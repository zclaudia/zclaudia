/**
 * End to end with the real bundled Pyright: Pi's Write tool reports the type
 * errors a write introduces in a Python project, imports resolve from the
 * workspace venv, and without a venv an unresolved import is not an error.
 */
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLanguageServerDiagnosticsProvider } from '../../providers/pi-runtime/language-server-diagnostics.js';
import { buildTools } from '../../providers/pi-runtime/tool-bridge.js';
import { LanguageServerManager } from '../manager.js';
import { createPyrightPreset } from '../presets.js';

async function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('Pyright write diagnostics (real language server)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function project(setup: (root: string) => void) {
    const root = mkdtempSync(path.join(tmpdir(), 'lsp-py-'));
    writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "p"\nversion = "0"\n');
    setup(root);
    const manager = new LanguageServerManager({ presets: [createPyrightPreset()] });
    const lease = manager.acquire(root, 'test');
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    cleanups.push(() => manager.dispose());
    cleanups.push(() => lease.release());
    await until(() => manager.status().some(s => s.state === 'ready'), 30_000);
    const write = buildTools(root, {
      enabled: ['Write'],
      diagnosticsProvider: createLanguageServerDiagnosticsProvider(manager, root, 15_000),
    }).find(tool => tool.name === 'Write') as any;
    return { root, manager, write };
  }

  it('reports a type error a write introduces, and answers a clean edit promptly', async () => {
    const { manager, root, write } = await project(() => undefined);
    expect(manager.serversFor(root).map(s => s.id)).toEqual(['pyright']);

    const broken = await write.execute('w1', {
      file_path: 'app.py',
      content: 'def f(x: int) -> int:\n    return x\n\nf("a")\n',
    });
    const brokenText = broken.content[0].text as string;
    expect(brokenText).toContain('Diagnostics (Python (Pyright)): 1 new error introduced');
    expect(brokenText).toMatch(/app\.py:4:\d+ Argument of type "Literal\['a'\]"/);

    await write.execute('w2', {
      file_path: 'app.py',
      content: 'def f(x: int) -> int:\n    return x\n\nf(1)\n',
    });
    const started = Date.now();
    const clean = await write.execute('w3', {
      file_path: 'app.py',
      content: 'def f(x: int) -> int:\n    return x\n\nf(2)\n',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(clean.content[0].text).toContain('Diagnostics (Python (Pyright)): no new errors');
  }, 90_000);

  it('does not call an unresolved import an error when there is no venv', async () => {
    const { write } = await project(() => undefined);
    const res = await write.execute('w1', {
      file_path: 'app.py',
      content: 'import zclaudia_not_installed_pkg\n\nx: int = 1\n',
    });
    expect(res.content[0].text).toContain('Diagnostics (Python (Pyright)): no new errors');
  }, 90_000);

  it.skipIf(!hasPython())(
    'resolves imports from the workspace .venv',
    async () => {
      const { write } = await project(root => {
        execFileSync('python3', ['-m', 'venv', '--without-pip', path.join(root, '.venv')]);
        const lib = path.join(root, '.venv', 'lib');
        const pythonDir = readdirSync(lib).find(name => name.startsWith('python'))!;
        const sitePackages = path.join(lib, pythonDir, 'site-packages');
        mkdirSync(path.join(sitePackages, 'venvonly'), { recursive: true });
        writeFileSync(
          path.join(sitePackages, 'venvonly', '__init__.py'),
          'def answer() -> int:\n    return 42\n'
        );
      });
      // Resolved from the venv: its types flow, so a misuse is an error...
      const res = await write.execute('w1', {
        file_path: 'app.py',
        content: 'from venvonly import answer\n\ns: str = answer()\n',
      });
      const text = res.content[0].text as string;
      expect(text).toContain('1 new error introduced');
      expect(text).toMatch(/app\.py:3:\d+ Type "int" is not assignable to declared type "str"/);
      // ...and with a venv, a missing package is a real error again.
      const missing = await write.execute('w2', {
        file_path: 'other.py',
        content: 'import zclaudia_not_installed_pkg\n',
      });
      expect(missing.content[0].text).toMatch(
        /Import "zclaudia_not_installed_pkg" could not be resolved/
      );
    },
    90_000
  );
});
