import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { parseApplyPatch } from '../apply-patch.js';
import { buildTools } from '../tool-bridge.js';

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), 'zc-apply-patch-'));
}

function getTools(dir: string): Record<string, any> {
  const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
  return Object.fromEntries(tools.map(t => [t.name, t]));
}

describe('parseApplyPatch', () => {
  it('parses a canonical update + add patch', () => {
    const operations = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        ' context',
        '-old',
        '+new',
        '*** Add File: b.ts',
        '+line one',
        '+line two',
        '*** End Patch',
      ].join('\n')
    );
    expect(operations).toEqual([
      { type: 'update', path: 'a.ts', oldText: 'context\nold\n', newText: 'context\nnew\n' },
      { type: 'add', path: 'b.ts', content: 'line one\nline two\n' },
    ]);
  });

  it('accepts a patch with a trailing newline after the end marker', () => {
    const operations = parseApplyPatch(
      '*** Begin Patch\n*** Delete File: a.ts\n*** End Patch\n'
    );
    expect(operations).toEqual([{ type: 'delete', path: 'a.ts' }]);
  });

  it('ignores blank lines around the markers', () => {
    const operations = parseApplyPatch(
      '\n\n*** Begin Patch\n*** Delete File: a.ts\n*** End Patch\n\n\n'
    );
    expect(operations).toEqual([{ type: 'delete', path: 'a.ts' }]);
  });

  it('treats a bare empty line inside an update hunk as a blank context line', () => {
    const operations = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        ' first',
        '',
        '-old',
        '+new',
        '*** End Patch',
      ].join('\n')
    );
    expect(operations).toEqual([
      { type: 'update', path: 'a.ts', oldText: 'first\n\nold\n', newText: 'first\n\nnew\n' },
    ]);
  });

  it('drops trailing blank separator lines at the end of an update hunk', () => {
    const operations = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-old',
        '+new',
        '',
        '*** Delete File: b.ts',
        '*** End Patch',
      ].join('\n')
    );
    expect(operations).toEqual([
      { type: 'update', path: 'a.ts', oldText: 'old\n', newText: 'new\n' },
      { type: 'delete', path: 'b.ts' },
    ]);
  });

  it('parses delete and rename operations', () => {
    const operations = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Delete File: gone.ts',
        '*** Rename File: old.ts -> new.ts',
        '*** End Patch',
      ].join('\n')
    );
    expect(operations).toEqual([
      { type: 'delete', path: 'gone.ts' },
      { type: 'rename', from: 'old.ts', to: 'new.ts' },
    ]);
  });

  it('rejects a patch without the end marker', () => {
    expect(() => parseApplyPatch('*** Begin Patch\n*** Delete File: a.ts\n')).toThrow(
      /Begin Patch.*End Patch/
    );
  });

  it('rejects a patch without the begin marker', () => {
    expect(() =>
      parseApplyPatch('*** Delete File: a.ts\n*** End Patch')
    ).toThrow(/Begin Patch.*End Patch/);
  });

  it('rejects an update hunk line without a -/+/space prefix', () => {
    expect(() =>
      parseApplyPatch(
        [
          '*** Begin Patch',
          '*** Update File: a.ts',
          '@@',
          '-old',
          'garbage line',
          '*** End Patch',
        ].join('\n')
      )
    ).toThrow(/Malformed update hunk.*a\.ts/);
  });

  it('rejects an add-file hunk line without a + prefix', () => {
    expect(() =>
      parseApplyPatch(
        ['*** Begin Patch', '*** Add File: a.ts', 'not added', '*** End Patch'].join('\n')
      )
    ).toThrow(/must start with "\+"/);
  });

  it('rejects a malformed rename operation', () => {
    expect(() =>
      parseApplyPatch('*** Begin Patch\n*** Rename File: only-from.ts\n*** End Patch')
    ).toThrow(/Invalid rename/);
  });

  it('rejects an unsupported operation', () => {
    expect(() =>
      parseApplyPatch('*** Begin Patch\n*** Frobnicate File: a.ts\n*** End Patch')
    ).toThrow(/Unsupported patch operation/);
  });
});

describe('apply patch integration', () => {
  it('applies a well-formed patch that ends with a trailing newline', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'a.ts' });
    const res = await tools.Edit.execute('e1', {
      patch:
        '*** Begin Patch\n*** Update File: a.ts\n@@\n-const a = 1;\n+const a = 2;\n*** End Patch\n',
    });
    const after = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(after).toBe('const a = 2;\n');
  });

  it('updates a hunk at EOF of a file without a trailing newline', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\nconst last = "old";');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'a.ts' });
    const res = await tools.Edit.execute('e1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const last = "old";',
        '+const last = "new";',
        '*** End Patch',
      ].join('\n'),
    });
    const after = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    // The file keeps its no-trailing-newline shape.
    expect(after).toBe('const a = 1;\nconst last = "new";');
  });

  it('updates a hunk at EOF of a file with a trailing newline', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\nconst last = "old";\n');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'a.ts' });
    const res = await tools.Edit.execute('e1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const last = "old";',
        '+const last = "new";',
        '*** End Patch',
      ].join('\n'),
    });
    const after = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(after).toBe('const a = 1;\nconst last = "new";\n');
  });

  it('applies rename and delete operations end to end', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'old.ts'), 'export const x = 1;\n');
    writeFileSync(path.join(dir, 'gone.ts'), 'export const y = 1;\n');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'old.ts' });
    await tools.Read.execute('r2', { path: 'gone.ts' });
    const res = await tools.Edit.execute('e1', {
      patch: [
        '*** Begin Patch',
        '*** Rename File: old.ts -> renamed.ts',
        '*** Delete File: gone.ts',
        '*** End Patch',
      ].join('\n'),
    });
    const renamed = readFileSync(path.join(dir, 'renamed.ts'), 'utf8');
    const oldExists = existsSync(path.join(dir, 'old.ts'));
    const goneExists = existsSync(path.join(dir, 'gone.ts'));
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(renamed).toBe('export const x = 1;\n');
    expect(oldExists).toBe(false);
    expect(goneExists).toBe(false);
  });
});
