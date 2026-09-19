import type { LlmModelDialect } from '@zclaudia/shared';
import { LLM_MODEL_DIALECTS } from '@zclaudia/shared';
import type { LlmProfilePreviewInput } from '../../../services/api';
import { validateModelDraftRow, type ModelRowDraft } from '../llmProfileModelDraft';
import { DIALECT_LABELS } from './derive';
import { MODEL_FIELD_BASE } from './styles';
import { ModelTestStatus } from './ModelTestStatus';
import { ResolvedContextWindowHint } from './ResolvedContextWindowHint';
import { useResolvedContextWindow } from './useResolvedContextWindow';

interface ModelRowProps {
  backendId: string;
  index: number;
  row: ModelRowDraft;
  allRows: ModelRowDraft[];
  providerType: string;
  onChange: (patch: Partial<ModelRowDraft>) => void;
  onRemove: () => void;
  onProbe: () => void;
  buildPreviewInput: () => LlmProfilePreviewInput;
}

export function ModelRow({
  backendId,
  index,
  row,
  allRows,
  providerType,
  onChange,
  onRemove,
  onProbe,
  buildPreviewInput,
}: ModelRowProps) {
  const errs = validateModelDraftRow(row, allRows, index);
  const isRunning = row.testStatus?.kind === 'running';
  const testDisabled = !providerType || isRunning || !row.modelId.trim() || !!errs.modelId;
  const testDisabledReason = !providerType
    ? 'Pick a provider type first'
    : !row.modelId.trim()
      ? 'Enter a model id first'
      : errs.modelId
        ? `Fix model id (${errs.modelId}) first`
        : undefined;

  const modelIdInput = row.modelId.trim();
  const contextOverrideEmpty = !row.contextWindowStr.trim();
  const helperEligible = !!providerType && !!modelIdInput && contextOverrideEmpty && !errs.modelId;

  const resolved = useResolvedContextWindow({
    backendId,
    modelId: modelIdInput,
    eligible: helperEligible,
    providerType,
    displayName: row.displayName,
    maxTokensStr: row.maxTokensStr,
    buildPreviewInput,
  });

  // The Auto option's label annotates what the runtime would detect from the
  // existing context-window preview resolution (when it happens to have run
  // and matched a provider with a known dialect label). This piggybacks on
  // the resolve-preview call already fired below for the contextWindow
  // helper — no separate fetch. `DIALECT_LABELS[...]` is looked up (not just
  // `matchedProvider` truthiness) because matches like 'anthropic' have no
  // dialect label and must fall back to plain "Auto".
  const detectedDialectLabel =
    resolved.status === 'ok' && resolved.matchedProvider
      ? (DIALECT_LABELS as Record<string, string | undefined>)[resolved.matchedProvider]
      : undefined;
  const autoDialectLabel = detectedDialectLabel
    ? `Auto — detected: ${detectedDialectLabel}`
    : 'Auto';

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <input
            type="text"
            value={row.modelId}
            onChange={e => onChange({ modelId: e.target.value })}
            placeholder="model id (e.g. claude-opus-4-7)"
            aria-label="model id"
            className={`${MODEL_FIELD_BASE} font-mono ${errs.modelId ? 'border-destructive' : 'border-border/70'}`}
          />
          {errs.modelId && (
            <p className="text-[10px] text-destructive mt-0.5">
              {errs.modelId === 'duplicate'
                ? 'duplicate model id in this profile'
                : 'model id is required'}
            </p>
          )}
        </div>
        <input
          type="text"
          value={row.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder="display name (optional)"
          aria-label="display name"
          className={`${MODEL_FIELD_BASE} border-border/70`}
        />
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.contextWindowStr}
            onChange={e => onChange({ contextWindowStr: e.target.value })}
            placeholder="context window (optional)"
            aria-label="context window"
            className={`${MODEL_FIELD_BASE} font-mono ${errs.contextWindow ? 'border-destructive' : 'border-border/70'}`}
          />
          {errs.contextWindow && (
            <p className="text-[10px] text-destructive mt-0.5">
              contextWindow {errs.contextWindow}
            </p>
          )}
          <ResolvedContextWindowHint
            state={resolved}
            eligible={helperEligible}
            modelId={modelIdInput}
          />
        </div>
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.maxTokensStr}
            onChange={e => onChange({ maxTokensStr: e.target.value })}
            placeholder="max tokens (optional)"
            aria-label="max tokens"
            className={`${MODEL_FIELD_BASE} font-mono ${errs.maxTokens ? 'border-destructive' : 'border-border/70'}`}
          />
          {errs.maxTokens && (
            <p className="text-[10px] text-destructive mt-0.5">maxTokens {errs.maxTokens}</p>
          )}
        </div>
      </div>
      {/* Below md this is three stacked bands rather than one line: the settings
          read as label-left / control-right like every other row in the editor,
          and the actions get a divided footer. Left as a single line from md up,
          where the row has the width for it. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-x-3">
          <ModelTestStatus status={row.testStatus} />
          <label className="flex cursor-pointer items-center justify-between gap-1.5 text-[11px] text-muted-foreground max-md:py-1 md:justify-start">
            {/* Control trails the label below md and leads it from md up, so the
                desktop reading order ("[x] Vision") is unchanged. */}
            <input
              type="checkbox"
              checked={row.supportsImage}
              onChange={e =>
                onChange({ supportsImage: e.target.checked, inputModalitiesTouched: true })
              }
              aria-label={`model ${row.modelId.trim() || index + 1} supports image input`}
              className="order-last h-3.5 w-3.5 rounded border-border md:order-none"
            />
            Vision
          </label>
          {providerType !== 'anthropic' && (
            <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground max-md:py-1">
              <span className="flex-shrink-0">Dialect</span>
              <select
                value={row.dialect}
                onChange={e => onChange({ dialect: e.target.value as '' | LlmModelDialect })}
                aria-label={`dialect for model ${row.modelId.trim() || index + 1}`}
                className={`min-w-0 flex-1 rounded-md border bg-background/70 px-1.5 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 md:max-w-[15rem] md:flex-none ${
                  row.dialect ? 'border-primary/50' : 'border-border/70'
                }`}
              >
                <option value="">{autoDialectLabel}</option>
                {LLM_MODEL_DIALECTS.map(d => (
                  <option key={d} value={d}>
                    {DIALECT_LABELS[d]}
                  </option>
                ))}
              </select>
              <fieldset className="space-y-1 mt-2">
                <legend className="text-xs text-muted-foreground">Supported thinking levels</legend>
                <p className="text-[11px] text-muted-foreground">
                  Select only levels supported by this model connection. Leave empty if unknown.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const).map(level => (
                    <label key={level} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={row.thinkingLevels?.includes(level) ?? false}
                        onChange={e =>
                          onChange({
                            thinkingLevels: e.target.checked
                              ? [...(row.thinkingLevels ?? []), level]
                              : (row.thinkingLevels ?? []).filter(x => x !== level),
                          })
                        }
                      />
                      {level}
                    </label>
                  ))}
                </div>
              </fieldset>
              {row.dialect && (
                <span className="flex-shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  forced
                </span>
              )}
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 max-md:border-t max-md:border-border/60 max-md:pt-2 md:gap-1">
          <button
            type="button"
            onClick={onProbe}
            disabled={testDisabled}
            title={testDisabledReason}
            className="rounded-md border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-foreground hover:bg-secondary disabled:opacity-50 max-md:flex-1 max-md:py-2"
          >
            {isRunning ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove model"
            className="rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 max-md:flex-1 max-md:py-2"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
