import { useCallback, useEffect, useRef, useState } from 'react';
import { getDesignAsset } from '../api';
import { encodeBase64Utf8, getCssDraft } from '../css-drafts';
import type { CssDraftIdentity } from '../css-drafts';
import { buildDesignRunPreview } from '../interactive';
import { buildDesignPreview } from '../preview';
import type { DesignPageSnapshot } from '../workspace/controller';

/** 面板级预览缓存上限（LRU；键 path → {key, html, blocked?}）。 */
const PREVIEW_CACHE_MAX = 8;
/** 总览缩略图惰性构建的并发上限。 */
const PREVIEW_MAX_CONCURRENT = 2;

/** 运行构建结果里被移除的远程引用计数（状态行展示）。 */
export interface RunBlockedCount {
  scripts: number;
  links: number;
}

export interface UsePreviewPipelineOptions {
  pages: DesignPageSnapshot[];
  activePage: DesignPageSnapshot | null;
  assetEpoch: number;
  previewMode: 'edit' | 'run';
  /** CSS 草稿表的代际（草稿编辑后预览需要重建）。 */
  cssDraftEpoch: number;
  backendId: string;
  sessionId: string;
  identity: CssDraftIdentity;
  channel: string;
}

export interface UsePreviewPipelineResult {
  /** 构建（或复用）一页的预览串；front=true 时插队（活动页优先）。 */
  ensurePreview: (page: DesignPageSnapshot, front?: boolean) => void;
  /** 已构建完成的预览（path → srcdoc），随构建完成逐格补充。 */
  previews: Record<string, string>;
  /** 活动页当前可用的预览串；未构建完成时为空串。 */
  activePreview: string;
  /** 运行模式下被移除的远程引用计数；非运行模式或未构建时 null。 */
  runBlocked: RunBlockedCount | null;
}

/**
 * 预览缓存与并发队列（P0 拆分自 DesignPanel）：
 * - LRU ≤8，键含 draftRevision / assetEpoch / previewMode / cssDraftEpoch；
 * - 队列并发 ≤2，活动页可插队；
 * - 预览资产装载优先读 CSS 草稿（未保存改动即时可见），否则读磁盘。
 */
export function usePreviewPipeline({
  pages,
  activePage,
  assetEpoch,
  previewMode,
  cssDraftEpoch,
  backendId,
  sessionId,
  identity,
  channel,
}: UsePreviewPipelineOptions): UsePreviewPipelineResult {
  const previewCacheRef = useRef(
    new Map<string, { key: string; html: string; blocked?: RunBlockedCount }>()
  );
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

  /**
   * P3.5 第二批（§6）：预览资产装载包装——路径存在 CSS 草稿时直接返回草稿文本
   * （utf8 → base64，mime text/css），在 getDesignAsset（磁盘版）之前拦截；
   * 预览构建器经 loadInlineAsset/resolveAsset 走到这里的路径即被草稿替换。
   */
  const loadPreviewAsset = useCallback(
    async (assetPath: string) => {
      const draft = getCssDraft(identity, assetPath);
      if (draft) return { mimeType: 'text/css', data: encodeBase64Utf8(draft.source) };
      return getDesignAsset(backendId, sessionId, assetPath);
    },
    [backendId, identity, sessionId]
  );

  const ensurePreview = useCallback(
    (page: DesignPageSnapshot, front = false) => {
      // 尚未载入磁盘文档的页（draftRevision 为空）不构建空预览：等文档到达后再建，
      // 与拆分前 `!activePreviewKey` 的跳过口径一致。
      if (!page.draftRevision) return;
      const key = `${page.draftRevision}:${assetEpoch}:${previewMode}:${cssDraftEpoch}`;
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
              loadAsset: loadPreviewAsset,
              channel,
            });
            cachePreview(page.path, key, result.html, result.blocked);
          } else {
            const html = await buildDesignPreview(
              page.source,
              page.path,
              loadPreviewAsset,
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
    [assetEpoch, cachePreview, channel, cssDraftEpoch, loadPreviewAsset, previewMode, pumpPreviews]
  );

  // 活动页预览：effect 依赖 (activePath, draftRevision, assetEpoch, mode, cssDraftEpoch)；缓存命中直接用。
  const activePreviewKey = activePage?.draftRevision
    ? `${activePage.draftRevision}:${assetEpoch}:${previewMode}:${cssDraftEpoch}`
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
  for (const page of pages) {
    if (!page.draftRevision) continue;
    const key = `${page.draftRevision}:${assetEpoch}:${previewMode}:${cssDraftEpoch}`;
    const cached = previewCacheRef.current.get(page.path);
    if (cached && cached.key === key) previews[page.path] = cached.html;
  }

  return { ensurePreview, previews, activePreview, runBlocked };
}
