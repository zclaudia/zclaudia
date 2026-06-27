import { AlertTriangle } from 'lucide-react';
import type { ContextWindowSource } from '@zclaudia/shared';
import { formatTokens } from '../../utils/formatTokens';

interface TokenUsageDisplayProps {
  latestInputTokens?: number;
  latestOutputTokens?: number;
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
  /**
   * Provenance of the contextWindow value. Used to render the source-explanation
   * tooltip and the fallback warning icon. Optional for backward-compat —
   * historical sessions and tests omit it.
   */
  contextWindowSource?: ContextWindowSource;
  /**
   * When `contextWindowSource === 'pi_ai_registry'`, the pi-ai provider id
   * whose registry entry matched (e.g. `'deepseek'`). Shown parenthetically in
   * the tooltip so cross-provider hits are visible to the user. Intentionally
   * never mentions "pi-ai" in user-facing copy.
   */
  contextWindowMatchedProvider?: string;
  /** Accumulated cache-read tokens for the session. */
  cacheReadTokens?: number;
  /** Accumulated cache-write tokens for the session. */
  cacheWriteTokens?: number;
  /** Cache-read tokens for the most recent agent run (snapshot). */
  latestCacheReadTokens?: number;
  /** Cache-write tokens for the most recent agent run (snapshot). */
  latestCacheWriteTokens?: number;
}

/**
 * Human-readable tooltip that explains where the displayed context window
 * came from. The `'fallback'` and `'openai_compat_default'` copies are
 * intentionally actionable — they point the user at the LLM-profile fix path
 * rather than just admitting we guessed.
 */
function contextSourceTooltip(
  source: ContextWindowSource | undefined,
  matchedProvider: string | undefined,
): string | null {
  switch (source) {
    case 'profile_entry':
      return 'Window set by your LLM profile model override';
    case 'pi_ai_registry':
      // Per F4 UX: surface "registry" to users; never expose "pi-ai" wording.
      // When a cross-provider sweep matched (matchedProvider set), annotate
      // it parenthetically so users can tell which provider supplied the spec.
      return `Window from registry${matchedProvider ? ` (${matchedProvider})` : ''}`;
    case 'openai_compat_default':
      return 'Using 128,000 default for openai-compat. No registry match for this model — declare the model on your LLM profile to set an accurate window.';
    case 'fallback':
      return 'Using default 100k window — no spec found for this model. Declare the model on your LLM profile for accuracy.';
    default:
      return null;
  }
}

export function TokenUsageDisplay({
  latestInputTokens,
  latestOutputTokens,
  inputTokens,
  outputTokens,
  contextWindow,
  contextWindowSource,
  contextWindowMatchedProvider,
  cacheReadTokens: _cacheReadTokens,
  cacheWriteTokens: _cacheWriteTokens,
  latestCacheReadTokens,
  latestCacheWriteTokens: _latestCacheWriteTokens,
}: TokenUsageDisplayProps) {
  const total = inputTokens + outputTokens;
  const currentInput = latestInputTokens ?? inputTokens;
  const currentOutput = latestOutputTokens ?? outputTokens;
  const currentTotal = currentInput + currentOutput;

  if (total === 0 && currentTotal === 0) return null;

  const hasContextWindow = typeof contextWindow === 'number' && contextWindow > 0;
  const ratio = hasContextWindow ? (currentInput / contextWindow) : 0;
  const colorClass = !hasContextWindow
    ? 'text-muted-foreground'
    : ratio > 0.8
      ? 'text-destructive'
      : ratio > 0.6
        ? 'text-yellow-500'
        : 'text-muted-foreground';

  const valueText = hasContextWindow
    ? `${formatTokens(currentInput, { decimals: 0, upper: true })}/${formatTokens(contextWindow, { decimals: 0, upper: true })}`
    : `${formatTokens(currentInput, { decimals: 0, upper: true })}/--`;

  // sourceTip is used by the AlertTriangle warning spans (fallback / openai_compat_default).
  // The AlertTriangle from lucide-react doesn't accept `title`, so we wrap it
  // in a span with title + aria-label to keep accessibility intact.
  const sourceTip = contextSourceTooltip(contextWindowSource, contextWindowMatchedProvider);
  // Both `fallback` and `openai_compat_default` are "we don't really know"
  // states — surface them with the same amber warning glyph but a distinct
  // aria-label so screen-reader users can tell them apart.
  const showFallbackIcon = hasContextWindow && contextWindowSource === 'fallback';
  const showOpenaiCompatDefaultIcon =
    hasContextWindow && contextWindowSource === 'openai_compat_default';

  return (
    <div className={`flex items-center gap-1 text-xs ${colorClass}`}>
      <span>{valueText}</span>
      {(latestCacheReadTokens ?? 0) > 0 && (
        <span
          className="text-muted-foreground"
          title={`Prompt cache hit: ${(latestCacheReadTokens ?? 0).toLocaleString()} tokens read from cache this turn`}
          aria-label="Prompt cache hit"
        >
          ↺ {formatTokens(latestCacheReadTokens ?? 0, { decimals: 0, upper: true })}
        </span>
      )}
      {showFallbackIcon && (
        <span
          className="inline-flex items-center"
          title={sourceTip ?? undefined}
          aria-label="Context window is a fallback estimate"
        >
          <AlertTriangle size={12} className="text-amber-500 shrink-0" />
        </span>
      )}
      {showOpenaiCompatDefaultIcon && (
        <span
          className="inline-flex items-center"
          title={sourceTip ?? undefined}
          aria-label="Context window is an openai-compat default (no registry match)"
        >
          <AlertTriangle size={12} className="text-amber-500 shrink-0" />
        </span>
      )}
    </div>
  );
}
