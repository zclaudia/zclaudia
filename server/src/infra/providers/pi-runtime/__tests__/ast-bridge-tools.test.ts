import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { createAstEditTool, createAstGrepTool } from '../ast-bridge-tools.js';

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zc-ast-bridge-'));
  writeFileSync(path.join(dir, 'a.ts'), 'console.log("hello");\nconst x = 1;\nconsole.log(x);\n');
  mkdirSync(path.join(dir, 'sub'));
  writeFileSync(path.join(dir, 'sub', 'b.ts'), 'function f() {\n  console.log("nested");\n}\n');
  writeFileSync(path.join(dir, 'notes.md'), 'console.log("not code")\n');
  return dir;
}

describe('AST bridge tools', () => {
  it('AstGrep finds structural matches across code files', async () => {
    const dir = makeWorkspace();
    const grep = createAstGrepTool(dir) as any;

    const result = await grep.execute('g1', { pattern: 'console.log($ARG)' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.details.ok).toBe(true);
    expect(result.details.matches).toBe(3);
    expect(result.content[0].text).toContain('a.ts:1');
    expect(result.content[0].text).toContain('sub/b.ts:2');
    expect(result.content[0].text).not.toContain('notes.md');
  });

  it('AstEdit dry_run previews the rewrite without writing', async () => {
    const dir = makeWorkspace();
    const edit = createAstEditTool(dir) as any;

    const result = await edit.execute('e1', {
      pattern: 'console.log($ARG)',
      rewrite: 'logger.info($ARG)',
      path: 'a.ts',
      dry_run: true,
    });
    const onDisk = readFileSync(path.join(dir, 'a.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(result.details.ok).toBe(true);
    expect(result.details.preview).toBe(true);
    expect(result.details.replaced).toBe(2);
    expect(result.details.diff).toContain('logger.info("hello")');
    expect(onDisk).toContain('console.log("hello")');
  });
});
