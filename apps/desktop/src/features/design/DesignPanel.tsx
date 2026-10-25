import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceTool } from '../../components/workspace/WorkspaceToolContext';
import { useWorkspaceVisible } from '../../components/workspace/WorkspaceContext';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { DesignSnapshotError, restoreDesignSnapshot } from './api';
import type { DesignConflictFile } from './api';
import { buildDesignAgentContext } from './agent-context';
import { AgentBar } from './agent/AgentBar';
import { relativeAssetRef } from './asset-ref';
import { useAgentRunFeedback } from './agent-run-watch';
import { BrandPanel } from './components/BrandPanel';
import { DeckPresenter } from './components/DeckPresenter';
import { DraftDiffModal } from './components/DraftDiffModal';
import { ExportShareDialog } from './components/ExportShareDialog';
import { MediaGenPanel } from './components/MediaGenPanel';
import { PageOverview } from './components/PageOverview';
import { PreviewCanvas } from './components/PreviewCanvas';
import { SelectionEditor } from './components/SelectionEditor';
import { StyleSourcePanel } from './components/StyleSourcePanel';
import { VersionHistory } from './components/VersionHistory';
import { isDeck, parseDeck } from './deck';
import type { DeckInfo } from './deck';
import { useAgentHandoff } from './hooks/useAgentHandoff';
import { useDesignAgentBridge } from './hooks/useDesignAgentBridge';
import type { AgentContextPayload } from './hooks/useAgentHandoff';
import { useDesignNotices } from './hooks/useDesignNotices';
import { useDesignShortcuts } from './hooks/useDesignShortcuts';
import { useElementTier } from './hooks/useElementTier';
import { usePreviewBridge } from './hooks/usePreviewBridge';
import { usePreviewPipeline } from './hooks/usePreviewPipeline';
import { useStyleSources } from './hooks/useStyleSources';
import { selectionChipLabel } from './inspector/breadcrumb';
import { Inspector } from './inspector/Inspector';
import { CanvasBanner } from './layout/CanvasBanner';
import type { CanvasBannerItem } from './layout/CanvasBanner';
import { CanvasEmptyState } from './layout/CanvasEmptyState';
import { CanvasToolbar } from './layout/CanvasToolbar';
import { DesignWorkbench } from './layout/DesignWorkbench';
import { LeftRail } from './layout/LeftRail';
import { NoticeStack } from './layout/NoticeStack';
import { StatusBar } from './layout/StatusBar';
import { TopBar } from './layout/TopBar';
import { AssetLibraryView } from './rail/AssetLibraryView';
import { BrandView } from './rail/BrandView';
import { LayersView } from './rail/LayersView';
import { LibraryView } from './rail/LibraryView';
import { MediaGenView } from './rail/MediaGenView';
import { PagesView } from './rail/PagesView';
import { SlidesView } from './rail/SlidesView';
import { TemplateView } from './rail/TemplateView';
import { useDesignLayoutStore } from './stores/designLayoutStore';
import { useDesignWorkspace } from './useDesignWorkspace';
import { isValidRulesMessage } from './validators';
import type { DesignEditOperation, DesignSelection } from './types';
import type { OpenPageResult } from './workspace/controller';

export { isValidRulesMessage };

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

const openFailureMessage = (result: Extract<OpenPageResult, { ok: false }>): string =>
  result.reason === 'limit' ? 'Close unsaved pages first' : (result.message ?? 'Failed to open page');

export function DesignPanel() {
  const tool = useWorkspaceTool();
  if (!tool?.sessionId || !tool.backendId)
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Connect the session backend before opening the design panel.
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
  const visible = useWorkspaceVisible();

  // ---- 响应式档位（§3.2）：面板容器实测宽度；0 → wide，首帧不闪 ----
  const {
    ref: rootRef,
    width: panelWidth,
    tier,
    compact,
    height: panelHeight,
  } = useElementTier<HTMLDivElement>();

  // ---- 布局偏好（§3.3，全局持久化）；抽屉开合是临时态 ----
  const leftOpen = useDesignLayoutStore(s => s.leftOpen);
  const leftTab = useDesignLayoutStore(s => s.leftTab);
  const libraryTab = useDesignLayoutStore(s => s.libraryTab);
  const leftWidth = useDesignLayoutStore(s => s.leftWidth);
  const rightOpen = useDesignLayoutStore(s => s.rightOpen);
  const rightTab = useDesignLayoutStore(s => s.rightTab);
  const collapsedSections = useDesignLayoutStore(s => s.collapsedSections);
  const setLeftOpen = useDesignLayoutStore(s => s.setLeftOpen);
  const toggleLeft = useDesignLayoutStore(s => s.toggleLeft);
  const setLeftTab = useDesignLayoutStore(s => s.setLeftTab);
  const setLibraryTab = useDesignLayoutStore(s => s.setLibraryTab);
  const setLeftWidth = useDesignLayoutStore(s => s.setLeftWidth);
  const toggleRight = useDesignLayoutStore(s => s.toggleRight);
  const setRightTab = useDesignLayoutStore(s => s.setRightTab);
  const setSectionCollapsed = useDesignLayoutStore(s => s.setSectionCollapsed);
  /** 窄/中档左栏抽屉（临时态，不持久化）。 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 窄档底部面板展开（临时态）。宽/中档检查器开合仍用持久化的 rightOpen。 */
  const [sheetOpen, setSheetOpen] = useState(false);

  // ---- 通知与画布缩放 ----
  const notices = useDesignNotices();
  const [actualScale, setActualScale] = useState<number | null>(null);

  // ---- P5 三态模式与 deck / 渲染导出（§2.4/§5）：面板会话内 state，不持久化 ----
  const [previewMode, setPreviewMode] = useState<'edit' | 'run'>('edit');
  const [presentDeck, setPresentDeck] = useState<{ startIndex: number } | null>(null);
  /** P5a 合并后的 Export & Share 对话框（ZIP / 渲染导出 / 分享）。 */
  const [exportShareOpen, setExportShareOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);

  // ---- P4c Library：Brand / Media 内嵌为主，原 Modal 仅留作工具行的兜底 ----
  const [brandOpen, setBrandOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [draftDiffOpen, setDraftDiffOpen] = useState(false);
  /** 页面关闭确认（dirty 页：保存 / 放弃修改 / 取消）。 */
  const [confirmClosePath, setConfirmClosePath] = useState<string | null>(null);

  const [channel] = useState(
    () => `design-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  );

  const identity = useMemo(
    () => ({ backendId, projectId, workingDirectory }),
    [backendId, projectId, workingDirectory]
  );

  const bridge = usePreviewBridge({ channel, controller, previewMode, files });

  /** 外部 .css 草稿编辑后的重选回路：新预览载入补发 select-path（expected 置空）。 */
  const handleDraftEdited = useCallback(
    (selection: DesignSelection) => {
      bridge.reselectRef.current = { elementPath: selection.elementPath, expected: new Map() };
    },
    [bridge.reselectRef]
  );

  const styles = useStyleSources({
    backendId,
    sessionId,
    identity,
    assetEpoch: state.assetEpoch,
    activePage,
    styleRules: bridge.styleRules,
    activePath: state.activePath,
    onDraftEdited: handleDraftEdited,
    refreshNow,
  });

  const pipeline = usePreviewPipeline({
    pages: state.pages,
    activePage,
    assetEpoch: state.assetEpoch,
    previewMode,
    cssDraftEpoch: styles.cssTable.epoch,
    backendId,
    sessionId,
    identity,
    channel,
  });

  const agent = useAgentHandoff({
    sessionId,
    backendId,
    workingDirectory,
    projectId,
    pages: state.pages,
    activePage,
    viewport: state.ui.viewport,
    refreshNow,
  });

  const reportAgentFrameLoad = useDesignAgentBridge({
    backendId,
    sessionId,
    identity,
    controller,
    visible,
    previewHtml: pipeline.activePreview,
    previewMode,
    overviewOpen,
    channel,
    iframeRef: bridge.iframeRef,
    showCanvas: () => {
      setOverviewOpen(false);
      setPreviewMode('edit');
    },
  });

  // 切页时关闭幻灯片播放器、Export & Share 对话框与媒体生成面板，避免陈旧页数据展示；会话切换经 key 重挂载自然复位。
  // P5b 起 Slides 编辑器常驻左栏：切页只关闭播放器，内嵌视图随活动页 prop 更新。
  const activePath = state.activePath;
  const clearStyleRules = bridge.clearStyleRules;
  useEffect(() => {
    setPresentDeck(null);
    setExportShareOpen(false);
    setMediaOpen(false);
    // P3.5 §5：切页一并清空样式来源区，旧页规则不污染新选区（选区回落由 rules-request 重新拉取）。
    clearStyleRules();
  }, [activePath, clearStyleRules]);

  // 窄档：选中元素时自动展开一次检查器（§3.1）。
  const selectionKey = activePage?.selection?.elementPath.join('.') ?? null;
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (tier !== 'narrow' || !selectionKey) return;
    if (autoOpenedRef.current === selectionKey) return;
    autoOpenedRef.current = selectionKey;
    setSheetOpen(true);
  }, [tier, selectionKey]);

  /** deck 检测与结构解析：按活动页快照 memo（页对象仅在自身 rev 变化时更换，含草稿修订推进）。 */
  const deckDetected = useMemo(
    () => (activePage ? isDeck(activePage.source) : false),
    [activePage]
  );
  const deckInfo = useMemo<DeckInfo | null>(() => {
    if (!activePage || !deckDetected) return null;
    try {
      return parseDeck(activePage.source);
    } catch {
      return null;
    }
  }, [activePage, deckDetected]);

  // files 经 ref 每渲染同步，避免闭包过期（P4.5 run 反馈）。
  const filesRef = useRef(files);
  filesRef.current = files;

  const handleApply = async (operations: DesignEditOperation[]) => {
    const selection = activePage?.selection;
    if (!selection) return;
    const pathKey = selection.elementPath.join('.');
    // 结构操作不设 mergeKey：每次操作独立成一条撤销记录；其余按 属性/文字/来源声明 归并。
    const mergeKey = operations.some(operation => operation.kind === 'structure')
      ? undefined
      : `${pathKey}:${operations
          .map(operation =>
            operation.kind === 'text'
              ? 'text'
              : operation.kind === 'style'
                ? `style:${operation.property}`
                : operation.kind === 'attribute'
                  ? `attr:${operation.name}`
                  : operation.kind === 'styleBlock'
                    ? `style:${operation.styleOrdinal}:${operation.rulePath.join('.')}:${operation.property}`
                    : `struct:${operation.action}`
          )
          .join('+')}`;
    const applied = await controller.apply(operations, `Edit element ${pathKey}`, mergeKey);
    if (!applied) return;
    // 应用后重选（§6.1/§6.3）：attribute/structure/非颜色 style/styleBlock 需要 iframe
    // 回发 select 消息刷新计算样式并核对 override；纯颜色沿用既有 verify 回路，不动。
    const needsReselect = operations.some(
      operation =>
        operation.kind === 'structure' ||
        operation.kind === 'attribute' ||
        operation.kind === 'styleBlock' ||
        (operation.kind === 'style' &&
          operation.property !== 'color' &&
          operation.property !== 'background-color')
    );
    if (needsReselect) {
      const expected = new Map<string, string>();
      for (const operation of operations) {
        if (operation.kind !== 'style' || operation.value === null) continue;
        // 颜色两项也放进去，键用 'color'/'background-color'（与 select 消息字段对应）；
        // 其余键用 CSS 属性名（与 selection.styles 键对应）。
        expected.set(operation.property, operation.value);
      }
      bridge.reselectRef.current = { elementPath: applied.elementPath, expected };
      bridge.verifyRef.current = null;
      return;
    }
    const expected: { color?: string; backgroundColor?: string } = {};
    for (const operation of operations) {
      if (operation.kind !== 'style' || operation.value === null) continue;
      if (operation.property === 'color') expected.color = operation.value;
      else expected.backgroundColor = operation.value;
    }
    bridge.verifyRef.current =
      expected.color || expected.backgroundColor
        ? { elementPath: applied.elementPath, expected }
        : null;
  };

  /** P6 §8.3：媒体面板「替换选中图片」——产物相对引用写入选中 <img> 的 src（AssetLibrary 替换同款事务）。 */
  const handleReplaceSelectionSrc = (assetPath: string) => {
    void handleApply([
      { kind: 'attribute', name: 'src', value: relativeAssetRef(activePage?.path ?? '', assetPath) },
    ]);
  };

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

  // ---- P4.5 run 结束反馈（§6.2/§6.3）：面板可见时监视本会话 run 过渡 ----
  const runFeedback = useAgentRunFeedback({
    sessionId,
    backendId,
    enabled: visible,
    getWatchState: () => ({
      files: filesRef.current,
      openPages: controller
        .getSnapshot()
        .pages.filter(page => page.docRevision)
        .map(page => ({ path: page.path, docRevision: page.docRevision as string })),
    }),
    refreshNow,
  });

  // ---- P6 §5：面板作用域快捷键（⌘S / ⌘Z / ⇧⌘Z）；接线后才在 Tooltip 显示快捷键 ----
  const shortcutSave = useCallback(() => {
    void controller.save();
  }, [controller]);
  const shortcutUndo = useCallback(() => {
    void controller.undo();
  }, [controller]);
  const shortcutRedo = useCallback(() => {
    void controller.redo();
  }, [controller]);
  useDesignShortcuts({
    enabled: visible,
    dirty: activePage?.status === 'dirty',
    busy: activePage?.busy ?? false,
    onSave: shortcutSave,
    onUndo: shortcutUndo,
    onRedo: shortcutRedo,
  });

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

  /** 聚焦聊天输入框（通知里的「Open chat」动作；找不到时静默）。 */
  const focusComposer = useCallback(() => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Type a message..."]');
    input?.focus();
  }, []);

  /** 预填到当前聊天 + 瞬时通知（沿用发送前可检查的语义）。 */
  const prefillWithNotice = useCallback(
    (prompt: string) => {
      agent.prefill(prompt);
      notices.push({
        id: 'prefill',
        text: 'Prefilled into the current chat — add your requirements and send.',
        ttl: 4000,
        actions: [{ label: 'Open chat', onSelect: focusComposer }],
      });
    },
    [agent, focusComposer, notices]
  );

  const openPage = useCallback(
    async (path: string) => {
      const result = await controller.open(path);
      if (result.ok) return;
      notices.push({ id: `open-${path}`, tone: 'warning', text: openFailureMessage(result) });
    },
    [controller, notices]
  );

  /** Agent 上下文：有选区 → modify；无选区 → generate（有活动页指向该页，空工作台回退 index）；request 追加到 prompt 末尾。 */
  const buildAgentContext = useCallback(
    (request: string): AgentContextPayload => {
      const input = agent.buildContextInput();
      const task = activePage?.selection ? 'modify' : 'generate';
      const context = buildDesignAgentContext(input, task, request.trim() ? { request } : undefined);
      return { task, sections: context.sections, prompt: context.prompt };
    },
    [activePage?.selection, agent]
  );

  /** 模式切换（P5 §0.1）：会话内 state 不持久化；切离运行模式即撤导航提示。 */
  const changePreviewMode = (mode: 'edit' | 'run') => {
    setPreviewMode(mode);
    bridge.clearRunNotice();
  };

  const railPanelOpen = tier === 'wide' ? leftOpen : drawerOpen;
  const inspectorOpen = tier === 'narrow' ? sheetOpen : rightOpen;
  const toggleInspector = () => {
    if (tier === 'narrow') setSheetOpen(open => !open);
    else toggleRight();
  };
  const toggleRailPanel = () => {
    if (tier === 'wide') toggleLeft();
    else setDrawerOpen(open => !open);
  };
  const selectRailTab = (tab: typeof leftTab) => {
    setLeftTab(tab);
    if (tier === 'wide') {
      if (!leftOpen) setLeftOpen(true);
    } else setDrawerOpen(true);
  };
  const openLayers = () => selectRailTab('layers');
  /** P5b：Slides 是动作，不是模式——选中左栏 Slides 页签并打开抽屉/面板。 */
  const showSlides = () => selectRailTab('slides');
  const openLibrary = (tab: typeof libraryTab) => {
    setLibraryTab(tab);
    selectRailTab('library');
  };
  /** Brand / Media 的内嵌入口：切到 Library 页签并让对话框让位（只留一个活动面）。 */
  const showBrand = () => {
    setBrandOpen(false);
    openLibrary('brand');
  };
  const showMedia = () => {
    setMediaOpen(false);
    openLibrary('media');
  };
  /** Expand：只抬高窄面板，已更宽的宽度保持不变。 */
  const expandLibraryPanel = () => setLeftWidth(Math.max(leftWidth, 320));
  /** 内嵌 Brand / Media 的唯一活动面：左栏可见且命中页签；对应对话框打开时让位。 */
  const libraryPanelVisible = visible && railPanelOpen && leftTab === 'library';
  const brandInlineActive = libraryPanelVisible && libraryTab === 'brand' && !brandOpen;
  const mediaInlineActive = libraryPanelVisible && libraryTab === 'media' && !mediaOpen;
  /** P5b：Slides 内嵌视图仅在真正可见时激活（隐藏时不挂任何缩略图 iframe）。 */
  const slidesInlineActive = visible && railPanelOpen && leftTab === 'slides';
  const handleTemplateInstalled = (entry: string) => {
    selectRailTab('pages');
    refreshNow();
    void openPage(entry);
  };

  // ---- run 反馈 / 运行导航 / 阻断横幅（§4.3） ----
  const feedbackFiles = runFeedback.status
    ? [...new Set([...runFeedback.status.diff.addedFiles, ...runFeedback.status.diff.changedPages])]
    : [];
  const allNotices = [
    ...notices.notices,
    ...(bridge.runNotice ? [{ id: 'run-notice', text: bridge.runNotice.text }] : []),
    ...(runFeedback.status
      ? [
          {
            id: 'run-feedback',
            text: runFeedback.status.text,
            actions: feedbackFiles.map(path => ({
              label: path,
              onSelect: () => void controller.open(path),
            })),
          },
        ]
      : []),
  ];
  const dismissNotice = (id: string) => {
    if (id === 'run-notice') bridge.dismissRunNotice();
    else if (id === 'run-feedback') runFeedback.dismiss();
    else notices.dismiss(id);
  };

  const bannerItems: CanvasBannerItem[] = [
    ...(activePage?.externalChange
      ? [
          {
            id: 'external-change',
            tone: 'warning' as const,
            text: 'This file was updated elsewhere. Your draft is preserved; reload to load the latest version.',
          },
        ]
      : []),
    ...(activePage?.missing
      ? [
          {
            id: 'missing',
            tone: 'warning' as const,
            text: 'This file no longer exists in the workspace; save to recreate it, or close the page.',
          },
        ]
      : []),
    ...(activePage?.error
      ? [
          {
            id: 'page-error',
            tone: 'destructive' as const,
            role: 'alert' as const,
            text: activePage.error,
          },
        ]
      : []),
  ];

  const showEmptyState = state.pages.length === 0 && files.length === 0;
  const zoomPercent = Math.round((actualScale ?? state.ui.zoom.value) * 100);

  return (
    <div ref={rootRef} data-testid="design-panel" className="h-full min-h-0">
      <DesignWorkbench
        tier={tier}
        compact={compact}
        height={panelHeight}
        leftOpen={railPanelOpen}
        rightOpen={inspectorOpen}
        leftWidth={leftWidth}
        onCloseDrawer={() => setDrawerOpen(false)}
        topBar={
          <TopBar
            tier={tier}
            compact={compact}
            pages={state.pages}
            activePath={state.activePath}
            files={files}
            viewport={state.ui.viewport}
            zoom={state.ui.zoom}
            actualScale={actualScale}
            previewMode={previewMode}
            deckAvailable={deckDetected}
            canUndo={activePage?.canUndo ?? false}
            canRedo={activePage?.canRedo ?? false}
            dirty={activePage?.status === 'dirty'}
            busy={activePage?.busy ?? false}
            loading={activePage?.status === 'loading'}
            leftOpen={railPanelOpen}
            overviewOpen={overviewOpen}
            treeOpen={leftTab === 'layers'}
            docPath={activePage?.path ?? null}
            onActivate={path => controller.activate(path)}
            onClose={handleCloseRequest}
            onOpen={path => void openPage(path)}
            onViewportChange={viewport => controller.setViewport(viewport)}
            onZoomChange={zoom => controller.setZoom(zoom)}
            onPreviewModeChange={changePreviewMode}
            onSlides={showSlides}
            onUndo={() => void controller.undo()}
            onRedo={() => void controller.redo()}
            onSave={() => void controller.save()}
            onToggleLeft={toggleRailPanel}
            onExportShare={() => setExportShareOpen(true)}
            onDiff={() => setDraftDiffOpen(true)}
            onReload={() => void controller.reload()}
            onRefresh={refreshNow}
            onTemplates={() => openLibrary('templates')}
            onBrand={showBrand}
            onAssets={() => openLibrary('assets')}
            onMedia={showMedia}
            onToggleOverview={() => setOverviewOpen(value => !value)}
            onToggleTree={openLayers}
          />
        }
        rail={
          <LeftRail
            tier={tier}
            open={railPanelOpen}
            tab={leftTab}
            width={leftWidth}
            deckAvailable={deckDetected}
            onSelectTab={selectRailTab}
            onToggle={toggleRailPanel}
            onResize={setLeftWidth}
            containerWidth={panelWidth}
            pages={
              <PagesView
                pages={state.pages}
                activePath={state.activePath}
                files={files}
                previews={pipeline.previews}
                overviewOpen={overviewOpen}
                onActivate={path => controller.activate(path)}
                onClose={handleCloseRequest}
                onOpen={path => void openPage(path)}
                onOpenTemplates={() => openLibrary('templates')}
                onToggleOverview={() => setOverviewOpen(value => !value)}
                onOpenInViewer={path =>
                  useFileViewerStore
                    .getState()
                    .openFile(projectRoot ?? '', path, undefined, undefined, backendId)
                }
                onRequestPreview={page => pipeline.ensurePreview(page)}
              />
            }
            layers={
              <LayersView
                source={activePage?.source ?? ''}
                selectionPath={activePage?.selection?.elementPath ?? null}
                onSelectPath={bridge.selectPath}
              />
            }
            library={
              <LibraryView
                libraryTab={libraryTab}
                onLibraryTabChange={setLibraryTab}
                assets={
                  <AssetLibraryView
                    active={visible && railPanelOpen && leftTab === 'library' && libraryTab === 'assets'}
                    compact
                    backendId={backendId}
                    sessionId={sessionId}
                    openPages={state.pages.map(page => ({ path: page.path, source: page.source }))}
                    referencedAssets={(activePage?.deps ?? []).map(dep => dep.path)}
                    activeDocPath={activePage?.path ?? null}
                    selection={activePage?.selection ? { tagName: activePage.selection.tagName } : null}
                    onApply={handleApply}
                    onImported={agent.handleAssetImported}
                  />
                }
                templates={
                  <TemplateView
                    active={
                      visible && railPanelOpen && leftTab === 'library' && libraryTab === 'templates'
                    }
                    compact
                    openEntryOnInstall
                    backendId={backendId}
                    sessionId={sessionId}
                    onInstalled={handleTemplateInstalled}
                  />
                }
                brand={
                  <BrandView
                    active={brandInlineActive}
                    compact
                    backendId={backendId}
                    sessionId={sessionId}
                    onSaved={agent.reloadBrand}
                  />
                }
                media={
                  <MediaGenView
                    active={mediaInlineActive}
                    compact
                    backendId={backendId}
                    sessionId={sessionId}
                    activeDocPath={activePage?.path ?? null}
                    imageSelectionReady={activePage?.selection?.tagName === 'img'}
                    onReplaceSelectionSrc={handleReplaceSelectionSrc}
                    onAssetImported={agent.handleAssetImported}
                  />
                }
                onExpand={expandLibraryPanel}
                onOpenBrand={() => setBrandOpen(true)}
                onOpenMedia={() => setMediaOpen(true)}
              />
            }
            slides={
              <SlidesView
                active={slidesInlineActive}
                page={
                  activePage
                    ? { path: activePage.path, source: activePage.source, busy: activePage.busy }
                    : null
                }
                previewHtml={pipeline.activePreview || null}
                deck={deckInfo}
                compact
                onCommit={(source, label) => controller.applySource(source, label)}
                onPresent={startIndex => setPresentDeck({ startIndex })}
              />
            }
          />
        }
        canvas={
          <div className="relative isolate flex min-h-0 flex-1 flex-col">
            <CanvasBanner items={bannerItems} />
            <CanvasToolbar
              compact={compact}
              viewport={state.ui.viewport}
              zoom={state.ui.zoom}
              actualScale={actualScale}
              onViewportChange={viewport => controller.setViewport(viewport)}
              onZoomChange={zoom => controller.setZoom(zoom)}
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
              {showEmptyState ? (
                <CanvasEmptyState
                  onGenerate={() => {
                    document
                      .querySelector<HTMLInputElement>('[data-testid="design-agent-bar"] input')
                      ?.focus();
                  }}
                  onTemplate={() => openLibrary('templates')}
                />
              ) : (
                <>
                  <div hidden={overviewOpen} className="flex min-h-0 flex-1 flex-col">
                    <PreviewCanvas
                      srcDoc={pipeline.activePreview}
                      viewport={state.ui.viewport}
                      zoom={state.ui.zoom}
                      tier={tier}
                      frameRef={bridge.iframeRef}
                      onFrameLoad={() => {
                        bridge.handleFrameLoad();
                        reportAgentFrameLoad();
                      }}
                      onScaleChange={setActualScale}
                      className="min-h-0 flex-1 pb-20"
                    />
                  </div>
                  {overviewOpen && (
                    <PageOverview
                      pages={state.pages}
                      activePath={state.activePath}
                      previews={pipeline.previews}
                      onRequestPreview={page => pipeline.ensurePreview(page)}
                      onActivate={path => controller.activate(path)}
                    />
                  )}
                </>
              )}
              <AgentBar
                selection={activePage?.selection ?? null}
                chipLabel={selectionChipLabel(activePage?.source, activePage?.selection ?? null)}
                dirty={activePage?.status === 'dirty'}
                busy={activePage?.busy ?? false}
                runMode={previewMode === 'run'}
                compact={tier === 'narrow'}
                onSave={() => void controller.save()}
                onPrefill={prefillWithNotice}
                buildContext={buildAgentContext}
              />
              <NoticeStack
                notices={allNotices}
                onDismiss={dismissNotice}
                className="right-2 top-2 w-80"
              />
            </div>
          </div>
        }
        inspector={
          <Inspector
            selection={activePage?.selection ?? null}
            docSource={activePage?.source ?? null}
            rightTab={rightTab}
            onRightTabChange={setRightTab}
            onSelectPath={bridge.selectPath}
            collapsedSections={collapsedSections}
            onToggleSection={setSectionCollapsed}
            dirty={activePage?.status === 'dirty'}
            runMode={previewMode === 'run'}
            narrow={tier === 'narrow'}
            collapsed={tier === 'narrow' && !sheetOpen}
            onToggleCollapsed={() => setSheetOpen(open => !open)}
            design={
              <SelectionEditor
                selection={activePage?.selection ?? null}
                busy={activePage?.busy ?? false}
                overrideWarning={bridge.overrideWarning}
                docSource={activePage?.source ?? null}
                docPath={activePage?.path ?? null}
                dirty={activePage?.status === 'dirty'}
                projectRoot={projectRoot}
                backendId={backendId}
                sessionId={sessionId}
                onSelectPath={bridge.selectPath}
                onApply={handleApply}
                collapsedSections={collapsedSections}
                onToggleSection={setSectionCollapsed}
                onGenerate={() => {
                  document
                    .querySelector<HTMLInputElement>('[data-testid="design-agent-bar"] input')
                    ?.focus();
                }}
                onTemplate={() => openLibrary('templates')}
                pageInfo={{
                  fileName: activePage ? basename(activePage.path) : null,
                  depCount: activePage?.deps?.length ?? 0,
                }}
              />
            }
            styles={
              <StyleSourcePanel
                rules={bridge.styleRules}
                rows={styles.styleSource.rows}
                truncated={styles.styleSource.truncated}
                busy={activePage?.busy ?? false}
                onApply={handleApply}
                onApplyExternal={styles.handleApplyExternal}
                cssDirty={styles.cssDraftDirty}
                savingStyles={styles.savingStyles}
                onSaveStyles={() => void styles.saveStyles()}
                conflictPath={styles.styleConflictPath}
                editError={styles.styleEditError}
                onKeepDraft={() => styles.setStyleConflictPath(null)}
                onReloadDraft={path => styles.setConfirmCssReloadPath(path)}
              />
            }
            history={
              <div className="flex flex-col gap-2">
                {activePage?.status === 'dirty' && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="View unsaved diff"
                    className="justify-start"
                    onClick={() => setDraftDiffOpen(true)}
                  >
                    Unsaved changes
                  </Button>
                )}
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
            }
          />
        }
        statusBar={
          <StatusBar
            dirty={activePage?.status === 'dirty'}
            loading={activePage?.status === 'loading'}
            busy={activePage?.busy ?? false}
            runMode={previewMode === 'run'}
            runBlocked={pipeline.runBlocked}
            viewport={state.ui.viewport}
            zoomLabel={`${zoomPercent}%`}
            onViewDiff={() => setDraftDiffOpen(true)}
            rightOpen={inspectorOpen}
            onToggleInspector={toggleInspector}
          />
        }
      />

      {brandOpen && (
        <BrandPanel
          open
          backendId={backendId}
          sessionId={sessionId}
          onClose={() => setBrandOpen(false)}
          onSaved={agent.reloadBrand}
        />
      )}
      {mediaOpen && (
        <MediaGenPanel
          open
          backendId={backendId}
          sessionId={sessionId}
          activeDocPath={activePage?.path ?? null}
          imageSelectionReady={activePage?.selection?.tagName === 'img'}
          onReplaceSelectionSrc={handleReplaceSelectionSrc}
          onAssetImported={agent.handleAssetImported}
          onClose={() => setMediaOpen(false)}
        />
      )}
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
      {/* ---- P5a 合并对话框（§4.8）：三页签同时挂载；关闭/切页由同一状态与 effect 管理 ---- */}
      {exportShareOpen && activePage && (
        <ExportShareDialog
          open
          onClose={() => setExportShareOpen(false)}
          exportProps={{
            backendId,
            sessionId,
            path: activePage.path,
            dirty: activePage.status === 'dirty',
            expectedRevision: activePage.docRevision,
            draftSource: activePage.source,
            onSave: saveForExport,
            onRefresh: refreshNow,
            cssDirty: styles.cssDraftDirty,
          }}
          renderProps={{
            entryPath: activePage.path,
            previewHtml: pipeline.activePreview || null,
            deck: deckInfo,
            viewport: state.ui.viewport,
          }}
          shareProps={{
            backendId,
            sessionId,
            docPath: activePage.path,
            currentSource: activePage.source,
            onHandoff: prompt => {
              prefillWithNotice(prompt);
              setExportShareOpen(false);
            },
          }}
        />
      )}
      {/* ---- P5 幻灯片播放器（§5/§6.3）：编辑在左栏 Slides 页签；切页由上方 effect 关闭播放器 ---- */}
      {presentDeck && deckInfo && (
        <DeckPresenter
          slides={deckInfo.slides}
          ratio={deckInfo.ratio}
          previewHtml={pipeline.activePreview || null}
          startIndex={presentDeck.startIndex}
          onClose={() => setPresentDeck(null)}
        />
      )}
      {confirmClosePath && (
        <Modal
          open
          onClose={() => setConfirmClosePath(null)}
          ariaLabel="Save before closing"
          title="Save before closing"
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="primary" onClick={() => void saveAndClose()}>
                Save
              </Button>
              <Button size="sm" variant="destructive" onClick={discardAndClose}>
                Discard changes
              </Button>
              <Button size="sm" onClick={() => setConfirmClosePath(null)}>
                Cancel
              </Button>
            </div>
          }
        >
          <div className="p-4 text-xs text-muted-foreground">
            "{confirmClosePath}" has unsaved changes. Save them before closing?
          </div>
        </Modal>
      )}
      {/* P3.5 第二批（§6）：「Reload from disk」确认对话框——草稿丢弃防误丢。 */}
      {styles.confirmCssReloadPath && (
        <Modal
          open
          onClose={() => styles.setConfirmCssReloadPath(null)}
          ariaLabel="Reload style file"
          title="Reload style file"
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => styles.reloadCssDraftFromDisk(styles.confirmCssReloadPath as string)}
              >
                Reload
              </Button>
              <Button size="sm" onClick={() => styles.setConfirmCssReloadPath(null)}>
                Cancel
              </Button>
            </div>
          }
        >
          <div className="p-4 text-xs text-muted-foreground">
            Reload "{styles.confirmCssReloadPath}" from disk? Unsaved style edits in this file will be
            lost.
          </div>
        </Modal>
      )}
    </div>
  );
}
