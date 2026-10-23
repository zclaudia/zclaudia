import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SafeFileWriteError,
  createRollingBackupKeeper,
  readBoundedFile,
  safeWriteFile,
} from '../safe-file-write.js';

function sha256(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}

describe('safe-file-write', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'safe-file-write-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serializes ten concurrent writers so exactly one matching revision wins', async () => {
    const file = path.join(dir, 'index.html');
    await writeFile(file, '<p>base</p>');
    const revision = sha256('<p>base</p>');

    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        safeWriteFile(file, Buffer.from(`<p>writer-${i}</p>`), {
          maxBytes: 1024,
          expectedRevision: revision,
        })
          .then(result => ({ ok: true as const, result }))
          .catch(error => ({ ok: false as const, error }))
      )
    );

    const won = attempts.filter(attempt => attempt.ok);
    const lost = attempts.filter(attempt => !attempt.ok);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(9);
    for (const failure of lost) {
      expect(failure.error).toBeInstanceOf(SafeFileWriteError);
      expect((failure.error as SafeFileWriteError).code).toBe('REVISION_CONFLICT');
    }
    const final = await readFile(file, 'utf8');
    expect(final).toMatch(/^<p>writer-\d+<\/p>$/);
    expect(won[0]?.result.revision).toBe(sha256(final));
  });

  it('rejects a stale revision and leaves the file untouched', async () => {
    const file = path.join(dir, 'doc.html');
    await writeFile(file, '<p>current</p>');
    await expect(
      safeWriteFile(file, Buffer.from('<p>next</p>'), {
        maxBytes: 1024,
        expectedRevision: sha256('<p>stale</p>'),
      })
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await readFile(file, 'utf8')).toBe('<p>current</p>');
  });

  it('preserves the original file mode across the replace', async () => {
    const file = path.join(dir, 'page.html');
    await writeFile(file, '<p>old</p>', { mode: 0o755 });
    await chmod(file, 0o755);
    const result = await safeWriteFile(file, Buffer.from('<p>new</p>'), {
      maxBytes: 1024,
      expectedRevision: sha256('<p>old</p>'),
    });
    expect(result.revision).toBe(sha256('<p>new</p>'));
    expect((await stat(file)).mode & 0o777).toBe(0o755);
    expect(await readFile(file, 'utf8')).toBe('<p>new</p>');
  });

  it('removes temp files after a failed final check and after success', async () => {
    const file = path.join(dir, 'guarded.html');
    await writeFile(file, '<p>base</p>');
    const tempFiles = async () => (await readdir(dir)).filter(name => name.startsWith('.tmp-'));
    // The backup hook races the write by replacing the target content after
    // the revision check; the synchronous final check must abort the rename
    // and the finally block must still remove the temp file.
    await expect(
      safeWriteFile(file, Buffer.from('<p>next</p>'), {
        maxBytes: 1024,
        expectedRevision: sha256('<p>base</p>'),
        backup: async () => {
          await writeFile(file, '<p>tampered</p>');
        },
      })
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await readFile(file, 'utf8')).toBe('<p>tampered</p>');
    expect(await tempFiles()).toEqual([]);

    await safeWriteFile(file, Buffer.from('<p>clean</p>'), {
      maxBytes: 1024,
      expectedRevision: sha256('<p>tampered</p>'),
    });
    expect(await readFile(file, 'utf8')).toBe('<p>clean</p>');
    expect(await tempFiles()).toEqual([]);
  });

  it('refuses to write through a symbolic link', async () => {
    const real = path.join(dir, 'real.html');
    await writeFile(real, '<p>real</p>');
    const link = path.join(dir, 'link.html');
    await symlink(real, link);
    await expect(
      safeWriteFile(link, Buffer.from('<p>next</p>'), {
        maxBytes: 1024,
        expectedRevision: sha256('<p>real</p>'),
      })
    ).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    expect(await readFile(real, 'utf8')).toBe('<p>real</p>');
  });

  it('keeps the newest five backups and deletes the oldest beyond the limit', async () => {
    const backupRoot = path.join(dir, 'backups');
    const target = path.join(dir, 'doc.html');
    await writeFile(target, '<p>live</p>');
    const keeper = createRollingBackupKeeper(backupRoot, 5);
    const statInfo = await stat(target);

    for (let i = 0; i < 6; i += 1) {
      await keeper(Buffer.from(`backup-${i}`), statInfo, target);
    }

    const backupDir = path.join(backupRoot, sha256(path.resolve(target)).slice(0, 16));
    const names = (await readdir(backupDir)).sort();
    expect(names).toHaveLength(5);
    const kept = await Promise.all(
      names.map(name => readFile(path.join(backupDir, name), 'utf8'))
    );
    expect(kept).toEqual(['backup-1', 'backup-2', 'backup-3', 'backup-4', 'backup-5']);
  });

  it('bounds reads: rejects oversized, non-regular and missing files', async () => {
    const file = path.join(dir, 'big.html');
    await writeFile(file, Buffer.alloc(64, 65));
    await expect(readBoundedFile(file, 32, 'HTML document')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    const { bytes } = await readBoundedFile(file, 64, 'HTML document');
    expect(bytes).toEqual(Buffer.alloc(64, 65));
    await expect(readBoundedFile(dir, 64, 'HTML document')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
    await expect(readBoundedFile(path.join(dir, 'absent.html'), 64, 'HTML document')).rejects.toMatchObject(
      { code: 'FILE_NOT_FOUND' }
    );
  });

  it('creates a missing file when createIfMissing is set with an empty or omitted revision', async () => {
    const file = path.join(dir, 'created.html');
    const result = await safeWriteFile(file, Buffer.from('<p>created</p>'), {
      maxBytes: 1024,
      expectedRevision: '',
      createIfMissing: true,
    });
    expect(result.revision).toBe(sha256('<p>created</p>'));
    expect(await readFile(file, 'utf8')).toBe('<p>created</p>');

    const second = path.join(dir, 'created-2.html');
    await safeWriteFile(second, Buffer.from('x'), {
      maxBytes: 8,
      expectedRevision: undefined,
      createIfMissing: true,
    });
    expect(await readFile(second, 'utf8')).toBe('x');
    // No temp files left behind and the created files are regular (not links).
    expect((await readdir(dir)).filter(name => name.startsWith('.tmp-'))).toEqual([]);
  });

  it('refuses to create with a non-empty expectedRevision while the target is missing', async () => {
    const file = path.join(dir, 'absent.html');
    await expect(
      safeWriteFile(file, Buffer.from('<p>next</p>'), {
        maxBytes: 1024,
        expectedRevision: sha256('<p>anything</p>'),
        createIfMissing: true,
      })
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await readdir(dir)).not.toContain('absent.html');
    expect((await readdir(dir)).filter(name => name.startsWith('.tmp-'))).toEqual([]);
  });

  it('still verifies revisions for existing files when createIfMissing is set', async () => {
    const file = path.join(dir, 'existing.html');
    await writeFile(file, '<p>base</p>');
    const updated = await safeWriteFile(file, Buffer.from('<p>next</p>'), {
      maxBytes: 1024,
      expectedRevision: sha256('<p>base</p>'),
      createIfMissing: true,
    });
    expect(updated.revision).toBe(sha256('<p>next</p>'));

    await expect(
      safeWriteFile(file, Buffer.from('<p>lost</p>'), {
        maxBytes: 1024,
        expectedRevision: '',
        createIfMissing: true,
      })
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await readFile(file, 'utf8')).toBe('<p>next</p>');
  });
});
