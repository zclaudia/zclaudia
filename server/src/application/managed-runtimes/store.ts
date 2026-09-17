import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const pending = `${filePath}.pending-${randomUUID()}`;
  const backup = `${filePath}.backup-${randomUUID()}`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  let backedUp = false;
  try {
    if (existsSync(filePath)) {
      await rename(filePath, backup);
      backedUp = true;
    }
    await rename(pending, filePath);
  } catch (error) {
    await rm(pending, { force: true });
    if (backedUp && !existsSync(filePath)) await rename(backup, filePath).catch(() => {});
    throw error;
  }
  await rm(backup, { force: true }).catch(() => {});
}

export async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
