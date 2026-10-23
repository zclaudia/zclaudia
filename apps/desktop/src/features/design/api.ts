import { apiCallForBackend } from '../../services/api/unwrap';
import { fetchApiForBackend, getAuthHeadersForBackend, getBaseUrlForBackend } from '../../services/api/base';
import type {
  DesignDepsResult,
  DesignDocument,
  DesignExportRequest,
  DesignSnapshotFile,
  DesignSnapshotSummary,
} from './types';

export type { DesignDocument } from './types';
export type { DesignSnapshotFile, DesignSnapshotSummary } from './types';
export interface DesignFileList {
  files: string[];
}
export interface DesignAsset {
  mimeType: string;
  data: string;
}

/** Detail of one snapshot: its summary plus the captured file manifest. */
export interface DesignSnapshotDetail {
  summary: DesignSnapshotSummary;
  files: DesignSnapshotFile[];
}

/** Result of a successful restore. */
export interface DesignRestoreResult {
  summary: DesignSnapshotSummary;
  restored: string[];
}

/** Content of one file captured in a snapshot. */
export interface DesignSnapshotFileContent {
  mime: string | null;
  /** base64-encoded bytes. */
  data: string;
}

/** One file reported by a 409 RESTORE_CONFLICT response. */
export interface DesignConflictFile {
  path: string;
  /** e.g. 'revision-mismatch' | 'missing-expected-revision' | 'unreadable'. */
  reason?: string;
  expectedRevision?: string;
  actualRevision?: string;
  error?: string;
}

/**
 * Snapshot error preserving the existing API error shape (message + code)
 * while carrying the conflict `files` detail from the response payload.
 */
export class DesignSnapshotError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly files: DesignConflictFile[] = []
  ) {
    super(message);
    this.name = 'DesignSnapshotError';
  }
}

function normalizeConflictFiles(source: unknown): DesignConflictFile[] {
  const files: unknown = Array.isArray(source) ? source : (source as { files?: unknown })?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((entry): DesignConflictFile | null => {
      if (typeof entry === 'string') return { path: entry };
      if (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string') {
        const record = entry as { path: string; reason?: unknown; message?: unknown };
        const reason = record.reason ?? record.message;
        return typeof reason === 'string' ? { path: record.path, reason } : { path: record.path };
      }
      return null;
    })
    .filter((entry): entry is DesignConflictFile => entry !== null);
}

function query(sessionId: string, path?: string): string {
  const params = new URLSearchParams({ sessionId });
  if (path !== undefined) params.set('path', path);
  return params.toString();
}

export function listDesignFiles(backendId: string, sessionId: string): Promise<DesignFileList> {
  return apiCallForBackend<DesignFileList>(backendId, `/api/design/files?${query(sessionId)}`);
}

export function getDesignDocument(
  backendId: string,
  sessionId: string,
  path: string
): Promise<DesignDocument> {
  return apiCallForBackend<DesignDocument>(
    backendId,
    `/api/design/document?${query(sessionId, path)}`
  );
}

export function putDesignDocument(
  backendId: string,
  input: {
    sessionId: string;
    path: string;
    source: string;
    expectedRevision: string;
    /** 文件被删除后重建保存（服务端仅在文件不存在时接受空 expectedRevision）。 */
    allowCreate?: boolean;
  }
): Promise<DesignDocument> {
  return apiCallForBackend<DesignDocument>(backendId, '/api/design/document', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getDesignAsset(
  backendId: string,
  sessionId: string,
  path: string
): Promise<DesignAsset> {
  return apiCallForBackend<DesignAsset>(backendId, `/api/design/asset?${query(sessionId, path)}`);
}

// ---------------------------------------------------------------------------
// Snapshots (version history)
// ---------------------------------------------------------------------------

/** List the snapshots of one document, newest first (server caps at 100). */
export function listDesignSnapshots(
  backendId: string,
  sessionId: string,
  path: string
): Promise<DesignSnapshotSummary[]> {
  return apiCallForBackend<DesignSnapshotSummary[]>(
    backendId,
    `/api/design/snapshots?${query(sessionId, path)}`
  );
}

/**
 * Capture a snapshot of the document as it is on disk. `source` tells the
 * server why the capture happened ('save' | 'manual'); it is optional so the
 * wrapper also works against servers that only track the capture itself.
 */
export function createDesignSnapshot(
  backendId: string,
  input: {
    sessionId: string;
    path: string;
    label?: string;
    source?: DesignSnapshotSummary['source'];
  }
): Promise<DesignSnapshotSummary> {
  return apiCallForBackend<DesignSnapshotSummary>(backendId, '/api/design/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Snapshot summary plus its file manifest. */
export async function getDesignSnapshotDetail(
  backendId: string,
  sessionId: string,
  id: string
): Promise<DesignSnapshotDetail> {
  return apiCallForBackend<DesignSnapshotDetail>(
    backendId,
    `/api/design/snapshots/${encodeURIComponent(id)}?${query(sessionId)}`
  );
}

/** One file captured in a snapshot (path must be part of the manifest). */
export function getDesignSnapshotFile(
  backendId: string,
  sessionId: string,
  id: string,
  path: string
): Promise<DesignSnapshotFileContent> {
  return apiCallForBackend<DesignSnapshotFileContent>(
    backendId,
    `/api/design/snapshots/${encodeURIComponent(id)}/file?${query(sessionId, path)}`
  );
}

/**
 * Restore a snapshot. Rejections are thrown as `DesignSnapshotError` so the
 * 409 RESTORE_CONFLICT `files` detail stays reachable: the server spreads the
 * DesignError details into the error object (`error.files`), which the shared
 * unwrapper's ApiError does not carry — hence the direct fetch here, lifting
 * message/code exactly like `apiCallForBackend` and adding the payload.
 * Incomplete snapshots require `confirmIncomplete: true` (409
 * SNAPSHOT_INCOMPLETE otherwise).
 */
export async function restoreDesignSnapshot(
  backendId: string,
  input: {
    sessionId: string;
    snapshotId: string;
    expectedRevisions: Record<string, string>;
    confirmIncomplete?: boolean;
  }
): Promise<DesignRestoreResult> {
  const path = `/api/design/snapshots/${encodeURIComponent(input.snapshotId)}/restore`;
  const result = await fetchApiForBackend<DesignRestoreResult>(path, backendId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: input.sessionId,
      expectedRevisions: input.expectedRevisions,
      ...(input.confirmIncomplete === undefined
        ? {}
        : { confirmIncomplete: input.confirmIncomplete }),
    }),
  });
  if (!result.success) {
    throw new DesignSnapshotError(
      result.error?.message || `API call failed: POST ${path}`,
      result.error?.code,
      normalizeConflictFiles(result.error)
    );
  }
  return result.data as DesignRestoreResult;
}

// ---------------------------------------------------------------------------
// P2 完整静态工作台：依赖 stat 与 ZIP 导出
// ---------------------------------------------------------------------------

/**
 * Server error from the deps/export endpoints. Mirrors `DesignSnapshotError`
 * (message + code + optional `files` detail) but is export-specific so the
 * snapshot error's contract stays untouched.
 */
export class DesignHttpError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly files: string[] = []
  ) {
    super(message);
    this.name = 'DesignHttpError';
  }
}

export function isDesignHttpError(error: unknown): error is DesignHttpError {
  return error instanceof DesignHttpError;
}

/** stat snapshot of an entry's local resource graph (no content hashing). */
export function getDesignDeps(
  backendId: string,
  sessionId: string,
  path: string
): Promise<DesignDepsResult> {
  return apiCallForBackend<DesignDepsResult>(
    backendId,
    `/api/design/deps?${query(sessionId, path)}`
  );
}

/**
 * Export the entry plus its local resources as a ZIP. The success response is
 * a binary stream (not the shared JSON envelope), so this uses a direct fetch
 * like `fileDownload.ts`; JSON error bodies are lifted into `DesignHttpError`
 * with the EXPORT_INCOMPLETE `files` list preserved.
 */
export async function exportDesignZip(
  backendId: string,
  request: DesignExportRequest
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${getBaseUrlForBackend(backendId)}/api/design/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeadersForBackend(backendId),
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    let message = `导出失败（${response.status}）`;
    let code: string | undefined;
    let files: string[] = [];
    try {
      const body = (await response.json()) as {
        error?: { message?: string; code?: string; files?: unknown };
      };
      if (body?.error) {
        if (typeof body.error.message === 'string') message = body.error.message;
        if (typeof body.error.code === 'string') code = body.error.code;
        if (Array.isArray(body.error.files)) {
          files = body.error.files.filter((entry): entry is string => typeof entry === 'string');
        }
      }
    } catch {
      // non-JSON error body: keep the fallback message
    }
    throw new DesignHttpError(message, code, files);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename =
    match?.[1] ??
    `design-export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 17)}.zip`;
  return { blob: await response.blob(), filename };
}
