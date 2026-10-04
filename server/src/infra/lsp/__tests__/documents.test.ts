import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentStore, type DocumentSink } from '../documents.js';

function recordingSink(wantsSave = false) {
  const sent: Array<{ method: string; params: any }> = [];
  const sink: DocumentSink = {
    wantsSave,
    notify: async (method, params) => {
      sent.push({ method, params });
    },
  };
  return { sink, sent };
}

describe('DocumentStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lsp-docs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('opens once, then sends didChange only when the content changes', async () => {
    const { sink, sent } = recordingSink();
    const store = new DocumentStore(sink, () => 'typescript');
    const file = path.join(dir, 'a.ts');
    writeFileSync(file, 'one');

    expect(await store.syncFromDisk(file)).toBe('opened');
    expect(await store.syncFromDisk(file)).toBe('unchanged');
    writeFileSync(file, 'two');
    expect(await store.syncFromDisk(file)).toBe('changed');

    expect(sent.map(s => s.method)).toEqual(['textDocument/didOpen', 'textDocument/didChange']);
    expect(sent[0].params.textDocument).toMatchObject({ languageId: 'typescript', version: 1 });
    expect(sent[1].params).toMatchObject({
      textDocument: { version: 2 },
      contentChanges: [{ text: 'two' }],
    });
  });

  it('sends didSave only to servers that asked for it', async () => {
    const { sink, sent } = recordingSink(true);
    const store = new DocumentStore(sink, () => 'typescript');
    await store.syncText(path.join(dir, 'a.ts'), 'x');
    expect(sent.map(s => s.method)).toEqual(['textDocument/didOpen', 'textDocument/didSave']);
  });

  it('closes a document whose file disappeared', async () => {
    const { sink, sent } = recordingSink();
    const store = new DocumentStore(sink, () => 'typescript');
    const file = path.join(dir, 'gone.ts');
    writeFileSync(file, 'x');
    await store.syncFromDisk(file);
    rmSync(file);
    expect(await store.syncFromDisk(file)).toBe('missing');
    expect(sent.at(-1)?.method).toBe('textDocument/didClose');
    expect(store.isOpen(file)).toBe(false);
  });

  it('evicts the least recently used document past the cap', async () => {
    const { sink, sent } = recordingSink();
    const store = new DocumentStore(sink, () => 'typescript', 2);
    const [a, b, c] = ['a.ts', 'b.ts', 'c.ts'].map(name => path.join(dir, name));
    await store.syncText(a, 'a');
    await store.syncText(b, 'b');
    await store.syncText(a, 'a'); // touch a: b is now the oldest
    await store.syncText(c, 'c');
    expect(store.isOpen(b)).toBe(false);
    expect(store.isOpen(a)).toBe(true);
    expect(sent.at(-1)).toMatchObject({ method: 'textDocument/didClose' });
    expect(sent.at(-1)?.params.textDocument.uri).toContain('b.ts');
  });

  it('keeps versions ordered under concurrent syncs of one file', async () => {
    const { sink, sent } = recordingSink();
    const store = new DocumentStore(sink, () => 'typescript');
    const file = path.join(dir, 'a.ts');
    await Promise.all(['1', '2', '3'].map(text => store.syncText(file, text)));
    const versions = sent.map(s => s.params.textDocument.version);
    expect(versions).toEqual([1, 2, 3]);
  });
});
