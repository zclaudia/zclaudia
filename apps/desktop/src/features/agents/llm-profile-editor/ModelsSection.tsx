import type { LlmProfilePreviewInput } from '../../../services/api';
import type { ModelRowDraft } from '../llmProfileModelDraft';
import { ModelRow } from './ModelRow';

interface ModelsSectionProps {
  backendId: string;
  models: ModelRowDraft[];
  providerType: string;
  fetching: boolean;
  fetchError: string | null;
  saveError: string | null;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<ModelRowDraft>) => void;
  onRemove: (index: number) => void;
  onFetch: () => void;
  onProbe: (index: number) => void;
  /**
   * Build a snapshot of the *current* form draft for the F3 resolve-preview
   * call. Each ModelRow uses this to ask the server "what context window
   * would the runtime resolve for my modelId if I left the override blank?".
   */
  buildPreviewInput: () => LlmProfilePreviewInput;
}

export function ModelsSection({
  backendId,
  models,
  providerType,
  fetching,
  fetchError,
  saveError,
  onAdd,
  onUpdate,
  onRemove,
  onFetch,
  onProbe,
  buildPreviewInput,
}: ModelsSectionProps) {
  // F2: Fetch/Test now hit the preview endpoints, so neither needs the profile
  // to be saved or the form to be pristine. The only remaining hard gate is
  // providerType (the preview validator requires it).
  const fetchDisabledReason = !providerType ? 'Pick a provider type first' : undefined;
  const fetchDisabled = !providerType || fetching;
  return (
    <div>
      {/* Right-aligned from md up; below md they share the full width instead of
          floating against an empty gutter. */}
      <div className="mb-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onFetch}
          disabled={fetchDisabled}
          title={fetchDisabledReason}
          className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-foreground hover:bg-secondary disabled:opacity-50 max-md:flex-1 max-md:py-2"
        >
          {fetching ? 'Fetching…' : 'Fetch from /models'}
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-foreground hover:bg-secondary max-md:flex-1 max-md:py-2"
        >
          + Add model
        </button>
      </div>
      {fetchError && <p className="mb-2 text-xs text-destructive">{fetchError}</p>}
      {saveError && <p className="mb-2 text-xs text-destructive">{saveError}</p>}
      {models.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No models declared. Add at least one model entry before saving — agent profiles bound to
          this LLM profile pick their model id from this list.
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((row, idx) => (
            <ModelRow
              key={row.rowUid}
              backendId={backendId}
              index={idx}
              row={row}
              allRows={models}
              providerType={providerType}
              onChange={patch => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
              onProbe={() => onProbe(idx)}
              buildPreviewInput={buildPreviewInput}
            />
          ))}
        </div>
      )}
    </div>
  );
}
