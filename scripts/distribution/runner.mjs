#!/usr/bin/env node
// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/zcode-distribution/runner.mjs (Apache-2.0)
//
// zclaudia 单命令分发入口（差距分析 T4 §2.1，第一梯队任务 E）。设计为打进发行包后位于
// <pkg>/bin/zclaudia.mjs，运行时根目录 <pkg> 由本文件位置推断：<pkg>/server 是
// server/scripts/bundle.mjs 产出的自包含 server bundle，<pkg>/web 是 apps/desktop/dist。
// 在源码仓里直接跑 --web 不成立（缺打包产物）——请先 pnpm build:distribution。
// 零依赖：仅使用 node 内置模块。
//
// 用法:
//   zclaudia --web [--host <host>] [--port <port>] [--token <token>|--no-token]
//   zclaudia --check --staging-dir <dir>
//   zclaudia --version
//   zclaudia --help
//
// 无 TUI 形态：无参数时打印用法并以退出码 0 结束（ZCode 的无参数进 TUI 分支在此退化）。
//
// 与 ZCode 原版的适配差异：
// - server 入口改为 bundle 产物 <root>/server/server.mjs，用系统 node 直接拉起；
//   web 静态根经 ZCLAUDIA_BROWSER_DIST 传给 server（browser-shell.ts:16-21 的既有约定）。
// - 监听 host 经 SERVER_HOST 环境变量传递（trust-boundary.ts:17-20）。
// - token 逻辑沿用 ZCode：非 127.0.0.1/localhost 监听自动生成访问 token 并打印带 token 的
//   URL，经 ZCLAUDIA_SERVER_AUTH_TOKEN 传给子进程。注意：zclaudia server 目前尚无消费该
//   变量的鉴权中间件（远端请求走 gateway clientId Bearer，见 express-auth.ts），server 端
//   强制是后续项；runner 侧已按 ZCode 语义生成与传递。
// - 新增 --check 自检模式：校验发行包目录结构完整，不起服务（供门禁与打包后冒烟）。
// - 去掉 --workspace/--open：zclaudia server 是多项目 DB 驱动（数据目录默认 ~/.zclaudia），
//   无单 workspace 概念；打开浏览器不在本命令职责内。
// - 代码格式按本仓库 prettier（单引号、分号、100 列）。

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 打包内布局：<root>/bin/zclaudia.mjs（本文件）、<root>/server/server.mjs、<root>/web/。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = join(root, 'server', 'server.mjs');
const webRoot = join(root, 'web');

function usage() {
  return `Usage:
  zclaudia --web [--host <host>] [--port <port>] [--token <token>|--no-token]
  zclaudia --check --staging-dir <dir>
  zclaudia --version

Options:
  --web                Start the bundled server with the bundled web UI.
  --host <host>        Bind address (default: 127.0.0.1). Non-local hosts get an access token.
  --port <port>        TCP port (default: pick a free port).
  --token <token>      Use a specific access token (web mode).
  --no-token           Disable the access token (web mode).
  --check              Validate a staged distribution directory, then exit.
  --staging-dir <dir>  Staged package root to validate (with --check).
  --help, -h           Show this help.
`;
}

async function resolveVersion() {
  // 打包形态读 <root>/package.json；在源码仓里直接跑时回落到仓库根。
  for (const candidate of [join(root, 'package.json'), join(root, '..', 'package.json')]) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8'));
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // 尝试下一个候选位置。
    }
  }
  return undefined;
}

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

function parseWebArgs(argv) {
  const options = {
    command: 'serve',
    host: '127.0.0.1',
    port: undefined,
    token: undefined,
    tokenEnabled: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.command = 'help';
      continue;
    }
    if (arg === '--host' || arg.startsWith('--host=')) {
      const parsed = readArgValue(argv, arg, index);
      options.host = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--port' || arg.startsWith('--port=')) {
      const parsed = readArgValue(argv, arg, index);
      options.port = Number(parsed.value);
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error('--port must be an integer between 0 and 65535');
      }
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--token' || arg.startsWith('--token=')) {
      const parsed = readArgValue(argv, arg, index);
      options.token = parsed.value;
      options.tokenEnabled = true;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--no-token') {
      options.tokenEnabled = false;
      continue;
    }
    throw new Error(`Unknown option "${arg}".\n${usage()}`);
  }

  return options;
}

function parseCheckArgs(argv) {
  const options = { command: 'check', stagingDir: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.command = 'help';
      continue;
    }
    if (arg === '--staging-dir' || arg.startsWith('--staging-dir=')) {
      const parsed = readArgValue(argv, arg, index);
      options.stagingDir = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    throw new Error(`Unknown option "${arg}".\n${usage()}`);
  }

  if (!options.stagingDir) {
    throw new Error('--check requires --staging-dir <dir>.\n' + usage());
  }

  return options;
}

function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function shouldProtectHost(host) {
  return !isLocalHost(host);
}

function createToken() {
  return randomBytes(24).toString('base64url');
}

function pickPort(host) {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function formatUrl(host, port, token) {
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const base = `http://${displayHost}:${port}/`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function networkUrls(port, token) {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') {
        continue;
      }
      const base = `http://${entry.address}:${port}/`;
      urls.push(token ? `${base}?token=${encodeURIComponent(token)}` : base);
    }
  }
  return urls;
}

async function assertRuntimeFiles() {
  for (const file of [serverEntry, join(webRoot, 'index.html')]) {
    await access(file).catch(cause => {
      throw new Error(`Missing runtime file: ${file}`, { cause });
    });
  }
}

async function serve(options) {
  await assertRuntimeFiles();
  const port = options.port && options.port > 0 ? options.port : await pickPort(options.host);
  const protect = options.tokenEnabled ?? shouldProtectHost(options.host);
  const token = protect ? (options.token ?? createToken()) : '';
  const localUrl = formatUrl(options.host, port, token);

  const child = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      // server 端监听 host 从 SERVER_HOST 读取（trust-boundary.ts:17-20）。
      SERVER_HOST: options.host,
      // web 静态根（browser-shell.ts:16-21）。
      ZCLAUDIA_BROWSER_DIST: webRoot,
      // 显式关闭 token 时必须传空串清掉继承值，否则 --no-token 仍会带着旧 token。
      ZCLAUDIA_SERVER_AUTH_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let shuttingDown = false;
  child.on('error', error => {
    console.error(`Unable to start zclaudia server: ${error.message}`);
    process.exit(1);
  });

  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(0);
    }
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  console.log('');
  console.log('zclaudia Web is running');
  console.log(`Local:   ${localUrl}`);
  if (options.host === '0.0.0.0' || options.host === '::') {
    for (const url of networkUrls(port, token)) {
      console.log(`Network: ${url}`);
    }
  }
  console.log('Press Ctrl+C to stop.');
  console.log('');

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', chunk => {
      if (chunk.includes(3)) {
        shutdown();
      }
    });
    process.stdin.on('error', () => {
      if (!shuttingDown) {
        shutdown();
      }
    });
  }
}

// 发行包最小布局：与 build.mjs 的 stage 产物一一对应。
const REQUIRED_STAGING_FILES = ['package.json', 'server/server.mjs', 'web/index.html'];

async function checkStaging(stagingDir) {
  const target = resolve(stagingDir);
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat?.isDirectory()) {
    console.error(`Staging directory not found: ${target}`);
    return 1;
  }

  const missing = [];
  for (const relative of REQUIRED_STAGING_FILES) {
    const fileStat = await stat(join(target, relative)).catch(() => null);
    if (!fileStat?.isFile()) {
      missing.push(relative);
    }
  }

  if (missing.length > 0) {
    console.error(`Staging layout incomplete in ${target}:`);
    for (const item of missing) {
      console.error(`  missing: ${item}`);
    }
    return 1;
  }

  console.log(`Staging layout OK: ${target}`);
  return 0;
}

try {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) {
    // 无 TUI：打印用法并成功退出。
    console.log(usage());
  } else if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) {
    const version = await resolveVersion();
    console.log(version ?? 'unknown');
  } else if (argv[0] === '--web') {
    const options = parseWebArgs(argv.slice(1));
    if (options.command === 'help') console.log(usage());
    else await serve(options);
  } else if (argv[0] === '--check') {
    const options = parseCheckArgs(argv.slice(1));
    if (options.command === 'help') console.log(usage());
    else process.exit(await checkStaging(options.stagingDir));
  } else {
    throw new Error(`Unknown argument "${argv[0]}".\n${usage()}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
