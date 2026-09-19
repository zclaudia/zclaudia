import { useEffect, useRef, useState } from 'react';
import type { ContextWindowSource } from '@zclaudia/shared';
import { resolveContextWindowPreviewForBackend } from '../../../services/api';
import type { LlmProfilePreviewInput } from '../../../services/api';

export interface ResolvedPreviewState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  value?: number;
  source?: ContextWindowSource;
  /**
   * Cross-provider matched pi-ai provider id when `source === 'pi_ai_registry'`.
   * Lets the helper text annotate e.g. "from registry (deepseek)" when an
   * OpenAI-compat profile borrows a registered model id from another provider.
   */
  matchedProvider?: string;
}

/**
 * F3: when contextWindow is left blank, ask the server what the runtime would
 * resolve for this modelId so users see "if you save this row blank, X via
 * Y" inline. Debounced so a fast typer doesn't fan out a request per
 * keystroke; a version counter ensures stale responses don't overwrite the
 * freshest result.
 */
export function useResolvedContextWindow({
  backendId,
  modelId,
  eligible,
  providerType,
  displayName,
  maxTokensStr,
  buildPreviewInput,
}: {
  backendId: string;
  /** The current row's modelId (already trimmed). */
  modelId: string;
  /** Whether the hint applies (provider picked, id typed, override blank, id valid). */
  eligible: boolean;
  providerType: string;
  displayName: string;
  maxTokensStr: string;
  buildPreviewInput: () => LlmProfilePreviewInput;
}): ResolvedPreviewState {
  const [resolved, setResolved] = useState<ResolvedPreviewState>({ status: 'idle' });
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Clear any pending debounce on every input change (in-flight responses
    // are neutralized by the request-id staleness guard below). If we're no
    // longer eligible (override filled, modelId cleared, etc.) just reset to
    // idle — the UI hides the helper text in those cases.
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!eligible) {
      // Don't surface stale results when the helper isn't applicable.
      if (resolved.status !== 'idle') setResolved({ status: 'idle' });
      return;
    }

    const myRequestId = ++requestIdRef.current;
    setResolved({ status: 'loading' });

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      const previewInput = buildPreviewInput();
      // Self-edit guard: strip the current row's own contextWindow override
      // (it's empty by the eligible gate, but also strip the entry's
      // maxTokens / displayName aren't relevant — we only need to neutralize
      // contextWindow). This way `resolveContextWindow` walks past the
      // profile_entry layer for *this* model id and reports what the next
      // layer (pi_ai_registry / openai_compat_default / fallback) would supply.
      const sanitizedModels = (previewInput.models ?? []).map(entry => {
        if (entry.modelId !== modelId) return entry;
        const { contextWindow: _omitContextWindow, ...rest } = entry;
        void _omitContextWindow;
        return rest;
      });

      resolveContextWindowPreviewForBackend(backendId, {
        ...previewInput,
        models: sanitizedModels,
        modelId,
      })
        .then(data => {
          if (myRequestId !== requestIdRef.current) return; // stale
          setResolved({
            status: 'ok',
            value: data.value,
            source: data.source,
            matchedProvider: data.matchedProvider,
          });
        })
        .catch(() => {
          if (myRequestId !== requestIdRef.current) return; // stale
          setResolved({ status: 'error' });
        });
    }, 300);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
    // We intentionally depend on the inputs that drive the request shape.
    // buildPreviewInput is recreated on every parent render — that's fine
    // because the debounce + version guard makes redundant calls safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, modelId, providerType, backendId, displayName, maxTokensStr]);

  // Clean up on unmount (covers row removal too).
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return resolved;
}
