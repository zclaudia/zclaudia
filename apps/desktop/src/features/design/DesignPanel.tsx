import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useWorkspaceTool } from '../../components/workspace/WorkspaceToolContext';
import { useComposerStore } from '../../stores/composerStore';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import {
  DesignSnapshotError,
  getDesignAsset,
  getDesignDocument,
  restoreDesignSnapshot,
} from './api';
import type { DesignConflictFile } from './api';
import { lineDiff } from './diff';
import { DesignToolbar } from './components/DesignToolbar';
import { ExportDialog } from './components/ExportDialog';
import { PageOverview } from './components/PageOverview';
import { PageTabs } from './components/PageTabs';
import { PreviewCanvas } from './components/PreviewCanvas';
import { SelectionEditor } from './components/SelectionEditor';
import { VersionHistory } from './components/VersionHistory';
import { LineDiffView } from './components/VersionDiff';
import { ViewportControls } from './components/ViewportControls';
import { buildDesignPreview } from './preview';
import { useDesignWorkspace } from './useDesignWorkspace';
import type { DesignEditOperation, DesignSelection } from './types';
import type { DesignPageSnapshot } from './workspace/controller';

/** 面板级预览缓存上限（LRU；键 path → {key, html}）。 */
const PREVIEW_CACHE_MAX = 8;
/** 总览缩略图惰性构建的并发上限。 */
const PREVIEW_MAX_CONCURRENT = 2;

const isValidSelection = (value: unknown): value is DesignSelection => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DesignSelection>;
  return (
    Array.isArray(v.elementPath) &&
    v.elementPath.length <= 64 &&
    v.elementPath.every(i => Number.isInteger(i) && i >= 0 && i < 10000) &&
    typeof v.tagName === 'string' &&
    v.tagName.length <= 64 &&
    typeof v.text === 'string' &&
    v.text.length <= 20000 &&
    (v.sourceText === undefined ||
      (typeof v.sourceText === 'string' && v.sourceText.length <= 20000)) &&
    (v.color === undefined || typeof v.color === 'string') &&
    (v.backgroundColor === undefined || typeof v.backgroundColor === 'string') &&
    (v.base === undefined || typeof v.base === 'string')
  );
};

interface VerifyExpectation {
  elementPath: number[];
  expected: { color?: string; backgroundColor?: string };
}

/** Compare two CSS color notations via the browser's own serializer. */
function colorsEquivalent(written: string, computed: string): boolean {
  const a = written.trim();
  const b = computed.trim();
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const probe = document.createElement('span');
  probe.style.color = a;
  const normalized = probe.style.color;
  return !!normalized && normalized.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

export function DesignPanel() {
  const tool = useWorkspaceTool();
  if (!tool?.sessionId || !tool.backendId)
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        请连接当前会话后端，再打开设计面板。
      </div>
    );
  const key = [
    tool.sessionId,
    tool.projectId ?? '',
    tool.workingDirectory ?? '',
    tool.backendId ?? 'local',
  ].join('\0');
  return (
    <DesignPanelSession
      key={key}
      sessionId={tool.sessionId}
      projectId={tool.projectId}
      projectRoot={tool.projectRoot}
      workingDirectory={tool.workingDirectory}
      backendId={tool.backendId}
    />
  );
}

function DesignPanelSession({
  sessionId,
  projectId,
  projectRoot,
  workingDirectory,
  backendId,
}: {
  sessionId: string;
  projectId?: string;
  /** 工作区根目录（fileViewer 的打开入口）；可能缺失。 */
  projectRoot?: string;
  workingDirectory?: string;
  backendId: string;
}) {
  const { state, files, refreshNow, controller } = useDesignWorkspace({
    sessionId,
    backendId,
    projectId,
    workingDirectory,
  });
  const activePage = state.activePath
    ? (state.pages.find(page => page.path === state.activePath) ?? null)
    : null;

  const [channel] = useState(
    () => `design-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const verifyRef = useRef<VerifyExpectation | null>(null);
  const [overrideWarning, setOverrideWarning] = useState(false);

  // ---- 面板级预览缓存：Map<path, {key: draftRevision:assetEpoch, html}>，LRU ≤8 ----
  const previewCacheRef = useRef(new Map<string, { key: string; html: string }>());
  const previewPendingRef = useRef(new Map<string, string>());
  const previewQueueRef = useRef<Array<() => Promise<void>>>([]);
  const previewInflightRef = useRef(0);
  const [, setPreviewTick] = useState(0);

  const cachePreview = useCallback((path: string, key: string, html: string) => {
    const cache = previewCacheRef.current;
    cache.delete(path); // 刷新 LRU 插入顺序
    cache.set(path, { key, html });
    while (cache.size > PREVIEW_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    setPreviewTick(tick => tick + 1);
  }, []);

  const pumpPreviews = useCallback(() => {
    while (
      previewInflightRef.current < PREVIEW_MAX_CONCURRENT &&
      previewQueueRef.current.length > 0
    ) {
      const job = previewQueueRef.current.shift();
      if (!job) break;
      previewInflightRef.current += 1;
      void job().finally(() => {
        previewInflightRef.current -= 1;
        pumpPreviews();
      });
    }
  }, []);

  /** 构建（或复用）一页的预览串；front=true 时插队（活动页优先）。 */
  const ensurePreview = useCallback(
    (page: DesignPageSnapshot, front = false) => {
      const key = `${page.draftRevision}:${state.assetEpoch}`;
      const cached = previewCacheRef.current.get(page.path);
      if (cached && cached.key === key) return;
      if (previewPendingRef.current.get(page.path) === key) return;
      previewPendingRef.current.set(page.path, key);
      const job = async () => {
        try {
          const html = await buildDesignPreview(
            page.source,
            page.path,
            assetPath => getDesignAsset(backendId, sessionId, assetPath),
            channel,
            page.draftRevision
          );
          cachePreview(page.path, key, html);
        } catch {
          // 预览构建失败不阻塞面板；资源拉取失败已在 buildDesignPreview 内部降级。
        } finally {
          previewPendingRef.current.delete(page.path);
        }
      };
      if (front) previewQueueRef.current.unshift(job);
      else previewQueueRef.current.push(job);
      pumpPreviews();
    },
    [backendId, channel, cachePreview, pumpPreviews, sessionId, state.assetEpoch]
  );

  // 活动页预览：effect 依赖 (activePath, draftRevision, assetEpoch)；缓存命中直接用。
  const activePreviewKey = activePage ? `${activePage.draftRevision}:${state.assetEpoch}` : null;
  const cachedActive = activePage ? previewCacheRef.current.get(activePage.path) : undefined;
  const activePreview =
    cachedActive && activePreviewKey && cachedActive.key === activePreviewKey
      ? cachedActive.html
      : '';

  useEffect(() => {
    if (!activePage || !activePreviewKey || activePreview) return;
    ensurePreview(activePage, true);
  }, [activePage, activePreviewKey, activePreview, ensurePreview]);

  // 总览用的预览表（本次渲染时从共享缓存读取；构建完成经 previewTick 触发重渲染）。
  const previews: Record<string, string> = {};
  for (const page of state.pages) {
    const key = `${page.draftRevision}:${state.assetEpoch}`;
    const cached = previewCacheRef.current.get(page.path);
    if (cached && cached.key === key) previews[page.path] = cached.html;
  }

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      const data = event.data as {
        type?: string;
        channel?: string;
        selection?: unknown;
        elementPath?: unknown;
        color?: unknown;
        backgroundColor?: unknown;
      } | null;
      if (!data || data.channel !== channel) return;
      if (data.type === 'zclaudia:design-select') {
        if (!isValidSelection(data.selection)) return;
        verifyRef.current = null;
        setOverrideWarning(false);
        controller.handleSelectionMessage(data.selection);
        return;
      }
      if (data.type === 'zclaudia:design-verify-result') {
        const pending = verifyRef.current;
        if (!pending) return;
        if (JSON.stringify(data.elementPath ?? []) !== JSON.stringify(pending.elementPath)) return;
        verifyRef.current = null;
        let mismatch = false;
        if (typeof data.color === 'string' && pending.expected.color) {
          mismatch ||= !colorsEquivalent(pending.expected.color, data.color);
        }
        if (typeof data.backgroundColor === 'string' && pending.expected.backgroundColor) {
          mismatch ||= !colorsEquivalent(pending.expected.backgroundColor, data.backgroundColor);
        }
        if (mismatch) setOverrideWarning(true);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [channel, controller]);

  // The verify request must reach the rebuilt preview, so it is sent on the iframe's load event.
  const handleFrameLoad = useCallback(() => {
    const pending = verifyRef.current;
    const frame = iframeRef.current;
    if (!pending || !frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: 'zclaudia:design-verify', channel, elementPath: pending.elementPath },
      '*'
    );
  }, [channel]);

  const handleApply = async (operations: DesignEditOperation[]) => {
    const selection = activePage?.selection;
    if (!selection) return;
    const pathKey = selection.elementPath.join('.');
    const mergeKey = `${pathKey}:${operations
      .map(operation => (operation.kind === 'text' ? 'text' : `style:${operation.property}`))
      .join('+')}`;
    const applied = await controller.apply(operations, `编辑元素 ${pathKey}`, mergeKey);
    if (!applied) return;
    const expected: { color?: string; backgroundColor?: string } = {};
    for (const operation of operations) {
      if (operation.kind !== 'style' || operation.value === null) continue;
      if (operation.property === 'color') expected.color = operation.value;
      else expected.backgroundColor = operation.value;
    }
    verifyRef.current =
      expected.color || expected.backgroundColor
        ? { elementPath: applied.elementPath, expected }
        : null;
  };

  // ---- 页面关闭确认（dirty 页：保存 / 放弃修改 / 取消） ----
  const [confirmClosePath, setConfirmClosePath] = useState<string | null>(null);

  const handleCloseRequest = (path: string) => {
    const page = state.pages.find(entry => entry.path === path);
    if (page && page.status === 'dirty') {
      setConfirmClosePath(path);
      return;
    }
    controller.close(path);
  };

  const discardAndClose = () => {
    if (!confirmClosePath) return;
    controller.close(confirmClosePath, { discardDraft: true });
    setConfirmClosePath(null);
  };

  const saveAndClose = async () => {
    if (!confirmClosePath) return;
    const path = confirmClosePath;
    // save 只作用于活动页：先激活目标页再保存。
    controller.activate(path);
    const saved = await controller.save();
    setConfirmClosePath(null);
    if (saved) controller.close(path);
  };

  /** 版本恢复：成功后由 onRestored 强制重载活动页（历史基线在重载中重建）。 */
  const restoreSnapshot = useCallback(
    async (
      snapshotId: string,
      expectedRevisions: Record<string, string>,
      options?: { confirmIncomplete?: boolean }
    ): Promise<{ ok: boolean; conflictFiles?: DesignConflictFile[]; errorCode?: string }> => {
      try {
        await restoreDesignSnapshot(backendId, {
          sessionId,
          snapshotId,
          expectedRevisions,
          ...(options?.confirmIncomplete === undefined
            ? {}
            : { confirmIncomplete: options.confirmIncomplete }),
        });
        return { ok: true };
      } catch (error) {
        const snapshotError = error instanceof DesignSnapshotError ? error : null;
        return {
          ok: false,
          errorCode: snapshotError?.code,
          conflictFiles: snapshotError?.files ?? [],
        };
      }
    },
    [backendId, sessionId]
  );

  const [prefillNotice, setPrefillNotice] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [draftDiffOpen, setDraftDiffOpen] = useState(false);

  /** 「保存并导出」的保存步骤：复用 controller.save；成功返回保存后的磁盘修订。 */
  const saveForExport = useCallback(async (): Promise<string | null> => {
    const saved = await controller.save();
    if (!saved) return null;
    const snapshot = controller.getSnapshot();
    const page = snapshot.activePath
      ? snapshot.pages.find(entry => entry.path === snapshot.activePath)
      : null;
    return page?.docRevision ?? null;
  }, [controller]);

  const prefill = (content: string) => {
    const composer = useComposerStore.getState();
    const existing =
      composer.pendingPrefills[sessionId]?.content ?? composer.drafts[sessionId]?.content ?? '';
    const combined = existing.trim() ? `${existing.trimEnd()}\n\n${content}` : content;
    composer.setPendingPrefill(sessionId, combined);
    setPrefillNotice(true);
  };
  const generate = () => {
    prefill(
      `Create or update a polished static HTML/CSS page at design/index.html in this workspace${workingDirectory ? ` (${workingDirectory})` : ''}. Use local files in the design/ folder with relative paths; do not use JavaScript to render the page or depend on CDN/external resources. Save the page so it appears in the Design panel. Keep the existing project context${projectId ? ` for project ${projectId}` : ''}.`
    );
  };
  const handoff = () => {
    if (!activePage || !activePage.selection || activePage.status === 'dirty') return;
    const snippet = (activePage.selection.sourceText ?? activePage.selection.text).slice(0, 1000);
    prefill(
      `Modify the selected element in ${activePage.path}. Element: <${activePage.selection.tagName}>; text: ${JSON.stringify(snippet)}; element path: ${activePage.selection.elementPath.join('.')}. Please update the HTML file and preserve the surrounding design.`
    );
  };

  return (
    <div data-testid="design-panel" className="flex h-full min-h-0 flex-col">
      <DesignToolbar
        docPath={activePage?.path ?? null}
        loading={activePage?.status === 'loading'}
        busy={activePage?.busy ?? false}
        dirty={activePage?.status === 'dirty'}
        canUndo={activePage?.canUndo ?? false}
        canRedo={activePage?.canRedo ?? false}
        hasSelection={!!activePage?.selection}
        overviewOpen={overviewOpen}
        onToggleOverview={() => setOverviewOpen(value => !value)}
        onExport={() => setExportOpen(true)}
        onToggleDiff={() => setDraftDiffOpen(true)}
        onRefresh={refreshNow}
        onGenerate={generate}
        onHandoff={handoff}
        onUndo={() => void controller.undo()}
        onRedo={() => void controller.redo()}
        onSave={() => void controller.save()}
        onReload={() => void controller.reload()}
      />
      <PageTabs
        pages={state.pages}
        activePath={state.activePath}
        files={files}
        onActivate={path => controller.activate(path)}
        onClose={handleCloseRequest}
        onOpen={path => controller.open(path)}
      />
      <ViewportControls
        viewport={state.ui.viewport}
        zoom={state.ui.zoom}
        onViewportChange={viewport => controller.setViewport(viewport)}
        onZoomChange={zoom => controller.setZoom(zoom)}
      />
      {prefillNotice && (
        <div
          role="status"
          className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          已填入当前聊天，补充需求后发送。
        </div>
      )}
      {activePage?.status === 'dirty' && (
        <div
          role="status"
          className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          有未保存的修改；请先保存后再交给 Agent 修改。
        </div>
      )}
      {activePage?.externalChange && (
        <div role="status" className="border-b border-border px-3 py-1.5 text-xs text-warning">
          此文件已在其他位置更新。你的草稿仍保留；重新载入可载入最新版本。
        </div>
      )}
      {activePage?.missing && (
        <div role="status" className="border-b border-border px-3 py-1.5 text-xs text-warning">
          此文件已从工作区消失；可保存以重建文件，或关闭页面。
        </div>
      )}
      {activePage?.error && (
        <div role="alert" className="border-b border-border px-3 py-1.5 text-xs text-destructive">
          {activePage.error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {overviewOpen ? (
          <PageOverview
            pages={state.pages}
            activePath={state.activePath}
            previews={previews}
            onRequestPreview={page => ensurePreview(page)}
            onActivate={path => controller.activate(path)}
          />
        ) : (
          <PreviewCanvas
            srcDoc={activePreview}
            viewport={state.ui.viewport}
            zoom={state.ui.zoom}
            frameRef={iframeRef}
            onFrameLoad={handleFrameLoad}
            className="min-h-52 flex-1"
          />
        )}
        <div className="max-h-64 min-h-36 shrink-0 overflow-y-auto border-t border-border p-3">
          <SelectionEditor
            selection={activePage?.selection ?? null}
            busy={activePage?.busy ?? false}
            overrideWarning={overrideWarning}
            docSource={activePage?.source ?? null}
            docPath={activePage?.path ?? null}
            dirty={activePage?.status === 'dirty'}
            projectRoot={projectRoot}
            backendId={backendId}
            onApply={handleApply}
          />
        </div>
        <div className="shrink-0 border-t border-border">
          <button
            type="button"
            aria-expanded={versionsOpen}
            aria-label="版本历史"
            onClick={() => setVersionsOpen(value => !value)}
            className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${versionsOpen ? '' : '-rotate-90'}`}
            />
            版本历史
          </button>
          {versionsOpen && (
            <div className="max-h-72 overflow-y-auto px-3 pb-3">
              <VersionHistory
                backendId={backendId}
                sessionId={sessionId}
                docPath={activePage?.path ?? null}
                currentSource={activePage?.source ?? null}
                busy={activePage?.busy ?? false}
                dirty={activePage?.status === 'dirty'}
                restore={restoreSnapshot}
                onRestored={() => void controller.reload()}
                onReload={() => void controller.reload()}
              />
            </div>
          )}
        </div>
      </div>
      {draftDiffOpen && activePage && (
        <DraftDiffModal
          open
          backendId={backendId}
          sessionId={sessionId}
          path={activePage.path}
          draftSource={activePage.source}
          onClose={() => setDraftDiffOpen(false)}
        />
      )}
      {exportOpen && activePage && (
        <ExportDialog
          open
          backendId={backendId}
          sessionId={sessionId}
          path={activePage.path}
          dirty={activePage.status === 'dirty'}
          expectedRevision={activePage.docRevision}
          draftSource={activePage.source}
          onSave={saveForExport}
          onRefresh={refreshNow}
          onClose={() => setExportOpen(false)}
        />
      )}
      {confirmClosePath && (
        <Modal
          open
          onClose={() => setConfirmClosePath(null)}
          ariaLabel="关闭前保存"
          title="关闭前保存"
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="primary" onClick={() => void saveAndClose()}>
                保存
              </Button>
              <Button size="sm" variant="destructive" onClick={discardAndClose}>
                放弃修改
              </Button>
              <Button size="sm" onClick={() => setConfirmClosePath(null)}>
                取消
              </Button>
            </div>
          }
        >
          <div className="p-4 text-xs text-muted-foreground">
            「{confirmClosePath}」有未保存的修改。关闭前要保存这些修改吗？
          </div>
        </Modal>
      )}
    </div>
  );
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

/**
 * 未保存差异（P2 §5.2）：磁盘已保存内容 vs 当前草稿的行级对比。快照不暴露
 * 基线源码，打开时取一次磁盘文档（fileViewer 同样永远读磁盘）；展示复用
 * VersionDiff 抽出的 LineDiffView（同款增删样式）。
 */
function DraftDiffModal({
  open,
  backendId,
  sessionId,
  path,
  draftSource,
  onClose,
}: {
  open: boolean;
  backendId: string;
  sessionId: string;
  path: string;
  draftSource: string;
  onClose: () => void;
}) {
  const [diskSource, setDiskSource] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDiskSource(null);
    setError('');
    getDesignDocument(backendId, sessionId, path)
      .then(doc => {
        if (live) setDiskSource(doc.source);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [open, backendId, sessionId, path]);

  const diff = diskSource === null ? null : lineDiff(diskSource, draftSource);
  const hasChanges = diff !== null && diff.lines.some(line => line.type !== 'same');

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="未保存差异"
      title={`未保存差异 · ${baseName(path)}`}
      size="lg"
      footer={
        <Button size="sm" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {error && (
          <div role="alert" className="text-xs text-destructive">
            差异加载失败：{error}
          </div>
        )}
        {diskSource === null && !error && (
          <div className="text-xs text-muted-foreground">正在加载差异…</div>
        )}
        {diff !== null && !hasChanges && (
          <div className="text-xs text-muted-foreground">草稿与已保存版本相同。</div>
        )}
        {diff !== null && hasChanges && <LineDiffView lines={diff.lines} truncated={diff.truncated} />}
      </div>
    </Modal>
  );
}
