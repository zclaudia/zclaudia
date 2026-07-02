import { useState, useRef, useLayoutEffect, useEffect, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePluginStore, selectPluginPanels } from '../../stores/pluginStore';
import { openToolInWorkspace } from '../../utils/workspaceActions';
import { useServerStore } from '../../stores/serverStore';
import { iconForPanel } from '../rightSidebarToolIcons';

interface Props {
  sessionId: string;
  projectId?: string;
  /** The element the menu anchors to (the + button's container). */
  anchorRef: RefObject<HTMLElement | null>;
  onPick: () => void;
}

const GAP = 4;
const MARGIN = 8;

export function ToolLauncherMenu({ sessionId, projectId, anchorRef, onPick }: Props) {
  const panels = usePluginStore(selectPluginPanels);
  const disabled = usePluginStore(s => s.disabledBuiltinPanels);
  const backendId = useServerStore(s => s.activeServerId);
  const tools = panels.filter(
    p =>
      (p.platforms ?? ['desktop']).includes('desktop') &&
      !disabled.includes(p.id) &&
      !p.hideFromLauncher
  );

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Anchor under the + button, flipping at the viewport edges. Rendered in a
  // portal (position: fixed) so the narrow panel's overflow can't clip it.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!a || !m) return;
      const mw = m.offsetWidth;
      const mh = m.offsetHeight;
      let left = a.left; // left-align to the anchor…
      if (left + mw > window.innerWidth - MARGIN) left = Math.max(MARGIN, a.right - mw); // …else right-align
      let top = a.bottom + GAP; // below the anchor…
      if (top + mh > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - GAP - mh); // …else above
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, tools.length]);

  // Close on outside press. The menu is portaled, so exclude both it and the anchor.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onPick();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onPick]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-50 min-w-44 rounded-md border border-border bg-popover py-1 shadow-md"
    >
      {tools.map(t => {
        const Icon = iconForPanel(t.id);
        return (
          <button
            key={t.id}
            role="menuitem"
            onClick={() => {
              openToolInWorkspace(sessionId, t.id, { projectId, backendId });
              onPick();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
          >
            <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
