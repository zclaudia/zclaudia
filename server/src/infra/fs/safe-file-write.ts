import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  lstatSync,
  mkdirSync,
  promises as fs,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import path from 'node:path';

/**
 * Error codes are call-site agnostic: this module never knows about HTTP or
 * the design domain. Callers (e.g. DesignService) map codes onto their own
 * error types.
 */
export type SafeFileWriteErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PATH_FORBIDDEN'
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'REVISION_CONFLICT';

export class SafeFileWriteError extends Error {
  constructor(
    readonly code: SafeFileWriteErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SafeFileWriteError';
  }
}

export interface SafeWriteOptions {
  maxBytes: number;
  /**
   * SHA-256 hex of the current on-disk content; must match or the write is
   * rejected. An empty string (or undefined) is only accepted together with
   * `createIfMissing` for a missing target.
   */
  expectedRevision: string | undefined;
  /** Optional pre-write backup hook; receives the current bytes and stat. */
  backup?: (bytes: Buffer, stat: Stats) => Promise<void>;
  /**
   * Create the target when it does not exist. Creation requires
   * `expectedRevision` to be empty or undefined — any other revision is
   * rejected as a conflict. When the target exists this flag changes
   * nothing: the usual revision verification applies.
   */
  createIfMissing?: boolean;
}

const locks = new Map<string, Promise<unknown>>();

/** Serialize operations per absolute path so concurrent writers cannot interleave. */
async function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  locks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function sha256(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}

function conflict(): SafeFileWriteError {
  return new SafeFileWriteError('REVISION_CONFLICT', 'File changed since the expected revision');
}

/**
 * Read a regular file with a hard size bound. Never follows symlinks for the
 * final path component and rejects non-regular files.
 */
export async function readBoundedFile(
  filePath: string,
  maxBytes: number,
  description: string
): Promise<{ bytes: Buffer; stat: Stats }> {
  let handle;
  try {
    handle = await fs.open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new SafeFileWriteError('UNSUPPORTED_FILE', 'Only regular files are available');
    if (stat.size > maxBytes)
      throw new SafeFileWriteError('FILE_TOO_LARGE', `${description} exceeds the size limit`);
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes)
      throw new SafeFileWriteError('FILE_TOO_LARGE', `${description} exceeds the size limit`);
    return { bytes, stat };
  } catch (error) {
    if (error instanceof SafeFileWriteError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP')
      throw new SafeFileWriteError('PATH_FORBIDDEN', 'Symbolic links are not allowed');
    throw new SafeFileWriteError('FILE_NOT_FOUND', 'File was not found');
  } finally {
    await handle?.close();
  }
}

/**
 * Atomically replace `absolutePath` with `next` under a per-path mutex:
 * read current content (bounded) → verify `expectedRevision` → optional
 * backup → write a same-directory temp file (original mode preserved) →
 * synchronous final check → rename. The final check and rename stay
 * synchronous so no other event-loop task can change the target between the
 * revision check and the replace.
 *
 * With `createIfMissing`, a missing target is created through the same
 * temp-file + final-check + rename path (no revision to verify, the target
 * must still be absent at the final check); the empty-revision requirement
 * keeps a stale client from silently re-creating a file it never saw.
 */
export async function safeWriteFile(
  absolutePath: string,
  next: Buffer,
  options: SafeWriteOptions
): Promise<{ revision: string }> {
  const target = path.resolve(absolutePath);
  return serialize(target, async () => {
    let initial: { bytes: Buffer; stat: Stats } | null = null;
    try {
      initial = await readBoundedFile(target, options.maxBytes, 'File');
    } catch (error) {
      const creatable =
        options.createIfMissing === true &&
        error instanceof SafeFileWriteError &&
        error.code === 'FILE_NOT_FOUND';
      if (!creatable) throw error;
      if (options.expectedRevision !== '' && options.expectedRevision !== undefined)
        throw conflict();
    }
    if (initial) {
      if (sha256(initial.bytes) !== options.expectedRevision) throw conflict();
      if (options.backup) await options.backup(initial.bytes, initial.stat);
    }
    const mode = (initial ? initial.stat.mode : 0o644) & 0o777;
    const temp = path.join(path.dirname(target), `.tmp-${randomUUID()}`);
    try {
      await fs.writeFile(temp, next, { flag: 'wx', mode });
      await fs.chmod(temp, mode);
      // Keep the final compare and rename synchronous so another event-loop
      // task cannot change the file between the revision check and replace.
      let current: Stats | null = null;
      try {
        current = lstatSync(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw conflict();
      }
      if (initial) {
        if (!current || current.isSymbolicLink()) throw conflict();
        const currentStat = statSync(target);
        if (
          !currentStat.isFile() ||
          currentStat.dev !== initial.stat.dev ||
          currentStat.ino !== initial.stat.ino
        ) {
          throw conflict();
        }
        if (sha256(readFileSync(target)) !== options.expectedRevision) throw conflict();
      } else if (current) {
        // The target appeared between the existence check and the rename.
        throw conflict();
      }
      // External processes can still race this final syscall; the check is
      // as close to replacement as Node's portable filesystem API allows.
      renameSync(temp, target);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
    return { revision: sha256(next) };
  });
}

/**
 * Build a backup hook that stores pre-write copies under
 * `<rootDir>/<sha256(filePath).slice(0, 16)>/<timestamp>-<uuid>` and keeps
 * only the newest `keep` copies per file. Writes and pruning run under the
 * module's per-path lock (keyed on the backup directory) so concurrent calls
 * cannot interleave or double-prune.
 */
export function createRollingBackupKeeper(
  rootDir: string,
  keep = 5
): (bytes: Buffer, stat: Stats, filePath: string) => Promise<void> {
  const root = path.resolve(rootDir);
  // Monotonic per-directory timestamp source: names sort chronologically even
  // when several backups land within the same millisecond.
  const lastStamp = new Map<string, number>();
  return async (bytes, _stat, filePath) => {
    const dir = path.join(
      root,
      createHash('sha256').update(path.resolve(filePath)).digest('hex').slice(0, 16)
    );
    await serialize(dir, async () => {
      mkdirSync(dir, { recursive: true });
      const stamp = Math.max(Date.now(), (lastStamp.get(dir) ?? 0) + 1);
      lastStamp.set(dir, stamp);
      const name = `${String(stamp).padStart(15, '0')}-${randomUUID()}`;
      writeFileSync(path.join(dir, name), bytes);
      // Timestamp-prefixed names sort chronologically; drop everything but
      // the newest `keep` copies.
      const names = readdirSync(dir);
      const stale = names.sort().reverse().slice(keep);
      for (const old of stale) rmSync(path.join(dir, old), { force: true });
    });
  };
}
