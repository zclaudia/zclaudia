// P6.1 媒体任务服务：任务生命周期（排队/并发调度/取消/重启收尾）+ 图片执行器工厂（§1.5）
// + 生成产物写入工厂（§5.1）。设计文档：docs/plans/2026-10-24-design-workbench-p6-implementation.md。
// 契约类型集中在 media-types.ts（冻结，禁改）。

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { safeWriteFile } from '../../infra/fs/safe-file-write.js';
import {
  DesignError,
  DesignService,
  assertContained,
  toDesignError,
  validateRelativePath,
} from './design-service.js';
import {
  MEDIA_GENERATED_VIDEO_MAX_BYTES,
  MEDIA_IMAGE_MAX_PROMPT_LENGTH,
  MEDIA_IMAGE_SIZE_PATTERN,
  MEDIA_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_TASK_CONCURRENCY,
  MEDIA_TASK_HISTORY_LIMIT,
  MEDIA_TASK_LIST_DEFAULT_LIMIT,
  MEDIA_TASK_LIST_MAX_LIMIT,
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_FPS,
  MEDIA_VIDEO_MAX_WIDTH,
  MEDIA_VIDEO_MIN_DURATION_MS,
  MEDIA_VIDEO_MIN_FPS,
  MEDIA_VIDEO_MIN_WIDTH,
  MediaProviderError,
  MediaTaskRunError,
  isDesignMediaTaskKind,
  type DesignMediaProgress,
  type DesignMediaProviderRef,
  type DesignMediaTaskKind,
  type DesignMediaTaskParams,
  type DesignMediaTaskResult,
  type DesignMediaTaskStatus,
  type MediaExecutorContext,
  type MediaImageProvider,
  type MediaImageResult,
  type MediaImageSource,
  type MediaTaskErrorCode,
  type MediaTaskExecution,
  type MediaTaskExecutor,
  type MediaTaskExecutors,
} from './media-types.js';

/** 本批唯一 provider（§0：openai-images）；L33 路由层透传同一常量。 */
const MEDIA_IMAGE_PROVIDER_ID = 'openai-images';
const DEFAULT_ASSETS_DIR = 'design/assets';
const IMAGE_KINDS: readonly DesignMediaTaskKind[] = ['image-generate', 'image-edit'];
const VIDEO_KINDS: readonly DesignMediaTaskKind[] = ['video-render'];

const MEDIA_PROVIDER_ERROR_CODES: Record<MediaProviderError['code'], MediaTaskErrorCode> = {
  'provider-error': 'PROVIDER_ERROR',
  'provider-unsupported': 'PROVIDER_UNSUPPORTED',
  'provider-timeout': 'PROVIDER_TIMEOUT',
  'provider-aborted': 'ABORTED',
};

const IMAGE_RESULT_EXTENSIONS: Record<MediaImageResult['mime'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

interface MediaTaskRow {
  id: string;
  workspace_root: string;
  session_id: string;
  kind: DesignMediaTaskKind;
  status: DesignMediaTaskStatus;
  params_json: string;
  provider_json: string | null;
  progress_json: string | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  dedup_key: string;
  created_at: number;
  updated_at: number;
}

/** 任务 wire 形态（设计文档 §6；桌面 api.ts 同款镜像，L33 路由直接复用）。 */
export interface DesignMediaTaskSummary {
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

interface ActiveRun {
  controller: AbortController;
  /** runTask 的收尾 promise；cancel(running) 等它 settle 后返回最新快照。 */
  promise: Promise<void>;
}

export interface MediaTaskServiceDeps {
  /** L33 接线：经 LlmProfileRepository 解析 profile 显示名；解析不到返回 null。 */
  resolveProfileName?: (profileId: string) => string | null;
}

interface NormalizedCreate {
  kind: DesignMediaTaskKind;
  params: DesignMediaTaskParams;
  /** image 类非空；video 为 null。 */
  profileId: string | null;
  model: string;
}

function mediaValidation(message: string): DesignError {
  return new DesignError(400, 'MEDIA_VALIDATION', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonOrNull<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') throw mediaValidation('prompt must be a non-empty string');
  const prompt = value.trim();
  if (!prompt || prompt.length > MEDIA_IMAGE_MAX_PROMPT_LENGTH)
    throw mediaValidation(`prompt must be 1..${MEDIA_IMAGE_MAX_PROMPT_LENGTH} characters`);
  return prompt;
}

function normalizeSize(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MEDIA_IMAGE_SIZE_PATTERN.test(value))
    throw mediaValidation('size must be in width x height format, e.g. 1024x1024');
  return value;
}

function normalizeTargetDir(value: unknown): string {
  if (value === undefined) return DEFAULT_ASSETS_DIR;
  if (typeof value !== 'string' || !value) throw mediaValidation('targetDir must be a workspace-relative path');
  try {
    validateRelativePath(value);
  } catch {
    throw mediaValidation('targetDir must be a workspace-relative path');
  }
  return value;
}

function requireRelativeField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw mediaValidation(`${field} must be a workspace-relative path`);
  try {
    validateRelativePath(value);
  } catch {
    throw mediaValidation(`${field} must be a workspace-relative path`);
  }
  return value;
}

function requireVideoDimension(value: unknown, field: 'width' | 'height'): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MEDIA_VIDEO_MIN_WIDTH ||
    value > MEDIA_VIDEO_MAX_WIDTH ||
    value % 2 !== 0
  ) {
    throw mediaValidation(
      `${field} must be an even number between ${MEDIA_VIDEO_MIN_WIDTH} and ${MEDIA_VIDEO_MAX_WIDTH}`
    );
  }
  return value;
}

function requireVideoFps(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MEDIA_VIDEO_MIN_FPS ||
    value > MEDIA_VIDEO_MAX_FPS
  ) {
    throw mediaValidation(`fps must be an integer between ${MEDIA_VIDEO_MIN_FPS} and ${MEDIA_VIDEO_MAX_FPS}`);
  }
  return value;
}

function requireVideoDuration(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MEDIA_VIDEO_MIN_DURATION_MS ||
    value > MEDIA_VIDEO_MAX_DURATION_MS
  ) {
    throw mediaValidation(
      `durationMs must be an integer between ${MEDIA_VIDEO_MIN_DURATION_MS} and ${MEDIA_VIDEO_MAX_DURATION_MS}`
    );
  }
  return value;
}

/** §1.3 参数校验与规范化（服务端权威；规范化形写入 params_json 并参与 dedup_key）。 */
function normalizeCreateInput(input: unknown): NormalizedCreate {
  if (!isRecord(input)) throw mediaValidation('Request body must be an object');
  const kind = input.kind;
  if (!isDesignMediaTaskKind(kind))
    throw mediaValidation('kind must be image-generate, image-edit, or video-render');

  if (kind === 'image-generate' || kind === 'image-edit') {
    const prompt = normalizePrompt(input.prompt);
    const size = normalizeSize(input.size);
    const targetDir = normalizeTargetDir(input.targetDir);
    const provider = input.provider;
    if (!isRecord(provider)) throw mediaValidation('provider must include profileId and model');
    if (typeof provider.profileId !== 'string' || !provider.profileId.trim())
      throw mediaValidation('provider.profileId must be a non-empty string');
    const profileId = provider.profileId.trim();
    if (
      typeof provider.model !== 'string' ||
      !provider.model.trim() ||
      provider.model.trim().length > 100
    )
      throw mediaValidation('provider.model must be a string of 1..100 characters');
    const model = provider.model.trim();

    const params: DesignMediaTaskParams =
      kind === 'image-generate'
        ? { type: 'image-generate', prompt, ...(size !== undefined ? { size } : {}), targetDir }
        : {
            type: 'image-edit',
            prompt,
            sourcePath: requireRelativeField(input.sourcePath, 'sourcePath'),
            ...(size !== undefined ? { size } : {}),
            targetDir,
          };
    return { kind, params, profileId, model };
  }

  const params: DesignMediaTaskParams = {
    type: 'video-render',
    entryPath: requireRelativeField(input.entryPath, 'entryPath'),
    width: requireVideoDimension(input.width, 'width'),
    height: requireVideoDimension(input.height, 'height'),
    fps: requireVideoFps(input.fps),
    durationMs: requireVideoDuration(input.durationMs),
  };
  return { kind, params, profileId: null, model: '' };
}

function normalizeListLimit(limit: unknown): number {
  if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0)
    return Math.min(limit, MEDIA_TASK_LIST_MAX_LIMIT);
  return MEDIA_TASK_LIST_DEFAULT_LIMIT;
}

function toSummary(row: MediaTaskRow): DesignMediaTaskSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    provider: parseJsonOrNull<DesignMediaProviderRef>(row.provider_json),
    params: JSON.parse(row.params_json) as DesignMediaTaskParams,
    progress: parseJsonOrNull<DesignMediaProgress>(row.progress_json),
    result: parseJsonOrNull<DesignMediaTaskResult>(row.result_json),
    error:
      row.error_code !== null
        ? { code: row.error_code, message: row.error_message ?? '' }
        : null,
  };
}

/**
 * 媒体任务服务（P6.1 §1）：任务按 fs.realpath 后的 workspace_root 归属；状态机
 * queued → running → completed|failed、queued|running → cancelled；image 类并发 2、
 * video 并发 1；同工作区同参数去重；每工作区保留最近 100 条；构造时收尾遗留任务。
 */
export class MediaTaskService {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly db: Database.Database,
    private readonly designService: DesignService,
    private readonly executors: MediaTaskExecutors,
    private readonly deps: MediaTaskServiceDeps = {}
  ) {
    // 重启收尾（§1.1）：构造时不存在任何内存活动执行，遗留 queued/running 一律判为中断。
    this.db
      .prepare(
        `UPDATE design_media_tasks
         SET status = 'failed', error_code = 'INTERRUPTED',
             error_message = 'Task interrupted by a service restart', updated_at = ?
         WHERE status IN ('queued', 'running')`
      )
      .run(Date.now());
  }

  async create(sessionId: unknown, input: unknown): Promise<DesignMediaTaskSummary> {
    const workspaceRoot = await this.designService.workspace(sessionId);
    const normalized = normalizeCreateInput(input);

    let provider: DesignMediaProviderRef | null = null;
    if (normalized.profileId !== null) {
      const profileName = this.deps.resolveProfileName?.(normalized.profileId) ?? null;
      if (!profileName) throw mediaValidation('The specified service profile does not exist');
      provider = {
        providerId: MEDIA_IMAGE_PROVIDER_ID,
        profileId: normalized.profileId,
        profileName,
        model: normalized.model,
      };
    }

    const dedupKey = createHash('sha256')
      .update(
        `${normalized.kind}${JSON.stringify(normalized.params)}${provider?.providerId ?? ''}${
          provider?.model ?? ''
        }`
      )
      .digest('hex');
    const duplicate = this.db
      .prepare(
        `SELECT id FROM design_media_tasks
         WHERE workspace_root = ? AND dedup_key = ? AND status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(workspaceRoot, dedupKey);
    if (duplicate) throw new DesignError(409, 'MEDIA_TASK_ACTIVE_EXISTS', 'An identical task is already in progress');

    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO design_media_tasks
           (id, workspace_root, session_id, kind, status, params_json, provider_json,
            progress_json, result_json, error_code, error_message, dedup_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`
      )
      .run(
        id,
        workspaceRoot,
        sessionId as string,
        normalized.kind,
        JSON.stringify(normalized.params),
        provider ? JSON.stringify(provider) : null,
        dedupKey,
        now,
        now
      );
    this.trimHistory(workspaceRoot);
    this.tryDispatch();
    return toSummary(this.requireRow(id, workspaceRoot));
  }

  async list(sessionId: unknown, limit?: unknown): Promise<DesignMediaTaskSummary[]> {
    const workspaceRoot = await this.designService.workspace(sessionId);
    const rows = this.db
      .prepare(
        `SELECT * FROM design_media_tasks WHERE workspace_root = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(workspaceRoot, normalizeListLimit(limit)) as MediaTaskRow[];
    return rows.map(toSummary);
  }

  async cancel(sessionId: unknown, taskId: unknown): Promise<DesignMediaTaskSummary> {
    const workspaceRoot = await this.designService.workspace(sessionId);
    if (typeof taskId !== 'string' || !taskId)
      throw new DesignError(404, 'MEDIA_TASK_NOT_FOUND', 'Task not found');
    const row = this.requireRow(taskId, workspaceRoot);
    if (row.status === 'queued') {
      this.finalizeStatus(taskId, 'cancelled', null, null, null);
      return toSummary(this.requireRow(taskId, workspaceRoot));
    }
    if (row.status !== 'running')
      throw new DesignError(409, 'MEDIA_TASK_INVALID_STATE', 'The task has already finished and cannot be canceled');
    const run = this.active.get(taskId);
    if (!run) {
      // 防御：运行中行缺失活动记录（仅可能来自异常外部改写）——直接落 cancelled。
      this.finalizeStatus(taskId, 'cancelled', null, null, null);
      return toSummary(this.requireRow(taskId, workspaceRoot));
    }
    run.controller.abort();
    await run.promise;
    return toSummary(this.requireRow(taskId, workspaceRoot));
  }

  async resultTarget(
    sessionId: unknown,
    taskId: unknown
  ): Promise<{ absolutePath: string; fileName: string; mime: string; bytes: number }> {
    const workspaceRoot = await this.designService.workspace(sessionId);
    if (typeof taskId !== 'string' || !taskId)
      throw new DesignError(404, 'MEDIA_TASK_NOT_FOUND', 'Task not found');
    const row = this.requireRow(taskId, workspaceRoot);
    const result =
      row.status === 'completed'
        ? parseJsonOrNull<DesignMediaTaskResult>(row.result_json)
        : null;
    if (!result)
      throw new DesignError(409, 'MEDIA_TASK_INVALID_STATE', 'The task is not finished yet or has no artifact');
    // 经 design resolve() containment：越界/私有问题在授权与符号链接层被拒绝。
    const resolved = await this.designService.resolveFile(sessionId, result.path);
    return {
      absolutePath: resolved.absolute,
      fileName: path.basename(resolved.absolute),
      mime: result.mime,
      bytes: result.bytes,
    };
  }

  // -------------------------------------------------------------------------
  // 调度与执行
  // -------------------------------------------------------------------------

  /** image（generate+edit 合计）与 video 两组独立并发上限；按 created_at 升序拉起 queued。 */
  private tryDispatch(): void {
    for (const group of ['image', 'video'] as const) {
      const kinds = group === 'image' ? IMAGE_KINDS : VIDEO_KINDS;
      const slots = MEDIA_TASK_CONCURRENCY[group] - this.countRunning(kinds);
      if (slots <= 0) continue;
      const placeholders = kinds.map(() => '?').join(', ');
      const queued = this.db
        .prepare(
          `SELECT * FROM design_media_tasks WHERE status = 'queued' AND kind IN (${placeholders})
           ORDER BY created_at ASC, rowid ASC LIMIT ?`
        )
        .all(...kinds, slots) as MediaTaskRow[];
      for (const row of queued) this.runTask(row).catch(() => undefined);
    }
  }

  private countRunning(kinds: readonly DesignMediaTaskKind[]): number {
    const placeholders = kinds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM design_media_tasks
         WHERE status = 'running' AND kind IN (${placeholders})`
      )
      .get(...kinds) as { count: number };
    return row.count;
  }

  /** 执行单条任务：queued→running → 执行器 → 终态收尾 → finally 再调度。永不 reject。 */
  private async runTask(row: MediaTaskRow): Promise<void> {
    const controller = new AbortController();
    let settleRun!: () => void;
    const promise = new Promise<void>(resolve => {
      settleRun = resolve;
    });
    this.active.set(row.id, { controller, promise });
    try {
      const claimed = this.db
        .prepare(
          `UPDATE design_media_tasks SET status = 'running', updated_at = ?
           WHERE id = ? AND status = 'queued'`
        )
        .run(Date.now(), row.id);
      if (claimed.changes === 0) return;

      let result: DesignMediaTaskResult | null = null;
      let errorCode: MediaTaskErrorCode = 'INTERNAL';
      let errorMessage = 'Task execution failed';
      try {
        const executor = this.executors[row.kind];
        if (!executor) throw new MediaTaskRunError('INTERNAL', 'No executor is configured for this task type');
        const execution: MediaTaskExecution = {
          id: row.id,
          kind: row.kind,
          params: JSON.parse(row.params_json) as DesignMediaTaskParams,
          provider: parseJsonOrNull<DesignMediaProviderRef>(row.provider_json),
          sessionId: row.session_id,
        };
        result = await executor(execution, this.createContext(row, controller));
      } catch (error) {
        result = null;
        if (error instanceof MediaTaskRunError) {
          errorCode = error.code;
          errorMessage = error.message;
        } else if (error instanceof MediaProviderError) {
          errorCode = MEDIA_PROVIDER_ERROR_CODES[error.code];
          errorMessage = error.message;
        } else {
          errorCode = 'INTERNAL';
          errorMessage = error instanceof Error && error.message ? error.message : 'Task execution failed';
        }
      }

      // 取消优先（§1.2/§1.4）：signal 已中止则一律 cancelled；已写产物保留 result_json。
      if (controller.signal.aborted) {
        this.finalizeStatus(row.id, 'cancelled', result ? JSON.stringify(result) : null, null, null);
      } else if (result) {
        this.finalizeStatus(row.id, 'completed', JSON.stringify(result), null, null);
      } else {
        this.finalizeStatus(row.id, 'failed', null, errorCode, errorMessage);
      }
    } finally {
      this.active.delete(row.id);
      settleRun();
      this.tryDispatch();
    }
  }

  private createContext(row: MediaTaskRow, controller: AbortController): MediaExecutorContext {
    return {
      signal: controller.signal,
      onProgress: async (update: DesignMediaProgress): Promise<void> => {
        try {
          this.db
            .prepare('UPDATE design_media_tasks SET progress_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(update), Date.now(), row.id);
        } catch {
          /* 进度持久化失败静默，不中断执行（§1.4）。 */
        }
      },
      workspaceRoot: row.workspace_root,
      resolveWorkspacePath: async (relativePath: string): Promise<string> =>
        (await this.designService.resolveFile(row.session_id, relativePath)).absolute,
    };
  }

  /** 终态写入；带 queued/running 守卫，取消后已写产物保留（result_json 原样传入）。 */
  private finalizeStatus(
    id: string,
    status: DesignMediaTaskStatus,
    resultJson: string | null,
    errorCode: string | null,
    errorMessage: string | null
  ): void {
    this.db
      .prepare(
        `UPDATE design_media_tasks
         SET status = ?, result_json = ?, error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`
      )
      .run(status, resultJson, errorCode, errorMessage, Date.now(), id);
  }

  private trimHistory(workspaceRoot: string): void {
    this.db
      .prepare(
        `DELETE FROM design_media_tasks WHERE workspace_root = ? AND id NOT IN (
           SELECT id FROM design_media_tasks WHERE workspace_root = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ${MEDIA_TASK_HISTORY_LIMIT}
         )`
      )
      .run(workspaceRoot, workspaceRoot);
  }

  private getRow(id: string, workspaceRoot: string): MediaTaskRow | undefined {
    return this.db
      .prepare('SELECT * FROM design_media_tasks WHERE id = ? AND workspace_root = ?')
      .get(id, workspaceRoot) as MediaTaskRow | undefined;
  }

  private requireRow(id: string, workspaceRoot: string): MediaTaskRow {
    const row = this.getRow(id, workspaceRoot);
    if (!row) throw new DesignError(404, 'MEDIA_TASK_NOT_FOUND', 'Task not found');
    return row;
  }
}

// ---------------------------------------------------------------------------
// 图片执行器工厂（§1.5，供 L33 组装；测试注入假 provider 与假回调）
// ---------------------------------------------------------------------------

export interface ImageTaskExecutorDeps {
  /** §1.5 契约保留：L33 组装时传入（源图/产物访问经由下方两个绑定回调完成）。 */
  designService: DesignService;
  /** 由 provider ref 构造具体 provider（L33 注入 openai-images 实现）。 */
  makeProvider: (ref: DesignMediaProviderRef) => Promise<MediaImageProvider>;
  /**
   * 读取 image-edit 源图（readAsset 口径）。sessionId 为任务提交会话
   * （执行器从 execution.sessionId 透传；L33 真装配绑 designService）。
   */
  readSourceImage: (
    sessionId: string,
    sourcePath: string
  ) => Promise<{ mime: string; bytes: Buffer }>;
  /** 将生成图片写入素材库（importAsset 口径，永不覆盖）；sessionId 同上。 */
  importGeneratedImage: (
    sessionId: string,
    fileName: string,
    bytes: Buffer,
    targetDir?: string
  ) => Promise<{ path: string }>;
}

function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** 文件名 gen-<slug>-<YYYYMMDD-HHmmss>.<ext>；slug 取 prompt 小写折叠形，空则 image。 */
export function generatedImageFileName(prompt: string, mime: MediaImageResult['mime']): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 24)
      .replace(/^-+|-+$/g, '') || 'image';
  return `gen-${slug}-${formatStamp(new Date())}.${IMAGE_RESULT_EXTENSIONS[mime]}`;
}

/**
 * 图片生成/编辑共用执行器：submitting →（image-edit 读源图）→ generating → saving。
 * 执行器本体只做编排；源图读取与产物写入经绑定回调，错误收口为 MediaTaskRunError，
 * 服务层按 §1.2 映射（MediaProviderError → PROVIDER_* 与 ABORTED，其他 → INTERNAL）。
 */
export function createImageTaskExecutor(deps: ImageTaskExecutorDeps): MediaTaskExecutor {
  return async (execution, ctx) => {
    const params = execution.params;
    if (params.type !== 'image-generate' && params.type !== 'image-edit')
      throw new MediaTaskRunError('INTERNAL', 'The image executor received a non-image task');
    if (!execution.provider) throw new MediaTaskRunError('INTERNAL', 'The image task is missing its service profile');

    await ctx.onProgress({ phase: 'submitting' });

    let source: MediaImageSource | undefined;
    if (params.type === 'image-edit') {
      try {
        const loaded = await deps.readSourceImage(execution.sessionId ?? '', params.sourcePath);
        if (loaded.bytes.length > MEDIA_IMAGE_SOURCE_MAX_BYTES)
          throw new Error(`Source image exceeds the ${MEDIA_IMAGE_SOURCE_MAX_BYTES}-byte limit`);
        source = { path: params.sourcePath, mime: loaded.mime, bytes: loaded.bytes };
      } catch (error) {
        throw new MediaTaskRunError(
          'ENTRY_UNREADABLE',
          error instanceof Error && error.message ? `Source image is not readable: ${error.message}` : 'Source image is not readable'
        );
      }
    }

    await ctx.onProgress({ phase: 'generating' });
    const provider = await deps.makeProvider(execution.provider);
    const generated =
      params.type === 'image-generate'
        ? await provider.generate({ prompt: params.prompt, size: params.size, signal: ctx.signal })
        : await provider.edit({
            prompt: params.prompt,
            size: params.size,
            source: source as MediaImageSource,
            signal: ctx.signal,
          });

    await ctx.onProgress({ phase: 'saving' });
    const fileName = generatedImageFileName(params.prompt, generated.mime);
    let imported: { path: string };
    try {
      imported = await deps.importGeneratedImage(
        execution.sessionId ?? '',
        fileName,
        generated.bytes,
        params.targetDir
      );
    } catch (error) {
      throw new MediaTaskRunError(
        'ASSET_WRITE_FAILED',
        error instanceof Error && error.message ? error.message : 'Failed to write the artifact to the asset library'
      );
    }
    return {
      path: imported.path,
      bytes: generated.bytes.length,
      mime: generated.mime,
      usage: generated.usage,
    };
  };
}

// ---------------------------------------------------------------------------
// 生成产物写入工厂（§5.1，视频等大产物；L32 消费）
// ---------------------------------------------------------------------------

const GENERATED_ASSET_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);
const MAX_GENERATED_NAME_LENGTH = 200;
const MAX_GENERATED_NAME_CANDIDATES = 100;

/** 文件名规则与 DesignService.validateAssetFileName 同口径，白名单限 .mp4/.webm/.mov。 */
function validateGeneratedAssetFileName(fileName: unknown): string {
  if (typeof fileName !== 'string' || !fileName || fileName.length > MAX_GENERATED_NAME_LENGTH)
    throw new DesignError(400, 'ASSET_INVALID', 'Filename must be a non-empty string of at most 200 characters');
  if (/[/\\]/.test(fileName) || path.basename(fileName) !== fileName)
    throw new DesignError(400, 'ASSET_INVALID', 'Filename must not contain path separators');
  if (/[\u0000-\u001f\u007f]/.test(fileName))
    throw new DesignError(400, 'ASSET_INVALID', 'Filename must not contain control characters');
  const extension = path.extname(fileName).toLowerCase();
  if (!GENERATED_ASSET_EXTENSIONS.has(extension))
    throw new DesignError(
      400,
      'ASSET_INVALID',
      `Unsupported file extension ${extension || '(none)'}; only .mp4/.webm/.mov videos are allowed`
    );
  return fileName;
}

/**
 * 绑定 sessionId 的生成产物写入器：固定落 design/assets，重名 -2/-3 候选 ≤100、
 * 永不覆盖；mkdir -p + realpath(parent) containment + safeWriteFile（上限 256 MiB）。
 */
export function createGeneratedAssetWriter(
  designService: DesignService,
  sessionId: string
): (fileName: string, bytes: Buffer, mime: string) => Promise<{ path: string; bytes: number }> {
  return async (fileName, bytes, _mime) => {
    validateGeneratedAssetFileName(fileName);
    const root = await designService.workspace(sessionId);
    const dirRelative = validateRelativePath(DEFAULT_ASSETS_DIR);
    const dirAbsolute = path.resolve(root, dirRelative);
    assertContained(root, dirAbsolute);
    await fs.mkdir(dirAbsolute, { recursive: true });
    // 符号链接父目录不得把写入带出工作区；叶子由 safeWriteFile 的 no-follow 守护。
    assertContained(root, await fs.realpath(dirAbsolute));

    const extension = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - extension.length);
    let candidate = fileName;
    for (let taken = 0; ; taken += 1) {
      const absolute = path.join(dirAbsolute, candidate);
      try {
        await fs.lstat(absolute);
      } catch {
        try {
          await safeWriteFile(absolute, bytes, {
            maxBytes: MEDIA_GENERATED_VIDEO_MAX_BYTES,
            expectedRevision: '',
            createIfMissing: true,
          });
        } catch (error) {
          throw toDesignError(error);
        }
        return {
          path: [dirRelative.split(path.sep).join('/'), candidate].join('/'),
          bytes: bytes.length,
        };
      }
      if (taken >= MAX_GENERATED_NAME_CANDIDATES)
        throw new DesignError(
          400,
          'ASSET_INVALID',
          `Too many files with the same name in the target directory; cannot generate a new name for ${fileName}`
        );
      candidate = `${stem}-${taken + 2}${extension}`;
    }
  };
}
