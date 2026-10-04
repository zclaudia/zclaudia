/**
 * End to end with the real bundled typescript-language-server: Pi's Write
 * tool reports the type errors a write introduces, and only those.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLanguageServerDiagnosticsProvider } from '../../providers/pi-runtime/language-server-diagnostics.js';
import { buildTools } from '../../providers/pi-runtime/tool-bridge.js';
import { LanguageServerManager } from '../manager.js';

const require = createRequire(import.meta.url);
const typescriptPackage = path.dirname(require.resolve('typescript/package.json'));

async function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

describe('TypeScript write diagnostics (real language server)', () => {
  let root: string;
  let manager: LanguageServerManager;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'lsp-ts-'));
    mkdirSync(path.join(root, 'node_modules'));
    mkdirSync(path.join(root, 'src'));
    symlinkSync(typescriptPackage, path.join(root, 'node_modules', 'typescript'), 'dir');
    writeFileSync(path.join(root, 'package.json'), '{"name":"p","private":true}');
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] })
    );
    manager = new LanguageServerManager();
  });

  afterAll(async () => {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it('detects the server for a TypeScript project', () => {
    expect(manager.serversFor(root).map(s => s.id)).toEqual(['typescript']);
  });

  it('reports new errors after a write and not the ones already there', async () => {
    const lease = manager.acquire(root, 'test');
    try {
      await until(() => manager.status().some(s => s.state === 'ready'), 30_000);
      const write = buildTools(root, {
        enabled: ['Write'],
        diagnosticsProvider: createLanguageServerDiagnosticsProvider(manager, root, 15_000),
      }).find(tool => tool.name === 'Write') as any;

      const created = await write.execute('w1', {
        file_path: 'src/a.ts',
        content: 'export const a: string = 1;\n',
      });
      const createdText = created.content[0].text as string;
      expect(createdText).toContain('Diagnostics (TypeScript): 1 new error introduced');
      expect(createdText).toContain("src/a.ts:1:14 Type 'number' is not assignable");

      const updated = await write.execute('w2', {
        file_path: 'src/a.ts',
        content: 'export const a: string = 1;\nexport const b: number = "x";\n',
      });
      const updatedText = updated.content[0].text as string;
      expect(updatedText).toContain('Diagnostics (TypeScript): 1 new error introduced');
      expect(updatedText).toContain('src/a.ts:2:14');
      expect(updatedText).not.toContain('src/a.ts:1:14');

      const fixed = await write.execute('w3', {
        file_path: 'src/a.ts',
        content: 'export const a: string = "1";\nexport const b: number = 2;\n',
      });
      expect(fixed.content[0].text).toContain('Diagnostics (TypeScript): no new errors.');
    } finally {
      lease.release();
    }
  }, 60_000);
});
