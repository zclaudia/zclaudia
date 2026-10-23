import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlobStore } from '../../../infra/design/blob-store.js';

describe('BlobStore', () => {
  let temp: string;
  let blobs: BlobStore;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-blobs-'));
    blobs = new BlobStore(temp);
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('stores content under blobs/<sha[0:2]>/<sha> and reads it back', async () => {
    const bytes = Buffer.from('hello blobs');
    const sha = await blobs.writeBlob(bytes);
    expect(sha).toHaveLength(64);
    await expect(stat(path.join(temp, 'blobs', sha.slice(0, 2), sha))).resolves.toBeTruthy();
    expect(await blobs.readBlob(sha)).toEqual(bytes);
    expect(await blobs.hasBlob(sha)).toBe(true);
    expect(await blobs.hasBlob('f'.repeat(64))).toBe(false);
  });

  it('deduplicates identical content and rejects size-divergent corruption', async () => {
    const bytes = Buffer.from('same content');
    const first = await blobs.writeBlob(bytes);
    const second = await blobs.writeBlob(Buffer.from('same content'));
    expect(second).toBe(first);

    // Simulate store corruption: same address, different size.
    const target = path.join(temp, 'blobs', first.slice(0, 2), first);
    await writeFile(target, Buffer.from('short'));
    await expect(blobs.writeBlob(bytes)).rejects.toThrow(/different size/);
  });

  it('sweeps only unreferenced blobs', async () => {
    const kept = await blobs.writeBlob(Buffer.from('kept'));
    const orphan = await blobs.writeBlob(Buffer.from('orphan'));
    const removed = await blobs.sweepUnreferenced(new Set([kept]));
    expect(removed).toEqual([orphan]);
    expect(await blobs.hasBlob(kept)).toBe(true);
    expect(await blobs.hasBlob(orphan)).toBe(false);
  });
});
