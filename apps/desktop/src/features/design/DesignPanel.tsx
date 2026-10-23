import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useWorkspaceTool } from '../../components/workspace/WorkspaceToolContext';
import { useWorkspaceVisible } from '../../components/workspace/WorkspaceContext';
import { useComposerStore } from '../../stores/composerStore';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import {
  DesignSnapshotError,
  getDesignAsset,
  getDesignBrand,
  getDesignDocument,
  restoreDesignSnapshot,
} from './api';
import type { DesignBrand, DesignConflictFile } from './api';
import { buildDesignAgentContext } from './agent-context';
import type { AgentContextInput, AgentContextSection, AgentContextTask } from './agent-context';
import { useAgentRunFeedback } from './agent-run-watch';
import { lineDiff } from './diff';
import { AgentContextPreview } from './components/AgentContextPreview';
import { AssetLibrary } from './components/AssetLibrary';
import { BrandPanel } from './components/BrandPanel';
import { DeckPanel } from './components/DeckPanel';
import { DeckPresenter } from './components/DeckPresenter';
import { DesignToolbar } from './components/DesignToolbar';
import { ExportDialog } from './components/ExportDialog';
import { RenderExportDialog } from './components/RenderExportDialog';
import { TemplateDialog } from './components/TemplateDialog';
import { PageOverview } from './components/PageOverview';
import { PageTabs } from './components/PageTabs';
import { PreviewCanvas } from './components/PreviewCanvas';
import { SelectionEditor } from './components/SelectionEditor';
import { VersionHistory } from './components/VersionHistory';
import { LineDiffView } from './components/VersionDiff';
import { ViewportControls } from './components/ViewportControls';
import { isDeck, parseDeck } from './deck';
import type { DeckInfo } from './deck';
import { buildDesignRunPreview } from './interactive';
import { buildDesignPreview } from './preview';
import { ElementTree } from './components/ElementTree';
import { useDesignWorkspace } from './useDesignWorkspace';
import type { DesignComputedStyles, DesignEditOperation, DesignSelection } from './types';
import type { DesignPageSnapshot } from './workspace/controller';

/** 面板级预览缓存上限（LRU；键 path → {key, html, blocked?}）。 */
const PREVIEW_CACHE_MAX = 8;
/** 总览缩略图惰性构建的并发上限。 */
const PREVIEW_MAX_CONCURRENT = 2;

/** 运行桥接 navigate 的 path 校验上限（P5 §2.4）。 */
const RUN_NAV_PATH_MAX = 500;
/** scheme 形态引用（运行 navigate path 与外部链接同口径）。 */
const SCHEME_LIKE = /^[a-z][a-z\d+.-]*:/i;

/** C0 控制字符与 DEL（码点比较，规避 no-control-regex；对齐 deck.ts）。 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 运行构建结果里被移除的远程引用计数（状态行展示）。 */
interface RunBlockedCount {
  scripts: number;
  links: number;
}

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
    (v.base === undefined || typeof v.base === 'string') &&
    isValidComputedStyles(v.styles) &&
    isValidSelectionAttrs(v.attrs) &&
    (v.inlineStyle === undefined || (typeof v.inlineStyle === 'string' && v.inlineStyle.length <= 2000))
  );
};

/** §6.1：styles 为普通对象（非 null/数组），键数 ≤32、值均为 string ≤200。 */
const isValidComputedStyles = (styles: unknown): boolean => {
  if (styles === undefined) return true;
  if (styles === null || typeof styles !== 'object' || Array.isArray(styles)) return false;
  const entries = Object.entries(styles as Record<string, unknown>);
  return entries.length <= 32 && entries.every(([, v]) => typeof v === 'string' && v.length <= 200);
};

/** §6.1：attrs 键 ∈ {src,alt,href}、值 string ≤500。 */
const isValidSelectionAttrs = (attrs: unknown): boolean => {
  if (attrs === undefined) return true;
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
  const entries = Object.entries(attrs as Record<string, unknown>);
  return entries.every(
    ([key, v]) =>
      (key === 'src' || key === 'alt' || key === 'href') &&
      typeof v === 'string' &&
      v.length <= 500
  );
};

interface VerifyExpectation {
  elementPath: number[];
  expected: { color?: string; backgroundColor?: string };
}

/** 应用后重选（§6.1/§6.3）：本轮写入的属性期望值，等 iframe 回发 select 消息时核对。 */
interface ReselectExpectation {
  elementPath: number[];
  /** 属性名 → 写入值（仅 value 非 null 的 style 操作；键与 select 消息 styles 一致）。 */
  expected: Map<string, string>;
}

const RESELECT_COLOR_KEYS = new Set(['color', 'background-color', 'border-color']);
const RESELECT_KEYWORD_KEYS = new Set(['text-align', 'border-style', 'object-fit']);
const RESELECT_LENGTH_KEYS = new Set([
  'width',
  'height',
  'font-size',
  'line-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'border-radius',
]);
const PX_LENGTH = /^[+-]?[\d.]+px$/;

/** font-weight 归一到 100–900 数值；bold→700、normal→400，bolder/lighter 与白名单外值返回 null（跳过）。 */
function fontWeightValue(value: string): number | null {
  const keyword = value.trim().toLowerCase();
  if (keyword === 'bold') return 700;
  if (keyword === 'normal') return 400;
  if (keyword === 'bolder' || keyword === 'lighter') return null;
  if (/^\d+$/.test(keyword)) {
    const numeric = Number(keyword);
    return numeric >= 100 && numeric <= 900 ? numeric : null;
  }
  return null;
}

/**
 * §6.3 重选对比表：expected 中任一属性与计算样式失配返回 true。
 * color/background-color 是 select 消息的顶层字段（不在 styles 映射里）；
 * 无可靠口径的键（font-family、margin/padding 简写、非 px 写法的长度、缺计算值）一律跳过，宁缺勿误报。
 */
function reselectMismatch(expected: Map<string, string>, selection: DesignSelection): boolean {
  for (const [property, written] of expected) {
    const computed =
      property === 'color'
        ? selection.color
        : property === 'background-color'
          ? selection.backgroundColor
          : selection.styles?.[property as keyof DesignComputedStyles];
    if (typeof computed !== 'string') continue;
    if (RESELECT_COLOR_KEYS.has(property)) {
      if (!colorsEquivalent(written, computed)) return true;
    } else if (property === 'font-weight') {
      const expectedWeight = fontWeightValue(written);
      const computedWeight = fontWeightValue(computed);
      if (expectedWeight !== null && computedWeight !== null && expectedWeight !== computedWeight)
        return true;
    } else if (RESELECT_KEYWORD_KEYS.has(property)) {
      if (written.trim().toLowerCase() !== computed.trim().toLowerCase()) return true;
    } else if (RESELECT_LENGTH_KEYS.has(property)) {
      // 长度键仅当双方都是纯 px 写法时按数值比对（em/%/简写不可靠）。
      if (
        PX_LENGTH.test(written) &&
        PX_LENGTH.test(computed) &&
        Number.parseFloat(written) !== Number.parseFloat(computed)
      )
        return true;
    }
    // font-family 与 margin/padding 简写：跳过（无可靠口径）。
  }
  return false;
}

const pathsEqual = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

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
  const visible = useWorkspaceVisible();

  // ---- P5 三态模式与 deck / 渲染导出（§2.4/§5）：面板会话内 state，不持久化 ----
  const [previewMode, setPreviewMode] = useState<'edit' | 'run'>('edit');
  const [presentDeck, setPresentDeck] = useState<{ startIndex: number } | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [renderExportOpen, setRenderExportOpen] = useState(false);
  /** 运行模式导航提示（design-navigate / design-nav-blocked），5 秒自动消失或手动关闭。 */
  const [runNotice, setRunNotice] = useState<{ text: string } | null>(null);

  // 切页时关闭幻灯片面板/播放器与渲染导出对话框，避免陈旧 deck 展示；会话切换经 key 重挂载自然复位。
  const activePath = state.activePath;
  useEffect(() => {
    setDeckOpen(false);
    setPresentDeck(null);
    setRenderExportOpen(false);
  }, [activePath]);

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

  // ---- P4.6 模板 / 品牌 / 素材对话框与上下文检视（§5.3） ----
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [contextPreview, setContextPreview] = useState<{
    task: AgentContextTask;
    sections: AgentContextSection[];
    prompt: string;
  } | null>(null);

  /** 品牌缓存：挂载拉一次，BrandPanel 保存成功后重拉；失败静默（保持 null，section 省略）。 */
  const brandRef = useRef<DesignBrand | null>(null);
  const reloadBrand = useCallback(() => {
    void (async () => {
      try {
        brandRef.current = await getDesignBrand(backendId, sessionId);
      } catch {
        brandRef.current = null;
      }
    })();
  }, [backendId, sessionId]);
  useEffect(() => {
    reloadBrand();
  }, [reloadBrand]);

  /** 本面板会话内最近导入的素材路径（≤10；进入上下文 Assets，unshift 去重）。 */
  const recentImportsRef = useRef<string[]>([]);
  const handleAssetImported = useCallback(
    (path: string) => {
      recentImportsRef.current = [path, ...recentImportsRef.current.filter(p => p !== path)].slice(
        0,
        10
      );
      // 素材变化让下一轮轮询尽快刷新 assetEpoch。
      refreshNow();
    },
    [refreshNow]
  );

  const [channel] = useState(
    () => `design-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const verifyRef = useRef<VerifyExpectation | null>(null);
  const reselectRef = useRef<ReselectExpectation | null>(null);
  const [overrideWarning, setOverrideWarning] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);

  // files 经 ref 每渲染同步，避免闭包过期（P4.5 run 反馈与 P5 navigate 消息共用）。
  const filesRef = useRef(files);
  filesRef.current = files;

  // ---- 面板级预览缓存：Map<path, {key: draftRevision:assetEpoch:mode, html, blocked?}>，LRU ≤8 ----
  const previewCacheRef = useRef(new Map<string, { key: string; html: string; blocked?: RunBlockedCount }>());
  const previewPendingRef = useRef(new Map<string, string>());
  const previewQueueRef = useRef<Array<() => Promise<void>>>([]);
  const previewInflightRef = useRef(0);
  const [, setPreviewTick] = useState(0);

  const cachePreview = useCallback(
    (path: string, key: string, html: string, blocked?: RunBlockedCount) => {
      const cache = previewCacheRef.current;
      cache.delete(path); // 刷新 LRU 插入顺序
      cache.set(path, blocked ? { key, html, blocked } : { key, html });
      while (cache.size > PREVIEW_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      setPreviewTick(tick => tick + 1);
    },
    []
  );

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

  /** 构建（或复用）一页的预览串；front=true 时插队（活动页优先）。缓存键含模式（P5 §2.4）。 */
  const ensurePreview = useCallback(
    (page: DesignPageSnapshot, front = false) => {
      const key = `${page.draftRevision}:${state.assetEpoch}:${previewMode}`;
      const cached = previewCacheRef.current.get(page.path);
      if (cached && cached.key === key) return;
      if (previewPendingRef.current.get(page.path) === key) return;
      previewPendingRef.current.set(page.path, key);
      const job = async () => {
        try {
          if (previewMode === 'run') {
            // 运行模式（P5 §2）：脚本保留执行、远程引用移除并计数；blocked 随缓存供状态条读取。
            const result = await buildDesignRunPreview({
              source: page.source,
              filePath: page.path,
              loadAsset: assetPath => getDesignAsset(backendId, sessionId, assetPath),
              channel,
            });
            cachePreview(page.path, key, result.html, result.blocked);
          } else {
            const html = await buildDesignPreview(
              page.source,
              page.path,
              assetPath => getDesignAsset(backendId, sessionId, assetPath),
              channel,
              page.draftRevision
            );
            cachePreview(page.path, key, html);
          }
        } catch {
          // 预览构建失败不阻塞面板；资源拉取失败已在构建器内部降级。
        } finally {
          previewPendingRef.current.delete(page.path);
        }
      };
      if (front) previewQueueRef.current.unshift(job);
      else previewQueueRef.current.push(job);
      pumpPreviews();
    },
    [backendId, channel, cachePreview, pumpPreviews, previewMode, sessionId, state.assetEpoch]
  );

  // 活动页预览：effect 依赖 (activePath, draftRevision, assetEpoch, mode)；缓存命中直接用。
  const activePreviewKey = activePage
    ? `${activePage.draftRevision}:${state.assetEpoch}:${previewMode}`
    : null;
  const cachedActive = activePage ? previewCacheRef.current.get(activePage.path) : undefined;
  const activePreview =
    cachedActive && activePreviewKey && cachedActive.key === activePreviewKey
      ? cachedActive.html
      : '';
  /** 运行模式状态条的 blocked 计数（随缓存构建落定；N+M 均 0 不显示该行）。 */
  const runBlocked =
    previewMode === 'run' && cachedActive && cachedActive.key === activePreviewKey
      ? (cachedActive.blocked ?? null)
      : null;

  useEffect(() => {
    if (!activePage || !activePreviewKey || activePreview) return;
    ensurePreview(activePage, true);
  }, [activePage, activePreviewKey, activePreview, ensurePreview]);

  // 总览用的预览表（本次渲染时从共享缓存读取；构建完成经 previewTick 触发重渲染）。
  const previews: Record<string, string> = {};
  for (const page of state.pages) {
    const key = `${page.draftRevision}:${state.assetEpoch}:${previewMode}`;
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
        path?: unknown;
        reason?: unknown;
      } | null;
      if (!data || data.channel !== channel) return;
      // P5 运行模式导航（§2.4）：仅运行预览的桥接会发这两类消息，编辑模式不响应。
      if (previewMode === 'run' && data.type === 'zclaudia:design-navigate') {
        const raw = typeof data.path === 'string' ? data.path : '';
        const valid =
          raw.length > 0 &&
          raw.length <= RUN_NAV_PATH_MAX &&
          !raw.includes('\\') &&
          !hasControlChars(raw) &&
          !SCHEME_LIKE.test(raw);
        if (valid && filesRef.current.includes(raw)) {
          setRunNotice({ text: `已打开 ${raw}` });
          void controller.open(raw);
        } else {
          setRunNotice({ text: `目标页面不在工作区：${raw}` });
        }
        return;
      }
      if (previewMode === 'run' && data.type === 'zclaudia:design-nav-blocked') {
        setRunNotice({
          text:
            data.reason === 'external'
              ? '已阻止打开外部链接'
              : '已阻止非页面链接（仅支持工作区内 HTML 跳转）',
        });
        return;
      }
      if (data.type === 'zclaudia:design-select') {
        if (!isValidSelection(data.selection)) return;
        verifyRef.current = null;
        setOverrideWarning(false);
        const reselect = reselectRef.current;
        if (reselect) {
          if (pathsEqual(data.selection.elementPath, reselect.elementPath)) {
            // §6.3：应用后的重选到达，按对比表核对写入值与计算样式。
            if (reselectMismatch(reselect.expected, data.selection)) {
              setOverrideWarning(true);
            }
          }
          // 路径不同 = 用户已点选其他元素：本轮重选作废，不告警。
          reselectRef.current = null;
        }
        controller.handleSelectionMessage(data.selection);
        return;
      }
      if (data.type === 'zclaudia:design-select-failed') {
        // 树与预览短暂不同步属正常（§6.1）：清挂起重选、不弹错，用户下次点击自愈。
        reselectRef.current = null;
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
  }, [channel, controller, previewMode]);

  // 运行导航提示 5 秒自动消失（§2.4）；手动关闭走提示条按钮。
  useEffect(() => {
    if (!runNotice) return;
    const timer = window.setTimeout(() => setRunNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [runNotice]);

  /** 模式切换（P5 §0.1）：会话内 state 不持久化；切离运行模式即撤导航提示。 */
  const changePreviewMode = (mode: 'edit' | 'run') => {
    setPreviewMode(mode);
    setRunNotice(null);
  };

  // The verify request and the post-apply reselect must reach the rebuilt preview,
  // so both are sent on the iframe's load event (at most once per frame load).
  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    const pending = verifyRef.current;
    if (pending) {
      frame.contentWindow.postMessage(
        { type: 'zclaudia:design-verify', channel, elementPath: pending.elementPath },
        '*'
      );
    }
    if (reselectRef.current) {
      frame.contentWindow.postMessage(
        {
          type: 'zclaudia:design-select-path',
          channel,
          elementPath: reselectRef.current.elementPath,
        },
        '*'
      );
    }
  }, [channel]);

  /** 元素导航（树节点 / 父级 / 子级）：向预览桥接发送路径选择请求（§6.1）。 */
  const selectPath = useCallback(
    (path: number[]) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) return;
      frame.contentWindow.postMessage(
        { type: 'zclaudia:design-select-path', channel, elementPath: path },
        '*'
      );
    },
    [channel]
  );

  const handleApply = async (operations: DesignEditOperation[]) => {
    const selection = activePage?.selection;
    if (!selection) return;
    const pathKey = selection.elementPath.join('.');
    // 结构操作不设 mergeKey：每次操作独立成一条撤销记录；其余按 属性/文字 归并。
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
                  : `struct:${operation.action}`
          )
          .join('+')}`;
    const applied = await controller.apply(operations, `编辑元素 ${pathKey}`, mergeKey);
    if (!applied) return;
    // 应用后重选（§6.1/§6.3）：attribute/structure/非颜色 style 需要 iframe 回发 select
    // 消息刷新计算样式并核对 override；纯颜色沿用既有 verify 回路，不动。
    const needsReselect = operations.some(
      operation =>
        operation.kind === 'structure' ||
        operation.kind === 'attribute' ||
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
      reselectRef.current = { elementPath: applied.elementPath, expected };
      verifyRef.current = null;
      return;
    }
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

  /**
   * 组装 §5.1 上下文输入（P4 §5.3）：面板已知页面与修订、活动页选区、
   * 品牌缓存、活动页素材引用 + 本会话导入、视口。两品牌文件都缺失时
   * brand 传 null（section 省略是诚实表现）。
   */
  const buildContextInput = useCallback((): AgentContextInput => {
    const brand = brandRef.current;
    return {
      workingDirectory,
      projectId,
      pages: state.pages.map(page => ({
        path: page.path,
        docRevision: page.docRevision ?? '',
        dirty: page.status === 'dirty',
      })),
      active: activePage
        ? {
            path: activePage.path,
            docRevision: activePage.docRevision ?? '',
            dirty: activePage.status === 'dirty',
            selection: activePage.selection
              ? {
                  tagName: activePage.selection.tagName,
                  elementPath: activePage.selection.elementPath,
                  text: activePage.selection.text,
                  sourceText: activePage.selection.sourceText,
                }
              : null,
          }
        : null,
      brand:
        brand && (brand.designMd !== null || brand.tokensCss !== null)
          ? { designMd: brand.designMd, tokensCss: brand.tokensCss }
          : null,
      assets: {
        referenced: (activePage?.deps ?? [])
          .filter(dep => dep.kind === 'image' || dep.kind === 'font')
          .map(dep => ({ path: dep.path, kind: dep.kind })),
        importedRecently: recentImportsRef.current,
      },
      viewport: { preset: state.ui.viewport.preset, width: state.ui.viewport.width },
    };
  }, [activePage, projectId, state.pages, state.ui.viewport, workingDirectory]);

  const generate = () => {
    const context = buildDesignAgentContext(buildContextInput(), 'generate');
    setContextPreview({ task: 'generate', sections: context.sections, prompt: context.prompt });
  };
  const handoff = () => {
    if (!activePage || !activePage.selection || activePage.status === 'dirty') return;
    const context = buildDesignAgentContext(buildContextInput(), 'modify');
    setContextPreview({ task: 'modify', sections: context.sections, prompt: context.prompt });
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
        previewMode={previewMode}
        onPreviewModeChange={changePreviewMode}
        deckAvailable={deckDetected}
        onDeck={() => setDeckOpen(true)}
        onRenderExport={() => setRenderExportOpen(true)}
        runMode={previewMode === 'run'}
        overviewOpen={overviewOpen}
        onToggleOverview={() => setOverviewOpen(value => !value)}
        treeOpen={treeOpen}
        onToggleTree={() => setTreeOpen(value => !value)}
        onExport={() => setExportOpen(true)}
        onToggleDiff={() => setDraftDiffOpen(true)}
        onTemplates={() => setTemplatesOpen(true)}
        onBrand={() => setBrandOpen(true)}
        onAssets={() => setAssetsOpen(true)}
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
      {runFeedback.status && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          <span>{runFeedback.status.text}</span>
          {[...new Set([...runFeedback.status.diff.addedFiles, ...runFeedback.status.diff.changedPages])].map(
            path => (
              <button
                key={path}
                type="button"
                onClick={() => void controller.open(path)}
                className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-accent"
              >
                {path}
              </button>
            )
          )}
          <button
            type="button"
            aria-label="关闭运行反馈"
            onClick={runFeedback.dismiss}
            className="ml-auto rounded-md px-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            ×
          </button>
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
      {previewMode === 'run' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          <span>运行模式：仅供交互体验，编辑请切回编辑模式</span>
          {runBlocked && runBlocked.scripts + runBlocked.links > 0 && (
            <span>
              {`已移除 ${runBlocked.scripts} 个外部脚本、${runBlocked.links} 个外部链接`}
            </span>
          )}
        </div>
      )}
      {runNotice && (
        <div
          role="status"
          className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          <span>{runNotice.text}</span>
          <button
            type="button"
            aria-label="关闭导航提示"
            onClick={() => setRunNotice(null)}
            className="ml-auto rounded-md px-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            ×
          </button>
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
        {/* P5 运行模式为只读体验：隐藏整个底部编辑区（含结构树与选区编辑器）。 */}
        {previewMode === 'edit' && (
          <div className="max-h-64 min-h-36 shrink-0 overflow-y-auto border-t border-border p-3">
            {treeOpen && (
              <div className="mb-3 overflow-hidden rounded-md border border-border">
                <ElementTree
                  source={activePage?.source ?? ''}
                  selectionPath={activePage?.selection?.elementPath ?? null}
                  onSelectPath={selectPath}
                />
              </div>
            )}
            <SelectionEditor
              selection={activePage?.selection ?? null}
              busy={activePage?.busy ?? false}
              overrideWarning={overrideWarning}
              docSource={activePage?.source ?? null}
              docPath={activePage?.path ?? null}
              dirty={activePage?.status === 'dirty'}
              projectRoot={projectRoot}
              backendId={backendId}
              sessionId={sessionId}
              onSelectPath={selectPath}
              onApply={handleApply}
            />
          </div>
        )}
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
      {contextPreview && (
        <AgentContextPreview
          open
          sections={contextPreview.sections}
          prompt={contextPreview.prompt}
          task={contextPreview.task}
          onClose={() => setContextPreview(null)}
          onConfirm={() => {
            prefill(contextPreview.prompt);
            setContextPreview(null);
          }}
        />
      )}
      {templatesOpen && (
        <TemplateDialog
          open
          backendId={backendId}
          sessionId={sessionId}
          onClose={() => setTemplatesOpen(false)}
          onInstalled={entry => {
            // 安装即刷新文件清单并打开入口页；open 失败由页面 error 呈现（结果忽略）。
            refreshNow();
            void controller.open(entry);
            setTemplatesOpen(false);
          }}
        />
      )}
      {brandOpen && (
        <BrandPanel
          open
          backendId={backendId}
          sessionId={sessionId}
          onClose={() => setBrandOpen(false)}
          onSaved={reloadBrand}
        />
      )}
      {assetsOpen && (
        <AssetLibrary
          open
          backendId={backendId}
          sessionId={sessionId}
          openPages={state.pages.map(page => ({ path: page.path, source: page.source }))}
          referencedAssets={(activePage?.deps ?? []).map(dep => dep.path)}
          activeDocPath={activePage?.path ?? null}
          selection={activePage?.selection ? { tagName: activePage.selection.tagName } : null}
          onApply={handleApply}
          onImported={handleAssetImported}
          onClose={() => setAssetsOpen(false)}
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
      {/* ---- P5 幻灯片面板 / 播放器 / 渲染导出（§5/§6.3）；切页由上方 effect 统一关闭 ---- */}
      {deckOpen && activePage && (
        <DeckPanel
          open
          page={{ path: activePage.path, source: activePage.source, busy: activePage.busy }}
          previewHtml={activePreview || null}
          deck={deckInfo}
          onCommit={(source, label) => controller.applySource(source, label)}
          onPresent={startIndex => setPresentDeck({ startIndex })}
          onClose={() => setDeckOpen(false)}
        />
      )}
      {presentDeck && deckInfo && (
        <DeckPresenter
          slides={deckInfo.slides}
          ratio={deckInfo.ratio}
          previewHtml={activePreview || null}
          startIndex={presentDeck.startIndex}
          onClose={() => setPresentDeck(null)}
        />
      )}
      {renderExportOpen && activePage && (
        <RenderExportDialog
          open
          onClose={() => setRenderExportOpen(false)}
          entryPath={activePage.path}
          previewHtml={activePreview || null}
          deck={deckInfo}
          viewport={state.ui.viewport}
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
