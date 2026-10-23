import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { getBaseUrlForBackend } from '../../../services/api/base';
import {
  createDesignShare,
  getDesignSnapshotFile,
  listDesignShareComments,
  listDesignShares,
  listDesignSnapshots,
  revokeDesignShare,
  setDesignShareCommentResolved,
} from '../api';
import type {
  DesignShareComment,
  DesignShareScope,
  DesignShareSummary,
  DesignSnapshotSummary,
} from '../api';
import { LOCATOR_REASON_TEXT, matchCommentTarget, truncateText } from '../comment-locator';
import { buildReviewHandoff } from '../review-handoff';

export interface SharePanelProps {
  open: boolean;
  onClose: () => void;
  backendId: string;
  sessionId: string | null;
  /** 当前活动页工作区路径；null = 无活动页（空态）。 */
  docPath: string | null;
  /** 当前磁盘入口源码（doc.source）：评论失效判定与交接用。 */
  currentSource: string | null;
  /** 交接产物上抛（DesignPanel prefill + 关面板）。 */
  onHandoff: (prompt: string) => void;
}

type Tab = 'links' | 'comments';
type ExpiryChoice = 'forever' | '1' | '7' | '30';
type ShareStatus = 'active' | 'revoked' | 'expired';

/** 服务端快照列表上限 100；分享表单只取最近 20 条。 */
const SNAPSHOT_LIMIT = 20;
const TITLE_MAX = 120;
/** shareUrl 展示截断宽度（title 属性保留全量）。 */
const SHARE_URL_DISPLAY_LIMIT = 48;
/** 定位 chip 的 target.text 摘要长度。 */
const TARGET_TEXT_LIMIT = 30;
const COPIED_RESET_MS = 1500;
const EMPTY_HINT = '先打开一个页面再管理分享';
const REVOKE_CONFIRM_TEXT = '撤销后链接立即失效且不可恢复，确认撤销？';
const LAN_NOTE = '局域网地址（需服务端开启 LAN 监听）';

const SCOPE_OPTIONS: Array<{ value: DesignShareScope; label: string }> = [
  { value: 'link', label: '任何持有链接的人' },
  { value: 'local', label: '仅本机' },
];

const EXPIRY_OPTIONS: Array<{ value: ExpiryChoice; label: string }> = [
  { value: 'forever', label: '永久' },
  { value: '1', label: '1 天' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
];

const SHARE_STATUS_LABEL: Record<ShareStatus, string> = {
  active: '进行中',
  revoked: '已撤销',
  expired: '已过期',
};

const SHARE_STATUS_CLASS: Record<ShareStatus, string> = {
  active: 'bg-success/15 text-success',
  revoked: 'bg-secondary text-muted-foreground',
  expired: 'bg-warning/15 text-warning',
};

/** 每行分享已知的 URL（仅创建响应里有；列表接口不返回）。 */
interface ShareUrls {
  shareUrl?: string;
  lanUrls: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

/** 与 VersionDiff.decodeBase64Utf8 同款（私有工具不跨组件共享）。 */
function decodeBase64Utf8(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 状态 chip 客户端计算：撤销优先，其次过期（expiresAt < now），否则进行中。 */
function shareStatus(share: DesignShareSummary, now: number): ShareStatus {
  if (share.revokedAt !== null) return 'revoked';
  if (share.expiresAt !== null && share.expiresAt < now) return 'expired';
  return 'active';
}

/**
 * 列表接口（GET /shares）不返回 shareUrl/lanUrls（服务端只在创建路由拼装）：
 * 优先用本次会话创建时服务端返回的绝对地址，否则由 token 推导
 * `<backend>/s/<token>`（与 share-viewer 挂载路径一致）。
 */
function deriveShareUrl(backendId: string, token: string): string {
  try {
    return `${getBaseUrlForBackend(backendId)}/s/${token}`;
  } catch {
    // base url 不可用（尚未连接）时退化为相对路径展示，面板不崩溃。
    return `/s/${token}`;
  }
}

/**
 * P7 §7.1 分享面板：分享链接（创建 + 管理）与审阅评论（失效判定 + 交接）
 * 两个 tab。数据手动刷新（无轮询）；全部副作用经 props/api 上抛。
 */
export function SharePanel({
  open,
  onClose,
  backendId,
  sessionId,
  docPath,
  currentSource,
  onHandoff,
}: SharePanelProps) {
  const [tab, setTab] = useState<Tab>('links');
  const [snapshots, setSnapshots] = useState<DesignSnapshotSummary[] | null>(null);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);
  const [shares, setShares] = useState<DesignShareSummary[] | null>(null);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [knownUrls, setKnownUrls] = useState<Record<string, ShareUrls>>({});
  const [formSnapshotId, setFormSnapshotId] = useState('');
  const [scope, setScope] = useState<DesignShareScope>('link');
  const [expiry, setExpiry] = useState<ExpiryChoice>('forever');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ shareUrl: string; lanUrls: string[] } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [lanOpenId, setLanOpenId] = useState<string | null>(null);
  const [selectedShareId, setSelectedShareId] = useState('');
  const [comments, setComments] = useState<DesignShareComment[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [handoffBusyId, setHandoffBusyId] = useState<string | null>(null);
  // 打开时刻的 now（过期 chip 计算口径；面板重开时重挂即刷新）。
  const [now] = useState(() => Date.now());
  const sharesRequestRef = useRef(0);
  const commentsRequestRef = useRef(0);

  const inactive = sessionId === null || docPath === null;

  const loadSnapshots = useCallback(async () => {
    if (sessionId === null || docPath === null) return;
    try {
      const list = await listDesignSnapshots(backendId, sessionId, docPath);
      setSnapshots(list.slice(0, SNAPSHOT_LIMIT));
      setSnapshotsError(null);
      // 缺省选最新一条（服务端 newest first）。
      setFormSnapshotId(prev => (prev === '' && list.length > 0 ? list[0].id : prev));
    } catch (e) {
      setSnapshots(null);
      setSnapshotsError(errorText(e));
    }
  }, [backendId, docPath, sessionId]);

  const loadShares = useCallback(async (): Promise<DesignShareSummary[]> => {
    if (sessionId === null || docPath === null) return [];
    const request = ++sharesRequestRef.current;
    try {
      const result = await listDesignShares(backendId, sessionId, docPath);
      if (request !== sharesRequestRef.current) return [];
      const list = result.shares;
      setShares(list);
      setSharesError(null);
      // 下拉缺省/纠偏到第一条未撤销分享（列表过滤未撤销的）。
      const active = list.filter(share => share.revokedAt === null);
      setSelectedShareId(prev =>
        prev !== '' && active.some(share => share.id === prev) ? prev : (active[0]?.id ?? '')
      );
      return list;
    } catch (e) {
      if (request !== sharesRequestRef.current) return [];
      setShares(null);
      setSharesError(errorText(e));
      return [];
    }
  }, [backendId, docPath, sessionId]);

  const loadComments = useCallback(
    async (shareId: string) => {
      if (sessionId === null) return;
      const request = ++commentsRequestRef.current;
      setComments(null);
      setCommentsError(null);
      try {
        const result = await listDesignShareComments(backendId, { sessionId, shareId });
        if (request !== commentsRequestRef.current) return;
        setComments(result.comments);
      } catch (e) {
        if (request !== commentsRequestRef.current) return;
        setComments(null);
        setCommentsError(errorText(e));
      }
    },
    [backendId, sessionId]
  );

  // 打开 / 切页 / 回到链接 tab 时重载（手动刷新语义，无轮询）；open=false 不发请求。
  useEffect(() => {
    if (!open || sessionId === null || docPath === null) return;
    if (tab !== 'links') return;
    setSnapshots(null);
    setSnapshotsError(null);
    setShares(null);
    setSharesError(null);
    setCreated(null);
    setCreateError(null);
    setFormSnapshotId('');
    setKnownUrls({});
    void loadSnapshots();
    void loadShares();
  }, [open, sessionId, docPath, tab, loadSnapshots, loadShares]);

  // Tab 切换 / 分享选择变化时重载评论；离开评论 tab 清空。
  useEffect(() => {
    if (!open || sessionId === null || docPath === null) return;
    if (tab !== 'comments' || selectedShareId === '') {
      setComments(null);
      setCommentsError(null);
      return;
    }
    void loadComments(selectedShareId);
  }, [open, sessionId, docPath, tab, selectedShareId, loadComments]);

  // 关闭时复位瞬态状态（对齐 MediaGenPanel 惯例）。
  useEffect(() => {
    if (open) return;
    setCreated(null);
    setCreateError(null);
    setCopiedKey(null);
    setLanOpenId(null);
    setSelectedShareId('');
    setComments(null);
    setCommentsError(null);
  }, [open]);

  const copyText = useCallback(async (text: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), COPIED_RESET_MS);
    } catch {
      // clipboard 不可用/失败：退回手动复制提示。
      window.prompt('复制失败，请手动复制该链接', text);
    }
  }, []);

  const handleCreate = async (): Promise<void> => {
    if (sessionId === null || docPath === null || formSnapshotId === '' || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const trimmed = title.trim();
      const result = await createDesignShare(backendId, {
        sessionId,
        snapshotId: formSnapshotId,
        scope,
        expiresInDays: expiry === 'forever' ? null : Number(expiry),
        title: trimmed === '' ? null : trimmed,
      });
      setCreated({ shareUrl: result.shareUrl, lanUrls: result.lanUrls });
      setKnownUrls(prev => ({
        ...prev,
        [result.share.id]: { shareUrl: result.shareUrl, lanUrls: result.lanUrls },
      }));
      setTitle('');
      await loadShares();
    } catch (e) {
      setCreateError(errorText(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (share: DesignShareSummary): Promise<void> => {
    if (sessionId === null || revokingId !== null) return;
    if (!window.confirm(REVOKE_CONFIRM_TEXT)) return;
    setRevokingId(share.id);
    try {
      await revokeDesignShare(backendId, { sessionId, shareId: share.id });
      await loadShares();
    } catch (e) {
      setSharesError(errorText(e));
    } finally {
      setRevokingId(null);
    }
  };

  const handleToggleResolved = async (comment: DesignShareComment): Promise<void> => {
    if (sessionId === null || selectedShareId === '' || resolvingId !== null) return;
    setResolvingId(comment.id);
    try {
      await setDesignShareCommentResolved(backendId, {
        sessionId,
        shareId: selectedShareId,
        commentId: comment.id,
        resolved: comment.resolvedAt === null,
      });
      await loadComments(selectedShareId);
    } catch (e) {
      setCommentsError(errorText(e));
    } finally {
      setResolvingId(null);
    }
  };

  const handleHandoff = async (
    comment: DesignShareComment,
    share: DesignShareSummary
  ): Promise<void> => {
    if (sessionId === null || handoffBusyId !== null) return;
    setHandoffBusyId(comment.id);
    try {
      // 快照源码取不到时以 null 继续（buildReviewHandoff 有对应分支），不阻断交接。
      let snapshotSource: string | null = null;
      try {
        const file = await getDesignSnapshotFile(
          backendId,
          sessionId,
          share.snapshotId,
          share.entryPath
        );
        snapshotSource = decodeBase64Utf8(file.data);
      } catch {
        snapshotSource = null;
      }
      // 前端只取前 20 条快照：超出时找不到元数据，label/createdAt 用缺省值
      // （label null / createdAt 0），可接受。
      const meta = snapshots?.find(item => item.id === share.snapshotId) ?? null;
      const result = buildReviewHandoff({
        comment,
        share,
        snapshot: {
          label: meta?.label ?? null,
          createdAt: meta?.createdAt ?? 0,
          entryPath: share.entryPath,
        },
        snapshotSource,
        currentSource,
        currentDocPath: docPath,
      });
      onHandoff(result.prompt);
    } finally {
      setHandoffBusyId(null);
    }
  };

  if (!open) return null;

  const activeShareOptions = (shares ?? [])
    .filter(share => share.revokedAt === null)
    .map(share => ({
      value: share.id,
      label: `${share.title ?? '（未命名分享）'} · ${formatTime(share.createdAt)}`,
    }));
  const selectedShare = shares?.find(share => share.id === selectedShareId) ?? null;
  const commentsLoading = comments === null && commentsError === null && selectedShareId !== '';

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

  const renderOpenLink = (url: string, id: string) => (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`打开分享 ${id}`}
      className="inline-flex h-6 max-md:h-9 items-center rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
    >
      打开
    </a>
  );

  const renderCreatedResult = () => {
    if (created === null) return null;
    const copyKey = 'created';
    return (
      <div
        data-testid="share-created-result"
        className="flex flex-col gap-1.5 rounded-md border border-border bg-secondary/60 p-2"
      >
        <div className="text-[11px] text-foreground">分享链接已创建：</div>
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
            title={created.shareUrl}
          >
            {truncateText(created.shareUrl, SHARE_URL_DISPLAY_LIMIT)}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-label="复制新分享链接"
            onClick={() => void copyText(created.shareUrl, copyKey)}
          >
            {copiedKey === copyKey ? '已复制' : '复制'}
          </Button>
          {renderOpenLink(created.shareUrl, 'created')}
        </div>
        {created.lanUrls.length > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {LAN_NOTE}：{created.lanUrls.join('、')}
          </div>
        )}
      </div>
    );
  };

  const renderShare = (share: DesignShareSummary) => {
    const status = shareStatus(share, now);
    const urls = knownUrls[share.id];
    const url = urls?.shareUrl ?? deriveShareUrl(backendId, share.token);
    const lanUrls = urls?.lanUrls ?? [];
    const copyKey = `share-${share.id}`;
    return (
      <li
        key={share.id}
        data-testid={`share-row-${share.id}`}
        className="flex flex-col gap-1.5 rounded-md border border-border p-2"
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${SHARE_STATUS_CLASS[status]}`}
          >
            {SHARE_STATUS_LABEL[status]}
          </span>
          <span className="truncate text-[11px] text-foreground">
            {share.title ?? '（未命名分享）'}
          </span>
          <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-muted-foreground">
            {share.entryPath}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
            title={url}
          >
            {truncateText(url, SHARE_URL_DISPLAY_LIMIT)}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-label={`复制链接 ${share.id}`}
            onClick={() => void copyText(url, copyKey)}
          >
            {copiedKey === copyKey ? '已复制' : '复制'}
          </Button>
          {renderOpenLink(url, share.id)}
          {share.revokedAt === null && (
            <Button
              size="sm"
              variant="destructive"
              disabled={revokingId !== null}
              aria-label={`撤销分享 ${share.id}`}
              onClick={() => void handleRevoke(share)}
            >
              {revokingId === share.id ? '撤销中…' : '撤销'}
            </Button>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {share.commentCount} 条评论 ·{' '}
          {share.lastAccessAt === null ? '未访问' : `最近访问 ${formatTime(share.lastAccessAt)}`}
        </div>
        {lanUrls.length > 0 && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              aria-expanded={lanOpenId === share.id}
              className="w-fit rounded text-2xs text-muted-foreground underline underline-offset-2"
              onClick={() => setLanOpenId(prev => (prev === share.id ? null : share.id))}
            >
              局域网地址（{lanUrls.length}）
            </button>
            {lanOpenId === share.id && (
              <div className="flex flex-col gap-0.5 rounded bg-secondary/60 px-2 py-1 text-[10px] text-muted-foreground">
                <span>{LAN_NOTE}</span>
                {lanUrls.map(lan => (
                  <span key={lan} className="font-mono">
                    {lan}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  const renderComment = (comment: DesignShareComment) => {
    // 失效判定：target null（整页评论）或 currentSource 缺失时不判定。
    const stale =
      comment.target !== null && currentSource !== null
        ? matchCommentTarget(currentSource, comment.target)
        : null;
    const resolved = comment.resolvedAt !== null;
    return (
      <li
        key={comment.id}
        data-testid={`share-comment-${comment.id}`}
        className="flex flex-col gap-1 rounded-md border border-border p-2"
      >
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-foreground">{comment.author}</span>
          <span className="text-muted-foreground">{formatTime(comment.createdAt)}</span>
          {resolved && (
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
              已解决
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-[11px] text-foreground">
          {comment.body}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {comment.target === null ? (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              整页评论
            </span>
          ) : (
            <button
              type="button"
              title={comment.target.text}
              className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {`定位：${comment.target.tagName} ${truncateText(comment.target.text, TARGET_TEXT_LIMIT)}`}
            </button>
          )}
          {stale !== null && !stale.matched && stale.reason !== undefined && (
            <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
              {`定位失效：${LOCATOR_REASON_TEXT[stale.reason]}`}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={resolvingId !== null}
              aria-label={resolved ? `取消解决 ${comment.id}` : `标记解决 ${comment.id}`}
              onClick={() => void handleToggleResolved(comment)}
            >
              {resolvingId === comment.id ? '处理中…' : resolved ? '取消解决' : '标记解决'}
            </Button>
            {!resolved && selectedShare !== null && (
              <Button
                size="sm"
                variant="primary"
                disabled={handoffBusyId !== null}
                aria-label={`交给 Agent 修改 ${comment.id}`}
                onClick={() => void handleHandoff(comment, selectedShare)}
              >
                {handoffBusyId === comment.id ? '组指令中…' : '交给 Agent 修改'}
              </Button>
            )}
          </span>
        </div>
      </li>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="分享"
      title="分享"
      size="2xl"
      footer={
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        {inactive ? (
          <p className="text-muted-foreground">{EMPTY_HINT}</p>
        ) : (
          <>
            <div
              className="flex w-fit gap-0.5 rounded-md bg-secondary p-0.5"
              role="tablist"
              aria-label="分享管理"
            >
              {renderTabButton('links', '分享链接')}
              {renderTabButton('comments', '审阅评论')}
            </div>
            {tab === 'links' ? (
              <>
                <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {snapshotsError !== null ? (
                      <span role="alert" className="text-destructive">
                        {snapshotsError}
                      </span>
                    ) : snapshots === null ? (
                      <span role="status" className="text-muted-foreground">
                        正在加载版本列表…
                      </span>
                    ) : snapshots.length === 0 ? (
                      <span className="text-muted-foreground">暂无版本快照，先创建版本再分享</span>
                    ) : (
                      <Select
                        value={formSnapshotId}
                        onChange={setFormSnapshotId}
                        options={snapshots.map(snapshot => ({
                          value: snapshot.id,
                          label: snapshot.label ?? formatTime(snapshot.createdAt),
                        }))}
                        placeholder="选择版本"
                        ariaLabel="分享版本"
                        className="w-56 shrink-0"
                      />
                    )}
                    <Select
                      value={scope}
                      onChange={setScope}
                      options={SCOPE_OPTIONS}
                      placeholder="访问范围"
                      ariaLabel="访问范围"
                      className="w-44 shrink-0"
                    />
                    <Select
                      value={expiry}
                      onChange={setExpiry}
                      options={EXPIRY_OPTIONS}
                      placeholder="有效期"
                      ariaLabel="有效期"
                      className="w-28 shrink-0"
                    />
                    <Input
                      aria-label="分享标题"
                      value={title}
                      maxLength={TITLE_MAX}
                      placeholder="标题（可选）"
                      className="h-6 w-44 px-1.5 py-0 text-[11px]"
                      onChange={event => setTitle(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={creating || formSnapshotId === ''}
                      onClick={() => void handleCreate()}
                    >
                      {creating ? '创建中…' : '创建分享'}
                    </Button>
                  </div>
                  {createError !== null && (
                    <div role="alert" className="text-destructive">
                      {createError}
                    </div>
                  )}
                </div>
                {renderCreatedResult()}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">分享列表</span>
                </div>
                {sharesError !== null && (
                  <div role="alert" className="text-destructive">
                    {sharesError}
                  </div>
                )}
                {shares === null && sharesError === null ? (
                  <p role="status" className="text-muted-foreground">
                    正在加载分享列表…
                  </p>
                ) : shares !== null && shares.length === 0 ? (
                  <p className="text-muted-foreground">暂无分享。</p>
                ) : (
                  <ul className="flex flex-col gap-2">{shares?.map(renderShare)}</ul>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {shares === null ? (
                    <span role="status" className="text-muted-foreground">
                      正在加载分享列表…
                    </span>
                  ) : activeShareOptions.length === 0 ? (
                    <span className="text-muted-foreground">暂无进行中的分享</span>
                  ) : (
                    <Select
                      value={selectedShareId}
                      onChange={setSelectedShareId}
                      options={activeShareOptions}
                      placeholder="选择分享"
                      ariaLabel="选择分享"
                      className="w-72 shrink-0"
                    />
                  )}
                  <Button
                    size="sm"
                    disabled={selectedShareId === ''}
                    onClick={() => {
                      if (selectedShareId !== '') void loadComments(selectedShareId);
                    }}
                  >
                    刷新
                  </Button>
                </div>
                {commentsError !== null && (
                  <div role="alert" className="text-destructive">
                    {commentsError}
                  </div>
                )}
                {commentsLoading && (
                  <p role="status" className="text-muted-foreground">
                    正在加载评论…
                  </p>
                )}
                {comments !== null && comments.length === 0 && (
                  <p className="text-muted-foreground">该分享暂无评论。</p>
                )}
                {comments !== null && comments.length > 0 && (
                  <ul className="flex flex-col gap-2">{comments.map(renderComment)}</ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
