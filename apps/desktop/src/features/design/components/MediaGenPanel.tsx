import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
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
const NO_PROFILE_HINT = '先在设置中配置 OpenAI 兼容服务';
const RETRY_CONFIRM_TEXT = '将重新提交生成请求，可能产生费用。继续？';
const REPLACE_READY_TITLE = '把选中图片的 src 替换为该产物';
const REPLACE_NEEDS_IMG = '需要先在预览中选中一个图片元素';

const VIDEO_TAB_NOTE = '动效渲染（近似实时采集）；当前不支持声音（成片无音轨）。';

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

export interface MediaGenPanelProps {
  open: boolean;
  onClose: () => void;
  backendId: string;
  sessionId: string | null;
  /** 当前活动页工作区路径；视频 tab 缺省入口，null = 无活动页（视频提交禁用）。 */
  activeDocPath: string | null;
  /** 选区是否为可替换的 img。 */
  imageSelectionReady: boolean;
  onReplaceSelectionSrc: (assetPath: string) => void;
  /** 产物落库后通知（L36 接 refreshNow/recentImports）。 */
  onAssetImported: (path: string) => void;
}

type ActionBusy = { taskId: string; kind: 'cancel' | 'download' | 'preview' } | null;

/**
 * 媒体生成面板（P6 §8.2）：图片生成 / 图片编辑 / 动效视频三个 tab + 任务
 * 记录列表（useMediaTasks 轮询驱动）。表单校验经 buildXxxCreateInput 纯函数
 * 就地显示；失败任务可经确认区块重试（以原 params + provider 快照重建）；
 * 图片结果卡带缩略图与「替换选中图片」（经 onReplaceSelectionSrc 上抛，替换
 * 事务由 L36 接线），视频结果卡经 blob URL 内嵌预览；产物首次出现时通知
 * onAssetImported。全部 API 失败以页内 alert 显示。
 */
export function MediaGenPanel({
  open,
  onClose,
  backendId,
  sessionId,
  activeDocPath,
  imageSelectionReady,
  onReplaceSelectionSrc,
  onAssetImported,
}: MediaGenPanelProps) {
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
    enabled: open,
  });

  /** 已通知过 onAssetImported 的任务 id（避免轮询重复通知）。 */
  const notifiedRef = useRef<Set<string>>(new Set());

  // 打开时拉取可用服务（hasCredential 才可选）。
  useEffect(() => {
    if (!open) return;
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
  }, [open, backendId]);

  // 图片编辑 tab 拉取工作区图片素材清单。
  useEffect(() => {
    if (!open || sessionId === null || tab !== 'image-edit') {
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
  }, [open, sessionId, backendId, tab]);

  // 视频入口缺省为当前活动页（活动页变化 / 打开面板时跟随）。
  useEffect(() => {
    if (!open) return;
    setEntryPath(activeDocPath ?? '');
  }, [open, activeDocPath]);

  // 关闭时复位瞬态状态（preview 置 null 触发 cleanup 撤销对象 URL）。
  useEffect(() => {
    if (open) return;
    setRetryTaskId(null);
    setSubmitError(null);
    setActionBusy(null);
    setPreview(null);
  }, [open]);

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
    if (!open || sessionId === null) return;
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
  }, [tasks, thumbs, open, sessionId, backendId]);

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

  if (!open) return null;

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

  const renderTabButton = (value: Tab, label: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={tab === value}
      className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
        tab === value
          ? 'bg-card text-foreground shadow-apple-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={() => setTab(value)}
    >
      {label}
    </button>
  );

  const renderServiceRow = () => (
    <>
      {profilesError !== null ? (
        <span role="alert" className="text-destructive">
          {profilesError}
        </span>
      ) : profiles === null ? (
        <span role="status" className="text-muted-foreground">
          正在加载服务配置…
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
          placeholder="选择图片服务"
          ariaLabel="图片服务"
          size="sm"
          className="w-44 shrink-0"
        />
      )}
      <Input
        aria-label="模型名称"
        value={model}
        list="media-model-suggestions"
        placeholder="模型（如 cogview-4）"
        className="h-6 w-40 flex-1 px-1.5 py-0 text-[11px]"
        onChange={event => setModel(event.target.value)}
      />
      <datalist id="media-model-suggestions">
        {MODEL_SUGGESTIONS.map(suggestion => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <Input
        aria-label="尺寸（可选）"
        value={size}
        placeholder="1024x1024"
        className="h-6 w-28 px-1.5 py-0 text-[11px]"
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
    return (
      <li
        key={task.id}
        data-testid={`media-task-${task.id}`}
        className="flex flex-col gap-1.5 rounded-md border border-border p-2"
      >
        <div className="flex items-center gap-2">
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
                aria-label={`取消${kind}任务`}
                onClick={() => void handleCancelTask(task.id)}
              >
                {busyCancel ? '取消中…' : '取消'}
              </Button>
            )}
            {task.status === 'failed' && (
              <Button
                size="sm"
                disabled={submitBusy}
                aria-label={`重试${kind}任务`}
                onClick={() => setRetryTaskId(task.id)}
              >
                重试
              </Button>
            )}
          </span>
        </div>
        {task.provider !== null && (
          <div className="text-[11px] text-muted-foreground">
            {`服务：${task.provider.profileName} · ${task.provider.model}`}
          </div>
        )}
        {result !== null && (
          <div className="text-[11px] text-muted-foreground">{mediaUsageLabel(result.usage)}</div>
        )}
        {task.status === 'failed' && task.error !== null && (
          <div role="alert" className="text-destructive">
            {task.error.message}
          </div>
        )}
        {result !== null && (
          <div className="flex items-start gap-2">
            {isVideoResult ? (
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
            )}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="max-w-full truncate font-mono text-[11px] text-foreground">
                {result.path}
              </span>
              <span className="flex items-center gap-1">
                {!isVideoResult && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!imageSelectionReady}
                    title={imageSelectionReady ? REPLACE_READY_TITLE : REPLACE_NEEDS_IMG}
                    aria-label={`替换选中图片 ${result.path}`}
                    onClick={() => onReplaceSelectionSrc(result.path)}
                  >
                    替换选中图片
                  </Button>
                )}
                {isVideoResult && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyPreview}
                    aria-label={`预览 ${result.path}`}
                    onClick={() => void handlePreview(task)}
                  >
                    {previewing ? '收起' : '预览'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyDownload}
                  aria-label={`下载 ${result.path}`}
                  onClick={() => void handleDownload(task)}
                >
                  {busyDownload ? '下载中…' : '下载'}
                </Button>
              </span>
            </div>
          </div>
        )}
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
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                aria-label="确认重试"
                disabled={submitBusy}
                onClick={() => void handleRetryConfirm(task)}
              >
                确认重试
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="媒体生成"
      title="媒体生成"
      size="2xl"
      footer={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void refresh()} disabled={loading}>
            刷新任务
          </Button>
          <span className="ml-auto" />
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        <div
          className="flex w-fit gap-0.5 rounded-md bg-secondary p-0.5"
          role="tablist"
          aria-label="媒体类型"
        >
          {renderTabButton('image-generate', '图片生成')}
          {renderTabButton('image-edit', '图片编辑')}
          {renderTabButton('video-render', '动效视频')}
        </div>
        {(error !== null || submitError !== null) && (
          <div role="alert" className="text-destructive">
            {error ?? submitError}
          </div>
        )}
        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          {tab === 'video-render' ? (
            <>
              <Input
                aria-label="视频入口路径"
                value={entryPath}
                placeholder="design/index.html"
                className={FIELD_CLASS}
                onChange={event => setEntryPath(event.target.value)}
              />
              <div className="flex items-center gap-2">
                <Input
                  aria-label="视口宽度"
                  type="number"
                  value={width}
                  className="h-6 w-24 px-1.5 py-0 text-[11px]"
                  onChange={event => setWidth(event.target.value)}
                />
                <Input
                  aria-label="视口高度"
                  type="number"
                  value={height}
                  className="h-6 w-24 px-1.5 py-0 text-[11px]"
                  onChange={event => setHeight(event.target.value)}
                />
                <Input
                  aria-label="帧率"
                  type="number"
                  value={fps}
                  className="h-6 w-20 px-1.5 py-0 text-[11px]"
                  onChange={event => setFps(event.target.value)}
                />
                <Input
                  aria-label="时长（秒）"
                  type="number"
                  value={duration}
                  className="h-6 w-20 px-1.5 py-0 text-[11px]"
                  onChange={event => setDuration(event.target.value)}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">{VIDEO_TAB_NOTE}</div>
            </>
          ) : (
            <>
              <textarea
                aria-label="生成描述"
                value={prompt}
                rows={3}
                placeholder="描述要生成的画面…"
                className={`${FIELD_CLASS} resize-y`}
                onChange={event => setPrompt(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">{renderServiceRow()}</div>
              {tab === 'image-edit' && (
                <div className="flex flex-wrap items-center gap-2">
                  {assetsError !== null ? (
                    <span role="alert" className="text-destructive">
                      {assetsError}
                    </span>
                  ) : assets === null ? (
                    <span role="status" className="text-muted-foreground">
                      正在加载素材…
                    </span>
                  ) : assets.length === 0 ? (
                    <span className="text-muted-foreground">工作区暂无图片素材</span>
                  ) : (
                    <Select
                      value={sourcePath}
                      onChange={setSourcePath}
                      options={assets.map(asset => ({ value: asset, label: asset }))}
                      placeholder="选择源图片"
                      ariaLabel="源图片"
                      size="sm"
                      className="w-64 shrink-0"
                    />
                  )}
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2">
            {validationError !== null && (
              <span className="text-destructive">{validationError}</span>
            )}
            {sessionId === null && <span className="text-muted-foreground">当前没有可用会话</span>}
            <span className="ml-auto" />
            <Button
              size="sm"
              variant="primary"
              disabled={submitDisabled}
              onClick={() => void handleSubmit()}
            >
              {submitBusy ? '提交中…' : tab === 'video-render' ? '开始渲染' : '提交生成'}
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">任务记录</span>
          {loading && <span className="text-[11px] text-muted-foreground">刷新中…</span>}
        </div>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground">暂无生成任务。</p>
        ) : (
          <ul className="flex flex-col gap-2">{tasks.map(renderTask)}</ul>
        )}
      </div>
    </Modal>
  );
}
