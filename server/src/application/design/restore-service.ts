import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  promises as fs,
  readFileSync,
  renameSync,
  statSync,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { BlobStore } from '../../infra/design/blob-store.js';
import { readBoundedFile } from '../../infra/fs/safe-file-write.js';
import {
  DesignError,
  DesignService,
  assertContained,
  validateRelativePath,
} from './design-service.js';
import {
  MAX_RESOURCE_BYTES,
  type SnapshotService,
  sha256,
  type SnapshotFileKind,
  type SnapshotSummary,
} from './snapshot-service.js';

export interface RestoreConflictFile {
  path: string;
  reason:
    | 'missing-expected-revision'
    | 'revision-mismatch'
    | 'unreadable'
    | 'path-forbidden'
    | 'invalid-path';
  expectedRevision?: string;
  actualRevision?: string;
  error?: string;
}

export interface RestoreReport {
  restored: string[];
  failed: Array<{ path: string; error: string }>;
  pending: string[];
}

export interface RestoreResult {
  summary: SnapshotSummary;
  restored: string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

interface ManifestRow {
  path: string;
  sha256: string;
  kind: SnapshotFileKind;
  mime: string | null;
}

/**
 * Restore a snapshot's manifest onto the workspace (P1.6 §6.4).
 *
 * Guarantees: every existing file's revision is checked against the
 * client-supplied `expectedRevisions` before anything is staged, all content
 * is staged as same-directory temp files before the first rename, and the
 * final revision check plus the sequential renames run synchronously so no
 * other event-loop task can interleave. There is no rollback: a failure stops
 * the run and is reported honestly (restored / failed / pending); files
 * outside the manifest are never touched.
 */
export class RestoreService {
  private readonly design: DesignService;

  constructor(
    private readonly db: Database.Database,
    private readonly blobs: BlobStore,
    private readonly snapshots: SnapshotService
  ) {
    this.design = new DesignService(db);
  }

  async restore(
    sessionId: unknown,
    snapshotId: unknown,
    expectedRevisions: unknown,
    confirmIncomplete?: unknown
  ): Promise<RestoreResult> {
    const root = await this.design.workspace(sessionId);
    const snap = this.snapshots.snapshotById(snapshotId);
    if (!snap) throw new DesignError(404, 'SNAPSHOT_NOT_FOUND', 'Snapshot was not found');
    if (snap.workspaceRoot !== root)
      throw new DesignError(409, 'WORKSPACE_MISMATCH', 'Snapshot belongs to a different workspace');
    if (!snap.complete && confirmIncomplete !== true)
      throw new DesignError(
        409,
        'SNAPSHOT_INCOMPLETE',
        'Snapshot is incomplete; pass confirmIncomplete to restore it anyway'
      );
    if (typeof expectedRevisions !== 'object' || expectedRevisions === null || Array.isArray(expectedRevisions))
      throw new DesignError(400, 'VALIDATION_ERROR', 'expectedRevisions must be an object');
    const expected = expectedRevisions as Record<string, unknown>;

    const manifest = this.db
      .prepare(
        'SELECT path, sha256, kind, mime FROM design_snapshot_files WHERE snapshot_id = ? ORDER BY path'
      )
      .all(snap.id) as unknown as ManifestRow[];

    const logId = `rl${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO design_restore_log (id, snapshot_id, session_id, started_at, status) VALUES (?, ?, ?, ?, ?)'
      )
      .run(logId, snap.id, typeof sessionId === 'string' ? sessionId : null, Date.now(), 'running');
    let finished = false;
    const finish = (status: 'succeeded' | 'failed' | 'conflict', report: RestoreReport): void => {
      if (finished) return;
      finished = true;
      this.db
        .prepare('UPDATE design_restore_log SET finished_at = ?, status = ?, report = ? WHERE id = ?')
        .run(Date.now(), status, JSON.stringify(report), logId);
    };

    // The three-segment report, updated as the run progresses so an
    // unexpected failure still logs something truthful.
    const report: RestoreReport = {
      restored: [],
      failed: [],
      pending: manifest.map(row => row.path),
    };

    const staged = new Map<string, string>();
    const cleanupStaged = async (): Promise<void> => {
      await Promise.all(
        [...staged.values()].map(tmp => fs.rm(tmp, { force: true }).catch(() => undefined))
      );
    };

    try {
      // Pre-restore snapshot of everything on disk right now. Best effort:
      // individual read failures land in the snapshot's incomplete reasons.
      try {
        await this.snapshots.captureFiles({
          root,
          sessionId: typeof sessionId === 'string' ? sessionId : null,
          entryPath: snap.entryPath,
          files: manifest.map(row => ({ path: row.path, kind: row.kind, mime: row.mime })),
          source: 'pre-restore',
          label: null,
        });
      } catch {
        /* recorded via the restore log below; never blocks the restore */
      }

      // Conflict check: every manifest file present on disk must match the
      // client-supplied revision. Missing files are treated as to-be-created.
      // A path occupied by a non-file (e.g. a directory) carries no revision
      // expectation — the rename will fail later and be reported.
      const conflicts: RestoreConflictFile[] = [];
      const present = new Map<string, string>();
      for (const row of manifest) {
        let target: string;
        try {
          target = path.join(root, validateRelativePath(row.path));
          assertContained(root, target);
        } catch (error) {
          conflicts.push({ path: row.path, reason: 'invalid-path', error: messageOf(error) });
          continue;
        }
        let linkStat: Stats;
        try {
          linkStat = await fs.lstat(target);
        } catch {
          continue; // missing → recreate during the rename phase
        }
        if (linkStat.isSymbolicLink()) {
          conflicts.push({
            path: row.path,
            reason: 'path-forbidden',
            error: 'Symbolic links are not allowed',
          });
          continue;
        }
        if (!linkStat.isFile()) continue; // directory etc. → honest rename failure below
        try {
          const resolved = await this.design.resolve(root, row.path);
          const { bytes } = await readBoundedFile(resolved.absolute, MAX_RESOURCE_BYTES, 'File');
          const actual = sha256(bytes);
          const expectedRevision = expected[row.path];
          if (!isValidRevision(expectedRevision)) {
            conflicts.push({
              path: row.path,
              reason: 'missing-expected-revision',
              actualRevision: actual,
            });
          } else if (actual !== expectedRevision) {
            conflicts.push({
              path: row.path,
              reason: 'revision-mismatch',
              expectedRevision,
              actualRevision: actual,
            });
          } else {
            present.set(row.path, resolved.absolute);
          }
        } catch (error) {
          conflicts.push({ path: row.path, reason: 'unreadable', error: messageOf(error) });
        }
      }
      if (conflicts.length) {
        finish('conflict', { restored: [], failed: [], pending: [] });
        throw new DesignError(
          409,
          'RESTORE_CONFLICT',
          'Workspace files changed since the snapshot was loaded',
          { files: conflicts }
        );
      }

      // Staging: every blob becomes a same-directory temp file first.
      try {
        for (const row of manifest) {
          const targetDir = path.dirname(path.join(root, validateRelativePath(row.path)));
          await fs.mkdir(targetDir, { recursive: true });
          const bytes = await this.blobs.readBlob(row.sha256);
          const temp = path.join(targetDir, `.design-restore-${randomUUID()}.tmp`);
          await fs.writeFile(temp, bytes, { flag: 'wx' });
          staged.set(row.path, temp);
          report.pending = report.pending.filter(p => p !== row.path);
        }
      } catch (error) {
        const failedPath = manifest.map(row => row.path).find(p => !staged.has(p)) ?? 'unknown';
        report.failed = [{ path: failedPath, error: messageOf(error) }];
        finish('failed', report);
        await cleanupStaged();
        throw new DesignError(500, 'RESTORE_FAILED', 'Restore failed while staging files', {
          report,
        });
      }

      // Final revision check + sequential renames, synchronous so no other
      // event-loop task can change a file between the check and its rename.
      const finalConflicts: RestoreConflictFile[] = [];
      for (const row of manifest) {
        const absolute = present.get(row.path);
        if (!absolute) continue;
        let actual: string | null = null;
        let broken: string | null = null;
        try {
          const linkStat = lstatSync(absolute);
          if (linkStat.isSymbolicLink()) broken = 'Symbolic links are not allowed';
          else {
            const stat = statSync(absolute);
            if (!stat.isFile()) broken = 'No longer a regular file';
            else if (stat.size > MAX_RESOURCE_BYTES) broken = 'File exceeds the size limit';
            else actual = sha256(readFileSync(absolute));
          }
        } catch (error) {
          broken = messageOf(error);
        }
        if (broken) {
          finalConflicts.push({ path: row.path, reason: 'unreadable', error: broken });
          continue;
        }
        if (actual !== expected[row.path]) {
          finalConflicts.push({
            path: row.path,
            reason: 'revision-mismatch',
            actualRevision: actual ?? undefined,
          });
        }
      }
      if (finalConflicts.length) {
        finish('conflict', { restored: [], failed: [], pending: [] });
        await cleanupStaged();
        throw new DesignError(
          409,
          'RESTORE_CONFLICT',
          'Workspace files changed while the restore was being prepared',
          { files: finalConflicts }
        );
      }

      const failed: Array<{ path: string; error: string }> = [];
      let failedIndex = -1;
      for (let index = 0; index < manifest.length; index++) {
        const row = manifest[index];
        try {
          const temp = staged.get(row.path);
          if (!temp) throw new Error('Missing staged file');
          renameSync(temp, path.join(root, validateRelativePath(row.path)));
          report.restored.push(row.path);
        } catch (error) {
          failed.push({ path: row.path, error: messageOf(error) });
          failedIndex = index;
          break;
        }
      }
      if (failedIndex >= 0) {
        report.failed = failed;
        report.pending = manifest.slice(failedIndex + 1).map(row => row.path);
        finish('failed', report);
        await cleanupStaged();
        throw new DesignError(500, 'RESTORE_FAILED', 'Restore failed partway; see report', {
          report,
        });
      }

      report.pending = [];
      finish('succeeded', report);

      // Post-restore capture; dedupe rules apply as for any capture. The
      // files are already restored and the log says succeeded, so a capture
      // failure must not turn the restore into an HTTP error — degrade to the
      // restored snapshot's own summary.
      let summary: SnapshotSummary;
      try {
        summary = await this.snapshots.captureFiles({
          root,
          sessionId: typeof sessionId === 'string' ? sessionId : null,
          entryPath: snap.entryPath,
          files: manifest.map(row => ({ path: row.path, kind: row.kind, mime: row.mime })),
          source: 'restore',
          label: null,
        });
      } catch {
        const fallback = this.snapshots.summaryById(snap.id);
        if (!fallback)
          throw new DesignError(
            500,
            'RESTORE_FAILED',
            'Restore succeeded but the post-restore snapshot could not be read'
          );
        summary = fallback;
      }
      return { summary, restored: report.restored };
    } catch (error) {
      finish('failed', report);
      await cleanupStaged();
      throw error;
    }
  }
}
