/**
 * Executable detection for language-server presets. Everything here is sync
 * (`resolveLaunch` feeds the sync `serversFor`) and memoised per root, so a
 * run's tool-list build costs a few `existsSync` calls at most once a minute.
 */
import { accessSync, constants, existsSync, readdirSync, statSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const DETECTION_TTL_MS = 60_000;

/** Memoise a per-root probe for `ttlMs`; `now` is injectable for tests. */
export function memoizeByRoot<T>(
  probe: (root: string) => T,
  ttlMs = DETECTION_TTL_MS,
  now: () => number = Date.now
): ((root: string) => T) & { clear(): void } {
  const cache = new Map<string, { at: number; value: T }>();
  const memoized = (root: string) => {
    const key = path.resolve(root);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = probe(key);
    cache.set(key, { at: now(), value });
    return value;
  };
  return Object.assign(memoized, { clear: () => cache.clear() });
}

export function hasRootMarker(root: string, markers: string[]): boolean {
  return markers.some(marker => existsSync(path.join(root, marker)));
}

const WORKSPACE_PACKAGE_DEPTH = 2;

function tsserverIn(dir: string): string | null {
  const candidate = path.join(dir, 'node_modules', 'typescript', 'lib', 'tsserver.js');
  return existsSync(candidate) ? candidate : null;
}

function childDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The project's own TypeScript server. typescript-language-server has no
 * TypeScript of its own, so a project without one gets no server.
 *
 * Searched from `root` upwards first (hoisted installs), then down through
 * workspace packages up to two levels (`server/`, `apps/desktop/`): pnpm
 * monorepos often have no TypeScript in the root `node_modules` at all.
 */
export function findWorkspaceTsserver(root: string): string | null {
  let dir = path.resolve(root);
  for (;;) {
    const found = tsserverIn(dir);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  let level = childDirectories(path.resolve(root));
  for (let depth = 1; depth <= WORKSPACE_PACKAGE_DEPTH && level.length > 0; depth++) {
    for (const candidate of level) {
      const found = tsserverIn(candidate);
      if (found) return found;
    }
    level = level.flatMap(childDirectories);
  }
  return null;
}

/**
 * typescript-language-server's CLI, shipped with zclaudia: the release bundle
 * copies it to `vendor/` beside server.mjs (see scripts/bundle.mjs); dev
 * resolves the package dependency.
 */
export function resolveBundledTypeScriptServer(moduleUrl: string = import.meta.url): string | null {
  const vendored = path.resolve(
    path.dirname(fileURLToPath(moduleUrl)),
    'vendor',
    'typescript-language-server',
    'lib',
    'cli.mjs'
  );
  if (existsSync(vendored)) return vendored;
  try {
    const req = createRequire(moduleUrl);
    const pkg = req.resolve('typescript-language-server/package.json');
    const cli = path.join(path.dirname(pkg), 'lib', 'cli.mjs');
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

const SOURCE_SEARCH_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target']);
const SOURCE_SEARCH_MAX_DIRS = 2_000;

/**
 * First source file with one of `extensions`, breadth first from `root`
 * (skipping dependencies, build output and dot directories). Used to load a
 * project when a workspace-wide query arrives before any file was opened.
 */
export function findFirstSourceFile(root: string, extensions: string[]): string | null {
  const wanted = new Set(extensions.map(ext => ext.toLowerCase()));
  const queue = [path.resolve(root)];
  for (let visited = 0; queue.length > 0 && visited < SOURCE_SEARCH_MAX_DIRS; visited++) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && wanted.has(path.extname(entry.name).toLowerCase())) {
        if (!entry.name.endsWith('.d.ts')) return path.join(dir, entry.name);
      }
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !SOURCE_SEARCH_SKIP.has(entry.name)
      ) {
        queue.push(path.join(dir, entry.name));
      }
    }
  }
  return null;
}

/**
 * Where language servers usually land besides PATH. Apps launched from the
 * macOS Dock inherit a minimal PATH without these, so search them too.
 */
function extraSearchDirs(): string[] {
  const home = os.homedir();
  const gopath = process.env.GOPATH?.split(path.delimiter)[0];
  return [
    gopath ? path.join(gopath, 'bin') : path.join(home, 'go', 'bin'),
    path.join(process.env.CARGO_HOME ?? path.join(home, '.cargo'), 'bin'),
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Absolute path of `command` on PATH (plus the usual install dirs), or null. */
export function findOnPath(command: string, pathValue = process.env.PATH ?? ''): string | null {
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  const dirs = [...pathValue.split(path.delimiter).filter(Boolean), ...extraSearchDirs()];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}
