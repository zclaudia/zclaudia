import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import type * as FileHistory from '../file-history.js';

// The history store directory is fixed at module load, so point it at a
// private dir before importing — keeps these tests independent of the shared
// default store other suites use.
let fileHistory: typeof FileHistory;
let storeDir: string;

async function tempRoot(label: string): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), label)));
}

beforeAll(async () => {
  storeDir = await tempRoot('zc-file-history-store-');
  process.env.ZCLAUDIA_FILE_HISTORY_DIR = storeDir;
  fileHistory = await import('../file-history.js');
});

afterAll(async () => {
  delete process.env.ZCLAUDIA_FILE_HISTORY_DIR;
  await rm(storeDir, { recursive: true, force: true });
});

describe('file history', () => {
  it('records and restores a backup', async () => {
    const root = await tempRoot('zc-fh-basic-');
    const target = path.join(root, 'f.ts');
    await writeFile(target, 'const a = 1;\n');
    const backup = await fileHistory.recordFileBackup('f.ts', 'const a = 1;\n', target);
    await writeFile(target, 'const a = 2;\n');

    const restored = await fileHistory.restoreFileBackup(backup.id);

    expect(restored.restored).toBe(true);
    expect(restored.workspaceRoot).toBe(root);
    expect(await readFile(target, 'utf8')).toBe('const a = 1;\n');
    await rm(root, { recursive: true, force: true });
  });

  it('writes backup files owner-only (0600)', async () => {
    const root = await tempRoot('zc-fh-perms-');
    const target = path.join(root, 'secret.ts');
    await writeFile(target, 'const key = 1;\n');

    const backup = await fileHistory.recordFileBackup('secret.ts', 'const key = 1;\n', target);

    expect((await stat(backup.path)).mode & 0o777).toBe(0o600);
    await rm(root, { recursive: true, force: true });
  });

  it('keeps every entry when backups for different files run concurrently', async () => {
    const root = await tempRoot('zc-fh-concurrent-');
    const files = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const name = `f${index}.ts`;
        const target = path.join(root, name);
        await writeFile(target, `const v = ${index};\n`);
        return { name, target };
      })
    );

    const backups = await Promise.all(
      files.map(({ name, target }, index) =>
        fileHistory.recordFileBackup(name, `const v = ${index};\n`, target)
      )
    );

    // Without the serialized index read-modify-write, concurrent records race
    // and silently drop entries.
    for (const backup of backups) {
      expect(await fileHistory.getFileBackup(backup.id)).toMatchObject({ id: backup.id });
    }
    await rm(root, { recursive: true, force: true });
  });

  it('prunes to the newest MAX_BACKUPS_PER_FILE backups per file on write', async () => {
    const root = await tempRoot('zc-fh-prune-');
    const target = path.join(root, 'hot.ts');
    await writeFile(target, 'const v = 0;\n');
    const total = fileHistory.MAX_BACKUPS_PER_FILE + 3;
    const backups = [];
    for (let index = 0; index < total; index += 1) {
      backups.push(await fileHistory.recordFileBackup('hot.ts', `const v = ${index};\n`, target));
    }

    const dropped = backups.slice(0, total - fileHistory.MAX_BACKUPS_PER_FILE);
    const kept = backups.slice(total - fileHistory.MAX_BACKUPS_PER_FILE);
    for (const backup of dropped) {
      expect(await fileHistory.getFileBackup(backup.id)).toBeUndefined();
      expect(existsSync(backup.path)).toBe(false);
    }
    for (const backup of kept) {
      expect(await fileHistory.getFileBackup(backup.id)).toMatchObject({ id: backup.id });
      expect(existsSync(backup.path)).toBe(true);
    }
    await rm(root, { recursive: true, force: true });
  });

  it('prunes backups older than the TTL on write', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const root = await tempRoot('zc-fh-ttl-');
      const target = path.join(root, 'old.ts');
      await writeFile(target, 'const v = 1;\n');
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const stale = await fileHistory.recordFileBackup('old.ts', 'const v = 1;\n', target);
      // 8 days later, beyond the 7-day TTL.
      vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
      const fresh = await fileHistory.recordFileBackup('old.ts', 'const v = 2;\n', target);

      expect(await fileHistory.getFileBackup(stale.id)).toBeUndefined();
      expect(existsSync(stale.path)).toBe(false);
      expect(await fileHistory.getFileBackup(fresh.id)).toMatchObject({ id: fresh.id });
      await rm(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to restore through a symlink at the recorded target', async () => {
    const root = await tempRoot('zc-fh-target-symlink-');
    const target = path.join(root, 'f.ts');
    const decoy = path.join(root, 'decoy.ts');
    await writeFile(target, 'const a = 1;\n');
    await writeFile(decoy, 'const decoy = true;\n');
    const backup = await fileHistory.recordFileBackup('f.ts', 'const a = 1;\n', target);
    await rm(target);
    await symlink(decoy, target);

    await expect(fileHistory.restoreFileBackup(backup.id)).rejects.toThrow('backup_target_symlink');
    // The symlink's own target is untouched.
    expect(await readFile(decoy, 'utf8')).toBe('const decoy = true;\n');
    await rm(root, { recursive: true, force: true });
  });

  it('refuses to restore when a path component now escapes the workspace', async () => {
    const root = await tempRoot('zc-fh-escape-');
    const outside = await tempRoot('zc-fh-outside-');
    await mkdir(path.join(root, 'sub'));
    const target = path.join(root, 'sub', 'f.ts');
    await writeFile(target, 'const a = 1;\n');
    const backup = await fileHistory.recordFileBackup('sub/f.ts', 'const a = 1;\n', target);
    // Swap the recorded parent directory for a symlink out of the workspace.
    await rm(path.join(root, 'sub'), { recursive: true, force: true });
    await symlink(outside, path.join(root, 'sub'));

    await expect(fileHistory.restoreFileBackup(backup.id)).rejects.toThrow(
      'backup_target_outside_workspace'
    );
    expect(existsSync(path.join(outside, 'f.ts'))).toBe(false);
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('still restores when the recorded file was simply deleted', async () => {
    const root = await tempRoot('zc-fh-deleted-');
    const target = path.join(root, 'gone.ts');
    await writeFile(target, 'const a = 1;\n');
    const backup = await fileHistory.recordFileBackup('gone.ts', 'const a = 1;\n', target);
    await rm(target);

    const restored = await fileHistory.restoreFileBackup(backup.id);

    expect(restored.restored).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('const a = 1;\n');
    await rm(root, { recursive: true, force: true });
  });
});
