import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Play } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { TONE_DOT } from '../../../components/ui/tone';
import { ancestorsOf } from './breadcrumb';
import type { DesignRightTab } from '../stores/designLayoutStore';
import type { DesignSelection } from '../types';

export interface InspectorProps {
  selection: DesignSelection | null;
  docSource: string | null;
  rightTab: DesignRightTab;
  onRightTabChange: (tab: DesignRightTab) => void;
  onSelectPath: (path: number[]) => void;
  collapsedSections: Record<string, boolean>;
  onToggleSection: (id: string, collapsed: boolean) => void;
  dirty: boolean;
  runMode: boolean;
  /** 窄档底部面板的抓手。 */
  narrow?: boolean;
  /** 窄档底部面板是否折叠为 76px peek。 */
  collapsed?: boolean;
  /** 窄档展开/收起底部面板。 */
  onToggleCollapsed?: () => void;
  design: ReactNode;
  styles: ReactNode;
  history: ReactNode;
}

const TABS: Array<{ id: DesignRightTab; label: string }> = [
  { id: 'design', label: 'Design' },
  { id: 'styles', label: 'Styles' },
  { id: 'history', label: 'History' },
];

/**
 * 右侧检查器（P1 §4.5）：面包屑头部 + Design / Styles / History 页签 +
 * 滚动体。三个页签内容都保持挂载（非当前页签 hidden），切页签不丢表单值；
 * History 首次访问后才挂载（避免未使用时的版本列表请求）。
 * 运行模式下整个检查器只显示一句只读说明。
 */
export function Inspector({
  selection,
  docSource,
  rightTab,
  onRightTabChange,
  onSelectPath,
  dirty,
  runMode,
  narrow = false,
  collapsed = false,
  onToggleCollapsed,
  design,
  styles,
  history,
}: InspectorProps) {
  const [historyMounted, setHistoryMounted] = useState(false);
  useEffect(() => {
    if (rightTab === 'history') setHistoryMounted(true);
  }, [rightTab]);

  const crumbs = selection && docSource ? ancestorsOf(docSource, selection.elementPath) : [];
  const title = selection ? selection.tagName : 'Inspector';
  const peeked = narrow && collapsed;
  const parentDisabled = !selection || selection.elementPath.length === 0;

  return (
    <aside
      data-testid="design-inspector"
      aria-label="Inspector"
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      {peeked ? (
        <button
          type="button"
          aria-label="Expand inspector"
          onClick={onToggleCollapsed}
          className="flex h-full w-full flex-col items-center gap-1.5 px-3 pt-1.5 text-left"
        >
          <span aria-hidden className="h-1 w-9 shrink-0 rounded-full bg-border" />
          <span className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="font-mono">{title}</span>
            <span className="text-[10px]">Tap to edit</span>
          </span>
        </button>
      ) : (
        <>
          {narrow && (
            <button
              type="button"
              aria-label="Collapse inspector"
              onClick={onToggleCollapsed}
              className="mx-auto mt-1.5 h-1 w-9 shrink-0 rounded-full bg-border"
            />
          )}
          <div className="flex shrink-0 items-start gap-2 border-b border-border px-3 pb-2 pt-2.5">
            <div className="min-w-0 flex-1">
              {crumbs.length > 0 && !narrow ? (
                <div className="flex flex-wrap items-center gap-0.5 font-mono text-[11px] text-muted-foreground">
                  {crumbs.map((segment, index) => {
                    const last = index === crumbs.length - 1;
                    return (
                      <span
                        key={segment.path.join('.') || 'body'}
                        className="inline-flex items-center gap-0.5"
                      >
                        {index > 0 && (
                          <span aria-hidden className="px-0.5 opacity-50">
                            ›
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Select ${segment.label}`}
                          aria-current={last ? 'true' : undefined}
                          onClick={() => onSelectPath(segment.path)}
                          className={`max-w-[150px] truncate rounded px-0.5 transition-colors hover:bg-secondary hover:text-foreground ${
                            last ? 'font-medium text-foreground' : ''
                          }`}
                        >
                          {segment.label}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="min-w-0 truncate text-[13px] font-semibold">{title}</span>
                {selection && (
                  <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                    {selection.elementPath.join('.')}
                  </span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              aria-label="Parent"
              className="shrink-0"
              disabled={parentDisabled}
              onClick={() => {
                if (selection) onSelectPath(selection.elementPath.slice(0, -1));
              }}
            >
              Parent
            </Button>
          </div>

          {runMode ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary">
                <Play size={16} strokeWidth={1.75} />
              </span>
              <div className="text-[13px] font-semibold text-foreground">Run mode</div>
              <p className="text-xs leading-relaxed">
                Interaction only — switch back to Edit mode to make changes.
              </p>
            </div>
          ) : (
            <div
              role="tablist"
              aria-label="Inspector tabs"
              className="flex shrink-0 gap-0.5 border-b border-border px-2 pt-1.5"
            >
              {TABS.map(tab => {
                const active = rightTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onRightTabChange(tab.id)}
                    className={`-mb-px inline-flex h-7 items-center gap-1 border-b-2 px-2 text-[12px] transition-colors ${
                      active
                        ? 'border-foreground font-medium text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                    {tab.id === 'history' && dirty && (
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONE_DOT.warning}`} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {/* Peek and run mode hide the form; they must not unmount it (pending edits live in state). */}
      <div hidden={peeked || runMode} className="min-h-0 flex-1 overflow-auto">
        <div hidden={rightTab !== 'design'}>{design}</div>
        <div hidden={rightTab !== 'styles'} className="p-3">
          {styles}
        </div>
        {historyMounted && (
          <div hidden={rightTab !== 'history'} className="p-3">
            {history}
          </div>
        )}
      </div>
    </aside>
  );
}
