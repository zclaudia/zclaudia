import { mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

export interface FileBackupResult {
  id: string;
  originalPath: string;
  originalAbsolutePath?: string;
  path: string;
  createdAt: number;
}

const backupDir = path.join(os.tmpdir(), 'zclaudia-file-history');
const indexPath = path.join(backupDir, 'index.json');

async function readIndex(): Promise<Record<string, FileBackupResult>> {
  try {
    return JSON.parse(await readFile(indexPath, 'utf8')) as Record<string, FileBackupResult>;
  } catch {
    return {};
  }
}

async function writeIndex(index: Record<string, FileBackupResult>): Promise<void> {
  await mkdir(backupDir, { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

export async function recordFileBackup(originalPath: string, content: string, originalAbsolutePath?: string): Promise<FileBackupResult> {
  const id = randomUUID();
  const createdAt = Date.now();
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${createdAt}-${id}.bak`);
  await writeFile(backupPath, content, 'utf8');
  const result: FileBackupResult = {
    id,
    originalPath,
    ...(originalAbsolutePath ? { originalAbsolutePath } : {}),
    path: backupPath,
    createdAt,
  };
  const index = await readIndex();
  index[id] = result;
  await writeIndex(index);
  return result;
}

export async function getFileBackup(id: string): Promise<FileBackupResult | undefined> {
  return (await readIndex())[id];
}

export async function restoreFileBackup(id: string): Promise<FileBackupResult & { restored: true }> {
  const backup = await getFileBackup(id);
  if (!backup) throw new Error('backup_not_found');
  if (!backup.originalAbsolutePath) throw new Error('backup_missing_target');
  const content = await readFile(backup.path, 'utf8');
  await mkdir(path.dirname(backup.originalAbsolutePath), { recursive: true });
  await writeFile(backup.originalAbsolutePath, content, 'utf8');
  return { ...backup, restored: true };
}
