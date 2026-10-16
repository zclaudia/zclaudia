#!/usr/bin/env node
// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/build-zcode.mjs (Apache-2.0)
//
// 组装 zclaudia 单命令发行包（差距分析 T4 §2.1/§2.8，第一梯队任务 E）：
// server bundle + web dist → dist/zclaudia/releases/<version>/zclaudia-<version>-<platform>-<arch>.tar.gz，
// 同时产出 sha256.txt、latest.json 与 install.sh（模板见 ./installer.mjs）。
//
// 用法:
//   pnpm build:distribution
//   node scripts/distribution/build.mjs --skip-build
//   node scripts/distribution/build.mjs --version 0.1.999 --out-dir dist/zclaudia
//   node scripts/distribution/build.mjs --base-url https://example.com/dist/zclaudia/
//
// Options:
//   --skip-build        复用既有 shared/server/desktop 构建产物与 server/bundle。
//   --version <text>    发行版本，默认读仓库根 package.json。
//   --out-dir <path>    输出目录，默认 dist/zclaudia（已在 .gitignore 的 dist/ 下）。
//   --base-url <url>    install.sh / latest.json 的下载根地址；默认读 ZCLAUDIA_DIST_BASE_URL。
//   --help, -h          显示本帮助。
//
// 与 ZCode 原版（scripts/build-zcode.mjs）的适配差异：
// - server 产物取 server/scripts/bundle.mjs 的自包含输出（server/bundle/：server.mjs +
//   内置插件 + vendor LSP + 预编译原生模块），而非 ZCode 的 tsc dist + 运行时 node_modules
//   拼装——本仓库 bundle.mjs 已解决原生模块 ABI 与 clean-room 安装，自包含性更好。
// - web 产物取 apps/desktop/dist（browser-shell.ts 期望的同一路径）。
// - tarball 文件名带 <platform>-<arch>（原版单平台命名 zcode-<v>.tar.gz）；latest.json
//   相应记录 platform/arch。多平台索引是后续项。
// - runner 复制为 <pkg>/bin/zclaudia.mjs；发行包内无 agent/TUI 形态（无 TUI 是既定范围）。
// - 代码格式按本仓库 prettier（单引号、分号、100 列）。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { installScriptSource } from './installer.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const defaultOutDir = resolve(root, 'dist', 'zclaudia');
const defaultBaseUrl = process.env.ZCLAUDIA_DIST_BASE_URL?.trim() || '';
const packageDirName = 'zclaudia';

const usage = `Usage:
  pnpm build:distribution
  node scripts/distribution/build.mjs --skip-build
  node scripts/distribution/build.mjs --version <text>
  node scripts/distribution/build.mjs --out-dir dist/zclaudia
  node scripts/distribution/build.mjs --base-url http://host/dist/zclaudia/

Options:
  --skip-build        Reuse existing shared/server/desktop outputs and server/bundle.
  --version <text>    Release version. Defaults to root package.json version.
  --out-dir <path>    Output directory. Defaults to dist/zclaudia.
  --base-url <url>    Default install.sh download base URL (env: ZCLAUDIA_DIST_BASE_URL).
  --help, -h          Show this help.
`;

function readArgValue(argv, arg, index) {
  if (arg.includes('=')) {
    return { nextIndex: index, value: arg.slice(arg.indexOf('=') + 1) };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${arg}`);
  }
  return { nextIndex: index + 1, value };
}

function parseArgs(argv) {
  const options = {
    baseUrl: defaultBaseUrl,
    help: false,
    outDir: defaultOutDir,
    skipBuild: false,
    version: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg === '--version' || arg.startsWith('--version=')) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.version = value;
      index = nextIndex;
      continue;
    }
    if (arg === '--out-dir' || arg.startsWith('--out-dir=')) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.outDir = resolve(root, value);
      index = nextIndex;
      continue;
    }
    if (arg === '--base-url' || arg.startsWith('--base-url=')) {
      const { nextIndex, value } = readArgValue(argv, arg, index);
      options.baseUrl = value.endsWith('/') ? value : `${value}/`;
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown option "${arg}". Run with --help for usage.`);
  }

  return options;
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args) {
  console.log(`[zclaudia] ${commandText(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`${commandText(command, args)} failed: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`${commandText(command, args)} failed`);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

async function assertFile(file, label) {
  const fileStat = await stat(file).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new Error(`Missing ${label}: ${file}`);
  }
}

async function assertDirectory(directory, label) {
  const directoryStat = await stat(directory).catch(() => null);
  if (!directoryStat?.isDirectory()) {
    throw new Error(`Missing ${label}: ${directory}`);
  }
}

// 构建顺序与 pnpm browser:build 一致：shared → server(tsc)；bundle.mjs 内部自行执行
// pnpm plugins:build 并 stage 内置插件；desktop build（tsc + vite → apps/desktop/dist）。
async function buildOutputs(skipBuild) {
  if (skipBuild) {
    console.log('[zclaudia] skipping build; reusing existing outputs');
    return;
  }

  run('pnpm', ['--filter', '@zclaudia/shared', 'run', 'build']);
  run('pnpm', ['--filter', '@zclaudia/server', 'run', 'build']);
  run(process.execPath, [resolve(root, 'server', 'scripts', 'bundle.mjs')]);
  run('pnpm', ['--filter', '@zclaudia/desktop', 'run', 'build']);
}

async function stagePackage({ packageRoot, version }) {
  const webDist = resolve(root, 'apps', 'desktop', 'dist');
  const serverBundle = resolve(root, 'server', 'bundle');

  await assertDirectory(webDist, 'web dist');
  await assertFile(resolve(webDist, 'index.html'), 'web dist index.html');
  await assertDirectory(serverBundle, 'server bundle');
  await assertFile(resolve(serverBundle, 'server.mjs'), 'server bundle entry (server.mjs)');
  // 原生模块（better-sqlite3/node-pty/@ast-grep/napi）以 externals 形式落在 bundle 的
  // node_modules/ 下，缺了包无法启动，一并把关。
  await assertDirectory(resolve(serverBundle, 'node_modules'), 'server bundle node_modules');

  await rm(packageRoot, { force: true, recursive: true });
  await mkdir(packageRoot, { recursive: true });

  await cp(webDist, resolve(packageRoot, 'web'), { recursive: true });
  await cp(serverBundle, resolve(packageRoot, 'server'), { recursive: true });

  await mkdir(resolve(packageRoot, 'bin'), { recursive: true });
  const runner = resolve(packageRoot, 'bin', 'zclaudia.mjs');
  await cp(resolve(root, 'scripts', 'distribution', 'runner.mjs'), runner);
  await chmod(runner, 0o755);

  await writeFile(
    resolve(packageRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'zclaudia-runtime',
        private: true,
        type: 'module',
        version,
      },
      null,
      2
    )
  );
}

async function createTarball({ packageParent, releaseDir, tarballName }) {
  await mkdir(releaseDir, { recursive: true });
  const tarball = resolve(releaseDir, tarballName);
  await rm(tarball, { force: true });
  run('tar', ['-czf', tarball, '-C', packageParent, packageDirName]);
  return tarball;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (!options.baseUrl) {
    throw new Error('Configure ZCLAUDIA_DIST_BASE_URL in the environment or pass --base-url');
  }

  const rootPackageJson = await readJson(resolve(root, 'package.json'));
  const version = options.version ?? rootPackageJson.version;
  if (!version || typeof version !== 'string') {
    throw new Error('Unable to resolve zclaudia version.');
  }

  await buildOutputs(options.skipBuild);

  const outDir = options.outDir;
  const workDir = resolve(outDir, '.work');
  const packageParent = workDir;
  const packageRoot = resolve(packageParent, packageDirName);
  const releaseDir = resolve(outDir, 'releases', version);
  const platformArch = `${process.platform}-${process.arch}`;
  const tarballName = `${packageDirName}-${version}-${platformArch}.tar.gz`;

  await rm(workDir, { force: true, recursive: true });
  await stagePackage({ packageRoot, version });
  const tarball = await createTarball({ packageParent, releaseDir, tarballName });
  const sha256 = await sha256File(tarball);
  await writeFile(resolve(releaseDir, 'sha256.txt'), `${sha256}  ${tarballName}\n`);

  await writeFile(
    resolve(outDir, 'latest.json'),
    JSON.stringify(
      {
        arch: process.arch,
        baseUrl: options.baseUrl,
        createdAt: new Date().toISOString(),
        name: packageDirName,
        platform: process.platform,
        sha256,
        tarball: tarballName,
        version,
      },
      null,
      2
    )
  );
  const installScript = resolve(outDir, 'install.sh');
  await writeFile(installScript, installScriptSource(options.baseUrl));
  await chmod(installScript, 0o755);
  await rm(workDir, { force: true, recursive: true });

  console.log(`[zclaudia] release directory: ${outDir}`);
  console.log(`[zclaudia] tarball: ${tarball}`);
  console.log(`[zclaudia] sha256: ${sha256}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
