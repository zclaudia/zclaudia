// P6 媒体任务共享契约：类型 + 常量 + 纯守卫（无 DB / IO 逻辑）。
// 设计文档：docs/plans/2026-10-24-design-workbench-p6-implementation.md §1/§2。
// 本文件为多卡（L30–L33）共同依赖的冻结契约，行为性实现禁止落在其中。

// ---------------------------------------------------------------------------
// 任务种类 / 状态 / 阶段
// ---------------------------------------------------------------------------

export type DesignMediaTaskKind = 'image-generate' | 'image-edit' | 'video-render';

export type DesignMediaTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 图片：submitting → generating → (downloading) → saving；视频：launching → rendering → encoding → saving。 */
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

/** 服务返回的用量（归一化；未返回则为 null，UI 显示「费用未知」）。 */
export interface DesignMediaUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}

// ---------------------------------------------------------------------------
// 参数（规范化后写入 params_json；dedup_key 由其规范形计算）
// ---------------------------------------------------------------------------

export interface DesignMediaTaskParamsImageGenerate {
  type: 'image-generate';
  prompt: string;
  size?: string;
  /** 缺省 'design/assets'。 */
  targetDir?: string;
}

export interface DesignMediaTaskParamsImageEdit {
  type: 'image-edit';
  prompt: string;
  /** 工作区相对路径，须为可读图片 ≤10 MiB。 */
  sourcePath: string;
  size?: string;
  targetDir?: string;
}

export interface DesignMediaTaskParamsVideoRender {
  type: 'video-render';
  entryPath: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
}

export type DesignMediaTaskParams =
  | DesignMediaTaskParamsImageGenerate
  | DesignMediaTaskParamsImageEdit
  | DesignMediaTaskParamsVideoRender;

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

// ---------------------------------------------------------------------------
// 上限与常量
// ---------------------------------------------------------------------------

export const MEDIA_IMAGE_MAX_PROMPT_LENGTH = 4000;
export const MEDIA_IMAGE_SIZE_PATTERN = /^\d{2,4}x\d{2,4}$/;
export const MEDIA_IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_VIDEO_MIN_WIDTH = 320;
export const MEDIA_VIDEO_MAX_WIDTH = 1920;
export const MEDIA_VIDEO_MIN_FPS = 8;
export const MEDIA_VIDEO_MAX_FPS = 60;
export const MEDIA_VIDEO_MIN_DURATION_MS = 500;
export const MEDIA_VIDEO_MAX_DURATION_MS = 60_000;
export const MEDIA_GENERATED_VIDEO_MAX_BYTES = 256 * 1024 * 1024;
export const MEDIA_TASK_HISTORY_LIMIT = 100;
export const MEDIA_TASK_LIST_DEFAULT_LIMIT = 50;
export const MEDIA_TASK_LIST_MAX_LIMIT = 200;
/** image-generate 与 image-edit 合计并发上限；video 单独一档。 */
export const MEDIA_TASK_CONCURRENCY: Record<'image' | 'video', number> = { image: 2, video: 1 };

// ---------------------------------------------------------------------------
// Provider 契约（L30 实现 openai-images；L31/L33 只依赖本接口）
// ---------------------------------------------------------------------------

export type MediaImageCapability = 'generate' | 'edit';

export interface MediaImageProviderInfo {
  id: string;
  label: string;
  capabilities: MediaImageCapability[];
}

export type MediaProviderErrorCode =
  | 'provider-error'
  | 'provider-unsupported'
  | 'provider-timeout'
  | 'provider-aborted';

export class MediaProviderError extends Error {
  constructor(
    readonly code: MediaProviderErrorCode,
    message: string,
    /** 上游 HTTP 状态码（若有）。 */
    readonly status?: number
  ) {
    super(message);
    this.name = 'MediaProviderError';
  }
}

export interface MediaImageSource {
  /** 工作区相对路径（记录用）。 */
  path: string;
  mime: string;
  bytes: Buffer;
}

export interface MediaImageResult {
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  usage: DesignMediaUsage | null;
}

export interface MediaImageProvider {
  readonly info: MediaImageProviderInfo;
  generate(input: { prompt: string; size?: string; signal: AbortSignal }): Promise<MediaImageResult>;
  edit(input: {
    prompt: string;
    size?: string;
    source: MediaImageSource;
    signal: AbortSignal;
  }): Promise<MediaImageResult>;
}

// ---------------------------------------------------------------------------
// 执行器契约（L31 调度；L30 组装 image；L32 提供 video）
// ---------------------------------------------------------------------------

export interface MediaExecutorContext {
  signal: AbortSignal;
  onProgress(update: DesignMediaProgress): Promise<void>;
  /** 服务端 fs.realpath 后的工作区根。 */
  workspaceRoot: string;
  /** 经 design resolve() 同款 containment 校验的绝对路径解析。 */
  resolveWorkspacePath(relativePath: string): Promise<string>;
}

export interface MediaTaskExecution {
  id: string;
  kind: DesignMediaTaskKind;
  params: DesignMediaTaskParams;
  provider: DesignMediaProviderRef | null;
  /**
   * 提交会话 id（MediaTaskService.runTask 从行记录填充）。执行器没有直接的
   * 会话通道，跨会话资源访问（读源图 / 产物写入 / 结果落盘）经由注入回调
   * 把本字段透传给宿主（L33 契约微调，L30–L32 已验收测试不受影响）。
   */
  sessionId?: string;
}

export type MediaTaskExecutor = (
  execution: MediaTaskExecution,
  ctx: MediaExecutorContext
) => Promise<DesignMediaTaskResult>;

export type MediaTaskExecutors = Partial<Record<DesignMediaTaskKind, MediaTaskExecutor>>;

/** 任务级错误码（写进 error_code 列）。 */
export type MediaTaskErrorCode =
  | 'INTERRUPTED'
  | 'RUNTIME_MISSING'
  | 'ENTRY_UNREADABLE'
  | 'RENDER_FAILED'
  | 'ENCODE_FAILED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_UNSUPPORTED'
  | 'PROVIDER_TIMEOUT'
  | 'ABORTED'
  | 'ASSET_WRITE_FAILED'
  | 'INTERNAL';

/** 执行器失败的标准抛出形态；service 收口时若 ctx.signal.aborted 则改判 cancelled。 */
export class MediaTaskRunError extends Error {
  constructor(readonly code: MediaTaskErrorCode, message: string) {
    super(message);
    this.name = 'MediaTaskRunError';
  }
}

// ---------------------------------------------------------------------------
// 纯守卫
// ---------------------------------------------------------------------------

export function isDesignMediaTaskKind(value: unknown): value is DesignMediaTaskKind {
  return (
    value === 'image-generate' || value === 'image-edit' || value === 'video-render'
  );
}

export function mediaTaskConcurrencyGroup(kind: DesignMediaTaskKind): 'image' | 'video' {
  return kind === 'video-render' ? 'video' : 'image';
}
