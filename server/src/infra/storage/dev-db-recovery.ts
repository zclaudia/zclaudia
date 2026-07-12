import { renameSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Whether the runtime is allowed to auto-reset (back up + recreate) the dev
 * database when its schema is incompatible.
 *
 * The embedded dev server sets ZCLAUDIA_CHANNEL='dev'; standalone dev runs may
 * set NODE_ENV=development or ZCLAUDIA_DEV. Production leaves ZCLAUDIA_CHANNEL
 * unset (treated as 'prod' elsewhere), so it never matches — and an explicit
 * 'prod' channel is a hard veto so no combination of stray env vars can ever
 * wipe production data.
 */
export function shouldAutoResetDevDb(env: NodeJS.ProcessEnv): boolean {
  if (env.ZCLAUDIA_CHANNEL === 'prod') return false;
  return env.ZCLAUDIA_CHANNEL === 'dev' || env.NODE_ENV === 'development' || !!env.ZCLAUDIA_DEV;
}

function formatTimestamp(date: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/**
 * Rename the database file to a timestamped backup (never `rm -rf`), drop stale
 * WAL/SHM sidecars, and prune old backups down to `keep` (default 1, newest).
 * The caller is responsible for closing the DB handle first. Returns the backup
 * path. Only touches `data.db*` — user files (attachments, workspace) are left
 * untouched.
 */
export function backupAndClearDb(
  dbPath: string,
  opts: { keep?: number; timestamp?: string } = {}
): string {
  const keep = opts.keep ?? 1;
  const ts = opts.timestamp ?? formatTimestamp(new Date());
  const backupPath = `${dbPath}.bak-${ts}`;

  renameSync(dbPath, backupPath);
  for (const ext of ['-wal', '-shm']) {
    rmSync(dbPath + ext, { force: true });
  }
  pruneBackups(dbPath, keep);
  return backupPath;
}

function pruneBackups(dbPath: string, keep: number): void {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.bak-`;
  // The timestamp suffix is fixed-width and zero-padded, so a lexical sort is
  // chronological — newest last.
  const backups = readdirSync(dir)
    .filter(f => f.startsWith(prefix))
    .sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    rmSync(path.join(dir, stale), { force: true });
  }
}

/**
 * Open a database and prepare its schema, recovering from an incompatible dev
 * schema by backing it up and starting fresh. Migration is attempted first;
 * only a genuine failure triggers the reset, and only in dev
 * (see {@link shouldAutoResetDevDb}). In production the error propagates so the
 * server halts instead of ever destroying data.
 */
export function withDevAutoReset<T>(args: {
  dbPath: string;
  env: NodeJS.ProcessEnv;
  open: () => T;
  prepare: (db: T) => void;
  close: (db: T) => void;
}): T {
  const { dbPath, env, open, prepare, close } = args;
  const db = open();
  try {
    prepare(db);
    return db;
  } catch (err) {
    if (!shouldAutoResetDevDb(env)) throw err;
    close(db);
    const backup = backupAndClearDb(dbPath);
    const cause = err instanceof Error ? err.message : String(err);
    console.warn(
      `[dev-db] schema/migration failed — backed up to ${backup} and recreating a fresh dev DB. ` +
        `Cause: ${cause}`
    );
    const fresh = open();
    prepare(fresh);
    return fresh;
  }
}
