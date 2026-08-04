import { UsageRing } from './UsageRing';

interface TokenUsageDisplayProps {
  /** Input tokens for the latest run (snapshot); preferred over the cumulative total. */
  latestInputTokens?: number;
  /** Cumulative session input tokens; the fallback when no snapshot exists. */
  inputTokens: number;
  /** Real context-window occupancy for the final LLM call, if available. */
  contextUsedTokens?: number;
  /** Context window for the active model, if known. */
  contextWindow?: number;
}

/**
 * Compact context-window gauge shown at the right edge of the composer: a
 * donut ring plus the used percentage. Detail (token counts, prompt-cache hits,
 * context-window source) lives in the ContextUsagePopover, not here. Mounted
 * in the desktop composer footer and, on mobile, at the right end of the
 * selector-trio row above the textarea.
 */
export function TokenUsageDisplay({
  latestInputTokens,
  inputTokens,
  contextUsedTokens,
  contextWindow,
}: TokenUsageDisplayProps) {
  const currentInput = contextUsedTokens ?? latestInputTokens ?? inputTokens;
  if (currentInput === 0) return null;

  const hasContextWindow = typeof contextWindow === 'number' && contextWindow > 0;
  const ratio = hasContextWindow ? currentInput / contextWindow : 0;
  const colorClass = !hasContextWindow
    ? 'text-muted-foreground'
    : ratio > 0.8
      ? 'text-destructive'
      : ratio > 0.6
        ? 'text-yellow-500'
        : 'text-muted-foreground';

  const percentText = hasContextWindow ? `${Math.round(ratio * 100)}%` : '—';

  return (
    <div className={`flex items-center gap-1.5 text-xs ${colorClass}`}>
      <UsageRing
        ratio={ratio}
        className={colorClass}
        label={`Context window ${percentText} used`}
      />
      <span className="tabular-nums">{percentText}</span>
    </div>
  );
}
