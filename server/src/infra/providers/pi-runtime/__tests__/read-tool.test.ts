import { describe, expect, it } from 'vitest';
import { mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createReadBridgeTool, isBlockedDevicePath } from '../read-tool.js';
import { createReadFileStateStore } from '../read-file-state.js';

describe('Read bridge tool module', () => {
  it('declares path requirements and the hashline parameter in its schema', () => {
    const read = createReadBridgeTool('/tmp') as any;

    expect(read.parameters.anyOf).toEqual([{ required: ['path'] }, { required: ['file_path'] }]);
    expect(read.parameters.properties.hashline).toMatchObject({ type: 'boolean' });
  });

  it('supports line offset and limit with structured details', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-module-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three', 'four'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'sample.ts', offset: 2, limit: 2 });

    expect(result.details).toMatchObject({
      ok: true,
      path: 'sample.ts',
      offset: 2,
      limit: 2,
      totalLines: 4,
      returnedLines: 2,
      state: {
        fullContentCaptured: true,
        partialView: true,
        range: { start: 2, end: 3 },
      },
    });
    expect(result.details.state.snapshotId).toMatch(/^sample\.ts#[a-f0-9]{12}$/);
    expect(result.details.state.fileDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.details.state.range.rangeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.content[0].text).toContain('2|two');
    expect(result.content[0].text).toContain('3|three');
    expect(result.content[0].text).not.toContain('1|one');
  });

  it('rejects non-integer offset and limit values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-invalid-window-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const offsetResult = await read.execute('read-bad-offset', { path: 'sample.ts', offset: 1.5 });
    const limitResult = await read.execute('read-bad-limit', { path: 'sample.ts', limit: 2.5 });

    expect(offsetResult.details).toMatchObject({ ok: false, error: 'invalid_offset' });
    expect(limitResult.details).toMatchObject({ ok: false, error: 'invalid_limit' });
  });

  it('appends an end-of-file footer when the whole file is returned', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-footer-full-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'sample.ts' });

    expect(result.details).toMatchObject({ totalLines: 3, returnedLines: 3 });
    expect(result.content[0].text).toContain('[End of file — all 3 lines shown.]');
  });

  it('tells the model how many lines remain and where to continue', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-footer-partial-'));
    const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
    await writeFile(path.join(root, 'big.ts'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.ts', offset: 1, limit: 10 });

    expect(result.details).toMatchObject({ totalLines: 50, returnedLines: 10 });
    expect(result.content[0].text).toContain(
      'Showing lines 1-10 of 50. 40 more lines below — call Read again with offset=11 to continue.'
    );
  });

  it('reports a clear footer when offset is past the end of a normal text file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-offset-past-eof-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-past-eof', { path: 'sample.ts', offset: 10, limit: 2 });

    expect(result.details).toMatchObject({ ok: true, totalLines: 3, returnedLines: 0 });
    expect(result.content[0].text).toContain(
      'Offset 10 is past end of file — 3 lines total. Re-read with offset=3 or lower.'
    );
    expect(result.content[0].text).not.toContain('10-3');
  });

  it('defaults to reading up to 2000 lines in one call', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-default-limit-'));
    const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`);
    await writeFile(path.join(root, 'medium.ts'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'medium.ts' });

    expect(result.details).toMatchObject({ totalLines: 300, returnedLines: 300 });
    expect(result.content[0].text).toContain('300|line300');
  });

  it('reads several line ranges in one call with a gap marker between them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-ranges-'));
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    await writeFile(path.join(root, 'sample.ts'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-ranges', { path: 'sample.ts', ranges: '2-3,10-11' });

    expect(result.details).toMatchObject({
      ok: true,
      format: 'ranges',
      totalLines: 20,
      returnedLines: 4,
    });
    expect(result.details.ranges).toEqual([
      [2, 3],
      [10, 11],
    ]);
    const text = result.content[0].text;
    expect(text).toContain('2|line2');
    expect(text).toContain('3|line3');
    expect(text).toContain('10|line10');
    expect(text).not.toContain('5|line5');
    expect(text).toMatch(/⋮ .*4-9 not shown/);
  });

  it('keeps a ranges read editable by capturing full content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-ranges-edit-'));
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const file = path.join(root, 'sample.ts');
    await writeFile(file, lines.join('\n'));
    const state = createReadFileStateStore();
    const read = createReadBridgeTool(root, { readFileState: state }) as any;

    await read.execute('read-ranges', { path: 'sample.ts', ranges: '2-3' });

    expect(state.assertEditable(file, lines.join('\n'))).toEqual({ ok: true });
  });

  it('rejects a malformed ranges selector', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-ranges-bad-'));
    await writeFile(path.join(root, 'sample.ts'), 'a\nb\nc\n');
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-ranges', { path: 'sample.ts', ranges: '3-1' });

    expect(result.details).toMatchObject({ ok: false, error: 'invalid_ranges' });
  });

  it('returns a dedup stub when the same file is re-read unchanged', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-dedup-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const first = await read.execute('read-1', { path: 'sample.ts' });
    const second = await read.execute('read-2', { path: 'sample.ts' });

    expect(first.details.deduped).toBeUndefined();
    expect(second.details).toMatchObject({ ok: true, deduped: true });
    expect(second.content[0].text).toContain('unchanged since your last read');
    // A different window is not a dedup hit.
    const windowed = await read.execute('read-3', { path: 'sample.ts', offset: 2, limit: 1 });
    expect(windowed.details.deduped).toBeUndefined();
  });

  it('does not dedup after the file content changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-dedup-change-'));
    const file = path.join(root, 'sample.ts');
    await writeFile(file, 'one\ntwo\n');
    const read = createReadBridgeTool(root) as any;

    await read.execute('read-1', { path: 'sample.ts' });
    await writeFile(file, 'one\ntwo\nthree\nfour\n'); // size changes → never a stale stub
    const second = await read.execute('read-2', { path: 'sample.ts' });

    expect(second.details.deduped).toBeUndefined();
    expect(second.content[0].text).toContain('4|four');
  });

  it('can return hashline anchors for content-addressed edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-hash-module-'));
    await writeFile(path.join(root, 'sample.ts'), 'const a = 1;\nconst b = 2;\n');
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-hashline', { path: 'sample.ts', hashline: true });

    expect(result.details.hashline).toMatchObject({ path: 'sample.ts' });
    expect(result.details.hashline.snapshotId).toEqual(expect.any(String));
    expect(result.details.hashline.lines[0]).toMatchObject({ line: 1, text: 'const a = 1;' });
    expect(result.content[0].text).toContain('[sample.ts#');
    expect(result.content[0].text).toMatch(/[a-f0-9]{12}\|const a = 1;/);
  });

  it('reports absolute line numbers for hashline reads with an offset', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-hash-offset-'));
    await writeFile(path.join(root, 'sample.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-hashline-offset', {
      path: 'sample.ts',
      offset: 2,
      limit: 1,
      hashline: true,
    });

    expect(result.details.hashline.lines).toHaveLength(1);
    expect(result.details.hashline.lines[0]).toMatchObject({ line: 2, text: 'const b = 2;' });
  });

  it('caps hashline output by the Read output budget', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-hash-cap-'));
    const lines = Array.from({ length: 5 }, (_, i) => `${i + 1}:` + 'a'.repeat(30_000));
    await writeFile(path.join(root, 'minified.js'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-hashline-cap', { path: 'minified.js', hashline: true });

    expect(result.details.hashline.cappedByTokens).toBe(true);
    expect(result.content[0].text.length).toBeLessThan(120_000);
    expect(result.content[0].text).toContain('output capped at ~25000 tokens');
  });

  it('rejects binary non-image files with a structured error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-bin-module-'));
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'blob.bin' });

    expect(result.details).toMatchObject({ ok: false, error: 'binary_file' });
    expect(result.content[0].text).toContain('Refusing to read binary file');
  });

  it('rejects symlinks that resolve outside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-symlink-root-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-symlink-outside-'));
    await writeFile(path.join(outside, 'secret.txt'), 'outside\n');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-symlink', { path: 'link.txt' });

    expect(result.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
  });

  it('flags special device paths as blocked (defense-in-depth)', () => {
    expect(isBlockedDevicePath('/dev/zero')).toBe(true);
    expect(isBlockedDevicePath('/dev/urandom')).toBe(true);
    expect(isBlockedDevicePath('/dev/fd/0')).toBe(true);
    expect(isBlockedDevicePath('/proc/self/fd/0')).toBe(true);
    expect(isBlockedDevicePath('/proc/1234/fd/2')).toBe(true);
    expect(isBlockedDevicePath('/proc/self/fd/3')).toBe(false);
    expect(isBlockedDevicePath('/home/user/project/src/index.ts')).toBe(false);
    expect(isBlockedDevicePath('/dev/zerox')).toBe(false);
  });

  it('rejects known-binary extensions without scanning content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-binext-'));
    // Plain-text bytes (no NUL) under a binary extension — content sniffing alone would miss it.
    await writeFile(path.join(root, 'bundle.zip'), 'PK plain text-ish content without nul bytes');
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'bundle.zip' });

    expect(result.details).toMatchObject({ ok: false, error: 'binary_file' });
  });

  it('reads plain-text files larger than the 512KB mutation cap', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-over-mutcap-'));
    // ~600KB of text: above MAX_TEXT_MUTATION_FILE_BYTES, below the fast-path threshold.
    const lines = Array.from({ length: 10_000 }, (_, i) => `line-${i + 1}-`.padEnd(60, 'x'));
    await writeFile(path.join(root, 'big.log'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.log', offset: 1, limit: 5 });

    expect(result.details).toMatchObject({ ok: true, totalLines: 10_000, returnedLines: 5 });
    expect(result.content[0].text).toContain('1|line-1-');
  });

  it('clips very long lines for display but keeps every line', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-colclip-'));
    // 5 lines × 30k chars: each exceeds the 2000-column display cap.
    const lines = Array.from({ length: 5 }, (_, i) => `${i + 1}:` + 'a'.repeat(30_000));
    await writeFile(path.join(root, 'minified.js'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'minified.js' });

    expect(result.details).toMatchObject({
      ok: true,
      totalLines: 5,
      returnedLines: 5,
      columnTruncated: 2000,
    });
    expect(result.content[0].text).toContain('chars clipped]');
    // Display stays far under the raw 150k chars thanks to per-line clipping.
    expect(result.content[0].text.length).toBeLessThan(20_000);
  });

  it('caps output by token budget when many lines exceed the budget', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-tokencap-'));
    // 200 lines × ~1k chars = ~200k chars (each under the column cap); budget is ~25k tokens ≈ 100k chars.
    const lines = Array.from({ length: 200 }, (_, i) => `${i + 1}:` + 'a'.repeat(1_000));
    await writeFile(path.join(root, 'wide.txt'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'wide.txt' });

    expect(result.details.ok).toBe(true);
    expect(result.details.totalLines).toBe(200);
    expect(result.details.returnedLines).toBeLessThan(200);
    expect(result.content[0].text).toContain('output capped at ~25000 tokens');
  });

  it('refuses hashline output when the first line exceeds the token budget', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-hash-firstline-'));
    // A single line well over the ~100k char budget — hashline cannot clip it.
    await writeFile(path.join(root, 'huge-line.js'), 'x'.repeat(500_000));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'huge-line.js', hashline: true });

    expect(result.details.ok).toBe(true);
    expect(result.details.hashline.lines).toHaveLength(0);
    expect(result.details.hashline.cappedByTokens).toBe(true);
    expect(result.content[0].text).toContain('Hashline anchoring needs whole lines');
  });

  it('nudges the model after repeated reads of the same file in a session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-repeat-'));
    const file = path.join(root, 'sample.ts');
    const read = createReadBridgeTool(root) as any;

    // The content changes between reads so each re-read bypasses the dedup stub
    // (which would otherwise short-circuit an identical re-read) and the
    // repeat-read counter advances.
    await writeFile(file, 'const a = 1;\n');
    const first = await read.execute('r1', { path: 'sample.ts' });
    await writeFile(file, 'const a = 22;\n');
    const second = await read.execute('r2', { path: 'sample.ts' });
    await writeFile(file, 'const a = 333;\n');
    const third = await read.execute('r3', { path: 'sample.ts' });

    expect(first.content[0].text).not.toContain('read #');
    expect(second.content[0].text).not.toContain('read #');
    expect(third.content[0].text).toContain('read #3 of this file this session');
  });

  it('streams a window out of a file larger than the fast-path threshold', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-stream-'));
    // ~11MB so the streaming path (>10MB) is exercised.
    const lines = Array.from({ length: 60_000 }, (_, i) => `row-${i + 1}`.padEnd(190, '.'));
    await writeFile(path.join(root, 'huge.csv'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const head = await read.execute('read-1', { path: 'huge.csv', offset: 1, limit: 10 });
    expect(head.details).toMatchObject({
      ok: true,
      totalLines: 60_000,
      returnedLines: 10,
      streamed: true,
    });
    expect(head.content[0].text).toContain('1|row-1');
    expect(head.content[0].text).toContain(
      '59990 more lines below — call Read again with offset=11'
    );

    const mid = await read.execute('read-2', { path: 'huge.csv', offset: 30_000, limit: 3 });
    expect(mid.details).toMatchObject({
      ok: true,
      totalLines: 60_000,
      returnedLines: 3,
      streamed: true,
    });
    expect(mid.content[0].text).toContain('30000|row-30000');

    const pastEnd = await read.execute('read-3', { path: 'huge.csv', offset: 60_001, limit: 5 });
    expect(pastEnd.details).toMatchObject({
      ok: true,
      totalLines: 60_000,
      returnedLines: 0,
      streamed: true,
    });
    expect(pastEnd.content[0].text).toContain(
      'Offset 60001 is past end of file — 60000 lines total. Re-read with offset=60000 or lower.'
    );
    expect(pastEnd.content[0].text).not.toContain('60001-60000');
  });

  it('keeps streaming reads partial for mutation guards', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-stream-state-'));
    const content = `${'x'.repeat(11 * 1024 * 1024)}\n`;
    const filePath = path.join(root, 'huge.txt');
    await writeFile(filePath, content);
    const readFileState = createReadFileStateStore();
    const read = createReadBridgeTool(root, { readFileState }) as any;

    const result = await read.execute('read-stream-state', { path: 'huge.txt' });
    const writeCheck = await readFileState.assertSafeToWrite(filePath, content);

    expect(result.details).toMatchObject({ ok: true, streamed: true });
    expect(writeCheck).toMatchObject({ ok: false, code: 'partial_read' });
  });

  it('returns a text notice for images when the model lacks vision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-img-module-'));
    await writeFile(path.join(root, 'tiny.png'), Buffer.from('not-real-image'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'tiny.png' });

    expect(result.details).toMatchObject({ ok: false, path: 'tiny.png', mimeType: 'image/png' });
    expect(result.content[0].text).toContain('current model does not support vision');
  });

  it('returns a structural summary for a large source file with no selector', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-'));
    const blocks: string[] = [];
    for (let f = 0; f < 30; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 8; b++) blocks.push(`  const v${f}_${b} = ${b};`);
      blocks.push('}');
    }
    await writeFile(path.join(root, 'big.ts'), blocks.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.ts' });

    expect(result.details).toMatchObject({ ok: true, format: 'outline' });
    expect(result.details.foldedBodies).toBeGreaterThanOrEqual(20);
    expect(result.content[0].text).toContain('… (+8 lines)');
    expect(result.content[0].text).toContain('Structural summary');
    expect(result.content[0].text).toContain('1|function fn0() {');
  });

  it('does not summarize when the savings gate is not met', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-nosavings-'));
    const lines = Array.from({ length: 300 }, (_, i) => `const x${i} = ${i};`);
    await writeFile(path.join(root, 'flat.ts'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'flat.ts' });

    expect(result.details.format).toBeUndefined();
    expect(result.details).toMatchObject({ ok: true, returnedLines: 300 });
  });

  it('does not summarize below the line threshold', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-small-'));
    const blocks: string[] = [];
    for (let f = 0; f < 10; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 8; b++) blocks.push(`  const v${f}_${b} = ${b};`);
      blocks.push('}');
    }
    await writeFile(path.join(root, 'small.ts'), blocks.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'small.ts' });
    expect(result.details.format).toBeUndefined();
  });

  it('full:true forces a verbatim read of an otherwise-summarizable file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-full-'));
    const blocks: string[] = [];
    for (let f = 0; f < 30; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 8; b++) blocks.push(`  const v${f}_${b} = ${b};`);
      blocks.push('}');
    }
    await writeFile(path.join(root, 'big.ts'), blocks.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.ts', full: true });
    expect(result.details.format).toBeUndefined();
    expect(result.details.returnedLines).toBe(300);
  });

  it('an explicit offset suppresses the summary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-offset-'));
    const blocks: string[] = [];
    for (let f = 0; f < 30; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 8; b++) blocks.push(`  const v${f}_${b} = ${b};`);
      blocks.push('}');
    }
    await writeFile(path.join(root, 'big.ts'), blocks.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.ts', offset: 5, limit: 3 });
    expect(result.details.format).toBeUndefined();
    expect(result.details).toMatchObject({ offset: 5, returnedLines: 3 });
  });

  it('records a summary read as partial-view but full-content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-state-'));
    const blocks: string[] = [];
    for (let f = 0; f < 30; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 8; b++) blocks.push(`  const v${f}_${b} = ${b};`);
      blocks.push('}');
    }
    const content = blocks.join('\n');
    await writeFile(path.join(root, 'big.ts'), content);
    const readFileState = createReadFileStateStore();
    const read = createReadBridgeTool(root, { readFileState }) as any;

    const result = await read.execute('read-1', { path: 'big.ts' });
    const filePath = path.join(root, 'big.ts');

    expect(result.details.format).toBe('outline');
    expect(readFileState.assertEditable(filePath, content)).toEqual({ ok: true });
    const writeCheck = await readFileState.assertSafeToWrite(filePath, content);
    expect(writeCheck).toMatchObject({ ok: false, code: 'partial_read' });
  });

  it('does not summarize a file above the 2MB byte cap', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-bigbytes-'));
    // > 2MB but < 20000 lines (long body lines) so the BYTE cap is what suppresses it.
    const blocks: string[] = [];
    for (let f = 0; f < 1200; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 10; b++) blocks.push(`  const v${f}_${b} = ${'x'.repeat(180)};`);
      blocks.push('}');
    }
    const content = blocks.join('\n');
    expect(content.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(content.split('\n').length).toBeLessThan(20_000);
    await writeFile(path.join(root, 'huge.ts'), content);
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'huge.ts' });
    expect(result.details.format).toBeUndefined();
  });

  it('does not summarize when hashline is requested on a large source file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-hashline-'));
    const blocks: string[] = [];
    for (let f = 0; f < 30; f++) {
      blocks.push(`function fn${f}() {`);
      for (let b = 0; b < 8; b++) blocks.push(`  const v${f}_${b} = ${b};`);
      blocks.push('}');
    }
    await writeFile(path.join(root, 'big.ts'), blocks.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.ts', hashline: true });
    expect(result.details.format).toBeUndefined();
    expect(result.details.hashline).toBeDefined();
  });

  it('does not summarize a large file of a non-outline extension', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-summary-nonoutline-'));
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} of plain text content here`);
    await writeFile(path.join(root, 'notes.txt'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'notes.txt' });
    expect(result.details.format).toBeUndefined();
    expect(result.details).toMatchObject({ ok: true, returnedLines: 300 });
  });
});
