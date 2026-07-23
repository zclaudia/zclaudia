import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createEditBridgeTool } from '../edit-write-tools.js';
import { createReadFileStateStore, type ReadFileStateStore } from '../read-file-state.js';
import { NOOP_EDIT_HARD_LIMIT, NoopEditGuard } from '../noop-edit-guard.js';

async function tempRoot(label: string): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), label)));
}

async function recordRead(
  state: ReadFileStateStore,
  root: string,
  name: string,
  content: string
): Promise<void> {
  const lines = content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  await state.recordRead(path.join(root, name), {
    content,
    offset: 1,
    limit: 2000,
    totalLines: lines.length,
    returnedLines: lines.length,
    hasFullContent: true,
  });
}

function spyOnRecord(guard: NoopEditGuard): Array<{ filePath: string; signature: string }> {
  const calls: Array<{ filePath: string; signature: string }> = [];
  const original = guard.record.bind(guard);
  guard.record = (filePath: string, signature: string) => {
    calls.push({ filePath, signature });
    return original(filePath, signature);
  };
  return calls;
}

describe('Edit schema', () => {
  it('declares preview_only in its parameter schema', () => {
    const edit = createEditBridgeTool('/tmp') as any;

    expect(edit.parameters.properties.preview_only).toMatchObject({
      type: 'boolean',
      default: false,
    });
  });

  it('warns that patch application is sequential and non-atomic', () => {
    const edit = createEditBridgeTool('/tmp') as any;
    const description = edit.parameters.properties.patch.description;

    expect(description).toMatch(/NOT atomic/i);
    expect(description).toContain('sequentially');
    expect(description).toContain('preview_only');
  });
});

describe('patch preflight noop accounting', () => {
  it('records exactly one failure per identical failing patch and escalates at the limit', async () => {
    const root = await tempRoot('zc-patch-noop-');
    await writeFile(path.join(root, 'a.ts'), 'const a = 1;\n');
    const state = createReadFileStateStore();
    await recordRead(state, root, 'a.ts', 'const a = 1;\n');
    const guard = new NoopEditGuard();
    const recordCalls = spyOnRecord(guard);
    const edit = createEditBridgeTool(root, { readFileState: state, noopGuard: guard }) as any;
    const patch =
      '*** Begin Patch\n*** Update File: a.ts\n@@\n-nonexistent line\n+new line\n*** End Patch';

    const first = await edit.execute('e1', { patch });
    const second = await edit.execute('e2', { patch });
    const third = await edit.execute('e3', { patch });

    expect(first.details.error).toBe('not_found');
    expect(second.details.error).toBe('not_found');
    expect(third.details.error).toBe('edit_loop_detected');
    // Exactly one record per logical patch failure — the preflight dry run
    // must not add its own.
    expect(recordCalls).toHaveLength(NOOP_EDIT_HARD_LIMIT);
    expect(new Set(recordCalls.map(call => call.signature)).size).toBe(1);

    await rm(root, { recursive: true, force: true });
  });

  it('does not double-count the failed first attempt of an EOF retry', async () => {
    const root = await tempRoot('zc-patch-retry-');
    // No trailing newline at EOF: the update hunk only matches on the retry.
    const original = 'const a = 1;\nconst last = "old";';
    await writeFile(path.join(root, 'b.ts'), original);
    const state = createReadFileStateStore();
    await recordRead(state, root, 'b.ts', original);
    const guard = new NoopEditGuard();
    const recordCalls = spyOnRecord(guard);
    const edit = createEditBridgeTool(root, { readFileState: state, noopGuard: guard }) as any;

    const result = await edit.execute('e1', {
      patch: [
        '*** Begin Patch',
        '*** Update File: b.ts',
        '@@',
        '-const last = "old";',
        '+const last = "new";',
        '*** End Patch',
      ].join('\n'),
    });

    expect(result.details.ok).toBe(true);
    // Preflight used to record the same not_found failure the real run then
    // recorded again — one logical failure counted twice.
    expect(recordCalls).toHaveLength(1);
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe(
      'const a = 1;\nconst last = "new";'
    );

    await rm(root, { recursive: true, force: true });
  });
});

describe('mixed line-ending edits', () => {
  it('keeps the majority LF style and leaves untouched LF lines byte-identical', async () => {
    const root = await tempRoot('zc-eol-lf-');
    // One stray CRLF line in an otherwise LF file.
    const original = 'alpha\nbeta\r\ngamma\ndelta\n';
    await writeFile(path.join(root, 'mixed.txt'), original);
    const state = createReadFileStateStore();
    await recordRead(state, root, 'mixed.txt', original);
    const edit = createEditBridgeTool(root, { readFileState: state }) as any;

    const result = await edit.execute('e1', {
      file_path: 'mixed.txt',
      old_string: 'gamma',
      new_string: 'GAMMA',
    });

    expect(result.details.ok).toBe(true);
    // Majority-wins: the file is written LF; the single minority CRLF line is
    // the only untouched line whose ending changes.
    expect(await readFile(path.join(root, 'mixed.txt'), 'utf8')).toBe(
      'alpha\nbeta\nGAMMA\ndelta\n'
    );

    await rm(root, { recursive: true, force: true });
  });

  it('keeps the majority CRLF style when editing a mostly-CRLF file', async () => {
    const root = await tempRoot('zc-eol-crlf-');
    // One stray LF line in an otherwise CRLF file.
    const original = 'alpha\r\nbeta\r\ngamma\ndelta\r\n';
    await writeFile(path.join(root, 'mixed.txt'), original);
    const state = createReadFileStateStore();
    await recordRead(state, root, 'mixed.txt', original);
    const edit = createEditBridgeTool(root, { readFileState: state }) as any;

    const result = await edit.execute('e1', {
      file_path: 'mixed.txt',
      old_string: 'gamma',
      new_string: 'GAMMA',
    });

    expect(result.details.ok).toBe(true);
    expect(await readFile(path.join(root, 'mixed.txt'), 'utf8')).toBe(
      'alpha\r\nbeta\r\nGAMMA\r\ndelta\r\n'
    );

    await rm(root, { recursive: true, force: true });
  });
});
