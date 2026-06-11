import { mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

export interface FileBackupResult {
  originalPath: string;
  path: string;
}

export async function recordFileBackup(originalPath: string, content: string): Promise<FileBackupResult> {
  const backupDir = path.join(os.tmpdir(), 'zclaudia-file-history');
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${Date.now()}-${randomUUID()}.bak`);
  await writeFile(backupPath, content, 'utf8');
  return {
    originalPath,
    path: backupPath,
  };
}
