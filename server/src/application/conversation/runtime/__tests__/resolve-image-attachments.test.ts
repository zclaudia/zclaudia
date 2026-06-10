import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveImageAttachments, MAX_IMAGES_PER_MESSAGE } from '../resolve-image-attachments.js';

// We import the class via initFileStore + getFileStore to construct a real instance
// with an in-memory SQLite DB and a temp dir on disk.
import { initFileStore, getFileStore } from '../../../../infra/storage/fileStore.js';

// Silence FileStore console output during tests
import { vi } from 'vitest';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

const att = (fileId: string, name = 'a.png') => ({ fileId, name, mimeType: 'image/png', type: 'image' as const });

describe('resolveImageAttachments', () => {
  let db: Database.Database;
  let tmpDir: string;
  let fileStore: ReturnType<typeof getFileStore>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db = createTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zclaudia-test-filestore-'));
    // Override ZCLAUDIA_DATA_DIR so initFileStore places files in our tmpDir
    // We can't use initFileStore easily since it joins dataDir/files;
    // instead we construct FileStore directly via the exported factory after
    // patching the env, but the cleanest approach is to call initFileStore
    // with a patched env and accept the 'files' subdir.
    const origEnv = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = tmpDir;
    initFileStore(db);
    if (origEnv === undefined) {
      delete process.env.ZCLAUDIA_DATA_DIR;
    } else {
      process.env.ZCLAUDIA_DATA_DIR = origEnv;
    }
    fileStore = getFileStore();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('resolves stored images to base64 entries', () => {
    const fileId = fileStore.storeFile('a.png', 'image/png', Buffer.from('fakepng').toString('base64'));
    const { images, notices } = resolveImageAttachments([att(fileId)], fileStore);
    expect(images).toEqual([{ name: 'a.png', mimeType: 'image/png', data: Buffer.from('fakepng').toString('base64') }]);
    expect(notices).toEqual([]);
  });

  it('skips non-image attachments silently', () => {
    const { images, notices } = resolveImageAttachments([{ fileId: 'x', name: 'doc.pdf', mimeType: 'application/pdf', type: 'file' }], fileStore);
    expect(images).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('emits a notice for missing files', () => {
    const { images, notices } = resolveImageAttachments([att('nonexistent')], fileStore);
    expect(images).toEqual([]);
    expect(notices).toEqual(['[Image attached: a.png — file unavailable]']);
  });

  it('emits a notice for oversize images', () => {
    const bigId = fileStore.storeFile('big.png', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'));
    const { images, notices } = resolveImageAttachments([att(bigId, 'big.png')], fileStore);
    expect(images).toEqual([]);
    expect(notices).toEqual(['[Image attached: big.png — skipped, exceeds 5MB limit]']);
  });

  it('caps at MAX_IMAGES_PER_MESSAGE with notices for the overflow', () => {
    const ids = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 2 }, (_, i) =>
      fileStore.storeFile(`i${i}.png`, 'image/png', Buffer.from('x').toString('base64'))
    );
    const { images, notices } = resolveImageAttachments(ids.map((id, i) => att(id, `i${i}.png`)), fileStore);
    expect(images).toHaveLength(MAX_IMAGES_PER_MESSAGE);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('max 10 images');
  });
});
