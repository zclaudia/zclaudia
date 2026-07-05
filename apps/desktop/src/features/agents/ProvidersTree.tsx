import { BackendGroup } from './BackendGroup';
import { TreeInfoRow, treeRowClass } from './treeRows';
import type { AgentsBackend, AgentsSelection } from './agents-types';
import type { LlmProfilesByBackend } from './useLlmProfilesByBackend';

interface ProvidersTreeProps {
  backends: AgentsBackend[];
  data: LlmProfilesByBackend;
  selection: AgentsSelection | null;
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  onSelectItem: (sel: AgentsSelection) => void;
}

/**
 * Backend-grouped master list for the Providers tab of Agents shell mode. Mirrors
 * SkillsTree's structure: one BackendGroup per backend, profile rows with trailing
 * providerType/default tags.
 * Presentational only — data comes from useLlmProfilesByBackend via the parent.
 */
export function ProvidersTree({
  backends,
  data,
  selection,
  expandedBackendIds,
  onToggleBackend,
  onSelectItem,
}: ProvidersTreeProps) {
  return (
    <div className="space-y-1">
      {backends.map(backend => {
        const { backendId } = backend;

        return (
          <BackendGroup
            key={backendId}
            backend={backend}
            expanded={expandedBackendIds.includes(backendId)}
            onToggle={() => onToggleBackend(backendId)}
            createLabel="New provider"
            onCreate={() => onSelectItem({ backendId, kind: 'new-llm-profile' })}
          >
            {(() => {
              const profiles = data.profiles.get(backendId);
              const error = data.errors.get(backendId);

              if (!profiles && data.loading) {
                return <TreeInfoRow>Loading…</TreeInfoRow>;
              }
              if (error) {
                return <TreeInfoRow>Couldn't load providers</TreeInfoRow>;
              }
              if (!profiles || profiles.length === 0) {
                return <TreeInfoRow>No providers</TreeInfoRow>;
              }

              return profiles.map(profile => {
                const isSelected =
                  selection?.kind === 'llm-profile' &&
                  selection.backendId === backendId &&
                  selection.id === profile.id;

                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => onSelectItem({ backendId, kind: 'llm-profile', id: profile.id })}
                    className={treeRowClass(isSelected)}
                  >
                    <span className="truncate flex-1">{profile.name}</span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {profile.providerType}
                    </span>
                    {profile.isDefault && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">default</span>
                    )}
                  </button>
                );
              });
            })()}
          </BackendGroup>
        );
      })}
    </div>
  );
}
