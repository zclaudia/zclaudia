/**
 * Built-in language-server presets (decision 1 of the LSP plan: presets come
 * before plugin / project configuration). TypeScript and Pyright ship with
 * zclaudia; Go and Rust servers are used when found on PATH.
 */
import {
  findOnPath,
  findVirtualEnvPython,
  findWorkspaceTsserver,
  hasRootMarker,
  memoizeByRoot,
  resolveBundledPyright,
  resolveBundledTypeScriptServer,
} from './detection.js';
import { fileUri } from './documents.js';
import type { LanguageServerPreset, LaunchSpec, LspRequest, RawLspDiagnostic } from './types.js';

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

interface TsServerDiagnostic {
  start?: { line?: number; offset?: number };
  text?: string;
  code?: number;
  category?: string;
}

interface TsServerResponse {
  success?: boolean;
  message?: string;
  body?: TsServerDiagnostic[];
}

const TS_SEVERITY: Record<string, number> = { error: 1, warning: 2, message: 3, suggestion: 4 };

/**
 * Pull a file's syntactic + semantic diagnostics from tsserver through
 * typescript-language-server's `typescript.tsserverRequest` command. Same
 * messages, codes and source as its pushed diagnostics, so the two compare.
 */
export async function pullTypeScriptDiagnostics(
  request: LspRequest,
  file: string,
  signal?: AbortSignal
): Promise<RawLspDiagnostic[]> {
  const diagnostics: RawLspDiagnostic[] = [];
  for (const command of ['syntacticDiagnosticsSync', 'semanticDiagnosticsSync']) {
    const response = await request<TsServerResponse | null>(
      'workspace/executeCommand',
      { command: 'typescript.tsserverRequest', arguments: [command, { file: fileUri(file) }] },
      signal
    );
    if (!response || response.success === false || !Array.isArray(response.body)) {
      throw new Error(response?.message ?? `tsserver ${command} returned no diagnostics`);
    }
    for (const diagnostic of response.body) {
      diagnostics.push({
        range: {
          start: {
            line: (diagnostic.start?.line ?? 1) - 1,
            character: (diagnostic.start?.offset ?? 1) - 1,
          },
        },
        severity: TS_SEVERITY[diagnostic.category ?? 'error'] ?? 1,
        message: diagnostic.text ?? '',
        source: 'typescript',
        ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
      });
    }
  }
  return diagnostics;
}

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
    refreshDetection: () => resolveLaunch.clear(),
    pullDiagnostics: pullTypeScriptDiagnostics,
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
  installHint?: string;
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
    ...(spec.installHint ? { installHint: spec.installHint } : {}),
    resolveLaunch: root => {
      if (!hasRootMarker(root, spec.rootMarkers)) return null;
      const executable = resolveExecutable('/');
      return executable ? { command: executable, args: spec.args, cwd: root } : null;
    },
    refreshDetection: () => resolveExecutable.clear(),
  };
}

const PYTHON_ROOT_MARKERS = [
  'pyproject.toml',
  'pyrightconfig.json',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
];

/**
 * What pyright is told through `workspace/configuration` (section `python`).
 * With a workspace venv it resolves imports from that interpreter. Without
 * one, an import it cannot resolve says more about the environment than the
 * code, so it is a warning: write diagnostics only report errors, and an agent
 * adding `import requests` must not be told it broke something. A project's
 * own pyrightconfig.json / [tool.pyright] still wins over these settings.
 */
export function pyrightSettings(venvPython: string | null): Record<string, unknown> {
  return {
    python: {
      ...(venvPython ? { pythonPath: venvPython } : {}),
      analysis: {
        // Sending `analysis` at all turns this off unless it is set.
        autoSearchPaths: true,
        ...(venvPython ? {} : { diagnosticSeverityOverrides: { reportMissingImports: 'warning' } }),
      },
    },
  };
}

export interface PyrightPresetDeps {
  resolveServer?: () => string | null;
  findVenvPython?: (root: string) => string | null;
  nodePath?: string;
}

/** Pyright ships with zclaudia (decision 2 of the P3 plan) and runs on the sidecar node. */
export function createPyrightPreset(deps: PyrightPresetDeps = {}): LanguageServerPreset {
  const resolveServer = deps.resolveServer ?? (() => resolveBundledPyright());
  const findVenvPython = deps.findVenvPython ?? findVirtualEnvPython;
  const nodePath = deps.nodePath ?? process.execPath;
  const resolveLaunch = memoizeByRoot((root: string): LaunchSpec | null => {
    if (!hasRootMarker(root, PYTHON_ROOT_MARKERS)) return null;
    const server = resolveServer();
    if (!server) return null;
    return {
      command: nodePath,
      args: [server, '--stdio'],
      cwd: root,
      settings: pyrightSettings(findVenvPython(root)),
    };
  });
  return {
    id: 'pyright',
    name: 'Python (Pyright)',
    languages: ['python'],
    extensions: { '.py': 'python', '.pyi': 'python' },
    rootMarkers: PYTHON_ROOT_MARKERS,
    resolveLaunch,
    refreshDetection: () => resolveLaunch.clear(),
  };
}

export const GOPLS_PRESET: PathPresetSpec = {
  id: 'gopls',
  name: 'Go (gopls)',
  languages: ['go'],
  extensions: { '.go': 'go' },
  rootMarkers: ['go.mod', 'go.work'],
  command: 'gopls',
  args: [],
  installHint: 'go install golang.org/x/tools/gopls@latest',
};

export const RUST_ANALYZER_PRESET: PathPresetSpec = {
  id: 'rust-analyzer',
  name: 'Rust (rust-analyzer)',
  languages: ['rust'],
  extensions: { '.rs': 'rust' },
  rootMarkers: ['Cargo.toml'],
  command: 'rust-analyzer',
  args: [],
  installHint: 'rustup component add rust-analyzer',
};

export function defaultLanguageServerPresets(): LanguageServerPreset[] {
  return [
    createTypeScriptPreset(),
    createPyrightPreset(),
    createPathPreset(GOPLS_PRESET),
    createPathPreset(RUST_ANALYZER_PRESET),
  ];
}
