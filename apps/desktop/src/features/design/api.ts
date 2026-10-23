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

/**
 * 工作区素材文件清单（P3.2 素材选择 / P4.3 素材库）：工作区相对路径，
 * 按 localeCompare 排序。kinds 缺省为 'image'（P3 图片谓词，向后兼容）；
 * 'font' 为字体扩展名白名单，'video' 为视频扩展名集（P6），'all' 为并集。
 */
export function listDesignAssets(
  backendId: string,
  sessionId: string,
  kinds?: 'image' | 'font' | 'video' | 'all'
): Promise<DesignFileList> {
  const params = new URLSearchParams({ sessionId });
  if (kinds) params.set('kinds', kinds);
  return apiCallForBackend<DesignFileList>(backendId, `/api/design/assets?${params.toString()}`);
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

// ---------------------------------------------------------------------------
// P4 模板与品牌体系
// ---------------------------------------------------------------------------

/** 内置模板目录项（来源固定 'zclaudia-builtin'，version 随目录演进）。 */
export interface DesignTemplateSummary {
  id: string;
  /** 中文名。 */
  name: string;
  /** 中文一句话描述。 */
  description: string;
  /** 安装后的工作区相对入口路径（如 'design/landing/index.html'）。 */
  entry: string;
  /** 模板将写入的全部文件（不含安装时生成的 TEMPLATE.json）。 */
  files: string[];
  version: string;
  source: string;
}

/** 模板安装结果：实际写入的工作区相对路径（含 TEMPLATE.json）与入口。 */
export interface DesignTemplateInstallResult {
  installed: string[];
  entry: string;
}

/** 品牌文件对（design/DESIGN.md + design/tokens.css）；文件不存在时内容与修订为 null。 */
export interface DesignBrand {
  designMd: string | null;
  tokensCss: string | null;
  designMdRevision: string | null;
  tokensCssRevision: string | null;
}

/**
 * 内置模板目录（静态，无 sessionId）。409 TEMPLATE_TARGET_EXISTS 抛
 * DesignHttpError，files 为工作区内已存在的冲突路径。
 */
export async function installDesignTemplate(
  backendId: string,
  input: { sessionId: string; templateId: string; overwrite?: boolean }
): Promise<DesignTemplateInstallResult> {
  const path = '/api/design/templates/install';
  const result = await fetchApiForBackend<DesignTemplateInstallResult>(path, backendId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: input.sessionId,
      templateId: input.templateId,
      ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
    }),
  });
  if (!result.success) {
    const error = (result.error ?? {}) as { message?: string; code?: string; files?: unknown };
    throw new DesignHttpError(
      error.message || `API call failed: POST ${path}`,
      error.code,
      Array.isArray(error.files) ? error.files.filter((f): f is string => typeof f === 'string') : []
    );
  }
  return result.data as DesignTemplateInstallResult;
}

export function listDesignTemplates(
  backendId: string
): Promise<{ templates: DesignTemplateSummary[] }> {
  return apiCallForBackend<{ templates: DesignTemplateSummary[] }>(
    backendId,
    '/api/design/templates'
  );
}

export function getDesignBrand(backendId: string, sessionId: string): Promise<DesignBrand> {
  return apiCallForBackend<DesignBrand>(backendId, `/api/design/brand?${query(sessionId)}`);
}

/**
 * 写品牌文件：只提交出现的键，两文件独立写入（不跨文件原子）。
 * 修订规则同 putDesignDocument：SHA-256 校验；文件不存在时传 '' 创建。
 */
export function putDesignBrand(
  backendId: string,
  input: {
    sessionId: string;
    designMd?: string;
    designMdRevision?: string;
    tokensCss?: string;
    tokensCssRevision?: string;
  }
): Promise<{ designMdRevision: string | null; tokensCssRevision: string | null }> {
  return apiCallForBackend<{
    designMdRevision: string | null;
    tokensCssRevision: string | null;
  }>(backendId, '/api/design/brand', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/**
 * 导入素材到工作区（默认 design/assets/）：JSON base64，解码后 ≤10 MiB，
 * 扩展名白名单 = 图片 ∪ 字体。目标已存在时服务端自动加 -2/-3 后缀去重，
 * 永不覆盖；返回最终写入的工作区相对路径。
 */
export function importDesignAsset(
  backendId: string,
  input: { sessionId: string; fileName: string; dataBase64: string; targetDir?: string }
): Promise<{ path: string }> {
  return apiCallForBackend<{ path: string }>(backendId, '/api/design/assets/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// P6 图片与视频能力：媒体任务
// 契约见 docs/plans/2026-10-24-design-workbench-p6-implementation.md §6/§7。
// ---------------------------------------------------------------------------

export type DesignMediaTaskKind = 'image-generate' | 'image-edit' | 'video-render';
export type DesignMediaTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type DesignMediaPhase =
  | 'submitting'
  | 'generating'
  | 'downloading'
  | 'saving'
  | 'launching'
  | 'rendering'
  | 'encoding';

export interface DesignMediaProgress {
  phase: DesignMediaPhase;
  detail?: string;
  /** 视频渲染阶段已采集帧数。 */
  frames?: number;
}

/** 服务返回的用量；null = 服务未返回（UI 显示「费用未知」）。 */
export interface DesignMediaUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}

export type DesignMediaTaskParams =
  | { type: 'image-generate'; prompt: string; size?: string; targetDir?: string }
  | { type: 'image-edit'; prompt: string; sourcePath: string; size?: string; targetDir?: string }
  | {
      type: 'video-render';
      entryPath: string;
      width: number;
      height: number;
      fps: number;
      durationMs: number;
    };

export interface DesignMediaProviderRef {
  providerId: string;
  profileId: string;
  profileName: string;
  model: string;
}

export interface DesignMediaTaskResult {
  /** 工作区相对产物路径（design/assets/…）。 */
  path: string;
  bytes: number;
  mime: string;
  usage: DesignMediaUsage | null;
}

export interface DesignMediaTask {
  id: string;
  kind: DesignMediaTaskKind;
  status: DesignMediaTaskStatus;
  createdAt: number;
  updatedAt: number;
  provider: DesignMediaProviderRef | null;
  params: DesignMediaTaskParams;
  progress: DesignMediaProgress | null;
  result: DesignMediaTaskResult | null;
  error: { code: string; message: string } | null;
}

export interface DesignMediaImageProviderInfo {
  id: string;
  label: string;
  capabilities: ('generate' | 'edit')[];
}

/** 可用于图片生成的 OpenAI 兼容 profile；只含 hasCredential 布尔，不含密钥。 */
export interface DesignMediaProfileInfo {
  id: string;
  name: string;
  providerType: string;
  hasCredential: boolean;
}

export type DesignMediaCreateInput =
  | {
      sessionId: string;
      kind: 'image-generate';
      provider: { profileId: string; model: string };
      prompt: string;
      size?: string;
      targetDir?: string;
    }
  | {
      sessionId: string;
      kind: 'image-edit';
      provider: { profileId: string; model: string };
      prompt: string;
      sourcePath: string;
      size?: string;
      targetDir?: string;
    }
  | {
      sessionId: string;
      kind: 'video-render';
      entryPath: string;
      width: number;
      height: number;
      fps: number;
      durationMs: number;
    };

/** 提交媒体任务。同工作区相同参数在跑 → 409 MEDIA_TASK_ACTIVE_EXISTS（DesignHttpError）。 */
export function createDesignMediaTask(
  backendId: string,
  input: DesignMediaCreateInput
): Promise<DesignMediaTask> {
  return apiCallForBackend<DesignMediaTask>(backendId, '/api/design/media-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** 工作区媒体任务列表（newest first）；面板轮询用。 */
export function listDesignMediaTasks(
  backendId: string,
  sessionId: string,
  limit?: number
): Promise<{ tasks: DesignMediaTask[] }> {
  const params = new URLSearchParams({ sessionId });
  if (limit !== undefined) params.set('limit', String(limit));
  return apiCallForBackend<{ tasks: DesignMediaTask[] }>(
    backendId,
    `/api/design/media-tasks?${params.toString()}`
  );
}

/** 取消排队中/进行中的任务；终态任务 → 409 MEDIA_TASK_INVALID_STATE。 */
export function cancelDesignMediaTask(
  backendId: string,
  input: { sessionId: string; taskId: string }
): Promise<DesignMediaTask> {
  return apiCallForBackend<DesignMediaTask>(
    backendId,
    `/api/design/media-tasks/${encodeURIComponent(input.taskId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: input.sessionId }),
    }
  );
}

/** provider 清单与可用服务配置（不含密钥材料）。 */
export function listDesignMediaProviders(
  backendId: string
): Promise<{ providers: DesignMediaImageProviderInfo[]; profiles: DesignMediaProfileInfo[] }> {
  return apiCallForBackend<{
    providers: DesignMediaImageProviderInfo[];
    profiles: DesignMediaProfileInfo[];
  }>(backendId, '/api/design/media/providers');
}

/**
 * 下载已完成任务的产物（视频等大文件）：二进制流直传（同 exportDesignZip
 * 模式），不经 base64 JSON；客户端以 blob 组装（上限 256 MiB，P6 文档声明）。
 */
export async function downloadDesignMediaTaskResult(
  backendId: string,
  sessionId: string,
  taskId: string
): Promise<{ blob: Blob; filename: string }> {
  const path = `/api/design/media-tasks/${encodeURIComponent(taskId)}/result`;
  const response = await fetch(
    `${getBaseUrlForBackend(backendId)}${path}?${new URLSearchParams({ sessionId })}`,
    { headers: { ...getAuthHeadersForBackend(backendId) } }
  );
  if (!response.ok) {
    let message = `下载失败（${response.status}）`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      if (body?.error) {
        if (typeof body.error.message === 'string') message = body.error.message;
        if (typeof body.error.code === 'string') code = body.error.code;
      }
    } catch {
      // 非 JSON 错误体：保留兜底文案
    }
    throw new DesignHttpError(message, code);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? `media-${taskId}`;
  return { blob: await response.blob(), filename };
}
