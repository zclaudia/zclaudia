/**
 * P6 §8.1 媒体任务客户端 hook 与纯函数。
 *
 * useMediaTasks：enabled 且 sessionId 非空时初次刷新 + 定时轮询——存在
 * active（queued/running）任务时 2s，否则 5s；卸载/失能清理定时器。
 * submit 失败不抛错（返回 { error }），409 MEDIA_TASK_ACTIVE_EXISTS 映射
 * 中文文案；其余 label/builder 为纯函数，供 MediaGenPanel 与测试复用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/api/unwrap';
import {
  DesignHttpError,
  createDesignMediaTask,
  cancelDesignMediaTask,
  listDesignMediaTasks,
} from './api';
import type {
  DesignMediaCreateInput,
  DesignMediaPhase,
  DesignMediaTask,
  DesignMediaTaskKind,
  DesignMediaTaskStatus,
  DesignMediaUsage,
} from './api';

/** active（queued/running）任务存在时的轮询间隔。 */
const POLL_ACTIVE_MS = 2000;
/** 无 active 任务时的轮询间隔。 */
const POLL_IDLE_MS = 5000;

export interface UseMediaTasksOptions {
  backendId: string;
  sessionId: string | null;
  enabled: boolean;
}

export interface UseMediaTasksResult {
  tasks: DesignMediaTask[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  submit: (input: DesignMediaCreateInput) => Promise<DesignMediaTask | { error: string }>;
  cancel: (taskId: string) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 409 去重（同工作区同参数在跑）转固定中文文案；其余沿用服务端 message。 */
function describeSubmitError(error: unknown): string {
  const code =
    error instanceof DesignHttpError || error instanceof ApiError ? error.code : undefined;
  if (code === 'MEDIA_TASK_ACTIVE_EXISTS') return 'An identical task is already in progress';
  return errorText(error);
}

/**
 * 媒体任务列表 hook（P6 §8.1）：挂载且启用时立即刷新一次，之后按
 * window.setInterval 轮询——上次刷新见过 active 任务则 2s、否则 5s（active
 * 标志翻转时重设间隔）；提交/取消的 API 失败一律转成字符串错误，不抛出。
 */
export function useMediaTasks(options: UseMediaTasksOptions): UseMediaTasksResult {
  const { backendId, sessionId, enabled } = options;
  const [tasks, setTasks] = useState<DesignMediaTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 最新 options 经 ref 读取：单一定时器 effect 不随回调引用重挂（agent-run-watch 同款）。
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  /** 上次刷新是否见过 active 任务（决定下一次轮询间隔）。 */
  const activeRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    const current = optionsRef.current;
    if (!current.enabled || current.sessionId === null) return;
    setLoading(true);
    try {
      const result = await listDesignMediaTasks(current.backendId, current.sessionId);
      setTasks(result.tasks);
      setError(null);
      activeRef.current = result.tasks.some(
        task => task.status === 'queued' || task.status === 'running'
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // 初次刷新 + 定时轮询：interval 周期由 activeRef 决定，翻转时重设；卸载/失能清理。
  useEffect(() => {
    if (!enabled || sessionId === null) return;
    let disposed = false;
    let inFlight = false;
    let intervalId: number | null = null;

    const restartInterval = (): void => {
      if (intervalId !== null) window.clearInterval(intervalId);
      intervalId = window.setInterval(
        () => {
          if (!inFlight) void poll();
        },
        activeRef.current ? POLL_ACTIVE_MS : POLL_IDLE_MS
      );
    };

    const poll = async (): Promise<void> => {
      const current = optionsRef.current;
      if (disposed || !current.enabled || current.sessionId === null) return;
      inFlight = true;
      try {
        const result = await listDesignMediaTasks(current.backendId, current.sessionId);
        if (disposed) return;
        setTasks(result.tasks);
        setError(null);
        const wasActive = activeRef.current;
        activeRef.current = result.tasks.some(
          task => task.status === 'queued' || task.status === 'running'
        );
        if (activeRef.current !== wasActive) restartInterval();
      } catch (err) {
        if (!disposed) setError(errorText(err));
      } finally {
        inFlight = false;
      }
    };

    restartInterval();
    void poll();
    return () => {
      disposed = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [enabled, sessionId, backendId]);

  const submit = useCallback(
    async (input: DesignMediaCreateInput): Promise<DesignMediaTask | { error: string }> => {
      const current = optionsRef.current;
      try {
        const task = await createDesignMediaTask(current.backendId, input);
        await refresh();
        return task;
      } catch (err) {
        return { error: describeSubmitError(err) };
      }
    },
    [refresh]
  );

  const cancel = useCallback(
    async (taskId: string): Promise<void> => {
      const current = optionsRef.current;
      if (current.sessionId === null) return;
      try {
        await cancelDesignMediaTask(current.backendId, { sessionId: current.sessionId, taskId });
        await refresh();
      } catch (err) {
        setError(errorText(err));
      }
    },
    [refresh]
  );

  return { tasks, loading, error, refresh, submit, cancel };
}

// ---------------------------------------------------------------------------
// 纯函数：文案与输入校验
// ---------------------------------------------------------------------------

/** 阶段文案；rendering 可带已采集帧数 → 「渲染中（N 帧）」。 */
export function mediaPhaseLabel(phase: DesignMediaPhase, frames?: number): string {
  switch (phase) {
    case 'submitting':
      return 'Submitting';
    case 'generating':
      return 'Generating';
    case 'downloading':
      return 'Downloading';
    case 'saving':
      return 'Saving';
    case 'launching':
      return 'Starting render';
    case 'rendering':
      return typeof frames === 'number' ? `Rendering (${frames} frames)` : 'Rendering';
    case 'encoding':
      return 'Encoding';
  }
}

/** 状态徽章文案。 */
export function mediaStatusBadge(status: DesignMediaTaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Canceled';
  }
}

/**
 * 用量/费用文案：null → 「费用未知（服务未返回用量）」；有 totalCostUsd →
 * 「费用 $x.xxxx」；否则 tokens → 「用量：输入 N / 输出 M tokens」；
 * 全无已知键 → 同 null 文案。
 */
export function mediaUsageLabel(usage: DesignMediaUsage | null): string {
  const unknown = 'Cost unknown (service returned no usage)';
  if (usage === null) return unknown;
  if (typeof usage.totalCostUsd === 'number') return `Cost $${usage.totalCostUsd.toFixed(4)}`;
  if (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number') {
    return `Usage: ${usage.inputTokens ?? 0} input / ${usage.outputTokens ?? 0} output tokens`;
  }
  return unknown;
}

/** 任务类型文案。 */
export function mediaKindLabel(kind: DesignMediaTaskKind): string {
  switch (kind) {
    case 'image-generate':
      return 'Image generation';
    case 'image-edit':
      return 'Image edit';
    case 'video-render':
      return 'Motion video';
  }
}

export interface BuildImageCreateInputArgs {
  kind: 'image-generate' | 'image-edit';
  provider: { profileId: string; model: string } | null;
  prompt: string;
  size?: string;
  sourcePath?: string;
}

const PROMPT_MAX = 4000;
const SIZE_PATTERN = /^\d{2,4}x\d{2,4}$/;

/**
 * 图片类提交输入校验（纯函数）：prompt trim 后 1..4000、服务与模型必填、
 * image-edit 源图必填、size 传了须匹配「宽x高」。builder 不经 sessionId
 * （面板在提交前以 `{ ...input, sessionId }` 附上当前会话），因此返回值
 * 的 sessionId 为空串占位。
 */
export function buildImageCreateInput(
  args: BuildImageCreateInputArgs
): DesignMediaCreateInput | { error: string } {
  const prompt = args.prompt.trim();
  if (prompt.length === 0) return { error: 'Enter a prompt' };
  if (prompt.length > PROMPT_MAX) return { error: `Prompt must be at most ${PROMPT_MAX} characters` };
  const profileId = args.provider?.profileId.trim() ?? '';
  const model = args.provider?.model.trim() ?? '';
  if (profileId === '') return { error: 'Choose an image service' };
  if (model === '') return { error: 'Enter a model name' };
  const size = args.size?.trim() ?? '';
  if (size !== '' && !SIZE_PATTERN.test(size)) {
    return { error: 'Size must be width x height (e.g. 1024x1024)' };
  }
  if (args.kind === 'image-edit') {
    const sourcePath = args.sourcePath?.trim() ?? '';
    if (sourcePath === '') return { error: 'Choose a source image' };
    return {
      sessionId: '',
      kind: 'image-edit',
      provider: { profileId, model },
      prompt,
      sourcePath,
      ...(size !== '' ? { size } : {}),
    };
  }
  return {
    sessionId: '',
    kind: 'image-generate',
    provider: { profileId, model },
    prompt,
    ...(size !== '' ? { size } : {}),
  };
}

export interface BuildVideoCreateInputArgs {
  entryPath: string | null;
  width: string;
  height: string;
  fps: string;
  durationSeconds: string;
}

function parseInteger(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(value) ? value : null;
}

function parseNumber(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}

/** 尺寸校验：320..1920 的偶数（yuv420p 要求）。 */
function parseDimension(raw: string, label: string): number | { error: string } {
  const value = parseInteger(raw);
  if (value === null) return { error: `Enter ${label} (integer pixels)` };
  if (value < 320 || value > 1920) return { error: `${label} must be between 320 and 1920` };
  if (value % 2 !== 0) return { error: `${label} must be even` };
  return value;
}

/**
 * 视频提交输入校验（纯函数）：入口必填；宽/高 320..1920 且为偶数；fps
 * 8..60 整数；时长 0.5..60 秒（可带小数）→ durationMs 取整。sessionId
 * 同 buildImageCreateInput，由面板提交前附上。
 */
export function buildVideoCreateInput(
  args: BuildVideoCreateInputArgs
): DesignMediaCreateInput | { error: string } {
  const entryPath = args.entryPath?.trim() ?? '';
  if (entryPath === '') return { error: 'Enter the video entry HTML path' };
  const width = parseDimension(args.width, 'Viewport width');
  if (typeof width !== 'number') return width;
  const height = parseDimension(args.height, 'Viewport height');
  if (typeof height !== 'number') return height;
  const fps = parseInteger(args.fps);
  if (fps === null) return { error: 'Enter a frame rate (integer)' };
  if (fps < 8 || fps > 60) return { error: 'Frame rate must be between 8 and 60' };
  const seconds = parseNumber(args.durationSeconds);
  if (seconds === null) return { error: 'Enter a duration (seconds)' };
  if (seconds < 0.5 || seconds > 60) return { error: 'Duration must be between 0.5 and 60 seconds' };
  return {
    sessionId: '',
    kind: 'video-render',
    entryPath,
    width,
    height,
    fps,
    durationMs: Math.round(seconds * 1000),
  };
}
