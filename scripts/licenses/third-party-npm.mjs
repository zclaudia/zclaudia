// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/third-party-npm.mjs (Apache-2.0)
//
// npm 依赖实装清单与生产图读取。与 ZCode 原版的差异（适配 zclaudia 的 pnpm 隔离布局）：
// - scanInstalledPackages 额外枚举 node_modules/.pnpm 虚拟 store（pnpm 默认隔离布局下
//   传递依赖的实体只存在于 store 中，仅从顶层符号链接跟进触不到全部包）。
// - readInstallTargets 不依赖 `yaml` 包（根 node_modules 不可解析），只按需解析
//   pnpm-workspace.yaml 的 supportedArchitectures 段。
// - own workspace 前缀为 @zclaudia/。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const noticeName =
  /(?:^|[._-])(?:licen[sc]es?|copying|notice|copyright|unlicense|third.party|ofl)(?:[._-]|$)/iu;

// Windows 上 bare `pnpm` / `npm` 实际也是 cmd shim，需要 shell 负责解析
// （移植自 ZCode scripts/spawn-command.mjs 的 resolveSpawnRuntimeOptions）。
function spawnRuntimeOptions(command) {
  if (process.platform === 'win32' && /(^|[/\\])(pnpm|npm)(\.cmd|\.bat)?$/i.test(command)) {
    return { shell: true };
  }
  return {};
}

export async function readPackageNotices(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (['node_modules', '.git', 'test', 'tests', 'fixtures'].includes(entry.name)) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && noticeName.test(entry.name)) {
        const bytes = await readFile(full);
        if (bytes.includes(0) || bytes.length === 0) continue;
        files.push({ member: relative(directory, full).replaceAll('\\', '/'), bytes });
      } else if (entry.isFile() && /^readme(?:\.[^/]*)?$/iu.test(entry.name)) {
        const text = await readFile(full, 'utf8');
        const match = /^(?:#{1,6}\s+licen[sc]e[^\n]*\n|licen[sc]e\s*\n[=-]+\n)/imu.exec(text);
        if (match) {
          const section = text.slice(match.index).split(/\n(?=#{1,6}\s)/u)[0];
          files.push({
            member: `${relative(directory, full).replaceAll('\\', '/')} (license section)`,
            bytes: Buffer.from(section),
          });
        }
      }
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.member.localeCompare(b.member, 'en'));
}

// 解析锁文件（v9）packages 段的平台约束：`  'name@version':` 下的 `    os/cpu/libc: [..]` 行。
export function readLockfilePlatformConstraints(lockfileText) {
  const constraints = new Map();
  let inPackages = false;
  let key = null;
  for (const line of lockfileText.split(/\r?\n/u)) {
    if (/^\S/u.test(line)) {
      inPackages = line === 'packages:';
      key = null;
      continue;
    }
    if (!inPackages) continue;
    const header = /^ {2}(?:'([^']+)'|([^\s'][^:]*)):$/u.exec(line);
    if (header) {
      key = header[1] ?? header[2];
      continue;
    }
    const field = key && /^ {4}(os|cpu|libc): \[(.*)\]$/u.exec(line);
    if (field) {
      const values = field[2]
        .split(',')
        .map(value => value.trim().replace(/^'(.*)'$/u, '$1'))
        .filter(Boolean);
      constraints.set(key, { ...constraints.get(key), [field[1]]: values });
    }
  }
  return constraints;
}

// 照搬 pnpm package-is-installable 的 checkList，保证与实际安装结果一致（含否定项语义）。
function pnpmCheckList(values, list) {
  if (list.length === 1 && list[0] === 'any') return true;
  let match = false;
  let blc = 0;
  for (const value of values) {
    for (const item of list) {
      if (item[0] === '!') {
        if (item.slice(1) === value) return false;
        ++blc;
      } else {
        match = match || item === value;
      }
    }
  }
  return match || blc === list.length;
}

// targets.libc 为 null 表示宿主 libc 未知（非 Linux），pnpm 此时不检查 libc。
export function createInstallablePackageFilter(constraints, targets) {
  return (name, version) => {
    const wanted = constraints.get(`${name}@${version.split('(')[0]}`);
    if (!wanted) return true;
    if (wanted.os && !pnpmCheckList(targets.os, wanted.os)) return false;
    if (wanted.cpu && !pnpmCheckList(targets.cpu, wanted.cpu)) return false;
    if (wanted.libc && targets.libc && !pnpmCheckList(targets.libc, wanted.libc)) return false;
    return true;
  };
}

function hostLibc() {
  if (process.platform !== 'linux') return null;
  return process.report?.getReport?.()?.header?.glibcVersionRuntime ? 'glibc' : 'musl';
}

// 与 pnpm checkPlatform 相同：supportedArchitectures 未配置时只取宿主，`current` 替换为宿主值。
// pnpm-workspace.yaml 是根脚本唯一需要读取的 YAML；为不引入 `yaml` 依赖，这里只解析
// supportedArchitectures 段的 os/cpu/libc 列表（当前仓库未配置该段，返回宿主默认值）。
export async function readInstallTargets(root) {
  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const section = /^supportedArchitectures:$/mu.exec(workspace);
  const readList = field => {
    if (!section) return undefined;
    const from = workspace.indexOf(`  ${field}:`, section.index);
    if (from === -1) return undefined;
    const lines = workspace.slice(from).split(/\r?\n/u);
    if (lines[0] !== `  ${field}:`) return undefined;
    const values = [];
    for (const line of lines.slice(1)) {
      const item = /^ {4}- (.+)$/u.exec(line);
      if (!item) break;
      values.push(item[1].trim().replace(/^'(.*)'$/u, '$1'));
    }
    return values;
  };
  const resolveCurrent = (list, current) =>
    (list ?? ['current']).map(value => (value === 'current' ? current : value));
  const libc = hostLibc();
  return {
    os: resolveCurrent(readList('os'), process.platform),
    cpu: resolveCurrent(readList('cpu'), process.arch),
    libc: libc ? resolveCurrent(readList('libc'), libc) : null,
  };
}

// pnpm 按 supportedArchitectures 跳过的平台包（如 sharp / claude-agent-sdk 的其他平台构建）
// 从不安装、不分发，按锁文件平台约束整棵子树跳过，避免误报缺失。
export function productionPackages(projects, isInstallable = () => true) {
  const own = new Set(projects.map(project => project.name));
  const required = new Map();
  function dependencies(deps) {
    for (const [alias, info] of Object.entries(deps ?? {})) {
      const name = info.name ?? alias;
      if (!isInstallable(name, info.version)) continue;
      if (!own.has(name) && !name.startsWith('@zclaudia/') && !info.version.startsWith('link:')) {
        required.set(`${name}@${info.version}`, { name, version: info.version });
      }
      dependencies(info.dependencies);
      dependencies(info.optionalDependencies);
    }
  }
  for (const project of projects) {
    dependencies(project.dependencies);
    dependencies(project.optionalDependencies);
  }
  return required;
}

export function assertProductionGraphs(lockedProjects, installedProjects, isInstallable) {
  const locked = productionPackages(lockedProjects, isInstallable);
  const installed = productionPackages(installedProjects, isInstallable);
  const missing = [...locked].filter(([key]) => !installed.has(key));
  const stale = [...installed.keys()].filter(key => !locked.has(key));
  if (missing.length || stale.length) {
    throw new Error(
      `Installed production graph differs from pnpm-lock.yaml. Run pnpm install --frozen-lockfile.\nMissing: ${missing.map(([key]) => key).join(', ')}\nStale: ${stale.join(', ')}`
    );
  }
  return locked;
}

export async function readWorkspaceProductionGraph(root) {
  root = await realpath(root);
  // pnpm ls 默认读取安装快照，不能把旧图与当前锁文件哈希拼成有效声明；
  // 锁文件图与实装图各跑一次并断言一致。
  const [locked, actual] = await Promise.all(
    [true, false].map(async lockfileOnly => {
      const { stdout } = await exec(
        'pnpm',
        [
          '-r',
          'ls',
          '--prod',
          '--json',
          '--depth',
          'Infinity',
          ...(lockfileOnly ? ['--lockfile-only'] : []),
        ],
        {
          cwd: root,
          maxBuffer: 256 * 1024 * 1024,
          ...spawnRuntimeOptions('pnpm'),
        }
      );
      return JSON.parse(stdout);
    })
  );
  const isInstallable = createInstallablePackageFilter(
    readLockfilePlatformConstraints(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')),
    await readInstallTargets(root)
  );
  const required = assertProductionGraphs(locked, actual, isInstallable);
  return { required, projects: actual };
}

export async function scanInstalledPackages(root, projects) {
  // pnpm hoisted 布局的 ls.path 仍可能指向不存在的 .pnpm 路径；按真实安装目录和精确版本匹配。
  const installed = new Map();
  const visited = new Set();
  async function scanNodeModules(directory) {
    let actual;
    try {
      actual = await realpath(directory);
    } catch (error) {
      // ENOTDIR：`.pnpm/lock.yaml` 是普通文件，其下的 node_modules 路径不可进入。
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
      throw error;
    }
    if (visited.has(actual)) return;
    visited.add(actual);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(path)) await scanPackage(join(path, scoped));
      } else await scanPackage(path);
    }
  }
  async function scanPackage(directory) {
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
      throw error;
    }
    if (pkg.name && pkg.version) installed.set(`${pkg.name}@${pkg.version}`, { pkg, directory });
    await scanNodeModules(join(directory, 'node_modules'));
  }
  for (const project of projects) await scanNodeModules(join(project.path, 'node_modules'));
  await scanNodeModules(join(root, 'node_modules'));
  // pnpm 默认隔离布局：传递依赖的实体都在 node_modules/.pnpm/<pkg>@<ver>_<peers>/node_modules
  // 下，只从顶层符号链接跟进会漏掉大部分包；按 store 逐项枚举。
  let stores = [];
  try {
    stores = await readdir(join(root, 'node_modules', '.pnpm'));
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  }
  for (const store of stores) {
    if (store.startsWith('.')) continue;
    await scanNodeModules(join(root, 'node_modules', '.pnpm', store, 'node_modules'));
  }
  return installed;
}

export function missingProductionPackages(required, installed) {
  const missing = [...required].filter(([key]) => !installed.has(key)).map(([, item]) => item);
  for (const item of missing) {
    throw new Error(`Missing installed dependency: ${item.name}@${item.version}`);
  }
  return missing;
}

export async function collectNpmNotices(root, overrides) {
  root = await realpath(root);
  const { required, projects } = await readWorkspaceProductionGraph(root);
  // 标识门禁和声明生成必须扫描同一安装集合，避免嵌套版本只进声明、不进门禁。
  const installed = await scanInstalledPackages(root, projects);
  const packages = [];
  const missing = [];
  const notInstalled = missingProductionPackages(required, installed);
  for (const [key, item] of [...required].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const installedPackage = installed.get(key);
    if (!installedPackage) {
      continue;
    }
    const { pkg, directory } = installedPackage;
    const notices = await readPackageNotices(directory);
    const override = overrides.find(record => record.package === key);
    if (override?.file) {
      const bytes = await readFile(join(root, override.file));
      if (hashBytes(bytes) !== override.sha256) throw new Error(`Changed upstream notice: ${key}`);
      notices.push({ member: override.source, bytes });
    }
    // README 中仅有 MIT 等标签不能冒充完整许可文件；这种包仍需要版本固定的补充材料。
    if (
      !notices.some(({ member }) => !member.endsWith(' (license section)')) &&
      !override?.acceptedMissingNotice
    )
      missing.push(key);
    packages.push({
      ...item,
      license:
        pkg.license ??
        pkg.licenses?.map(item => (typeof item === 'string' ? item : item.type)).join(' OR ') ??
        override?.license ??
        '(not declared)',
      repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url,
      ...(override?.acceptedMissingNotice
        ? { acceptedMissingNotice: override.acceptedMissingNotice }
        : {}),
      notices,
    });
  }
  if (missing.length) throw new Error(`Missing complete upstream notices:\n${missing.join('\n')}`);
  return {
    packages,
    notInstalled,
    workspaceManifests: projects.map(project =>
      relative(root, join(project.path, 'package.json')).replaceAll('\\', '/')
    ),
  };
}
