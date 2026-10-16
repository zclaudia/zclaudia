import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

// Tools must resolve paths through resolveInsideWorkspaces so a project's
// additional directories are honored. The single-root helper stays only as the
// wrapper itself and for the language-server-only rename refusal check.
const ALLOWED = new Set(['workspace-paths.ts', 'rename-symbol-tool.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (name === '__tests__') return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('pi-runtime workspace path resolution', () => {
  it('does not call the single-root resolveInsideWorkspace from tools', () => {
    const root = path.resolve(__dirname, '..');
    const offenders = sourceFiles(root)
      .filter(file => !ALLOWED.has(path.basename(file)))
      .filter(file => /\bresolveInsideWorkspace\(/.test(readFileSync(file, 'utf8')))
      .map(file => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
