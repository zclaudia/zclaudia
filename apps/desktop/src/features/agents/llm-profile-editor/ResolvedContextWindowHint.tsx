import { AlertTriangle } from 'lucide-react';
import type { ResolvedPreviewState } from './useResolvedContextWindow';

/**
 * Helper text shown directly beneath the contextWindow input, explaining
 * (when the user hasn't typed an override) which value + source the runtime
 * would resolve. Fallback rendering uses an amber AlertTriangle to make
 * "we don't actually know" visually distinct from "we have a sourced value".
 */
export function ResolvedContextWindowHint({
  state,
  eligible,
  modelId,
}: {
  state: ResolvedPreviewState;
  eligible: boolean;
  /**
   * The current row's modelId (already trimmed). Only used by the
   * openai_compat_default warning, which calls it out by name so the user
   * sees *which* id failed to match the registry.
   */
  modelId: string;
}) {
  if (!eligible) return null;
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return <p className="text-[10px] text-muted-foreground mt-0.5">Resolving…</p>;
  }
  if (state.status === 'error') {
    return <p className="text-[10px] text-muted-foreground mt-0.5">—</p>;
  }
  // 'ok'
  if (state.value == null || state.source == null) return null;
  const formatted = state.value.toLocaleString();
  switch (state.source) {
    case 'profile_entry':
      // Theoretically unreachable because we strip our own override before
      // calling — leave a sane label in case a *different* row declares the
      // same modelId (rare; still informative).
      return (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Using {formatted} via this profile's override
        </p>
      );
    case 'pi_ai_registry':
      // F4: registry hits can come from a cross-provider sweep (e.g. running
      // `deepseek-v4` through an openai-compat proxy resolves to provider
      // `deepseek`). Annotate parenthetically when matchedProvider is set so
      // users see which provider's spec we adopted. Per UX, never expose
      // "pi-ai" in user-facing copy.
      return (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Using {formatted} from registry
          {state.matchedProvider ? ` (${state.matchedProvider})` : ''}
        </p>
      );
    case 'openai_compat_default':
      // F4: openai-compat proxies hand back a 128k literal when nothing in
      // the registry matched the model id. Surface this as a distinct amber
      // warning so users can tell "we guessed 128k for compat" apart from
      // "we got a real spec from the registry".
      return (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Using {formatted} default for openai-compat. No registry match for "{modelId}" — declare
            contextWindow above or use a known model id.
          </span>
        </p>
      );
    case 'fallback':
      return (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Falls back to {formatted} — no spec found. Declare contextWindow above or add to LLM
            profile.
          </span>
        </p>
      );
    default:
      return null;
  }
}
