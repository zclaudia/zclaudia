/**
 * Built-in language-server presets (decision 1 of the LSP plan: presets come
 * before plugin / project configuration). TypeScript ships with zclaudia; Python, Go and Rust servers are used when found on PATH.
 */
import {
  findOnPath,
  findWorkspaceTsserver,
  hasRootMarker,
  memoizeByRoot,
  resolveBundledTypeScriptServer,
} from './detection.js';
import type { LanguageServerPreset, LaunchSpec } from './types.js';

const TYPESCRIPT_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
};

const TYPESCRIPT_ROOT_MARKERS = ['tsconfig.json', 'jsconfig.json', 'package.json'];

export interface TypeScriptPresetDeps {
  resolveServer?: () => string | null;
  findTsserver?: (root: string) => string | null;
  nodePath?: string;
}

export function createTypeScriptPreset(deps: TypeScriptPresetDeps = {}): LanguageServerPreset {
  const resolveServer = deps.resolveServer ?? (() => resolveBundledTypeScriptServer());
  const findTsserver = deps.findTsserver ?? findWorkspaceTsserver;
  // The sidecar node in release builds, the project node in dev.
  const nodePath = deps.nodePath ?? process.execPath;
  const resolveLaunch = memoizeByRoot((root: string): LaunchSpec | null => {
    if (!hasRootMarker(root, TYPESCRIPT_ROOT_MARKERS)) return null;
    const server = resolveServer();
    const tsserver = findTsserver(root);
    if (!server || !tsserver) return null;
    return {
      command: nodePath,
      args: [server, '--stdio'],
      cwd: root,
      // Pin the TypeScript we detected so the server cannot pick a different one.
      initializationOptions: { tsserver: { path: tsserver }, hostInfo: 'zclaudia' },
    };
  });
  return {
    id: 'typescript',
    name: 'TypeScript',
    languages: ['typescript', 'javascript'],
    extensions: TYPESCRIPT_EXTENSIONS,
    rootMarkers: TYPESCRIPT_ROOT_MARKERS,
    resolveLaunch,
  };
}

export interface PathPresetSpec {
  id: string;
  name: string;
  languages: string[];
  extensions: Record<string, string>;
  rootMarkers: string[];
  command: string;
  args: string[];
}

/**
 * A preset whose server is an executable found on PATH (decision 2 of the LSP
 * plan: other languages are detected, never downloaded). The spec has the
 * same shape a plugin `lspServers` entry will have.
 */
export function createPathPreset(
  spec: PathPresetSpec,
  find: (command: string) => string | null = findOnPath
): LanguageServerPreset {
  // PATH lookups do not depend on the root; one memo entry serves every root.
  const resolveExecutable = memoizeByRoot(() => find(spec.command));
  return {
    id: spec.id,
    name: spec.name,
    languages: spec.languages,
    extensions: spec.extensions,
    rootMarkers: spec.rootMarkers,
    resolveLaunch: root => {
      if (!hasRootMarker(root, spec.rootMarkers)) return null;
      const executable = resolveExecutable('/');
      return executable ? { command: executable, args: spec.args, cwd: root } : null;
    },
  };
}

export const PYRIGHT_PRESET: PathPresetSpec = {
  id: 'pyright',
  name: 'Python (Pyright)',
  languages: ['python'],
  extensions: { '.py': 'python', '.pyi': 'python' },
  rootMarkers: [
    'pyproject.toml',
    'pyrightconfig.json',
    'setup.py',
    'setup.cfg',
    'requirements.txt',
    'Pipfile',
  ],
  command: 'pyright-langserver',
  args: ['--stdio'],
};

export const GOPLS_PRESET: PathPresetSpec = {
  id: 'gopls',
  name: 'Go (gopls)',
  languages: ['go'],
  extensions: { '.go': 'go' },
  rootMarkers: ['go.mod', 'go.work'],
  command: 'gopls',
  args: [],
};

export const RUST_ANALYZER_PRESET: PathPresetSpec = {
  id: 'rust-analyzer',
  name: 'Rust (rust-analyzer)',
  languages: ['rust'],
  extensions: { '.rs': 'rust' },
  rootMarkers: ['Cargo.toml'],
  command: 'rust-analyzer',
  args: [],
};

export function defaultLanguageServerPresets(): LanguageServerPreset[] {
  return [
    createTypeScriptPreset(),
    createPathPreset(PYRIGHT_PRESET),
    createPathPreset(GOPLS_PRESET),
    createPathPreset(RUST_ANALYZER_PRESET),
  ];
}
