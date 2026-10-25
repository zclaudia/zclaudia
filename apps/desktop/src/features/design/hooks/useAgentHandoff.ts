import { useCallback, useEffect, useRef, useState } from 'react';
import { useComposerStore } from '../../../stores/composerStore';
import { getDesignBrand } from '../api';
import type { DesignBrand } from '../api';
import { buildDesignAgentContext } from '../agent-context';
import type { AgentContextInput, AgentContextTask } from '../agent-context';
import type { DesignPageSnapshot } from '../workspace/controller';
import type { DesignViewport } from '../types';

export interface AgentContextPayload {
  task: AgentContextTask;
  sections: ReturnType<typeof buildDesignAgentContext>['sections'];
  prompt: string;
}

export interface UseAgentHandoffOptions {
  sessionId: string;
  backendId: string;
  workingDirectory?: string;
  projectId?: string;
  pages: DesignPageSnapshot[];
  activePage: DesignPageSnapshot | null;
  viewport: DesignViewport;
  /** 素材导入后让下一轮轮询尽快刷新 assetEpoch。 */
  refreshNow: () => void;
}

export interface UseAgentHandoffResult {
  /** 品牌缓存重拉（BrandPanel 保存成功后调用）。 */
  reloadBrand: () => void;
  /** 本面板会话内最近导入的素材路径（≤10）。 */
  handleAssetImported: (path: string) => void;
  /** 组装 §5.1 上下文输入（面板已知页面与修订、活动页选区、品牌、素材、视口）。 */
  buildContextInput: () => AgentContextInput;
  /** 页面上下文：有活动页时指向该页，真正空白工作台回退 design/index.html。 */
  generate: () => AgentContextPayload;
  /** 「交给 Agent 修改」上下文（选中元素）；无选区或 dirty 时返回 null（沿用既有禁用规则）。 */
  handoff: () => AgentContextPayload | null;
  /** 把完整指令预填进当前聊天（保留用户确认后发送的语义）。 */
  prefill: (content: string) => void;
  /** 预填提示条是否显示（P0 保持既有整行横幅；P1 起迁入 NoticeStack）。 */
  prefillNotice: boolean;
}

/**
 * Agent 交接上下文（P0 拆分自 DesignPanel，P4 §5.3）：品牌缓存、本会话
 * 最近导入素材、上下文输入装配、generate/handoff 两个任务入口与 prefill。
 * 只组装与预填，不发送；发送前用户仍可在聊天输入框检查内容。
 */
export function useAgentHandoff({
  sessionId,
  backendId,
  workingDirectory,
  projectId,
  pages,
  activePage,
  viewport,
  refreshNow,
}: UseAgentHandoffOptions): UseAgentHandoffResult {
  const [prefillNotice, setPrefillNotice] = useState(false);

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

  const buildContextInput = useCallback((): AgentContextInput => {
    const brand = brandRef.current;
    return {
      workingDirectory,
      projectId,
      pages: pages.map(page => ({
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
      viewport: { preset: viewport.preset, width: viewport.width },
    };
  }, [activePage, pages, projectId, viewport, workingDirectory]);

  const generate = useCallback((): AgentContextPayload => {
    const context = buildDesignAgentContext(buildContextInput(), 'generate');
    return { task: 'generate', sections: context.sections, prompt: context.prompt };
  }, [buildContextInput]);

  const handoff = useCallback((): AgentContextPayload | null => {
    if (!activePage || !activePage.selection || activePage.status === 'dirty') return null;
    const context = buildDesignAgentContext(buildContextInput(), 'modify');
    return { task: 'modify', sections: context.sections, prompt: context.prompt };
  }, [activePage, buildContextInput]);

  const prefill = useCallback(
    (content: string) => {
      const composer = useComposerStore.getState();
      const existing =
        composer.pendingPrefills[sessionId]?.content ?? composer.drafts[sessionId]?.content ?? '';
      const combined = existing.trim() ? `${existing.trimEnd()}\n\n${content}` : content;
      composer.setPendingPrefill(sessionId, combined);
      setPrefillNotice(true);
    },
    [sessionId]
  );

  return {
    reloadBrand,
    handleAssetImported,
    buildContextInput,
    generate,
    handoff,
    prefill,
    prefillNotice,
  };
}
