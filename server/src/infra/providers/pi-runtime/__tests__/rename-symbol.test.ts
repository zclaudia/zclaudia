import { createHash } from 'crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceEditToFileEdits } from '../../../lsp/rename.js';
import {
  LanguageServerError,
  type LanguageServerPort,
  type LspRenameResult,
  type LspTextEdit,
} from '../../language-server-port.js';
import { applyFileEditsAtomically, applyTextEdits } from '../edit-write/apply-text-edits.js';
import { buildTools } from '../tool-bridge.js';

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

function edit(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  newText: string
): LspTextEdit {
  return { startLine, startCharacter, endLine, endCharacter, newText };
}

describe('applyTextEdits', () => {
  it('applies edits by LSP position, in any order, keeping CRLF and lone CR lines', () => {
    expect(applyTextEdits('a b\r\nb a\rb\n', [edit(1, 0, 1, 1, 'x'), edit(0, 2, 0, 3, 'x')])).toBe(
      'a x\r\nx a\rb\n'
    );
    expect(applyTextEdits('one\rtwo', [edit(1, 0, 1, 3, 'TWO')])).toBe('one\rTWO');
  });

  it('counts columns in UTF-16 code units and clamps past the line end', () => {
    expect(applyTextEdits('😀 foo\n', [edit(0, 3, 0, 6, 'bar')])).toBe('😀 bar\n');
    expect(applyTextEdits('ab\ncd', [edit(0, 1, 0, 99, 'Z')])).toBe('aZ\ncd');
  });

  it('refuses overlapping edits', () => {
    expect(() => applyTextEdits('abcdef', [edit(0, 0, 0, 3, 'x'), edit(0, 2, 0, 4, 'y')])).toThrow(
      /overlap/
    );
  });
});

describe('workspaceEditToFileEdits', () => {
  it('reads both WorkspaceEdit shapes, preferring documentChanges', () => {
    const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
    const fromChanges = workspaceEditToFileEdits({
      changes: { 'file:///w/a.ts': [{ range, newText: 'x' }] },
    });
    expect([...fromChanges.entries()]).toEqual([['/w/a.ts', [edit(0, 1, 0, 2, 'x')]]]);
    const fromDocumentChanges = workspaceEditToFileEdits({
      changes: { 'file:///w/ignored.ts': [{ range, newText: 'x' }] },
      documentChanges: [
        { textDocument: { uri: 'file:///w/b.ts', version: 1 }, edits: [{ range, newText: 'y' }] },
      ],
    });
    expect([...fromDocumentChanges.keys()]).toEqual(['/w/b.ts']);
  });

  it('refuses file operations as a whole', () => {
    expect(() =>
      workspaceEditToFileEdits({
        documentChanges: [{ kind: 'rename', oldUri: 'file:///w/a.rs', newUri: 'file:///w/b.rs' }],
      })
    ).toThrow(expect.objectContaining({ code: 'unsupported_edit' }));
  });
});

describe('applyFileEditsAtomically', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zc-apply-edits-'));
  });
  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  function file(relative: string, content: string) {
    const absolutePath = path.join(dir, relative);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
    return { absolutePath, path: relative, contentHash: sha1(content) };
  }

  it('writes nothing when any file changed since the edits were computed', async () => {
    const a = file('a.ts', 'foo\n');
    const b = file('b.ts', 'foo\n');
    writeFileSync(b.absolutePath, 'foo // changed\n');
    const result = await applyFileEditsAtomically(
      [
        { ...a, edits: [edit(0, 0, 0, 3, 'bar')] },
        { ...b, edits: [edit(0, 0, 0, 3, 'bar')] },
      ],
      undefined
    );
    expect(result).toMatchObject({ ok: false, error: 'stale_content', path: 'b.ts' });
    expect(readFileSync(a.absolutePath, 'utf8')).toBe('foo\n');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'restores the files already written when a later write fails',
    async () => {
      const a = file('a.ts', 'foo\n');
      const b = file('locked/b.ts', 'foo\n');
      chmodSync(path.dirname(b.absolutePath), 0o555); // the temp file cannot be created
      try {
        const result = await applyFileEditsAtomically(
          [
            { ...a, edits: [edit(0, 0, 0, 3, 'bar')] },
            { ...b, edits: [edit(0, 0, 0, 3, 'bar')] },
          ],
          undefined
        );
        expect(result).toMatchObject({ ok: false, error: 'apply_failed', path: 'locked/b.ts' });
        expect(result.ok === false && result.message).toContain('restored');
        expect(readFileSync(a.absolutePath, 'utf8')).toBe('foo\n');
      } finally {
        chmodSync(path.dirname(b.absolutePath), 0o755);
      }
    }
  );

  it('keeps a BOM and CRLF, and previews without writing', async () => {
    const a = file('a.ts', '﻿const foo = 1;\r\nfoo;\r\n');
    const edits = [edit(0, 7, 0, 10, 'bar'), edit(1, 0, 1, 3, 'bar')];
    const preview = await applyFileEditsAtomically([{ ...a, edits }], undefined, {
      previewOnly: true,
    });
    expect(preview).toMatchObject({ ok: true });
    expect(readFileSync(a.absolutePath, 'utf8')).toBe('﻿const foo = 1;\r\nfoo;\r\n');

    const applied = await applyFileEditsAtomically([{ ...a, edits }], undefined);
    expect(applied).toMatchObject({ ok: true });
    expect(readFileSync(a.absolutePath)).toEqual(
      Buffer.from('﻿const bar = 1;\r\nbar;\r\n', 'utf8')
    );
  });
});

describe('RenameSymbol tool', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zc-rename-tool-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function write(relative: string, content: string) {
    const absolute = path.join(dir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    return absolute;
  }

  /** A port whose rename renames `foo` to the new name in the given files. */
  function portRenaming(files: string[], overrides: Partial<LspRenameResult> = {}) {
    return {
      serversFor: () => [{ id: 'fake', name: 'Fake', languages: ['ts'] }],
      query: vi.fn(),
      rename: vi.fn(
        async (): Promise<LspRenameResult> => ({
          oldName: 'foo',
          files: files.map(relative => {
            const absolute = path.join(dir, relative);
            const text = readFileSync(absolute, 'utf8');
            const column = text.indexOf('foo');
            return {
              file: absolute,
              path: relative,
              contentHash: sha1(text),
              edits: [edit(0, column, 0, column + 3, 'bar')],
            };
          }),
          ...overrides,
        })
      ),
    } satisfies LanguageServerPort;
  }

  const tool = (port: LanguageServerPort, enabled = ['RenameSymbol', 'Edit']) =>
    buildTools(dir, { enabled, languageServerPort: port });

  it('is only offered with a language server that can rename', () => {
    const queryOnly = { serversFor: () => [{ id: 'f', name: 'F', languages: [] }], query: vi.fn() };
    expect(tool(queryOnly, ['RenameSymbol'])).toEqual([]);
    const noServers = { ...portRenaming([]), serversFor: () => [] };
    expect(tool(noServers, ['RenameSymbol'])).toEqual([]);
    expect(tool(portRenaming([]), ['RenameSymbol']).map(t => t.name)).toEqual(['RenameSymbol']);
  });

  it('renames across files and leaves them editable without a Read', async () => {
    write('a.ts', 'export const foo = 1;\n');
    write('b.ts', "import { foo } from './a';\n");
    const port = portRenaming(['a.ts', 'b.ts']);
    const [rename, editTool] = tool(port) as any[];

    const res = await rename.execute('r1', {
      file_path: 'b.ts',
      line: 1,
      symbol: 'foo',
      new_name: 'bar',
    });
    expect(port.rename).toHaveBeenCalledWith(
      expect.objectContaining({ line: 1, character: 10, newName: 'bar' }),
      undefined
    );
    expect(res.content[0].text).toContain('Renamed foo → bar');
    expect(res.details).toMatchObject({ ok: true, fileCount: 2, editCount: 2 });
    expect(readFileSync(path.join(dir, 'a.ts'), 'utf8')).toBe('export const bar = 1;\n');

    // The rename recorded the new content: Edit needs no Read first.
    const edited = await editTool.execute('e1', {
      file_path: 'a.ts',
      old_string: 'bar = 1',
      new_string: 'bar = 2',
    });
    expect(edited.details.ok).toBe(true);
  });

  it.each([
    ['a sensitive file', '.env', 'a sensitive file'],
    ['a dependency', 'node_modules/lib/index.ts', 'a dependency'],
  ])('refuses the whole rename when it would touch %s', async (_label, relative, reason) => {
    write('a.ts', 'export const foo = 1;\n');
    write(relative, 'foo\n');
    const [rename] = tool(portRenaming(['a.ts', relative])) as any[];
    const res = await rename.execute('r2', {
      file_path: 'a.ts',
      line: 1,
      symbol: 'foo',
      new_name: 'bar',
    });
    expect(res.details).toMatchObject({ ok: false, error: 'rename_refused' });
    expect(res.content[0].text).toContain(`${relative} (${reason})`);
    expect(readFileSync(path.join(dir, 'a.ts'), 'utf8')).toBe('export const foo = 1;\n');
  });

  it('refuses references outside the workspace', async () => {
    write('a.ts', 'export const foo = 1;\n');
    const port = portRenaming(['a.ts']);
    port.rename.mockResolvedValueOnce({
      files: [
        {
          file: '/elsewhere/x.ts',
          path: '/elsewhere/x.ts',
          external: true,
          contentHash: '',
          edits: [],
        },
      ],
    });
    const [rename] = tool(port) as any[];
    const res = await rename.execute('r3', {
      file_path: 'a.ts',
      line: 1,
      symbol: 'foo',
      new_name: 'bar',
    });
    expect(res.content[0].text).toContain('/elsewhere/x.ts (outside the workspace)');
  });

  it('passes on what the language server refused, and validates input first', async () => {
    write('a.ts', 'export const foo = 1;\n');
    const port = portRenaming(['a.ts']);
    port.rename.mockRejectedValueOnce(
      new LanguageServerError('rename_not_allowed', 'You cannot rename this element.')
    );
    const [rename] = tool(port) as any[];
    const refused = await rename.execute('r4', {
      file_path: 'a.ts',
      line: 1,
      symbol: 'foo',
      new_name: 'bar',
    });
    expect(refused.details).toMatchObject({ ok: false, error: 'rename_not_allowed' });

    for (const [args, error] of [
      [{ file_path: 'a.ts', line: 1, symbol: 'foo', new_name: 'two words' }, 'invalid_name'],
      [{ file_path: 'a.ts', line: 1, symbol: 'foo', new_name: 'foo' }, 'invalid_name'],
      [{ file_path: 'a.ts', line: 1, symbol: 'nope', new_name: 'bar' }, 'symbol_not_found'],
      [{ file_path: '../x.ts', line: 1, symbol: 'foo', new_name: 'bar' }, 'path_outside_workspace'],
    ] as const) {
      expect((await rename.execute('r5', args)).details.error).toBe(error);
    }
    expect(port.rename).toHaveBeenCalledTimes(1);
  });

  it('notes files the server listed that no longer exist', async () => {
    write('a.ts', 'export const foo = 1;\n');
    const [rename] = tool(portRenaming(['a.ts'], { skippedMissing: ['gone.ts'] })) as any[];
    const res = await rename.execute('r6', {
      file_path: 'a.ts',
      line: 1,
      symbol: 'foo',
      new_name: 'bar',
    });
    expect(res.content[0].text).toContain('Skipped (no longer on disk');
    expect(res.content[0].text).toContain('gone.ts');
  });
});
