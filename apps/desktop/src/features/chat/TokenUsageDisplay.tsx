import { AlertTriangle } from 'lucide-react';
import type { ContextWindowSource } from '@zclaudia/shared';

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
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return String(count);
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
    ? `${formatTokenCount(currentInput)}/${formatTokenCount(contextWindow)}`
    : `${formatTokenCount(currentInput)}/--`;

  // The numeric figures stay in the overall hover title (current/total/context)
  // so we don't regress existing user behavior. The source tooltip lives on a
  // dedicated wrapper around the value text so hovering exclusively over the
  // "X/Y" cluster (or the warning icon) surfaces the source explanation.
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
    <div
      className={`flex items-center gap-1 text-xs ${colorClass}`}
      title={`Current: ${currentInput.toLocaleString()} in / ${currentOutput.toLocaleString()} out | Total: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out | Context: ${hasContextWindow ? contextWindow.toLocaleString() : 'unknown'}`}
    >
      <span title={sourceTip ?? undefined}>{valueText}</span>
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
