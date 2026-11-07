import { useState, useEffect, useLayoutEffect, useRef, memo } from 'react';
import { type ToolCallState } from '../../../stores/runStore';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { formatToolInput } from './toolFormatters';
import { getToolCallSummary } from '../../../config/toolCallSummary';
import { ToolCallItem } from '../ToolCallItem';

interface ToolCallListProps {
  toolCalls: ToolCallState[];
  defaultCollapsed?: boolean;
  isStreaming?: boolean;
}

// Get status icon as Lucide component
function getStatusIconComponent(status: ToolCallState['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={10} className="text-success" />;
    case 'error':
      return <XCircle size={10} className="text-destructive" />;
    case 'running':
      return <Loader2 size={10} className="animate-spin text-primary" />;
    default:
      return null;
  }
}

function getToolCallDisplayStatus(tc: ToolCallState): ToolCallState['status'] {
  // AskUserQuestion reports normal user answers through the provider's error path.
  // Match ToolCallItem's non-destructive rendering in collapsed summaries.
  if (tc.toolName === 'AskUserQuestion' && tc.status === 'error') {
    return 'completed';
  }
  return tc.status;
}

const MAX_VISIBLE_TOOLS = 5;
// `gap-1.5` at the default 16px root font size.
const SUMMARY_CHIP_GAP_PX = 6;

interface SummaryChip {
  id: string;
  status: ToolCallState['status'];
  summary: string;
  toolCall: ToolCallState;
}

function SummaryChipBadge({ chip, title }: { chip: SummaryChip; title?: string }) {
  return (
    <span
      data-summary-chip
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] ${
        chip.status === 'error'
          ? 'bg-destructive/20 text-destructive'
          : chip.status === 'running'
            ? 'bg-muted text-primary'
            : 'bg-secondary text-muted-foreground'
      }`}
    >
      <span>{getStatusIconComponent(chip.status)}</span>
      <span className="truncate max-w-[120px]">{chip.summary}</span>
    </span>
  );
}

/**
 * How many summary chips fit on a single line, leaving room for the ellipsis
 * whenever chips after the last one would be hidden.
 */
function fitSummaryChipCount(
  widths: readonly number[],
  moreWidth: number,
  available: number,
  totalCount: number,
  gap: number = SUMMARY_CHIP_GAP_PX
): number {
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = count === 0 ? width : used + gap + width;
    const hidesMore = totalCount > count + 1;
    const reserved = hidesMore ? gap + moreWidth : 0;
    if (next + reserved > available) break;
    used = next;
    count += 1;
  }
  return count;
}

function SummaryBar({ toolCalls, onClick }: { toolCalls: ToolCallState[]; onClick: () => void }) {
  const completedCount = toolCalls.filter(
    tc => getToolCallDisplayStatus(tc) === 'completed'
  ).length;
  const errorCount = toolCalls.filter(tc => getToolCallDisplayStatus(tc) === 'error').length;
  const runningCount = toolCalls.filter(tc => getToolCallDisplayStatus(tc) === 'running').length;

  // The latest calls are the candidates; the layout pass below decides how many of
  // them fit on one line, so narrow (mobile) panes never grow the card to several rows.
  // The oldest candidates are dropped first — the newest call must stay visible.
  const chips: SummaryChip[] = toolCalls.slice(-MAX_VISIBLE_TOOLS).map(tc => ({
    id: tc.id,
    status: getToolCallDisplayStatus(tc),
    summary: getToolCallSummary(tc),
    toolCall: tc,
  }));
  const chipKey = chips.map(chip => `${chip.id}:${chip.status}:${chip.summary}`).join('|');

  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  // Bumped on resize so the fit calculation runs again for the new width.
  const [measureToken, setMeasureToken] = useState(0);
  const measureKey = `${chipKey}#${toolCalls.length}#${measureToken}`;
  const [measured, setMeasured] = useState<{ key: string; count: number } | null>(null);
  // Until this exact chip set is measured, render every candidate (never painted —
  // the layout effect below settles the count before the browser draws).
  const measuring = measured?.key !== measureKey;
  const fitCount = measuring ? chips.length : (measured?.count ?? chips.length);

  // Rotations and pane resizes re-open the fit calculation.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setMeasureToken(token => token + 1));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!measuring) return;
    const row = rowRef.current;
    if (!row) return;
    const available = row.getBoundingClientRect().width;
    if (available <= 0) {
      // No layout yet (tests, detached row): fall back to the count cap.
      setMeasured({ key: measureKey, count: chips.length });
      return;
    }
    const rendered = Array.from(row.querySelectorAll<HTMLElement>('[data-summary-chip]'));
    const moreWidth = moreRef.current?.getBoundingClientRect().width ?? 0;
    // Read the real gap: root font scaling can make `gap-1.5` larger than 6px.
    const computedGap = Number.parseFloat(getComputedStyle(row).columnGap);
    const count = fitSummaryChipCount(
      rendered.map(chip => chip.getBoundingClientRect().width),
      moreWidth,
      available,
      toolCalls.length,
      Number.isFinite(computedGap) ? computedGap : SUMMARY_CHIP_GAP_PX
    );
    setMeasured({ key: measureKey, count });
  }, [measuring, measureKey, chips.length, toolCalls.length]);

  const hiddenCount = Math.max(0, toolCalls.length - fitCount);
  const visibleChips = measuring ? chips : chips.slice(chips.length - fitCount);

  return (
    <div
      onClick={onClick}
      className="px-3 py-2 text-xs bg-muted/50 rounded-md hover:bg-muted transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex items-center gap-1 text-foreground font-medium">
          <Wrench size={12} className="text-muted-foreground" />
          {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {completedCount > 0 && (
            <span className="flex items-center gap-0.5 text-success">
              <CheckCircle2 size={10} />
              {completedCount}
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-0.5 text-destructive ml-1">
              <XCircle size={10} />
              {errorCount}
            </span>
          )}
          {runningCount > 0 && (
            <span className="flex items-center gap-0.5 text-primary ml-1">
              <Loader2 size={10} className="animate-spin" />
              {runningCount}
            </span>
          )}
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground ml-auto text-[10px]">
          Click to expand <ChevronRight size={10} />
        </span>
      </div>
      <div
        ref={rowRef}
        data-testid="tool-summary-row"
        className="flex items-center gap-1.5 overflow-hidden"
      >
        {(measuring || hiddenCount > 0) && (
          <span
            ref={moreRef}
            data-testid="tool-summary-more"
            aria-hidden={measuring || undefined}
            title={
              measuring
                ? undefined
                : `${hiddenCount} earlier tool call${hiddenCount > 1 ? 's' : ''} hidden`
            }
            className="shrink-0 self-center text-[10px] text-muted-foreground"
          >
            …
          </span>
        )}
        {visibleChips.map((chip, index) => (
          <SummaryChipBadge
            key={chip.id || index}
            chip={chip}
            // Tooltips are only for the settled row; the measuring pass never paints.
            title={
              measuring
                ? undefined
                : formatToolInput(chip.toolCall.toolName, chip.toolCall.toolInput)
            }
          />
        ))}
      </div>
    </div>
  );
}

type ToolCallListMode = 'streaming' | 'collapsed' | 'expanded';

export const ToolCallList = memo(function ToolCallList({
  toolCalls: allToolCalls,
  defaultCollapsed = false,
  isStreaming = false,
}: ToolCallListProps) {
  const [userOverride, setUserOverride] = useState<ToolCallListMode | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Sub-agent inner steps (parentToolUseId set) never render top-level here;
  // they belong to the sub-agent drawer. Filtering once keeps every mode's
  // counts and "latest tool" fallbacks free of nested calls.
  const toolCalls = allToolCalls.filter(tc => !tc.parentToolUseId);

  // While streaming, a new tool arriving should reset any user override so the latest tool
  // becomes visible again; otherwise a single click could hide every subsequent tool of the run.
  const prevLengthRef = useRef(toolCalls.length);
  useEffect(() => {
    if (isStreaming && toolCalls.length !== prevLengthRef.current) {
      setUserOverride(null);
      setShowAll(false);
    }
    prevLengthRef.current = toolCalls.length;
  }, [toolCalls.length, isStreaming]);

  if (toolCalls.length === 0) return null;

  const defaultMode: ToolCallListMode = defaultCollapsed
    ? 'collapsed'
    : isStreaming
      ? 'streaming'
      : 'expanded';
  const mode: ToolCallListMode = userOverride ?? defaultMode;

  if (mode === 'collapsed') {
    return <SummaryBar toolCalls={toolCalls} onClick={() => setUserOverride('expanded')} />;
  }

  if (mode === 'streaming') {
    // Expand only the currently-running tools; everything else folds into the summary bar above.
    // If none are running, fall back to the latest one for visual continuity during the brief gap
    // between a tool finishing and the next one starting.
    const runningTools: ToolCallState[] = [];
    const otherTools: ToolCallState[] = [];
    for (const tc of toolCalls) {
      if (tc.status === 'running') runningTools.push(tc);
      else otherTools.push(tc);
    }
    const hasRunning = runningTools.length > 0;
    const expandedTools = hasRunning ? runningTools : [toolCalls[toolCalls.length - 1]];
    const olderTools = hasRunning ? otherTools : toolCalls.slice(0, -1);
    return (
      <div className="space-y-2">
        {olderTools.length > 0 && (
          <SummaryBar toolCalls={olderTools} onClick={() => setUserOverride('expanded')} />
        )}
        {expandedTools.map(tc => (
          <ToolCallItem key={tc.id} toolCall={tc} />
        ))}
      </div>
    );
  }

  const hasMany = toolCalls.length > MAX_VISIBLE_TOOLS;
  const earlierCount = Math.max(0, toolCalls.length - MAX_VISIBLE_TOOLS);
  const visibleToolCalls = !hasMany || showAll ? toolCalls : toolCalls.slice(-MAX_VISIBLE_TOOLS);

  const collapseAll = () => {
    setUserOverride('collapsed');
    setShowAll(false);
  };

  return (
    <div className="space-y-1">
      <button
        onClick={collapseAll}
        className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown size={12} />
        <span>Collapse tool calls</span>
      </button>

      {hasMany && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="px-3 py-1.5 text-xs bg-muted/50 rounded-md hover:bg-muted transition-colors cursor-pointer w-full text-left text-muted-foreground"
        >
          <span className="flex items-center gap-1">
            {showAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showAll ? 'Hide' : 'Show'} {earlierCount} earlier tool call
            {earlierCount > 1 ? 's' : ''}
          </span>
        </button>
      )}

      {visibleToolCalls.map(tc => (
        <ToolCallItem key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
});

export type { ToolCallListProps, ToolCallListMode };
export {
  SummaryBar,
  getToolCallSummary,
  getStatusIconComponent,
  getToolCallDisplayStatus,
  fitSummaryChipCount,
  MAX_VISIBLE_TOOLS,
};
