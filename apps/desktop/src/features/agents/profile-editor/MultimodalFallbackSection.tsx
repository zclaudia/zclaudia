import type { LlmProfileConfig } from '@zclaudia/shared';
import { EditorRow } from '../ui/EditorSection';
import { visionCapableModels } from './derive';
import { FIELD_CLASS, MONO_FIELD_CLASS } from './styles';

export function MultimodalFallbackSection({
  llmProfiles,
  profileId,
  model,
  onProfileChange,
  onModelChange,
  onRemove,
  onFlush,
}: {
  llmProfiles: LlmProfileConfig[];
  profileId: string;
  model: string;
  onProfileChange: (id: string) => void;
  onModelChange: (v: string) => void;
  onRemove: () => void;
  onFlush: () => void;
}) {
  const fallbackProfile = llmProfiles.find(p => p.id === profileId);
  const declaredModels = fallbackProfile?.models ?? [];
  const hasDeclaredModels = declaredModels.length > 0;
  const visionModels = visionCapableModels(fallbackProfile);
  const modelValue =
    hasDeclaredModels && !visionModels.some(entry => entry.modelId === model) ? '' : model;
  return (
    <>
      <div className="divide-y divide-border/60">
        <EditorRow
          title="Fallback LLM Profile"
          control={
            <div className="w-48 md:w-56">
              <select
                aria-label="Fallback LLM Profile"
                value={profileId}
                onChange={event => onProfileChange(event.target.value)}
                onBlur={onFlush}
                className={FIELD_CLASS}
              >
                <option value="">None</option>
                {llmProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        {profileId && hasDeclaredModels && (
          <EditorRow
            title="Fallback Model"
            description="Must support image input"
            control={
              <div className="w-48 md:w-56">
                <select
                  aria-label="Fallback Model"
                  value={modelValue}
                  onChange={event => onModelChange(event.target.value)}
                  onBlur={onFlush}
                  disabled={visionModels.length === 0}
                  className={`${FIELD_CLASS} disabled:opacity-50`}
                >
                  <option value="">Select a Vision-capable model</option>
                  {visionModels.map(entry => {
                    const label = entry.displayName || entry.modelId;
                    return (
                      <option key={entry.modelId} value={entry.modelId}>
                        {label === entry.modelId ? label : `${label} (${entry.modelId})`}
                      </option>
                    );
                  })}
                </select>
              </div>
            }
          />
        )}

        {profileId && !hasDeclaredModels && (
          <EditorRow
            title="Fallback Model"
            description="Must support image input"
            control={
              <div className="w-48 md:w-56">
                <input
                  type="text"
                  aria-label="Fallback Model"
                  value={model}
                  onChange={event => onModelChange(event.target.value)}
                  onBlur={onFlush}
                  placeholder="model id"
                  className={MONO_FIELD_CLASS}
                />
              </div>
            }
          />
        )}

        <EditorRow
          title={
            <span className="text-xs text-muted-foreground">
              {profileId ? 'Vision fallback enabled' : 'No fallback selected'}
            </span>
          }
          control={
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Remove fallback
            </button>
          }
        />
      </div>

      {profileId && hasDeclaredModels && visionModels.length === 0 && (
        <p className="mx-4 mb-4 text-xs text-warning">
          No Vision-capable models declared on this LLM profile.
        </p>
      )}
    </>
  );
}
