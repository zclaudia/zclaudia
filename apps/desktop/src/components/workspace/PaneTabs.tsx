import { Fragment, useState, useRef, useEffect, useCallback } from 'react';
import { X, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useRightWorkspaceStore,
  type PaneNode,
  type ToolRef,
} from '../../stores/rightWorkspaceStore';
import { usePluginStore } from '../../stores/pluginStore';
import { iconForPanel } from '../rightSidebarToolIcons';
import { closeTabInWorkspace } from '../../utils/workspaceActions';
import { ToolLauncherMenu } from './ToolLauncherMenu';
import { PanelActions } from '../panels/PanelRenderer';
import { useDragSplitStore } from './dragSplit';
import { MULTI_INSTANCE_PANELS } from '../../stores/panelInstance';

interface PaneTabsProps {
  sessionId: string;
  pane: PaneNode;
  focused: boolean;
  projectId?: string;
}

export function PaneTabs({ sessionId, pane, focused, projectId }: PaneTabsProps) {
  const panels = usePluginStore(s => s.panels);
  const hoverTabPaneId = useDragSplitStore(s => s.hoverTabPaneId);
  const hoverTabIndex = useDragSplitStore(s => s.hoverTabIndex);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherRef = useRef<HTMLDivElement>(null);

  // Soft fade at the tab-list edges when tabs overflow (e.g. a narrow pane), so the
  // scrolled-off tabs melt into the trailing action area instead of hard-cutting.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pane.tools.length, updateScrollState]);
  // No-wheel affordance: chevron buttons on the overflow edges scroll the tab list
  // by roughly a page so tabs stay reachable without a scroll wheel / trackpad.
  const scrollByStep = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  };
  const maskStyle =
    canScroll.left || canScroll.right
      ? {
          maskImage: `linear-gradient(to right, ${canScroll.left ? 'transparent, black 16px' : 'black'}, ${canScroll.right ? 'black calc(100% - 16px), transparent' : 'black'})`,
          WebkitMaskImage: `linear-gradient(to right, ${canScroll.left ? 'transparent, black 16px' : 'black'}, ${canScroll.right ? 'black calc(100% - 16px), transparent' : 'black'})`,
        }
      : undefined;

  const activePanel = panels.find(p => p.id === pane.activeToolId);

  const onActivate = (ref: ToolRef) =>
    useRightWorkspaceStore
      .getState()
      .setActiveTool(sessionId, pane.id, ref.toolId, ref.instanceKey);

  const onClose = (e: React.MouseEvent, ref: ToolRef) => {
    e.stopPropagation();
    closeTabInWorkspace(sessionId, pane.id, ref.toolId, ref.instanceKey);
  };

  return (
    <div
      data-tab-strip
      data-pane-id={pane.id}
      className={`flex items-stretch px-1 h-8 border-b border-border/50 flex-shrink-0 select-none ${focused ? '' : 'opacity-90'}`}
    >
      {/* Only the tab list scrolls; the launcher + drag spacer stay outside so the
          launcher dropdown isn't clipped by overflow (overflow-x:auto → overflow-y:auto).
          The relative wrapper hosts the edge chevrons that overlay the faded edges. */}
      <div className="relative flex min-w-0">
        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          style={maskStyle}
          className="flex items-stretch gap-0.5 min-w-0 flex-1 overflow-x-auto scrollbar-hidden"
        >
          {pane.tools.map((ref, index) => {
            const panel = panels.find(p => p.id === ref.toolId);
            const Icon = iconForPanel(ref.toolId);
            const isActive =
              ref.toolId === pane.activeToolId && ref.instanceKey === pane.activeInstanceKey;
            const label = panel?.label ?? ref.toolId;
            return (
              <Fragment key={`${ref.toolId}:${ref.instanceKey ?? ''}`}>
                {hoverTabPaneId === pane.id && hoverTabIndex === index && (
                  <div className="w-0.5 my-1.5 rounded bg-foreground/60 flex-shrink-0" />
                )}
                <div
                  data-tab-index={index}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => onActivate(ref)}
                  onPointerDown={e => {
                    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
                    useDragSplitStore.getState().startDrag({
                      toolId: ref.toolId,
                      instanceKey: ref.instanceKey,
                      multiInstance: MULTI_INSTANCE_PANELS.has(ref.toolId),
                      sourcePaneId: pane.id,
                      sourceIndex: index,
                    });
                  }}
                  className={`group flex items-center gap-1.5 px-2.5 cursor-pointer max-w-[140px] ${
                    isActive
                      ? 'text-foreground shadow-[inset_0_-2px_0_hsl(var(--muted-foreground))]'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={label}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                  <span className="text-xs truncate">{label}</span>
                  <button
                    aria-label={`Close ${label}`}
                    onClick={e => onClose(e, ref)}
                    onPointerDown={e => e.stopPropagation()}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </Fragment>
            );
          })}
          {hoverTabPaneId === pane.id && hoverTabIndex === pane.tools.length && (
            <div className="w-0.5 my-1.5 rounded bg-foreground/60 flex-shrink-0" />
          )}
        </div>
        {canScroll.left && (
          <button
            aria-label="Scroll tabs left"
            title="Scroll tabs left"
            onClick={() => scrollByStep(-1)}
            className="absolute inset-y-0 left-0 z-10 flex items-center pl-0.5 pr-2 bg-gradient-to-r from-card via-card/90 to-transparent text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {canScroll.right && (
          <button
            aria-label="Scroll tabs right"
            title="Scroll tabs right"
            onClick={() => scrollByStep(1)}
            className="absolute inset-y-0 right-0 z-10 flex items-center pr-0.5 pl-2 bg-gradient-to-l from-card via-card/90 to-transparent text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="relative flex items-center" ref={launcherRef}>
        <button
          aria-label="Add tool"
          title="Add tool"
          onClick={() => {
            useRightWorkspaceStore.getState().focusPane(sessionId, pane.id);
            setLauncherOpen(v => !v);
          }}
          className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        {launcherOpen && (
          <ToolLauncherMenu
            sessionId={sessionId}
            projectId={projectId}
            anchorRef={launcherRef}
            onPick={() => setLauncherOpen(false)}
          />
        )}
      </div>

      {/* Trailing empty area: drags the OS window (the strip is now the topmost row). */}
      <div className="flex-1 self-stretch" data-tauri-drag-region />

      {/* Active tool's action buttons (search, reload, …) — re-homed here from the
          old per-pane header that the tab strip replaced. */}
      {activePanel?.actions ? (
        <div data-pane-actions className="ml-auto flex items-center flex-shrink-0 pr-0.5">
          <PanelActions panel={activePanel} projectId={projectId} />
        </div>
      ) : null}
    </div>
  );
}
