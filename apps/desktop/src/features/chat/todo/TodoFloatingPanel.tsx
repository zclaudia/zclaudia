import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Minus,
  Square,
  XCircle,
} from 'lucide-react';
import type { NormalizedTodoItem } from '@zclaudia/shared/interaction/forms';
import { IconButton } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useInteractionStore } from '../../../stores/interactionStore';
import { useUIStore } from '../../../stores/uiStore';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../stores/runStore';
import { UsageRing } from '../UsageRing';
import { findLatestTodoSnapshot, summarizeTodos } from './todoSnapshot';

const COLLAPSED_KEY = 'zclaudia:todo-panel:collapsed';
const OFFSET_KEY = 'zclaudia:todo-panel:offset';
const EDGE = 8;
const DEFAULT_OFFSET = { top: EDGE, right: 12 };

type Offset = { top: number; right: number };

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

function TodoStatusIcon({ status }: { status: NormalizedTodoItem['status'] }) {
  const common = { size: 14, strokeWidth: 1.75, className: 'flex-shrink-0 mt-[3px]' };
  switch (status) {
    case 'completed':
      return <CheckCircle2 {...common} className={`${common.className} text-success`} />;
    case 'in_progress':
      return <Loader2 {...common} className={`${common.className} animate-spin text-primary`} />;
    case 'cancelled':
      return <XCircle {...common} className={`${common.className} text-muted-foreground/60`} />;
    default:
      return <Square {...common} className={`${common.className} text-muted-foreground`} />;
  }
}

function TodoRow({ todo }: { todo: NormalizedTodoItem }) {
  const text =
    todo.status === 'completed'
      ? 'text-muted-foreground line-through'
      : todo.status === 'cancelled'
        ? 'text-muted-foreground/60 line-through'
        : todo.status === 'in_progress'
          ? 'text-foreground font-medium'
          : 'text-foreground';
  return (
    <li
      data-status={todo.status}
      className={`flex items-start gap-2 rounded-md px-2 py-1 text-xs leading-5 ${
        todo.status === 'in_progress' ? 'bg-secondary' : ''
      }`}
    >
      <TodoStatusIcon status={todo.status} />
      <span className={`min-w-0 break-words ${text}`}>{todo.content}</span>
    </li>
  );
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
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; start: Offset } | null>(null);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    persist(COLLAPSED_KEY, next ? '1' : '0');
  }, []);

  const clampOffset = useCallback((next: Offset): Offset => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return next;
    const maxTop = Math.max(EDGE, parent.clientHeight - panel.offsetHeight - EDGE);
    const maxRight = Math.max(EDGE, parent.clientWidth - panel.offsetWidth - EDGE);
    return {
      top: Math.min(Math.max(EDGE, next.top), maxTop),
      right: Math.min(Math.max(EDGE, next.right), maxRight),
    };
  }, []);

  const onDragStart = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (isMobile || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = { x: e.clientX, y: e.clientY, start: offset };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isMobile, offset]
  );

  const onDragMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset(
        clampOffset({
          top: drag.start.top + (e.clientY - drag.y),
          right: drag.start.right - (e.clientX - drag.x),
        })
      );
    },
    [clampOffset]
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

  const position = isMobile ? { top: EDGE, right: EDGE } : offset;
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
        ref={panelRef}
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
      ref={panelRef}
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
