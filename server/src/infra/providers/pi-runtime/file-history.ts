import { chmod, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { isOutsideWorkspace } from './workspace-paths.js';

export interface FileBackupResult {
  id: string;
  originalPath: string;
  originalAbsolutePath?: string;
  /**
   * Workspace root the backup target belonged to when recorded, derived from
   * originalPath + originalAbsolutePath. Restores re-validate containment
   * against it; legacy entries without it only get the symlink check.
   */
  workspaceRoot?: string;
  path: string;
  createdAt: number;
}

/** Newest backups kept per original file; older ones are pruned on write. */
export const MAX_BACKUPS_PER_FILE = 20;
/** Backups older than this are pruned on write. */
export const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Test hook: point the history store at a private directory by setting
// ZCLAUDIA_FILE_HISTORY_DIR before this module is first imported.
const backupDir =
  process.env.ZCLAUDIA_FILE_HISTORY_DIR ?? path.join(os.tmpdir(), 'zclaudia-file-history');
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
  // The index records absolute workspace paths — keep it owner-only too.
  // (mode on writeFile only applies at creation, so chmod explicitly.)
  await chmod(indexPath, 0o600).catch(() => {});
}

// The index is shared across files, so every read-modify-write runs behind
// this module-level promise chain (same pattern as file-write-lock.ts, but a
// single queue — per-file locks would not serialize the shared index).
let indexLock: Promise<void> = Promise.resolve();

async function runWithIndexLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = indexLock;
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  indexLock = previous.then(
    () => current,
    () => current
  );
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Recovers the workspace root from a backup's recorded paths. Callers pass a
 * workspace-relative originalPath (forward slashes) and the absolute target;
 * stripping the relative suffix off the absolute path yields the root. This
 * keeps every caller (including ones that cannot be changed here) covered
 * without threading a new parameter through.
 */
function deriveWorkspaceRoot(
  originalPath: string,
  originalAbsolutePath: string | undefined
): string | undefined {
  if (!originalAbsolutePath) return undefined;
  const relative = originalPath
    .split('/')
    .filter(segment => segment.length > 0)
    .join(path.sep);
  if (!relative) return undefined;
  const absolute = path.resolve(originalAbsolutePath);
  const suffix = `${path.sep}${relative}`;
  if (!absolute.endsWith(suffix)) return undefined;
  return absolute.slice(0, absolute.length - suffix.length);
}

/**
 * Drops expired backups and caps each file at its newest MAX_BACKUPS_PER_FILE
 * entries. Returns the pruned index plus the backup files to delete. Survivors
 * keep their original (insertion) order so the same-write tiebreak below stays
 * a stable recency order across writes.
 */
function pruneIndex(
  index: Record<string, FileBackupResult>,
  now: number
): { index: Record<string, FileBackupResult>; removedPaths: string[] } {
  const perFile = new Map<string, Array<{ entry: FileBackupResult; position: number }>>();
  const kept: Record<string, FileBackupResult> = {};
  const removedPaths: string[] = [];
  const entries = Object.values(index);
  for (const [position, entry] of entries.entries()) {
    const fileKey = entry.originalAbsolutePath ?? entry.originalPath;
    const group = perFile.get(fileKey) ?? [];
    group.push({ entry, position });
    perFile.set(fileKey, group);
  }
  const droppedIds = new Set<string>();
  for (const group of perFile.values()) {
    if (group.length <= MAX_BACKUPS_PER_FILE) continue;
    // Oldest first; createdAt can tie on same-millisecond backups, so break
    // ties by insertion order (earlier = older).
    const oldestFirst = [...group].sort(
      (a, b) => a.entry.createdAt - b.entry.createdAt || a.position - b.position
    );
    for (const { entry } of oldestFirst.slice(0, group.length - MAX_BACKUPS_PER_FILE)) {
      droppedIds.add(entry.id);
    }
  }
  for (const entry of entries) {
    if (now - entry.createdAt > BACKUP_TTL_MS || droppedIds.has(entry.id)) {
      removedPaths.push(entry.path);
    } else {
      kept[entry.id] = entry;
    }
  }
  return { index: kept, removedPaths };
}

export async function recordFileBackup(
  originalPath: string,
  content: string,
  originalAbsolutePath?: string
): Promise<FileBackupResult> {
  const id = randomUUID();
  const createdAt = Date.now();
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${createdAt}-${id}.bak`);
  // 0600: backups can hold sensitive file contents and tmp dirs are shared.
  // The filename is unique, so the creation mode always applies.
  await writeFile(backupPath, content, { encoding: 'utf8', mode: 0o600 });
  const workspaceRoot = deriveWorkspaceRoot(originalPath, originalAbsolutePath);
  const result: FileBackupResult = {
    id,
    originalPath,
    ...(originalAbsolutePath ? { originalAbsolutePath } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    path: backupPath,
    createdAt,
  };
  await runWithIndexLock(async () => {
    const index = await readIndex();
    index[id] = result;
    const pruned = pruneIndex(index, Date.now());
    await writeIndex(pruned.index);
    await Promise.all(pruned.removedPaths.map(removed => rm(removed, { force: true })));
  });
  return result;
}

export async function getFileBackup(id: string): Promise<FileBackupResult | undefined> {
  return (await readIndex())[id];
}

/**
 * Re-validates a restore target the way workspace-paths.ts guards mutations:
 * the target must stay inside the workspace it was recorded in (lexically and
 * after resolving symlinks of its nearest existing ancestor) and must not
 * itself be a symlink — restoring through one would write somewhere the
 * recorded path never pointed at.
 */
async function assertRestoreTargetSafe(
  workspaceRoot: string | undefined,
  originalAbsolutePath: string
): Promise<void> {
  const target = path.resolve(originalAbsolutePath);
  const targetStat = await lstat(target).catch(() => undefined);
  if (targetStat?.isSymbolicLink()) throw new Error('backup_target_symlink');
  if (!workspaceRoot) return;
  const workspace = path.resolve(workspaceRoot);
  if (isOutsideWorkspace(path.relative(workspace, target))) {
    throw new Error('backup_target_outside_workspace');
  }
  let probe = target;
  const missingParts: string[] = [];
  // stat (not lstat) so a dangling symlink does not count as an existing
  // ancestor — mirrors resolveInsideWorkspace's existsSync walk.
  while (!(await stat(probe).catch(() => undefined))) {
    const parent = path.dirname(probe);
    if (parent === probe) throw new Error('backup_target_outside_workspace');
    missingParts.unshift(path.basename(probe));
    probe = parent;
  }
  const realWorkspace = await realpath(workspace).catch(() => workspace);
  const realExistingPrefix = await realpath(probe);
  if (isOutsideWorkspace(path.relative(realWorkspace, realExistingPrefix))) {
    throw new Error('backup_target_outside_workspace');
  }
  const realCandidate =
    missingParts.length > 0 ? path.join(realExistingPrefix, ...missingParts) : realExistingPrefix;
  if (isOutsideWorkspace(path.relative(realWorkspace, realCandidate))) {
    throw new Error('backup_target_outside_workspace');
  }
}

export async function restoreFileBackup(
  id: string
): Promise<FileBackupResult & { restored: true }> {
  const backup = await getFileBackup(id);
  if (!backup) throw new Error('backup_not_found');
  if (!backup.originalAbsolutePath) throw new Error('backup_missing_target');
  await assertRestoreTargetSafe(backup.workspaceRoot, backup.originalAbsolutePath);
  const content = await readFile(backup.path, 'utf8');
  await mkdir(path.dirname(backup.originalAbsolutePath), { recursive: true });
  await writeFile(backup.originalAbsolutePath, content, 'utf8');
  return { ...backup, restored: true };
}
