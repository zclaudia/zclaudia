import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Content-addressed blob store for design snapshots. Blobs live at
 * `<root>/blobs/<sha[0:2]>/<sha>` so identical content is stored once.
 * The root is injectable (tests point it at a temp directory).
 */
export class BlobStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir, 'blobs');
  }

  private blobPath(sha: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(`Invalid blob hash: ${sha}`);
    return path.join(this.root, sha.slice(0, 2), sha);
  }

  /**
   * Store bytes and return their SHA-256 hex. Deduplicated: an existing blob
   * with the same size is reused as-is; an existing blob with a different
   * size means store corruption and throws.
   */
  async writeBlob(bytes: Buffer): Promise<string> {
    const sha = createHash('sha256').update(bytes).digest('hex');
    const final = this.blobPath(sha);
    let existing;
    try {
      existing = await fs.stat(final);
    } catch {
      existing = null;
    }
    if (existing) {
      if (existing.size !== bytes.length)
        throw new Error(`Blob store corruption: ${sha} exists with a different size`);
      return sha;
    }
    await fs.mkdir(path.dirname(final), { recursive: true });
    // Write-then-rename keeps concurrent writers of the same content from
    // ever exposing a partial blob; same-content races are harmless.
    const temp = path.join(path.dirname(final), `.tmp-${randomUUID()}`);
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx' });
      await fs.rename(temp, final);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
    return sha;
  }

  async hasBlob(sha: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.blobPath(sha));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async readBlob(sha: string): Promise<Buffer> {
    return fs.readFile(this.blobPath(sha));
  }

  /**
   * Delete every blob file on disk that is not in `referenced` (the set of
   * sha256 values still referenced by surviving snapshot manifests). Used by
   * snapshot pruning to garbage-collect orphaned content. Returns the
   * removed hashes.
   */
  async sweepUnreferenced(referenced: ReadonlySet<string>): Promise<string[]> {
    const removed: string[] = [];
    let prefixes: string[];
    try {
      prefixes = await fs.readdir(this.root);
    } catch {
      return removed;
    }
    for (const prefix of prefixes) {
      if (!/^[a-f0-9]{2}$/.test(prefix)) continue;
      const dir = path.join(this.root, prefix);
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!/^[a-f0-9]{64}$/.test(name) || referenced.has(name)) continue;
        try {
          await fs.rm(path.join(dir, name), { force: true });
          removed.push(name);
        } catch {
          /* best effort */
        }
      }
    }
    return removed;
  }
}
