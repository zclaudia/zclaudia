import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { FieldLabel } from '../ui/EditorSection';
import { FIELD_CLASS, SELECT_POPOVER_CLASS } from './styles';

/**
 * F2: Model is now a dropdown rather than a free-text input. The valid set
 * comes from the bound LLM profile's `models` list, which the LlmProfileManager
 * now requires at least one of. We still render a degraded state for legacy
 * profiles created before the requirement, so historical agent profiles don't
 * break when their bound LLM profile has no models declared.
 */
export function ModelSelector({
  value,
  onChange,
  llmProfile,
  hideLabel = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  llmProfile: LlmProfileConfig | undefined;
  hideLabel?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const models = llmProfile?.models ?? [];
  const hasModels = models.length > 0;
  const selectedEntry = models.find(m => m.modelId === value);
  const displayLabel = selectedEntry
    ? selectedEntry.displayName || selectedEntry.modelId
    : value
      ? value
      : hasModels
        ? 'Select a model'
        : 'No models available — declare models on the LLM profile';

  return (
    <div ref={ref} className="relative">
      {!hideLabel && <FieldLabel>Model *</FieldLabel>}
      <button
        type="button"
        onClick={() => hasModels && setOpen(!open)}
        disabled={!hasModels}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left font-mono disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && hasModels && (
        <div className={`${SELECT_POPOVER_CLASS} max-h-72 overflow-y-auto`}>
          {models.map(m => {
            const label = m.displayName || m.modelId;
            return (
              <button
                key={m.modelId}
                type="button"
                onClick={() => {
                  onChange(m.modelId);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  m.modelId === value
                    ? 'text-primary font-medium bg-muted/40'
                    : 'text-foreground hover:bg-secondary/80'
                }`}
              >
                <span className="w-4 flex-shrink-0">
                  {m.modelId === value && <Check size={14} strokeWidth={2.5} />}
                </span>
                <span className="font-mono truncate">{label}</span>
                {label !== m.modelId && (
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                    {m.modelId}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
