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

  it('answers LSPTool queries by symbol, correct on the first call and after disk edits', async () => {
    writeFileSync(
      path.join(root, 'src', 'lib.ts'),
      'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n'
    );
    writeFileSync(
      path.join(root, 'src', 'main.ts'),
      "import { greet } from './lib';\n\nexport function run(): string {\n  return greet('a');\n}\n"
    );
    const lsp = buildTools(root, { enabled: ['LSPTool'], languageServerPort: manager }).find(
      tool => tool.name === 'LSPTool'
    ) as any;
    expect(lsp).toBeDefined();
    const call = async (args: Record<string, unknown>) => {
      const result = await lsp.execute('q', args);
      expect(result.details.ok).toBe(true);
      return JSON.parse(result.content[0].text);
    };

    // First query on a cold project: must reach the declaration, not stop at the import.
    const definition = await call({
      action: 'definition',
      file: 'src/main.ts',
      line: 4,
      symbol: 'greet',
    });
    expect(definition.locations[0]).toMatchObject({
      file: 'src/lib.ts',
      line: 1,
      preview: 'export function greet(name: string): string {',
    });

    const hover = await call({ action: 'hover', file: 'src/main.ts', line: 4, symbol: 'greet' });
    expect(hover.contents).toContain('greet(name: string): string');

    const callers = await call({
      action: 'incomingCalls',
      file: 'src/lib.ts',
      line: 1,
      symbol: 'greet',
    });
    expect(callers.calls[0].caller).toMatchObject({
      name: 'run',
      location: { file: 'src/main.ts' },
    });

    // A change made outside Edit/Write (think Bash `sed`) is visible to the next query.
    writeFileSync(
      path.join(root, 'src', 'main.ts'),
      "import { greet } from './lib';\n\nexport function run(): string {\n  return greet('a') + greet('b');\n}\n"
    );
    const references = await call({
      action: 'references',
      file: 'src/lib.ts',
      line: 1,
      symbol: 'greet',
    });
    const inMain = references.locations.filter(
      (l: any) => l.file === 'src/main.ts' && l.line === 4
    );
    expect(inMain).toHaveLength(2);
  }, 60_000);

  describe('write diagnostics beyond the edited file', () => {
    let lease: { release(): void };
    let tools: any[];
    const tool = (name: string) => tools.find(t => t.name === name);

    beforeAll(async () => {
      lease = manager.acquire(root, 'test-beyond');
      await until(() => manager.status().some(s => s.state === 'ready'), 30_000);
      tools = buildTools(root, {
        enabled: ['Read', 'Write', 'Edit'],
        diagnosticsProvider: createLanguageServerDiagnosticsProvider(manager, root, 15_000),
      });
    });
    afterAll(() => lease.release());

    it('answers a clean edit of a clean file at once', async () => {
      // typescript-language-server publishes nothing for empty → empty, so a
      // publish-only wait would sit out the whole budget here.
      await tool('Write').execute('c1', {
        file_path: 'src/clean.ts',
        content: 'export const c = 1;\n',
      });
      const started = Date.now();
      const res = await tool('Write').execute('c2', {
        file_path: 'src/clean.ts',
        content: 'export const c = 2;\n',
      });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(res.content[0].text).toContain('Diagnostics (TypeScript): no new errors');
    }, 60_000);

    it('reports a caller in another open file broken by a signature change', async () => {
      await tool('Write').execute('d1', {
        file_path: 'src/dep.ts',
        content: 'export function f(x: number): number {\n  return x;\n}\n',
      });
      const use = await tool('Write').execute('d2', {
        file_path: 'src/use.ts',
        content: "import { f } from './dep';\nexport const y = f(1);\n",
      });
      expect(use.content[0].text).toContain('Diagnostics (TypeScript): no new errors');

      const changed = await tool('Write').execute('d3', {
        file_path: 'src/dep.ts',
        content: 'export function f(x: string): string {\n  return x;\n}\n',
      });
      const text = changed.content[0].text as string;
      expect(text).toContain('Diagnostics (TypeScript): 1 error introduced in other open files:');
      expect(text).toMatch(/src\/use\.ts:2:\d+ Argument of type 'number' is not assignable/);
    }, 60_000);

    it('checks a patch after all of its files are written', async () => {
      await tool('Write').execute('p0', {
        file_path: 'src/p1.ts',
        content: 'export const one = 1;\n',
      });
      await tool('Read').execute('p0r', { path: 'src/p1.ts' });
      // p1 imports from p2, which the same patch adds afterwards.
      const res = await tool('Edit').execute('p1', {
        patch: [
          '*** Begin Patch',
          '*** Update File: src/p1.ts',
          '@@',
          '-export const one = 1;',
          "+import { two } from './p2';",
          '+export const one: number = two - 1;',
          '*** Add File: src/p2.ts',
          '+export const two = 2;',
          '*** End Patch',
        ].join('\n'),
      });
      expect(res.details.ok).toBe(true);
      const text = res.content[0].text as string;
      expect(text).toContain('Diagnostics (TypeScript): no new errors');
      expect(text).not.toContain('introduced');
    }, 60_000);
  });
});
