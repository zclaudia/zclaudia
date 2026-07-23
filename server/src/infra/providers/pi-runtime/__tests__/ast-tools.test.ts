import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildTools } from '../tool-bridge.js';
import { collectAstFiles, substituteMetaVariables } from '../ast-tools.js';

function getTools(dir: string): Record<string, any> {
  const tools = buildTools(dir, { enabled: ['AstGrep', 'AstEdit'] });
  return Object.fromEntries(tools.map(t => [t.name, t]));
}

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zc-ast-'));
  writeFileSync(path.join(dir, 'a.ts'), 'console.log("hello");\nconst x = 1;\nconsole.log(x);\n');
  mkdirSync(path.join(dir, 'sub'));
  writeFileSync(path.join(dir, 'sub', 'b.ts'), 'function f() {\n  console.log("nested");\n}\n');
  writeFileSync(path.join(dir, 'notes.md'), 'console.log("not code")\n');
  return dir;
}

describe('AstGrep', () => {
  it('finds structural matches across files with metavariables', async () => {
    const dir = makeWorkspace();
    const res = await getTools(dir).AstGrep.execute('g1', { pattern: 'console.log($ARG)' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.matches).toBe(3);
    expect(res.content[0].text).toContain('a.ts:1');
    expect(res.content[0].text).toContain('sub/b.ts:2');
    expect(res.content[0].text).not.toContain('notes.md');
  });

  it('scopes the search to a subpath', async () => {
    const dir = makeWorkspace();
    const res = await getTools(dir).AstGrep.execute('g1', {
      pattern: 'console.log($ARG)',
      path: 'sub',
    });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.matches).toBe(1);
  });

  it('returns ok with zero matches for an unmatched pattern', async () => {
    const dir = makeWorkspace();
    const res = await getTools(dir).AstGrep.execute('g1', { pattern: 'alert($X)' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.matches).toBe(0);
  });
});

describe('collectAstFiles', () => {
  it('terminates on symlink cycles without duplicating files', async () => {
    const dir = makeWorkspace();
    // loop -> root, sub/up -> root: both resolve to an already-visited realpath.
    symlinkSync(dir, path.join(dir, 'loop'), 'dir');
    symlinkSync(dir, path.join(dir, 'sub', 'up'), 'dir');

    const files = await collectAstFiles(dir);
    const rel = files.map(f => path.relative(dir, f)).sort();
    rmSync(dir, { recursive: true, force: true });

    expect(rel).toEqual(['a.ts', 'sub/b.ts']);
  });

  it('skips vendor and node_modules directories', async () => {
    const dir = makeWorkspace();
    mkdirSync(path.join(dir, 'vendor'));
    writeFileSync(path.join(dir, 'vendor', 'v.ts'), 'console.log("v");\n');
    mkdirSync(path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, 'node_modules', 'n.ts'), 'console.log("n");\n');

    const files = await collectAstFiles(dir);
    const rel = files.map(f => path.relative(dir, f)).sort();
    rmSync(dir, { recursive: true, force: true });

    expect(rel).toEqual(['a.ts', 'sub/b.ts']);
  });

  it('follows symlinks to files', async () => {
    const dir = makeWorkspace();
    symlinkSync(path.join(dir, 'a.ts'), path.join(dir, 'linked.ts'));

    const files = await collectAstFiles(dir);
    const rel = files.map(f => path.relative(dir, f)).sort();
    rmSync(dir, { recursive: true, force: true });

    expect(rel).toEqual(['a.ts', 'linked.ts', 'sub/b.ts']);
  });
});

describe('substituteMetaVariables', () => {
  it('substitutes single and multi metavariables', () => {
    const fake = {
      getMatch: (name: string) => (name === 'ARG' ? { text: () => '"x"' } : null),
      getMultipleMatches: (name: string) =>
        name === 'ARGS' ? [{ text: () => 'a' }, { text: () => 'b' }] : [],
    };

    expect(substituteMetaVariables('logger.info($ARG)', fake as any)).toBe('logger.info("x")');

    expect(substituteMetaVariables('g($$$ARGS)', fake as any)).toBe('g(a, b)');
  });
});

describe('AstEdit', () => {
  it('dry_run previews the rewrite without writing', async () => {
    const dir = makeWorkspace();
    const res = await getTools(dir).AstEdit.execute('e1', {
      pattern: 'console.log($ARG)',
      rewrite: 'logger.info($ARG)',
      path: 'a.ts',
      dry_run: true,
    });
    const onDisk = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.preview).toBe(true);
    expect(res.details.replaced).toBe(2);
    expect(res.details.diff).toContain('logger.info("hello")');
    expect(onDisk).toContain('console.log("hello")');
  });

  it('applies the rewrite across files and reports per-file counts', async () => {
    const dir = makeWorkspace();
    const res = await getTools(dir).AstEdit.execute('e1', {
      pattern: 'console.log($ARG)',
      rewrite: 'logger.info($ARG)',
    });
    const a = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    const b = readFileSync(path.join(dir, 'sub', 'b.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.replaced).toBe(3);
    expect(a).toContain('logger.info("hello")');
    expect(a).toContain('logger.info(x)');
    expect(b).toContain('logger.info("nested")');
  });

  it('refuses to edit auto-generated files', async () => {
    const dir = makeWorkspace();
    writeFileSync(
      path.join(dir, 'gen.ts'),
      '// Code generated by protoc-gen-ts. DO NOT EDIT.\nconsole.log("gen");\n'
    );
    const res = await getTools(dir).AstEdit.execute('e1', {
      pattern: 'console.log($ARG)',
      rewrite: 'logger.info($ARG)',
      path: 'gen.ts',
    });
    const onDisk = readFileSync(path.join(dir, 'gen.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(false);
    expect(onDisk).toContain('console.log("gen")');
  });

  it('errors when nothing matches', async () => {
    const dir = makeWorkspace();
    const res = await getTools(dir).AstEdit.execute('e1', {
      pattern: 'alert($X)',
      rewrite: 'warn($X)',
    });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(false);
    expect(res.details.error).toBe('no_matches');
  });
});
