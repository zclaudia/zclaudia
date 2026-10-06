import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, GripVertical, Minus } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useInteractionStore } from '../../../stores/interactionStore';
import { useUIStore } from '../../../stores/uiStore';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../stores/runStore';
import { UsageRing } from '../UsageRing';
import {
  clampOffset,
  findLatestTodoSnapshot,
  summarizeTodos,
  TODO_PANEL_EDGE as EDGE,
  type Bounds,
  type Offset,
} from './todoSnapshot';
import { TodoRow } from './TodoRow';

const COLLAPSED_KEY = 'zclaudia:todo-panel:collapsed';
const OFFSET_KEY = 'zclaudia:todo-panel:offset';
const DEFAULT_OFFSET = { top: EDGE, right: 12 };

function readCollapsed(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function readOffset(): Offset {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFSET_KEY) ?? 'null');
    if (typeof parsed?.top === 'number' && typeof parsed?.right === 'number') return parsed;
  } catch {
    // Unreadable storage falls back to the default corner.
  }
  return DEFAULT_OFFSET;
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Position and collapse state are conveniences; losing them is harmless.
  }
}

interface TodoFloatingPanelProps {
  sessionId: string;
  messages: MessageWithToolCalls[];
  liveToolCalls: ToolCallState[];
  isRunning: boolean;
}

/**
 * The session's current task list, floating over the top-right of the chat
 * pane. Expanded it shows every step; collapsed it shrinks to a progress pill.
 * Shown while the run is going, and after it only if the latest turn left
 * steps unfinished — old sessions don't resurface stale lists.
 */
export function TodoFloatingPanel({
  sessionId,
  messages,
  liveToolCalls,
  isRunning,
}: TodoFloatingPanelProps) {
  const isMobile = useIsMobile();
  const interactions = useInteractionStore(s => s.interactions);
  const requestMessageJump = useUIStore(s => s.requestMessageJump);
  const snapshot = useMemo(
    () => findLatestTodoSnapshot({ sessionId, messages, liveToolCalls, interactions }),
    [sessionId, messages, liveToolCalls, interactions]
  );
  const summary = useMemo(() => summarizeTodos(snapshot?.todos ?? []), [snapshot]);

  const [collapsed, setCollapsed] = useState(() => readCollapsed(isMobile));
  const [showCompleted, setShowCompleted] = useState(false);
  const [offset, setOffset] = useState<Offset>(readOffset);
  const offsetRef = useRef(offset);
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; start: Offset } | null>(null);

  // `offset` is where the user put the panel; what's drawn is that, pulled
  // back inside the pane. Re-measured whenever the panel grows (completed
  // steps revealed, collapse/expand) or the pane shrinks, so the remembered
  // spot survives a temporarily small window.
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measure = useCallback(() => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const next = {
      maxTop: parent.clientHeight - panel.offsetHeight - EDGE,
      maxRight: parent.clientWidth - panel.offsetWidth - EDGE,
    };
    setBounds(prev =>
      prev && prev.maxTop === next.maxTop && prev.maxRight === next.maxRight ? prev : next
    );
  }, []);
  const setPanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      panelRef.current = node;
      if (!node || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      if (node.offsetParent) observer.observe(node.offsetParent);
      observerRef.current = observer;
      measure();
    },
    [measure]
  );
  const displayed = clampOffset(offset, bounds);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    persist(COLLAPSED_KEY, next ? '1' : '0');
  }, []);

  const onDragStart = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (isMobile || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      // Start from where it's drawn, so a clamped panel doesn't jump on grab.
      dragRef.current = { x: e.clientX, y: e.clientY, start: displayed };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isMobile, displayed]
  );

  const onDragMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset(
        clampOffset(
          {
            top: drag.start.top + (e.clientY - drag.y),
            right: drag.start.right - (e.clientX - drag.x),
          },
          bounds
        )
      );
    },
    [bounds]
  );

  const onDragEnd = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    persist(OFFSET_KEY, JSON.stringify(offsetRef.current));
  }, []);

  if (!snapshot) return null;
  if (!isRunning && (summary.allDone || !snapshot.fromLatestTurn)) return null;

  const position = isMobile ? { top: EDGE, right: EDGE } : displayed;
  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
  };

  if (collapsed) {
    const label = summary.allDone
      ? `All ${summary.total} tasks done`
      : (summary.current?.content ?? 'Tasks');
    return (
      <div
        ref={setPanelRef}
        className="absolute z-10"
        style={position}
        data-testid="todo-floating-panel"
        data-state="collapsed"
      >
        <button
          type="button"
          onClick={() => setCollapsedPersisted(false)}
          aria-label={`Show task list, ${summary.done} of ${summary.total} done`}
          className="flex h-7 max-w-[min(18rem,calc(100vw-2rem))] items-center gap-2 rounded-full border border-border bg-popover pl-1.5 pr-2.5 text-xs text-foreground shadow-lg transition-colors hover:bg-secondary max-md:h-9"
        >
          {summary.allDone ? (
            <CheckCircle2 size={16} strokeWidth={1.75} className="flex-shrink-0 text-success" />
          ) : (
            <UsageRing
              ratio={summary.total > 0 ? summary.done / summary.total : 0}
              className="flex-shrink-0 text-primary"
            />
          )}
          <span className="min-w-0 truncate">{label}</span>
          {!summary.allDone && (
            <span className="flex-shrink-0 tabular-nums text-muted-foreground">
              {summary.done}/{summary.total}
            </span>
          )}
        </button>
      </div>
    );
  }

  const completedCount = snapshot.todos.filter(t => t.status === 'completed').length;
  const foldCompleted = completedCount > 0 && !showCompleted;
  const visible = snapshot.todos
    .map((todo, index) => ({ todo, index }))
    .filter(({ todo }) => !foldCompleted || todo.status !== 'completed');
  const ratio = summary.total > 0 ? summary.done / summary.total : 0;
  const messageId = snapshot.messageId;

  return (
    <div
      ref={setPanelRef}
      className="absolute z-10 flex w-[min(18rem,calc(100%-1rem))] flex-col rounded-xl border border-border bg-popover shadow-lg"
      style={position}
      data-testid="todo-floating-panel"
      data-state="expanded"
      role="region"
      aria-label="Task list"
    >
      <div
        className={`flex items-center gap-1.5 pl-2 pr-1 pt-1.5 pb-1 ${
          isMobile ? '' : 'cursor-grab active:cursor-grabbing select-none touch-none'
        }`}
        {...dragHandlers}
      >
        {!isMobile && (
          <GripVertical
            size={13}
            strokeWidth={1.75}
            className="flex-shrink-0 text-muted-foreground/60"
            aria-hidden
          />
        )}
        <span className="text-xs font-medium text-foreground">Tasks</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {summary.done} of {summary.total}
        </span>
        <span className="flex-1" />
        <Tooltip content="Collapse">
          <IconButton
            size="sm"
            aria-label="Collapse task list"
            onClick={() => setCollapsedPersisted(true)}
          >
            <Minus size={14} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="mx-2.5 mb-1.5 h-0.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <div className="max-h-[min(50vh,22rem)] overflow-y-auto px-1 pb-1">
        {completedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowCompleted(v => !v)}
            aria-expanded={showCompleted}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {showCompleted ? (
              <ChevronDown size={14} strokeWidth={1.75} className="flex-shrink-0" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} className="flex-shrink-0" />
            )}
            <span>{showCompleted ? 'Hide completed' : `${completedCount} completed`}</span>
          </button>
        )}
        <ul className="space-y-0.5">
          {visible.map(({ todo, index }) => (
            <TodoRow key={index} todo={todo} />
          ))}
        </ul>
      </div>

      {messageId && (
        <div className="flex justify-end border-t border-border px-1 py-1">
          <button
            type="button"
            onClick={() => requestMessageJump(sessionId, messageId)}
            className="h-6 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Show in chat
          </button>
        </div>
      )}
    </div>
  );
}
