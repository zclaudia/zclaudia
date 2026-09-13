import { useMemo, useState } from 'react';
import type { InvocableDescriptor } from '@zclaudia/shared/providers';
import { useInvocableCatalog } from '../../hooks/chat/useInvocableCatalog';

/**
 * Invocable autocomplete (URIP design doc §16.2).
 *
 * Rows show the display trigger, description, source badge (host / runtime /
 * portable), scope, and fidelity. Colliding display triggers stay visible —
 * keyboard selection records the canonical ID while the composer keeps the
 * editable display text.
 */

export interface InvocableAutocompleteProps {
  backendId?: string | null;
  sessionId: string;
  typedText: string;
  onSelect: (descriptor: InvocableDescriptor) => void;
  enabled?: boolean;
}

function sourceBadge(descriptor: InvocableDescriptor): string {
  if (descriptor.kind === 'host.action') return 'ZClaudia';
  if (descriptor.kind === 'portable.skill') return 'Skill';
  return descriptor.runtimeType;
}

export function InvocableAutocomplete({
  backendId,
  sessionId,
  typedText,
  onSelect,
  enabled = true,
}: InvocableAutocompleteProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { snapshot, autocomplete, loading, waitingForLiveCatalog, error } = useInvocableCatalog({
    backendId,
    sessionId,
    enabled,
  });

  const rows = useMemo(() => autocomplete(typedText), [autocomplete, typedText]);

  if (!typedText.startsWith('/') || (rows.length === 0 && !waitingForLiveCatalog)) {
    return null;
  }

  return (
    <div role="listbox" aria-label="Command suggestions" data-testid="invocable-autocomplete">
      {waitingForLiveCatalog && rows.length === 0 && (
        <div className="px-3 py-2 text-xs opacity-60">
          {loading ? 'Loading commands…' : 'Runtime commands still loading…'}
        </div>
      )}
      {error && rows.length === 0 && (
        <div className="px-3 py-2 text-xs opacity-60">
          Command catalog unavailable — plain messages still work.
        </div>
      )}
      {rows.map((descriptor, index) => (
        <button
          key={descriptor.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
            index === activeIndex ? 'bg-black/5 dark:bg-white/10' : ''
          }`}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => onSelect(descriptor)}
        >
          <span className="font-medium">{descriptor.displayTrigger}</span>
          {descriptor.argumentHint && <span className="opacity-50">{descriptor.argumentHint}</span>}
          <span className="ml-auto flex items-center gap-1 text-xs opacity-60">
            <span data-testid="source-badge">{sourceBadge(descriptor)}</span>
            <span>·</span>
            <span>{descriptor.origin.scope}</span>
            <span>·</span>
            <span>
              {descriptor.execution.mode === 'emulated' ||
              descriptor.execution.fidelity === 'best-effort'
                ? 'compatibility'
                : 'native'}
            </span>
          </span>
        </button>
      ))}
      {snapshot && rows.length > 0 && (
        <div className="px-3 py-1 text-[10px] opacity-40">
          {snapshot.completeness === 'partial' ? 'Partial catalog' : `${rows.length} match(es)`}
        </div>
      )}
    </div>
  );
}
