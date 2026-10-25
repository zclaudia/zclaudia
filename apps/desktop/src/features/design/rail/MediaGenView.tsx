import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { saveBlobToFile } from '../../../services/fileDownload';
import {
  downloadDesignMediaTaskResult,
  getDesignAsset,
  listDesignAssets,
  listDesignMediaProviders,
} from '../api';
import type { DesignMediaCreateInput, DesignMediaProfileInfo, DesignMediaTask } from '../api';
import {
  buildImageCreateInput,
  buildVideoCreateInput,
  mediaKindLabel,
  mediaPhaseLabel,
  mediaStatusBadge,
  mediaUsageLabel,
  useMediaTasks,
} from '../media-task-client';

type Tab = 'image-generate' | 'image-edit' | 'video-render';

/** 模型建议（datalist）：覆盖 CogView 与 OpenAI 常用图片模型。 */
const MODEL_SUGGESTIONS = ['cogview-4', 'gpt-image-1', 'dall-e-3'];
const NO_PROFILE_HINT = 'Configure an OpenAI-compatible service in Settings first';
const RETRY_CONFIRM_TEXT = 'This will resubmit the generation request and may incur costs. Continue?';
const REPLACE_READY_TITLE = "Replace the selected image's src with this artifact";
const REPLACE_NEEDS_IMG = 'Select an image element in the preview first';

const VIDEO_TAB_NOTE = 'Motion rendering (near-real-time capture); audio is not supported (no soundtrack).';

const TAB_LABELS: Record<Tab, string> = {
  'image-generate': 'Image generation',
  'image-edit': 'Image edit',
  'video-render': 'Motion video',
};

const COMPACT_TAB_LABELS: Record<Tab, string> = {
  'image-generate': 'Image',
  'image-edit': 'Edit',
  'video-render': 'Video',
};

const COMPACT_FIELD = 'h-6 w-full min-w-0 px-1.5 py-0 text-[11px]';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** builder 不经 sessionId：面板提交前以展开附上当前会话。 */
function attachSession(
  built: DesignMediaCreateInput | { error: string },
  sessionId: string
): DesignMediaCreateInput | { error: string } {
  return 'error' in built ? built : { ...built, sessionId };
}

/**
 * DesignMediaTask 本身也带 error 键（终态错误详情），不能用 `'error' in`
 * 判别 submit 结果；按「error 为字符串」判失败。
 */
function isSubmitFailure(
  outcome: DesignMediaTask | { error: string }
): outcome is { error: string } {
  return typeof (outcome as { error?: unknown }).error === 'string';
}

/** 以失败任务的 params + provider 快照重建提交输入（重试用）。 */
function buildRetryInput(
  task: DesignMediaTask,
  sessionId: string
): DesignMediaCreateInput | { error: string } {
  const provider =
    task.provider !== null
      ? { profileId: task.provider.profileId, model: task.provider.model }
      : null;
  const params = task.params;
  switch (params.type) {
    case 'image-generate':
      return attachSession(
        buildImageCreateInput({
          kind: 'image-generate',
          provider,
          prompt: params.prompt,
          ...(params.size !== undefined ? { size: params.size } : {}),
        }),
        sessionId
      );
    case 'image-edit':
      return attachSession(
        buildImageCreateInput({
          kind: 'image-edit',
          provider,
          prompt: params.prompt,
          sourcePath: params.sourcePath,
          ...(params.size !== undefined ? { size: params.size } : {}),
        }),
        sessionId
      );
    case 'video-render':
      return attachSession(
        buildVideoCreateInput({
          entryPath: params.entryPath,
          width: String(params.width),
          height: String(params.height),
          fps: String(params.fps),
          durationSeconds: String(params.durationMs / 1000),
        }),
        sessionId
      );
  }
}

export interface MediaGenViewProps {
  /** Inline visibility gate: inactive renders null, pauses polling and skips asset/profile work. */
  active: boolean;
  backendId: string;
  sessionId: string | null;
  /** 当前活动页工作区路径；视频 tab 缺省入口，null = 无活动页（视频提交禁用）。 */
  activeDocPath: string | null;
  /** 选区是否为可替换的 img。 */
  imageSelectionReady: boolean;
  onReplaceSelectionSrc: (assetPath: string) => void;
  /** 产物落库后通知（L36 接 refreshNow/recentImports）。 */
  onAssetImported: (path: string) => void;
  /** Compact layout for the 224–240px left rail. */
  compact?: boolean;
  /** Modal-shell behavior: hiding rewinds the video default entry path on reopen. */
  resetOnHide?: boolean;
}

type ActionBusy = { taskId: string; kind: 'cancel' | 'download' | 'preview' } | null;

/**
 * 媒体生成视图（P4c 把原 P6 §8.2 面板内容抽成共享视图）：图片生成 / 图片
 * 编辑 / 动效视频三个 tab + 任务记录列表（useMediaTasks 轮询驱动）。表单校验
 * 经 buildXxxCreateInput 纯函数就地显示；失败任务可经确认区块重试（以原
 * params + provider 快照重建）；图片结果卡带缩略图与「替换选中图片」（经
 * onReplaceSelectionSrc 上抛），视频结果卡经 blob URL 内嵌预览；产物首次
 * 出现时通知 onAssetImported。全部 API 失败以页内 alert 显示。
 *
 * active=false 时渲染 null 并停用轮询/服务/素材/缩略图抓取；表单（tab、prompt、
 * 服务、尺寸、视频参数）保留，重新激活不丢失草稿。服务端的任务不会被取消。
 */
export function MediaGenView({
  active,
  backendId,
  sessionId,
  activeDocPath,
  imageSelectionReady,
  onReplaceSelectionSrc,
  onAssetImported,
  compact = false,
  resetOnHide = false,
}: MediaGenViewProps) {
  const [tab, setTab] = useState<Tab>('image-generate');
  const [profiles, setProfiles] = useState<DesignMediaProfileInfo[] | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [assets, setAssets] = useState<string[] | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [size, setSize] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [entryPath, setEntryPath] = useState('');
  const [width, setWidth] = useState('1280');
  const [height, setHeight] = useState('720');
  const [fps, setFps] = useState('30');
  const [duration, setDuration] = useState('5');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<ActionBusy>(null);
  const [retryTaskId, setRetryTaskId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ taskId: string; url: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const { tasks, loading, error, refresh, submit, cancel } = useMediaTasks({
    backendId,
    sessionId,
    enabled: active,
  });

  /** 已通知过 onAssetImported 的任务 id（避免轮询重复通知）。 */
  const notifiedRef = useRef<Set<string>>(new Set());
  /** 上次同步过的活动页；仅在文档变化（或 Modal 重新打开）时改写视频默认入口。 */
  const entryDocRef = useRef<string | null | undefined>(undefined);

  // 激活时拉取可用服务（hasCredential 才可选）。失能期间不做任何服务请求。
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setProfiles(null);
    setProfilesError(null);
    listDesignMediaProviders(backendId)
      .then(result => {
        if (cancelled) return;
        const usable = result.profiles.filter(profile => profile.hasCredential);
        setProfiles(usable);
        setProfileId(prev => (prev === '' && usable.length > 0 ? usable[0].id : prev));
      })
      .catch(err => {
        if (!cancelled) setProfilesError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [active, backendId]);

  // 图片编辑 tab 拉取工作区图片素材清单。
  useEffect(() => {
    if (!active || sessionId === null || tab !== 'image-edit') {
      return;
    }
    let cancelled = false;
    setAssets(null);
    setAssetsError(null);
    listDesignAssets(backendId, sessionId, 'image')
      .then(list => {
        if (!cancelled) setAssets(list.files);
      })
      .catch(err => {
        if (!cancelled) setAssetsError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [active, sessionId, backendId, tab]);

  // 视频入口缺省为当前活动页：仅文档变化或（Modal）重新激活时跟随。
  useEffect(() => {
    if (!active) {
      if (resetOnHide) entryDocRef.current = undefined;
      return;
    }
    if (entryDocRef.current === activeDocPath) return;
    entryDocRef.current = activeDocPath;
    setEntryPath(activeDocPath ?? '');
  }, [active, activeDocPath, resetOnHide]);

  // 失能时只复位瞬态交互状态（preview 置 null 触发 cleanup 撤销对象 URL），
  // 保留表单草稿；服务端任务不受影响。
  useEffect(() => {
    if (active) return;
    setRetryTaskId(null);
    setSubmitError(null);
    setActionBusy(null);
    setPreview(null);
  }, [active]);

  // blob 预览对象 URL 生命周期：更换 / 收起 / 卸载时 revoke。
  useEffect(() => {
    if (preview === null) return;
    const url = preview.url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [preview]);

  // 图片结果缩略图（getDesignAsset base64）：懒加载，失败保留占位。
  useEffect(() => {
    if (!active || sessionId === null) return;
    let cancelled = false;
    for (const task of tasks) {
      const result = task.status === 'completed' ? task.result : null;
      if (result === null || !result.mime.startsWith('image/')) continue;
      if (thumbs[result.path] !== undefined) continue;
      const path = result.path;
      getDesignAsset(backendId, sessionId, path)
        .then(asset => {
          if (cancelled) return;
          setThumbs(prev => ({ ...prev, [path]: `data:${asset.mimeType};base64,${asset.data}` }));
        })
        .catch(() => {
          // 加载失败保留占位块
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tasks, thumbs, active, sessionId, backendId]);

  // 产物首次出现（completed 且此前未见）→ 通知一次。
  useEffect(() => {
    for (const task of tasks) {
      const result = task.status === 'completed' ? task.result : null;
      if (result === null || notifiedRef.current.has(task.id)) continue;
      notifiedRef.current.add(task.id);
      onAssetImported(result.path);
    }
  }, [tasks, onAssetImported]);

  const selectedProfile = profiles?.find(profile => profile.id === profileId) ?? null;
  const built: DesignMediaCreateInput | { error: string } | null = useMemo(() => {
    if (tab === 'video-render') {
      return buildVideoCreateInput({
        entryPath,
        width,
        height,
        fps,
        durationSeconds: duration,
      });
    }
    return buildImageCreateInput({
      kind: tab === 'image-edit' ? 'image-edit' : 'image-generate',
      provider: selectedProfile === null ? null : { profileId: selectedProfile.id, model },
      prompt,
      ...(size.trim() !== '' ? { size } : {}),
      ...(tab === 'image-edit' ? { sourcePath } : {}),
    });
  }, [
    tab,
    selectedProfile,
    model,
    prompt,
    size,
    sourcePath,
    entryPath,
    width,
    height,
    fps,
    duration,
  ]);
  const validationError = built !== null && 'error' in built ? built.error : null;

  if (!active) return null;

  const noProfile = tab !== 'video-render' && profiles !== null && profiles.length === 0;
  const submitDisabled =
    sessionId === null ||
    submitBusy ||
    built === null ||
    'error' in built ||
    noProfile ||
    (tab === 'video-render' && activeDocPath === null && entryPath.trim() === '');

  const resetForm = (): void => {
    if (tab === 'video-render') {
      setEntryPath(activeDocPath ?? '');
      setWidth('1280');
      setHeight('720');
      setFps('30');
      setDuration('5');
      return;
    }
    setPrompt('');
    setSize('');
    if (tab === 'image-edit') setSourcePath('');
  };

  const handleSubmit = async (): Promise<void> => {
    if (sessionId === null || built === null || 'error' in built) return;
    setSubmitError(null);
    setSubmitBusy(true);
    try {
      const outcome = await submit({ ...built, sessionId });
      if (isSubmitFailure(outcome)) {
        setSubmitError(outcome.error);
      } else {
        resetForm();
      }
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleCancelTask = async (taskId: string): Promise<void> => {
    setActionBusy({ taskId, kind: 'cancel' });
    try {
      await cancel(taskId);
    } finally {
      setActionBusy(null);
    }
  };

  const handleRetryConfirm = async (task: DesignMediaTask): Promise<void> => {
    if (sessionId === null) return;
    setRetryTaskId(null);
    const input = buildRetryInput(task, sessionId);
    if ('error' in input) {
      setSubmitError(input.error);
      return;
    }
    setSubmitError(null);
    setSubmitBusy(true);
    try {
      const outcome = await submit(input);
      if (isSubmitFailure(outcome)) setSubmitError(outcome.error);
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleDownload = async (task: DesignMediaTask): Promise<void> => {
    if (sessionId === null || task.result === null) return;
    setActionBusy({ taskId: task.id, kind: 'download' });
    try {
      const { blob, filename } = await downloadDesignMediaTaskResult(backendId, sessionId, task.id);
      await saveBlobToFile(blob, filename);
    } catch (err) {
      setSubmitError(errorText(err));
    } finally {
      setActionBusy(null);
    }
  };

  const handlePreview = async (task: DesignMediaTask): Promise<void> => {
    if (sessionId === null || task.result === null) return;
    if (preview !== null && preview.taskId === task.id) {
      setPreview(null); // 收起；对象 URL 由 effect cleanup revoke
      return;
    }
    setActionBusy({ taskId: task.id, kind: 'preview' });
    try {
      const { blob } = await downloadDesignMediaTaskResult(backendId, sessionId, task.id);
      setPreview({ taskId: task.id, url: URL.createObjectURL(blob) });
    } catch (err) {
      setSubmitError(errorText(err));
    } finally {
      setActionBusy(null);
    }
  };

  const renderTabButton = (value: Tab) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={tab === value}
      aria-label={TAB_LABELS[value]}
      className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
        tab === value
          ? 'bg-card text-foreground shadow-apple-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={() => setTab(value)}
    >
      {compact ? COMPACT_TAB_LABELS[value] : TAB_LABELS[value]}
    </button>
  );

  const selectClass = compact ? 'w-full min-w-0' : 'w-44 shrink-0';
  const modelClass = compact
    ? `${COMPACT_FIELD} px-1.5`
    : 'h-6 w-40 flex-1 px-1.5 py-0 text-[11px]';
  const sizeClass = compact ? `${COMPACT_FIELD} px-1.5` : 'h-6 w-28 px-1.5 py-0 text-[11px]';
  const videoFieldClass = compact
    ? `${COMPACT_FIELD} px-1.5`
    : 'h-6 w-24 px-1.5 py-0 text-[11px]';

  const renderServiceRow = () => (
    <>
      {profilesError !== null ? (
        <span role="alert" className="min-w-0 break-words text-destructive">
          {profilesError}
        </span>
      ) : profiles === null ? (
        <span role="status" className="text-muted-foreground">
          Loading service profiles…
        </span>
      ) : profiles.length === 0 ? (
        <span role="alert" className="text-muted-foreground">
          {NO_PROFILE_HINT}
        </span>
      ) : (
        <Select
          value={profileId}
          onChange={setProfileId}
          options={profiles.map(profile => ({ value: profile.id, label: profile.name }))}
          placeholder="Choose an image service"
          ariaLabel="Image service"
          size="sm"
          className={selectClass}
        />
      )}
      <Input
        aria-label="Model name"
        value={model}
        list="media-model-suggestions"
        placeholder="Model (e.g. cogview-4)"
        className={modelClass}
        onChange={event => setModel(event.target.value)}
      />
      <datalist id="media-model-suggestions">
        {MODEL_SUGGESTIONS.map(suggestion => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <Input
        aria-label="Size (optional)"
        value={size}
        placeholder="1024x1024"
        className={sizeClass}
        onChange={event => setSize(event.target.value)}
      />
    </>
  );

  const renderTask = (task: DesignMediaTask) => {
    const result = task.status === 'completed' ? task.result : null;
    const isVideoResult = result !== null && result.mime.startsWith('video/');
    const phaseText =
      task.progress !== null ? mediaPhaseLabel(task.progress.phase, task.progress.frames) : null;
    const busyCancel = actionBusy?.taskId === task.id && actionBusy.kind === 'cancel';
    const busyDownload = actionBusy?.taskId === task.id && actionBusy.kind === 'download';
    const busyPreview = actionBusy?.taskId === task.id && actionBusy.kind === 'preview';
    const kind = mediaKindLabel(task.kind);
    const previewing = preview !== null && preview.taskId === task.id;
    const thumbnail =
      result === null ? null : isVideoResult ? (
        <span
          aria-hidden
          className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-[10px] text-muted-foreground"
        >
          MP4
        </span>
      ) : thumbs[result.path] !== undefined ? (
        <img
          src={thumbs[result.path]}
          alt=""
          loading="lazy"
          className="h-12 w-16 shrink-0 rounded-md border border-border object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="h-12 w-16 shrink-0 rounded-md border border-border bg-secondary"
        />
      );
    const resultActions =
      result === null ? null : (
        <span className="flex flex-wrap items-center gap-1">
          {!isVideoResult && (
            <Button
              size="sm"
              variant="outline"
              disabled={!imageSelectionReady}
              title={imageSelectionReady ? REPLACE_READY_TITLE : REPLACE_NEEDS_IMG}
              aria-label={`Replace selected image ${result.path}`}
              onClick={() => onReplaceSelectionSrc(result.path)}
            >
              Replace selected image
            </Button>
          )}
          {isVideoResult && (
            <Button
              size="sm"
              variant="outline"
              disabled={busyPreview}
              aria-label={`Preview ${result.path}`}
              onClick={() => void handlePreview(task)}
            >
              {previewing ? 'Collapse' : 'Preview'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busyDownload}
            aria-label={`Download ${result.path}`}
            onClick={() => void handleDownload(task)}
          >
            {busyDownload ? 'Downloading…' : 'Download'}
          </Button>
        </span>
      );
    return (
      <li
        key={task.id}
        data-testid={`media-task-${task.id}`}
        className="flex flex-col gap-1.5 rounded-md border border-border p-2"
      >
        <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'flex items-center gap-2'}>
          <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {mediaStatusBadge(task.status)}
          </span>
          <span className="shrink-0 text-[11px] text-foreground">{kind}</span>
          {phaseText !== null && (
            <span className="truncate text-[11px] text-muted-foreground">{phaseText}</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {(task.status === 'queued' || task.status === 'running') && (
              <Button
                size="sm"
                disabled={busyCancel}
                aria-label={`Cancel ${kind} task`}
                onClick={() => void handleCancelTask(task.id)}
              >
                {busyCancel ? 'Canceling…' : 'Cancel'}
              </Button>
            )}
            {task.status === 'failed' && (
              <Button
                size="sm"
                disabled={submitBusy}
                aria-label={`Retry ${kind} task`}
                onClick={() => setRetryTaskId(task.id)}
              >
                Retry
              </Button>
            )}
          </span>
        </div>
        {task.provider !== null && (
          <div className="break-words text-[11px] text-muted-foreground">
            {`Service: ${task.provider.profileName} · ${task.provider.model}`}
          </div>
        )}
        {result !== null && (
          <div className="text-[11px] text-muted-foreground">{mediaUsageLabel(result.usage)}</div>
        )}
        {task.status === 'failed' && task.error !== null && (
          <div role="alert" className="break-words text-destructive">
            {task.error.message}
          </div>
        )}
        {result !== null &&
          (compact ? (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-start gap-2">
                {thumbnail}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                  {result.path}
                </span>
              </div>
              {resultActions}
            </div>
          ) : (
            <div className="flex items-start gap-2">
              {thumbnail}
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="max-w-full truncate font-mono text-[11px] text-foreground">
                  {result.path}
                </span>
                {resultActions}
              </div>
            </div>
          ))}
        {previewing && (
          <video
            controls
            src={preview?.url}
            data-testid="media-video-preview"
            className="w-full rounded-md border border-border"
          />
        )}
        {retryTaskId === task.id && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-secondary p-2">
            <div className="text-[11px] text-foreground">{RETRY_CONFIRM_TEXT}</div>
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setRetryTaskId(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                aria-label="Confirm retry"
                disabled={submitBusy}
                onClick={() => void handleRetryConfirm(task)}
              >
                Confirm retry
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      data-testid="media-view"
      className={`flex flex-col gap-3 text-xs ${compact ? '' : 'p-4'}`}
    >
      <div
        className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-md bg-secondary p-0.5"
        role="tablist"
        aria-label="Media type"
      >
        {renderTabButton('image-generate')}
        {renderTabButton('image-edit')}
        {renderTabButton('video-render')}
      </div>
      {(error !== null || submitError !== null) && (
        <div role="alert" className="break-words text-destructive">
          {error ?? submitError}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2.5">
        {tab === 'video-render' ? (
          <>
            <Input
              aria-label="Video entry path"
              value={entryPath}
              placeholder="design/index.html"
              className={FIELD_CLASS}
              onChange={event => setEntryPath(event.target.value)}
            />
            {compact ? (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label="Viewport width"
                  type="number"
                  value={width}
                  className={videoFieldClass}
                  onChange={event => setWidth(event.target.value)}
                />
                <Input
                  aria-label="Viewport height"
                  type="number"
                  value={height}
                  className={videoFieldClass}
                  onChange={event => setHeight(event.target.value)}
                />
                <Input
                  aria-label="Frame rate"
                  type="number"
                  value={fps}
                  className={videoFieldClass}
                  onChange={event => setFps(event.target.value)}
                />
                <Input
                  aria-label="Duration (s)"
                  type="number"
                  value={duration}
                  className={videoFieldClass}
                  onChange={event => setDuration(event.target.value)}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Viewport width"
                  type="number"
                  value={width}
                  className={videoFieldClass}
                  onChange={event => setWidth(event.target.value)}
                />
                <Input
                  aria-label="Viewport height"
                  type="number"
                  value={height}
                  className={videoFieldClass}
                  onChange={event => setHeight(event.target.value)}
                />
                <Input
                  aria-label="Frame rate"
                  type="number"
                  value={fps}
                  className="h-6 w-20 px-1.5 py-0 text-[11px]"
                  onChange={event => setFps(event.target.value)}
                />
                <Input
                  aria-label="Duration (s)"
                  type="number"
                  value={duration}
                  className="h-6 w-20 px-1.5 py-0 text-[11px]"
                  onChange={event => setDuration(event.target.value)}
                />
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">{VIDEO_TAB_NOTE}</div>
          </>
        ) : (
          <>
            <textarea
              aria-label="Prompt"
              value={prompt}
              rows={3}
              placeholder="Describe what to generate…"
              className={`${FIELD_CLASS} resize-y`}
              onChange={event => setPrompt(event.target.value)}
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">{renderServiceRow()}</div>
            {tab === 'image-edit' && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {assetsError !== null ? (
                  <span role="alert" className="min-w-0 break-words text-destructive">
                    {assetsError}
                  </span>
                ) : assets === null ? (
                  <span role="status" className="text-muted-foreground">
                    Loading assets…
                  </span>
                ) : assets.length === 0 ? (
                  <span className="text-muted-foreground">No image assets in the workspace yet</span>
                ) : (
                  <Select
                    value={sourcePath}
                    onChange={setSourcePath}
                    options={assets.map(asset => ({ value: asset, label: asset }))}
                    placeholder="Choose source image"
                    ariaLabel="Source image"
                    size="sm"
                    className={compact ? 'w-full min-w-0' : 'w-64 shrink-0'}
                  />
                )}
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {validationError !== null && (
            <span className="min-w-0 break-words text-destructive">{validationError}</span>
          )}
          {sessionId === null && <span className="text-muted-foreground">No session available</span>}
          <span className="ml-auto" />
          <Button
            size="sm"
            variant="primary"
            disabled={submitDisabled}
            onClick={() => void handleSubmit()}
          >
            {submitBusy ? 'Submitting…' : tab === 'video-render' ? 'Start rendering' : 'Submit'}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Task history</span>
        <span className="flex items-center gap-2">
          {loading && <span className="text-[11px] text-muted-foreground">Refreshing…</span>}
          <Button size="sm" onClick={() => void refresh()} disabled={loading}>
            Refresh tasks
          </Button>
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground">No generation tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">{tasks.map(renderTask)}</ul>
      )}
    </div>
  );
}
