import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { BlobStore } from '../../infra/design/blob-store.js';
import { readBoundedFile } from '../../infra/fs/safe-file-write.js';
import {
  ASSET_TYPES,
  DesignError,
  DesignService,
  toDesignError,
  validateRelativePath,
} from './design-service.js';
import {
  collectCssResourceRefs,
  collectHtmlResourceRefs,
  type ResourceRef,
} from './resource-graph.js';

// Capture bounds (P1.6 §6.3).
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_RESOURCES = 200;
export const MAX_CSS_DEPTH = 4;
export const MAX_SNAPSHOTS_PER_WORKSPACE = 500;
export const MAX_LISTED_SNAPSHOTS = 100;

const SNAPSHOT_SOURCES = new Set(['save', 'manual', 'pre-restore', 'restore']);

export type SnapshotSource = 'save' | 'manual' | 'pre-restore' | 'restore';
export type SnapshotFileKind = 'entry' | 'css' | 'image' | 'font' | 'video' | 'other';

export interface SnapshotFile {
  path: string;
  sha256: string;
  bytes: number;
  kind: SnapshotFileKind;
  mime: string | null;
}

export interface SnapshotSummary {
  id: string;
  workspaceRoot: string;
  sessionId: string | null;
  entryPath: string;
  label: string | null;
  source: string;
  complete: boolean;
  incompleteReasons: string[];
  fileCount: number;
  totalBytes: number;
  createdAt: number;
}

export interface SnapshotDetail {
  summary: SnapshotSummary;
  files: SnapshotFile[];
}

interface SnapshotRow {
  id: string;
  workspace_root: string;
  session_id: string | null;
  entry_path: string;
  label: string | null;
  source: string;
  complete: number;
  incomplete_reasons: string;
  file_count: number;
  total_bytes: number;
  created_at: number;
}

interface CapturedFile {
  path: string;
  bytes: Buffer;
  stat: Stats;
  kind: SnapshotFileKind;
  mime: string | null;
}

/** A file read plus the post-read stability verdict (§6.3 step 3). */
interface StableRead {
  bytes: Buffer;
  stat: Stats;
  unstable: boolean;
}

export function sha256(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mimeForPath(refPath: string): string | null {
  return ASSET_TYPES[path.posix.extname(refPath).toLowerCase()] ?? null;
}

/**
 * Read a file, then re-stat: if mtimeMs or size moved, re-read once. If the
 * file moves again after the re-read the result is flagged unstable — the
 * caller records `changed-during-capture` and keeps the re-read content.
 */
async function readWithStabilityCheck(
  absolutePath: string,
  maxBytes: number
): Promise<StableRead> {
  const first = await readBoundedFile(absolutePath, maxBytes, 'File');
  let rechecked: Stats | null;
  try {
    rechecked = await fs.stat(absolutePath);
  } catch {
    rechecked = null;
  }
  if (rechecked && rechecked.mtimeMs === first.stat.mtimeMs && rechecked.size === first.stat.size)
    return { bytes: first.bytes, stat: first.stat, unstable: false };
  const second = await readBoundedFile(absolutePath, maxBytes, 'File');
  let settled: Stats | null;
  try {
    settled = await fs.stat(absolutePath);
  } catch {
    settled = null;
  }
  return {
    bytes: second.bytes,
    stat: second.stat,
    unstable: !settled || settled.mtimeMs !== second.stat.mtimeMs || settled.size !== second.stat.size,
  };
}

export class SnapshotService {
  private readonly design: DesignService;

  constructor(
    private readonly db: Database.Database,
    private readonly blobs: BlobStore
  ) {
    this.design = new DesignService(db);
  }

  /** Manually or automatically triggered capture: BFS the resource graph from an HTML entry. */
  async capture(
    sessionId: unknown,
    entryPath: unknown,
    label?: unknown,
    source: SnapshotSource = 'manual'
  ): Promise<SnapshotSummary> {
    if (typeof source !== 'string' || !SNAPSHOT_SOURCES.has(source))
      throw new DesignError(400, 'VALIDATION_ERROR', 'Invalid snapshot source');
    const normalizedLabel = this.normalizeLabel(label);
    const root = await this.design.workspace(sessionId);
    const entry = await this.design.resolve(root, entryPath);
    if (!/\.html?$/i.test(entry.relative))
      throw new DesignError(400, 'UNSUPPORTED_FILE', 'Only HTML entry documents can be captured');

    const incomplete: string[] = [];
    const files = new Map<string, CapturedFile>();

    const entryRead = await this.readForCapture(entry.absolute, MAX_ENTRY_BYTES);
    if (entryRead.unstable) incomplete.push(`changed-during-capture: ${entry.relative}`);
    let totalBytes = entryRead.bytes.length;
    files.set(entry.relative, {
      path: entry.relative,
      bytes: entryRead.bytes,
      stat: entryRead.stat,
      kind: 'entry',
      mime: 'text/html',
    });

    // BFS over the resource graph, css imports included (depth ≤ 4).
    const visited = new Set<string>([entry.relative]);
    const queued = new Set<string>();
    const queue: Array<{ ref: ResourceRef; depth: number }> = [];
    let discovered = 0;
    let limitHit = false;
    for (const ref of collectHtmlResourceRefs(entryRead.bytes.toString('utf8'), entry.relative).refs) {
      if (visited.has(ref.path) || queued.has(ref.path)) continue;
      queued.add(ref.path);
      queue.push({ ref, depth: 1 });
      discovered++;
    }
    if (queue.length > MAX_RESOURCES) {
      queue.length = MAX_RESOURCES;
      limitHit = true;
    }

    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      const { ref, depth } = next;
      queued.delete(ref.path);
      if (visited.has(ref.path)) continue;
      visited.add(ref.path);
      let read: StableRead;
      try {
        const resolved = await this.design.resolve(root, ref.path);
        read = await this.readForCapture(resolved.absolute, MAX_RESOURCE_BYTES);
      } catch (error) {
        incomplete.push(`${ref.path}: ${messageOf(error)}`);
        continue;
      }
      if (read.unstable) incomplete.push(`changed-during-capture: ${ref.path}`);
      if (totalBytes + read.bytes.length > MAX_TOTAL_BYTES) {
        incomplete.push(`${ref.path}: total capture size limit exceeded`);
        continue;
      }
      totalBytes += read.bytes.length;
      files.set(ref.path, {
        path: ref.path,
        bytes: read.bytes,
        stat: read.stat,
        kind: ref.kind,
        mime: mimeForPath(ref.path),
      });
      if (ref.kind === 'css') {
        for (const next of collectCssResourceRefs(read.bytes.toString('utf8'), ref.path).refs) {
          if (depth + 1 > MAX_CSS_DEPTH) {
            incomplete.push(`${next.path}: css import depth limit exceeded`);
            continue;
          }
          if (visited.has(next.path) || queued.has(next.path)) continue;
          if (discovered >= MAX_RESOURCES) {
            limitHit = true;
            continue;
          }
          discovered++;
          queued.add(next.path);
          queue.push({ ref: next, depth: depth + 1 });
        }
      }
    }
    if (limitHit) incomplete.push('resource-limit: more than 200 resources referenced');

    return this.persistSnapshot({
      root,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
      entryPath: entry.relative,
      label: normalizedLabel,
      source,
      files,
      incomplete,
    });
  }

  /**
   * Capture an explicit file list (no resource graph) — used by the restore
   * flow for pre-restore and post-restore snapshots. Per-file failures are
   * recorded as incomplete reasons instead of aborting the capture.
   */
  async captureFiles(options: {
    root: string;
    sessionId: string | null;
    entryPath: string;
    files: Array<{ path: string; kind: SnapshotFileKind; mime: string | null }>;
    source: SnapshotSource;
    label?: string | null;
  }): Promise<SnapshotSummary> {
    if (!SNAPSHOT_SOURCES.has(options.source))
      throw new DesignError(400, 'VALIDATION_ERROR', 'Invalid snapshot source');
    const incomplete: string[] = [];
    const files = new Map<string, CapturedFile>();
    for (const entry of options.files) {
      let resolved: { relative: string; absolute: string };
      try {
        resolved = await this.design.resolve(options.root, entry.path);
      } catch (error) {
        incomplete.push(`${entry.path}: ${messageOf(error)}`);
        continue;
      }
      try {
        const read = await this.readForCapture(resolved.absolute, MAX_RESOURCE_BYTES);
        if (read.unstable) incomplete.push(`changed-during-capture: ${resolved.relative}`);
        files.set(resolved.relative, {
          path: resolved.relative,
          bytes: read.bytes,
          stat: read.stat,
          kind: entry.kind,
          mime: entry.mime,
        });
      } catch (error) {
        incomplete.push(`${entry.path}: ${messageOf(toDesignError(error) as Error)}`);
      }
    }
    return this.persistSnapshot({
      root: options.root,
      sessionId: options.sessionId,
      entryPath: options.entryPath,
      label: this.normalizeLabel(options.label),
      source: options.source,
      files,
      incomplete,
    });
  }

  async list(sessionId: unknown, entryPath: unknown): Promise<SnapshotSummary[]> {
    const root = await this.design.workspace(sessionId);
    const entryRelative = validateRelativePath(entryPath).split(path.sep).join('/');
    const rows = this.db
      .prepare(
        `SELECT * FROM design_snapshots WHERE workspace_root = ? AND entry_path = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(root, entryRelative, MAX_LISTED_SNAPSHOTS) as SnapshotRow[];
    return rows.map(row => this.toSummary(row));
  }

  async detail(sessionId: unknown, snapshotId: unknown): Promise<SnapshotDetail> {
    const row = await this.requireSnapshotForSession(sessionId, snapshotId);
    return { summary: this.toSummary(row), files: this.filesOf(row.id) };
  }

  async readFile(
    sessionId: unknown,
    snapshotId: unknown,
    filePath: unknown
  ): Promise<{ mime: string | null; data: string }> {
    const row = await this.requireSnapshotForSession(sessionId, snapshotId);
    const manifestPath = this.validateManifestPath(filePath);
    const file = this.db
      .prepare('SELECT sha256, mime FROM design_snapshot_files WHERE snapshot_id = ? AND path = ?')
      .get(row.id, manifestPath) as { sha256: string; mime: string | null } | undefined;
    if (!file)
      throw new DesignError(404, 'FILE_NOT_FOUND', 'Path is not part of this snapshot');
    const bytes = await this.blobs.readBlob(file.sha256);
    return { mime: file.mime, data: bytes.toString('base64') };
  }

  /** Raw lookup for the restore flow. Returns null when the id is unknown. */
  snapshotById(snapshotId: unknown): {
    id: string;
    workspaceRoot: string;
    entryPath: string;
    label: string | null;
    complete: boolean;
  } | null {
    if (typeof snapshotId !== 'string' || !snapshotId) return null;
    const row = this.db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(snapshotId) as
      | SnapshotRow
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      workspaceRoot: row.workspace_root,
      entryPath: row.entry_path,
      label: row.label,
      complete: row.complete === 1,
    };
  }

  /**
   * Full summary of a snapshot by id, without session/workspace re-validation.
   * RestoreService uses it as the fallback when the post-restore capture
   * fails after the files themselves were already restored.
   */
  summaryById(snapshotId: unknown): SnapshotSummary | null {
    if (typeof snapshotId !== 'string' || !snapshotId) return null;
    const row = this.db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(snapshotId) as
      | SnapshotRow
      | undefined;
    return row ? this.toSummary(row) : null;
  }

  private async requireSnapshotForSession(
    sessionId: unknown,
    snapshotId: unknown
  ): Promise<SnapshotRow> {
    const row = this.snapshotById(snapshotId);
    if (!row) throw new DesignError(404, 'SNAPSHOT_NOT_FOUND', 'Snapshot was not found');
    const root = await this.design.workspace(sessionId);
    if (row.workspaceRoot !== root)
      throw new DesignError(409, 'WORKSPACE_MISMATCH', 'Snapshot belongs to a different workspace');
    return this.db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(row.id) as SnapshotRow;
  }

  /**
   * Snapshot file paths are resolved against the stored manifest, not the
   * disk, so containment is enforced syntactically: malformed input is a 400,
   * anything that would leave the workspace (absolute, `..`, backslash,
   * private component) is a 403.
   */
  private validateManifestPath(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 2048 ||
      value.includes('\0')
    )
      throw new DesignError(400, 'VALIDATION_ERROR', 'path must be a relative file path');
    if (value.includes('\\') || path.posix.isAbsolute(value))
      throw new DesignError(403, 'PATH_FORBIDDEN', 'path is outside the snapshot manifest');
    const parts = value.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.')))
      throw new DesignError(403, 'PATH_FORBIDDEN', 'path is outside the snapshot manifest');
    return value;
  }

  private normalizeLabel(label: unknown): string | null {
    if (label === undefined || label === null) return null;
    if (typeof label !== 'string') throw new DesignError(400, 'VALIDATION_ERROR', 'label must be a string');
    const trimmed = label.trim();
    if (!trimmed) return null;
    if (trimmed.length > 256) throw new DesignError(400, 'VALIDATION_ERROR', 'label is too long');
    return trimmed;
  }

  private async readForCapture(absolutePath: string, maxBytes: number): Promise<StableRead> {
    try {
      return await readWithStabilityCheck(absolutePath, maxBytes);
    } catch (error) {
      throw toDesignError(error);
    }
  }

  /**
   * Write blobs, then (when complete) dedupe against the most recent complete
   * snapshot of the same workspace+entry, then insert rows inside one
   * transaction and prune beyond the per-workspace limit.
   */
  private async persistSnapshot(options: {
    root: string;
    sessionId: string | null;
    entryPath: string;
    label: string | null;
    source: SnapshotSource;
    files: Map<string, CapturedFile>;
    incomplete: string[];
  }): Promise<SnapshotSummary> {
    const complete = options.incomplete.length === 0;
    const rows: Array<SnapshotFile> = [];
    for (const file of options.files.values()) {
      rows.push({
        path: file.path,
        sha256: await this.blobs.writeBlob(file.bytes),
        bytes: file.bytes.length,
        kind: file.kind,
        mime: file.mime,
      });
    }
    const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);

    if (complete) {
      const existing = this.findIdenticalCompleteSnapshot(options.root, options.entryPath, rows);
      if (existing) return existing;
    }

    const id = `ds${randomUUID()}`;
    const createdAt = Date.now();
    const incompleteReasons = JSON.stringify(options.incomplete);
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO design_snapshots
         (id, workspace_root, session_id, entry_path, label, source, run_id, complete, incomplete_reasons, file_count, total_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          options.root,
          options.sessionId,
          options.entryPath,
          options.label,
          options.source,
          complete ? 1 : 0,
          incompleteReasons,
          rows.length,
          totalBytes,
          createdAt
        );
      const insertFile = this.db.prepare(
        'INSERT INTO design_snapshot_files (snapshot_id, path, sha256, bytes, kind, mime) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const row of rows)
        insertFile.run(id, row.path, row.sha256, row.bytes, row.kind, row.mime);
      this.pruneOldest(options.root);
    });
    insert();

    // Reverse-lookup from the surviving manifests and drop orphaned blobs.
    const referenced = new Set(
      (this.db.prepare('SELECT DISTINCT sha256 FROM design_snapshot_files').all() as Array<{
        sha256: string;
      }>).map(row => row.sha256)
    );
    await this.blobs.sweepUnreferenced(referenced);

    return {
      id,
      workspaceRoot: options.root,
      sessionId: options.sessionId,
      entryPath: options.entryPath,
      label: options.label,
      source: options.source,
      complete,
      incompleteReasons: options.incomplete,
      fileCount: rows.length,
      totalBytes,
      createdAt,
    };
  }

  /**
   * Per-workspace cap (§6.1): delete the oldest rows beyond 500 (with their
   * file rows). Snapshots pinned by an unrevoked share (`design_shares`,
   * P7 §3) are never prune candidates, so the limit acts as a history quota
   * for unpinned history rather than a hard cap — the workspace total may
   * transiently exceed 500 while pins hold. Expired-but-unrevoked shares
   * still pin (the row remains reachable, so its content must not vanish).
   * The blob sweep after capture needs no change: its referenced set is
   * derived from all surviving file rows, so a pinned row keeps its blobs.
   */
  private pruneOldest(workspaceRoot: string): void {
    const { count } = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM design_snapshots
       WHERE workspace_root = ?
         AND NOT EXISTS (
           SELECT 1 FROM design_shares sh
           WHERE sh.snapshot_id = design_snapshots.id AND sh.revoked_at IS NULL
         )`
      )
      .get(workspaceRoot) as { count: number };
    if (count <= MAX_SNAPSHOTS_PER_WORKSPACE) return;
    const excess = count - MAX_SNAPSHOTS_PER_WORKSPACE;
    const oldest = this.db
      .prepare(
        `SELECT id FROM design_snapshots
       WHERE workspace_root = ?
         AND NOT EXISTS (
           SELECT 1 FROM design_shares sh
           WHERE sh.snapshot_id = design_snapshots.id AND sh.revoked_at IS NULL
         )
       ORDER BY created_at ASC, rowid ASC LIMIT ?`
      )
      .all(workspaceRoot, excess) as Array<{ id: string }>;
    if (!oldest.length) return;
    const ids = oldest.map(row => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`DELETE FROM design_snapshot_files WHERE snapshot_id IN (${placeholders})`)
      .run(...ids);
    this.db.prepare(`DELETE FROM design_snapshots WHERE id IN (${placeholders})`).run(...ids);
  }

  private findIdenticalCompleteSnapshot(
    workspaceRoot: string,
    entryPath: string,
    rows: Array<SnapshotFile>
  ): SnapshotSummary | null {
    const latest = this.db
      .prepare(
        `SELECT id FROM design_snapshots
       WHERE workspace_root = ? AND entry_path = ? AND complete = 1
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(workspaceRoot, entryPath) as { id: string } | undefined;
    if (!latest) return null;
    const existing = this.db
      .prepare('SELECT path, sha256 FROM design_snapshot_files WHERE snapshot_id = ?')
      .all(latest.id) as Array<{ path: string; sha256: string }>;
    if (existing.length !== rows.length) return null;
    const byPath = new Map(rows.map(row => [row.path, row.sha256]));
    for (const row of existing) {
      if (byPath.get(row.path) !== row.sha256) return null;
    }
    const full = this.db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(latest.id) as
      | SnapshotRow
      | undefined;
    return full ? this.toSummary(full) : null;
  }

  private filesOf(snapshotId: string): SnapshotFile[] {
    return this.db
      .prepare('SELECT path, sha256, bytes, kind, mime FROM design_snapshot_files WHERE snapshot_id = ? ORDER BY path')
      .all(snapshotId) as unknown as SnapshotFile[];
  }

  private toSummary(row: SnapshotRow): SnapshotSummary {
    let reasons: string[] = [];
    try {
      const parsed = JSON.parse(row.incomplete_reasons);
      if (Array.isArray(parsed)) reasons = parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch {
      reasons = [];
    }
    return {
      id: row.id,
      workspaceRoot: row.workspace_root,
      sessionId: row.session_id,
      entryPath: row.entry_path,
      label: row.label,
      source: row.source,
      complete: row.complete === 1,
      incompleteReasons: reasons,
      fileCount: row.file_count,
      totalBytes: row.total_bytes,
      createdAt: row.created_at,
    };
  }
}
