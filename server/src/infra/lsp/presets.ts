/**
 * Built-in language-server presets (decision 1 of the LSP plan: presets come
 * before plugin / project configuration). P0 ships TypeScript only.
 */
import {
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

export function defaultLanguageServerPresets(): LanguageServerPreset[] {
  return [createTypeScriptPreset()];
}
