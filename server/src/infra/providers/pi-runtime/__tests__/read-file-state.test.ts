import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createReadFileStateStore } from '../read-file-state.js';

async function fixture(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zc-rfs-'));
  const file = path.join(dir, 'sample.ts');
  await writeFile(file, content);
  return file;
}

describe('read-file-state edit guards', () => {
  it('assertEditable allows editing after a partial-display read that captured full content', async () => {
    const file = await fixture('a\nb\nc\n');
    const store = createReadFileStateStore();
    await store.recordRead(file, {
      content: 'a\nb\nc\n',
      offset: 1,
      limit: 3,
      totalLines: 3,
      returnedLines: 1,
      isPartialView: true,
      hasFullContent: true,
    });
    expect(store.assertEditable(file, 'a\nb\nc\n')).toEqual({ ok: true });
  });

  it('assertEditable rejects when only a partial window was captured (streaming)', async () => {
    const file = await fixture('a\nb\nc\n');
    const store = createReadFileStateStore();
    await store.recordRead(file, {
      content: 'a\n',
      offset: 1,
      limit: 1,
      totalLines: 3,
      returnedLines: 1,
      isPartialView: true,
      hasFullContent: false,
    });
    expect(store.assertEditable(file, 'a\nb\nc\n')).toMatchObject({
      ok: false,
      code: 'partial_read',
    });
  });

  it('assertEditable rejects when the file changed since read', async () => {
    const file = await fixture('a\nb\nc\n');
    const store = createReadFileStateStore();
    await store.recordRead(file, {
      content: 'a\nb\nc\n',
      offset: 1,
      limit: 3,
      totalLines: 3,
      returnedLines: 3,
      hasFullContent: true,
    });
    expect(store.assertEditable(file, 'a\nb\nDIFFERENT\n')).toMatchObject({
      ok: false,
      code: 'file_modified_since_read',
    });
  });

  it('assertEditable rejects when never read', async () => {
    const file = await fixture('a\n');
    const store = createReadFileStateStore();
    expect(store.assertEditable(file, 'a\n')).toMatchObject({ ok: false, code: 'file_not_read' });
  });

  it('assertEditableHashline ignores file drift but needs full content', async () => {
    const file = await fixture('a\nb\n');
    const store = createReadFileStateStore();
    await store.recordRead(file, {
      content: 'a\nb\n',
      offset: 1,
      limit: 2,
      totalLines: 2,
      returnedLines: 1,
      isPartialView: true,
      hasFullContent: true,
    });
    expect(store.assertEditableHashline(file)).toEqual({ ok: true });
  });

  it('Write guard (assertSafeToWrite) still blocks a partial-display read', async () => {
    const file = await fixture('a\nb\nc\n');
    const store = createReadFileStateStore();
    await store.recordRead(file, {
      content: 'a\nb\nc\n',
      offset: 1,
      limit: 3,
      totalLines: 3,
      returnedLines: 1,
      isPartialView: true,
      hasFullContent: true,
    });
    const check = await store.assertSafeToWrite(file, 'a\nb\nc\n');
    expect(check).toMatchObject({ ok: false, code: 'partial_read' });
  });
});
