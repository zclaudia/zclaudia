import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../../services/api/unwrap';
import { getDesignDocument, putDesignDocument } from '../api';
import {
  applyCssEdit,
  commitCssDraft,
  dirtyCssPaths,
  discardCssDraft,
  getCssDraft,
  getCssDraftTable,
  openCssDraft,
  subscribeCssDrafts,
} from '../css-drafts';
import type { CssDraftIdentity, CssDraftTableSnapshot } from '../css-drafts';
import { buildStyleRules } from '../css-source';
import type { CssRuleRow, CssSourceEdit } from '../css-source';
import type { DesignPageSnapshot } from '../workspace/controller';
import type { DesignRulesMessage, DesignSelection } from '../types';

/** assetEpoch 分代磁盘 css 缓存的空代表（epoch 不符时 cssDocsForEpoch 退回此值）。 */
const EMPTY_CSS_DOCS: Record<string, { source: string; revision: string }> = {};

const pathsEqual = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export interface UseStyleSourcesOptions {
  backendId: string;
  sessionId: string;
  identity: CssDraftIdentity;
  assetEpoch: number;
  activePage: DesignPageSnapshot | null;
  /** 桥接最新一帧的生效规则载荷（与选区对齐后渲染来源区）。 */
  styleRules: DesignRulesMessage | null;
  activePath: string | null;
  /** 外部 .css 草稿编辑后需要在新预览载入时补发 select-path。 */
  onDraftEdited: (selection: DesignSelection) => void;
  refreshNow: () => void;
}

export interface UseStyleSourcesResult {
  /** 外部 .css 草稿表快照。 */
  cssTable: CssDraftTableSnapshot;
  /** 任一文件存在脏草稿（「Save styles」可用性与导出提示）。 */
  cssDraftDirty: boolean;
  /** 样式来源区渲染模型（行 + 截断标记）。 */
  styleSource: { rows: CssRuleRow[]; truncated: boolean };
  savingStyles: boolean;
  styleConflictPath: string | null;
  styleEditError: string | null;
  confirmCssReloadPath: string | null;
  setConfirmCssReloadPath: (path: string | null) => void;
  setStyleConflictPath: (path: string | null) => void;
  /** 外部 .css 来源的声明编辑：写入进程内草稿（不经 HTML 事务/页面脏点）。 */
  handleApplyExternal: (origin: string, edit: CssSourceEdit) => void;
  /** 逐文件保存脏 CSS 草稿（expectedRevision = 草稿 baseRevision）。 */
  saveStyles: () => Promise<void>;
  /** 冲突动作二（确认后）：丢弃草稿并重新从磁盘拉取。 */
  reloadCssDraftFromDisk: (path: string) => void;
}

/**
 * 外部 .css 草稿与样式来源区（P0 拆分自 DesignPanel，P3.5 第二批逻辑）：
 * 草稿表订阅、磁盘源按 assetEpoch 分代缓存、来源区装配、保存/冲突状态。
 * 所有编辑都落在进程内草稿，预览缓存键随草稿代际变化自动重建。
 */
export function useStyleSources({
  backendId,
  sessionId,
  identity,
  assetEpoch,
  activePage,
  styleRules,
  activePath,
  onDraftEdited,
  refreshNow,
}: UseStyleSourcesOptions): UseStyleSourcesResult {
  const subscribeCssTable = useCallback((listener: () => void) => subscribeCssDrafts(listener), []);
  const getCssTable = useCallback(() => getCssDraftTable(identity), [identity]);
  const cssTable: CssDraftTableSnapshot = useSyncExternalStore(subscribeCssTable, getCssTable);
  const cssDraftDirty = Object.values(cssTable.drafts).some(draft => draft.dirty);

  /**
   * 外部 origin 的磁盘源缓存（按 assetEpoch 分代：deps 轮询发现磁盘 css 变化即
   * 整体失效重取）。草稿存在时样式来源区优先用草稿文本（cssSources 装配处）。
   */
  const [cssDocs, setCssDocs] = useState<{
    epoch: number;
    docs: Record<string, { source: string; revision: string }>;
  }>({ epoch: -1, docs: {} });
  const cssDocsForEpoch = cssDocs.epoch === assetEpoch ? cssDocs.docs : EMPTY_CSS_DOCS;
  const cssDocsInflightRef = useRef(new Set<string>());

  /** 样式来源区的编辑/保存反馈（就地提示与冲突横幅状态）。 */
  const [savingStyles, setSavingStyles] = useState(false);
  const [styleConflictPath, setStyleConflictPath] = useState<string | null>(null);
  const [styleEditError, setStyleEditError] = useState<string | null>(null);
  /** 「Reload from disk」的确认对话框（防误丢草稿）。 */
  const [confirmCssReloadPath, setConfirmCssReloadPath] = useState<string | null>(null);

  /** 规则载荷里的外部 .css origin 路径（去重、保序）。 */
  const externalCssPaths = useMemo(() => {
    const paths: string[] = [];
    for (const rule of styleRules?.rules ?? []) {
      if (!rule.origin.startsWith('@inline/') && !paths.includes(rule.origin))
        paths.push(rule.origin);
    }
    return paths;
  }, [styleRules]);

  // 外部 origin 的磁盘源拉取：缺缓存即取（getDesignDocument 支持 .css），
  // 取回后顺手打开干净草稿（后续编辑的宿主）；失败静默——来源区按只读展示。
  useEffect(() => {
    const epoch = assetEpoch;
    let cancelled = false;
    for (const path of externalCssPaths) {
      if (cssDocsForEpoch[path] || cssDocsInflightRef.current.has(path)) continue;
      cssDocsInflightRef.current.add(path);
      void (async () => {
        try {
          const doc = await getDesignDocument(backendId, sessionId, path);
          if (!cancelled) {
            setCssDocs(prev =>
              prev.epoch === epoch
                ? {
                    epoch: prev.epoch,
                    docs: { ...prev.docs, [path]: { source: doc.source, revision: doc.revision } },
                  }
                : // 首写或代际重建：以本轮 epoch 建缓存（代际前移会重跑 effect 并 cancel 本轮）。
                  { epoch, docs: { [path]: { source: doc.source, revision: doc.revision } } }
            );
            openCssDraft(identity, path, { source: doc.source, revision: doc.revision });
          }
        } catch {
          // 拉取失败：该 origin 维持 external-css-readonly；下轮 rules 到达重试。
        } finally {
          cssDocsInflightRef.current.delete(path);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [externalCssPaths, cssDocsForEpoch, assetEpoch, backendId, sessionId, identity]);

  /**
   * P3.5 §5：样式来源区数据（选区或规则载荷变化即重算）。elementPath 与当前
   * 选区不一致（切页/换选区、迟到载荷）一律清空；computed 取 selection.styles
   * 与顶层 color/backgroundColor 合成（与 reselectMismatch 同一口径）。
   * 第二批：外部 origin 的源文本装配 cssSources——草稿优先（未保存改动即时
   * 可见），否则磁盘缓存；两者皆无的 origin 维持只读。
   */
  const styleSource = useMemo<{ rows: CssRuleRow[]; truncated: boolean }>(() => {
    const selection = activePage?.selection ?? null;
    if (!styleRules || !selection || !pathsEqual(styleRules.elementPath, selection.elementPath)) {
      return { rows: [], truncated: false };
    }
    const computed: Partial<Record<string, string>> = { ...(selection.styles ?? {}) };
    if (typeof selection.color === 'string') computed.color = selection.color;
    if (typeof selection.backgroundColor === 'string')
      computed['background-color'] = selection.backgroundColor;
    const cssSources: Record<string, { source: string; revision: string }> = {};
    for (const rule of styleRules.rules) {
      if (rule.origin.startsWith('@inline/') || cssSources[rule.origin]) continue;
      const draft = cssTable.drafts[rule.origin];
      if (draft) cssSources[rule.origin] = { source: draft.source, revision: draft.revision };
      else {
        const disk = cssDocsForEpoch[rule.origin];
        if (disk) cssSources[rule.origin] = disk;
      }
    }
    return {
      rows: buildStyleRules({
        htmlSource: activePage?.source ?? '',
        matched: styleRules.rules,
        computed,
        inlineStyle: selection.inlineStyle ?? null,
        ...(Object.keys(cssSources).length > 0 ? { cssSources } : {}),
      }),
      truncated: styleRules.truncated ?? false,
    };
  }, [activePage, styleRules, cssTable, cssDocsForEpoch]);

  // 切页时清空样式编辑/保存反馈与确认框（草稿本身进程内保留）。
  useEffect(() => {
    setStyleEditError(null);
    setStyleConflictPath(null);
    setConfirmCssReloadPath(null);
  }, [activePath]);

  /**
   * P3.5 第二批（§6）：外部 .css 来源的声明编辑——applyCssEdit 写入进程内草稿
   * （不经 HTML 事务/页面脏点），预览缓存键随 cssDraftEpoch 变化自动重建，
   * 草稿经 loadPreviewAsset 内联即时可见。错误就地提示（来源区 alert）。
   */
  const handleApplyExternal = (origin: string, edit: CssSourceEdit) => {
    const draft = getCssDraft(identity, origin);
    if (!draft) {
      setStyleEditError(
        `The style source ${origin} is not loaded yet; try again after the rules refresh.`
      );
      return;
    }
    try {
      applyCssEdit(identity, origin, draft.revision, edit);
      setStyleEditError(null);
      // 预览重建后经 frame load 补发 select-path → 新 select → rules-request，
      // 规则区按草稿刷新（同 styleBlock 的 needsReselect 口径；expected 置空不作告警核对）。
      if (activePage?.selection) onDraftEdited(activePage.selection);
    } catch (error) {
      setStyleEditError(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * P3.5 第二批（§6 保存与冲突）：逐文件保存脏 CSS 草稿
   * （putDesignDocument(.css)，expectedRevision = 草稿 baseRevision）。
   * 409 REVISION_CONFLICT → 来源区横幅 + 保留/重新载入两动作；
   * 其余失败显示服务端 message；成功清 dirty 并刷新 baseRevision。
   */
  const saveStyles = async () => {
    if (savingStyles) return;
    const paths = dirtyCssPaths(identity);
    if (paths.length === 0) return;
    setSavingStyles(true);
    setStyleConflictPath(null);
    setStyleEditError(null);
    try {
      for (const path of paths) {
        const draft = getCssDraft(identity, path);
        if (!draft || !draft.dirty) continue;
        try {
          const saved = await putDesignDocument(backendId, {
            sessionId,
            path,
            source: draft.source,
            expectedRevision: draft.baseRevision,
          });
          commitCssDraft(identity, path, { source: saved.source, revision: saved.revision });
          // 磁盘 mtime 变化经 deps 轮询 → assetEpoch 自增；主动刷一轮加快切换到磁盘版。
          refreshNow();
        } catch (error) {
          if (error instanceof ApiError && error.code === 'REVISION_CONFLICT') {
            setStyleConflictPath(path);
          } else {
            setStyleEditError(error instanceof Error ? error.message : String(error));
          }
          break;
        }
      }
    } finally {
      setSavingStyles(false);
    }
  };

  /** 冲突动作二（确认后）：丢弃草稿 → 清该路径磁盘缓存 → 拉取 effect 重取并重开干净草稿。 */
  const reloadCssDraftFromDisk = (path: string) => {
    setConfirmCssReloadPath(null);
    setStyleConflictPath(null);
    setStyleEditError(null);
    discardCssDraft(identity, path);
    setCssDocs(prev =>
      prev.epoch === assetEpoch
        ? {
            epoch: prev.epoch,
            docs: Object.fromEntries(Object.entries(prev.docs).filter(([key]) => key !== path)),
          }
        : prev
    );
  };

  return {
    cssTable,
    cssDraftDirty,
    styleSource,
    savingStyles,
    styleConflictPath,
    styleEditError,
    confirmCssReloadPath,
    setConfirmCssReloadPath,
    setStyleConflictPath,
    handleApplyExternal,
    saveStyles,
    reloadCssDraftFromDisk,
  };
}
