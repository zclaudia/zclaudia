/**
 * A user-defined server end to end, with the real clangd when it is on PATH:
 * defined like Settings defines one, it reports the errors a write introduces.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLanguageServerDiagnosticsProvider } from '../../providers/pi-runtime/language-server-diagnostics.js';
import { buildTools } from '../../providers/pi-runtime/tool-bridge.js';
import { findOnPath } from '../detection.js';
import { LanguageServerManager } from '../manager.js';
import { createConfiguredPreset } from '../presets.js';
import { LanguageServerRegistry } from '../registry.js';

const clangd = findOnPath('clangd');

async function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

describe.skipIf(!clangd)('a custom language server (real clangd)', () => {
  let root: string;
  let manager: LanguageServerManager;
  let lease: { release(): void };
  let write: any;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'lsp-clangd-'));
    writeFileSync(path.join(root, 'compile_flags.txt'), '-std=c11\n');
    const registry = new LanguageServerRegistry([]);
    registry.setUserPresets([
      createConfiguredPreset({
        id: 'clangd',
        name: 'C (clangd)',
        command: 'clangd',
        extensions: { '.c': 'c', '.h': 'c' },
        rootMarkers: ['compile_flags.txt'],
      }),
    ]);
    manager = new LanguageServerManager({ registry });
    lease = manager.acquire(root, 'test');
    await until(() => manager.status().some(s => s.state === 'ready'), 30_000);
    write = buildTools(root, {
      enabled: ['Write'],
      diagnosticsProvider: createLanguageServerDiagnosticsProvider(manager, root, 15_000),
    }).find(tool => tool.name === 'Write');
  });

  afterAll(async () => {
    lease?.release();
    await manager?.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the error a write introduces, and answers a clean edit promptly', async () => {
    expect(manager.statusFor(root)).toEqual([
      expect.objectContaining({ id: 'clangd', source: 'user', state: 'ready' }),
    ]);
    const broken = await write.execute('w1', {
      file_path: 'main.c',
      content: 'int main(void) {\n  int x = "s";\n  return x;\n}\n',
    });
    const text = broken.content[0].text as string;
    expect(text).toContain('Diagnostics (C (clangd)):');
    expect(text).toMatch(/main\.c:2:\d+ .*(incompatible|initializing)/i);

    await write.execute('w2', {
      file_path: 'main.c',
      content: 'int main(void) {\n  return 0;\n}\n',
    });
    const started = Date.now();
    const clean = await write.execute('w3', {
      file_path: 'main.c',
      content: 'int main(void) {\n  return 1;\n}\n',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(clean.content[0].text).toContain('Diagnostics (C (clangd)): no new errors');
  }, 90_000);
});
