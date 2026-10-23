import { createHash } from 'node:crypto';
import { promises as fs, type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  SafeFileWriteError,
  createRollingBackupKeeper,
  readBoundedFile,
  safeWriteFile,
} from '../../infra/fs/safe-file-write.js';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_LIST_FILES = 5000;
const MAX_LIST_DIRS = 20000;
const MAX_LIST_DEPTH = 64;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage']);
export const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

export class DesignError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Optional structured payload merged into the HTTP error object (e.g. RESTORE_CONFLICT files). */
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

// Pre-write document backups, outside any workspace. Resolution mirrors
// server/src/infra/storage/db.ts (ZCLAUDIA_DATA_DIR ?? ~/.zclaudia) without
// importing it, to keep the storage module free of application-layer ties.
const DESIGN_BACKUP_ROOT = path.join(
  process.env.ZCLAUDIA_DATA_DIR ? path.resolve(process.env.ZCLAUDIA_DATA_DIR) : path.join(os.homedir(), '.zclaudia'),
  'design-write-backups'
);
const designBackupKeeper = createRollingBackupKeeper(DESIGN_BACKUP_ROOT, 5);

/**
 * Map the shared write-boundary error codes onto the design HTTP contract.
 * Status/code pairs and messages are identical to the pre-refactor behavior.
 */
export function toDesignError(error: unknown): unknown {
  if (error instanceof SafeFileWriteError) {
    switch (error.code) {
      case 'UNSUPPORTED_FILE':
        return new DesignError(400, error.code, 'Only regular files are available');
      case 'FILE_TOO_LARGE':
        return new DesignError(413, error.code, error.message);
      case 'PATH_FORBIDDEN':
        return new DesignError(403, error.code, 'Symbolic links are not allowed');
      case 'FILE_NOT_FOUND':
        return new DesignError(404, error.code, 'File was not found');
      case 'REVISION_CONFLICT':
        return new DesignError(409, error.code, 'Document changed since it was loaded');
    }
  }
  return error;
}

function hash(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}
export function validateRelativePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    value.includes('\0') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value)
  ) {
    throw new DesignError(400, 'VALIDATION_ERROR', 'path must be a relative file path');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new DesignError(400, 'VALIDATION_ERROR', 'path contains a private or invalid component');
  }
  return parts.join(path.sep);
}
export function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    if (!relative) return;
    throw new DesignError(403, 'PATH_FORBIDDEN', 'path is outside the session workspace');
  }
}

export class DesignService {
  constructor(private readonly db: Database.Database) {}

  async workspace(sessionId: unknown): Promise<string> {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256)
      throw new DesignError(400, 'VALIDATION_ERROR', 'sessionId is required');
    const row = this.db
      .prepare(
        `SELECT COALESCE(NULLIF(s.working_directory, ''), p.root_path) AS root_path
      FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`
      )
      .get(sessionId) as { root_path?: string } | undefined;
    if (!row) throw new DesignError(404, 'SESSION_NOT_FOUND', 'Session was not found');
    if (!row.root_path)
      throw new DesignError(400, 'WORKSPACE_UNAVAILABLE', 'Session has no workspace directory');
    try {
      return await fs.realpath(row.root_path);
    } catch {
      throw new DesignError(404, 'WORKSPACE_UNAVAILABLE', 'Session workspace is unavailable');
    }
  }

  async resolve(
    root: string,
    value: unknown,
    options?: { allowMissingLeaf?: boolean }
  ): Promise<{ relative: string; absolute: string }> {
    const relative = validateRelativePath(value);
    const absolute = path.resolve(root, relative);
    assertContained(root, absolute);
    const parts = relative.split(path.sep);
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      let info: Stats;
      try {
        info = await fs.lstat(current);
      } catch (error) {
        // With allowMissingLeaf only the final component may be absent
        // (creation path): parents were still symlink-checked above and
        // containment was already enforced syntactically.
        const missingLeaf =
          options?.allowMissingLeaf === true &&
          index === parts.length - 1 &&
          (error as NodeJS.ErrnoException).code === 'ENOENT';
        if (!missingLeaf) throw new DesignError(404, 'FILE_NOT_FOUND', 'File was not found');
        return { relative: parts.join('/'), absolute };
      }
      if (info.isSymbolicLink())
        throw new DesignError(403, 'PATH_FORBIDDEN', 'Symbolic links are not allowed');
    }
    let real: string;
    try {
      real = await fs.realpath(absolute);
    } catch {
      throw new DesignError(404, 'FILE_NOT_FOUND', 'File was not found');
    }
    assertContained(root, real);
    const canonicalRelative = path.relative(root, real);
    if (canonicalRelative.split(path.sep).some(part => part.startsWith('.'))) {
      throw new DesignError(403, 'PATH_FORBIDDEN', 'Private files are not available');
    }
    return { relative: relative.split(path.sep).join('/'), absolute: real };
  }

  /**
   * Resolve a session-scoped file path to its workspace root plus normalized
   * relative/absolute paths. Shared entry point for the design services
   * (deps/export) so workspace and path rules stay in one place.
   */
  async resolveFile(
    sessionId: unknown,
    filePath: unknown,
    options?: { allowMissingLeaf?: boolean }
  ): Promise<{ root: string; relative: string; absolute: string }> {
    const root = await this.workspace(sessionId);
    const file = await this.resolve(root, filePath, options);
    return { root, relative: file.relative, absolute: file.absolute };
  }

  private async readBounded(
    filePath: string,
    maxBytes: number,
    description: string
  ): Promise<{ bytes: Buffer; stat: Stats }> {
    try {
      return await readBoundedFile(filePath, maxBytes, description);
    } catch (error) {
      throw toDesignError(error);
    }
  }

  async list(sessionId: unknown): Promise<{ files: string[] }> {
    const root = await this.workspace(sessionId);
    const files: string[] = [];
    let visitedDirs = 0;
    const walk = async (dir: string, prefix: string): Promise<void> => {
      if (
        ++visitedDirs > MAX_LIST_DIRS ||
        prefix.split('/').filter(Boolean).length > MAX_LIST_DEPTH
      )
        return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs, rel);
        else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
          try {
            const real = await fs.realpath(abs);
            assertContained(root, real);
            const stat = await fs.stat(real);
            if (stat.isFile()) files.push(rel);
          } catch {
            /* ignore broken or escaping links */
          }
          if (files.length >= MAX_LIST_FILES) return;
        }
        if (files.length >= MAX_LIST_FILES) return;
      }
    };
    await walk(root, '');
    return { files: files.sort((a, b) => a.localeCompare(b)) };
  }

  async readDocument(sessionId: unknown, filePath: unknown) {
    const root = await this.workspace(sessionId);
    const file = await this.resolve(root, filePath);
    if (!/\.html?$/i.test(file.relative))
      throw new DesignError(400, 'UNSUPPORTED_FILE', 'Only HTML documents can be edited');
    const { bytes } = await this.readBounded(file.absolute, MAX_SOURCE_BYTES, 'HTML document');
    const source = bytes.toString('utf8');
    return { path: file.relative, source, revision: hash(bytes) };
  }

  async writeDocument(
    sessionId: unknown,
    filePath: unknown,
    source: unknown,
    expectedRevision: unknown,
    allowCreate?: unknown
  ) {
    if (typeof source !== 'string')
      throw new DesignError(400, 'VALIDATION_ERROR', 'source must be a string');
    const bytes = Buffer.from(source, 'utf8');
    if (bytes.length > MAX_SOURCE_BYTES)
      throw new DesignError(413, 'FILE_TOO_LARGE', 'HTML document exceeds the 2 MiB limit');
    if (allowCreate !== undefined && typeof allowCreate !== 'boolean')
      throw new DesignError(400, 'VALIDATION_ERROR', 'allowCreate must be a boolean');
    const create = allowCreate === true;
    const revisionIsHash =
      typeof expectedRevision === 'string' && /^[a-f0-9]{64}$/.test(expectedRevision);
    // A rebuild-after-delete save passes an empty (or omitted) revision.
    const revisionForCreate = create && (expectedRevision === '' || expectedRevision === undefined);
    if (!revisionIsHash && !revisionForCreate)
      throw new DesignError(400, 'VALIDATION_ERROR', 'expectedRevision must be a SHA-256 revision');
    const file = await this.resolveFile(sessionId, filePath, { allowMissingLeaf: create });
    if (!/\.html?$/i.test(file.relative))
      throw new DesignError(400, 'UNSUPPORTED_FILE', 'Only existing HTML documents can be edited');
    try {
      await safeWriteFile(file.absolute, bytes, {
        maxBytes: MAX_SOURCE_BYTES,
        expectedRevision: revisionIsHash ? (expectedRevision as string) : '',
        createIfMissing: create,
        backup: async (current, stat) => {
          // Backups are best-effort: a failure must never fail the save
          // (the write itself stays fully guarded by safeWriteFile).
          try {
            await designBackupKeeper(current, stat, file.absolute);
          } catch {
            /* ignore backup failures */
          }
        },
      });
    } catch (error) {
      throw toDesignError(error);
    }
    return { path: file.relative, source, revision: hash(bytes) };
  }

  async readAsset(sessionId: unknown, filePath: unknown) {
    const root = await this.workspace(sessionId);
    const file = await this.resolve(root, filePath);
    const ext = path.extname(file.relative).toLowerCase();
    const mimeType = ASSET_TYPES[ext];
    if (!mimeType) throw new DesignError(415, 'UNSUPPORTED_ASSET', 'Asset type is not allowed');
    const { bytes } = await this.readBounded(file.absolute, MAX_ASSET_BYTES, 'Asset');
    return { mimeType, data: bytes.toString('base64') };
  }
}
