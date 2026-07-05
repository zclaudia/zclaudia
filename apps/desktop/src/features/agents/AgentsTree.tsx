import { BackendGroup } from './BackendGroup';
import type { AgentsSelection } from './agents-types';
import type { AgentsBackend, ProfilesByBackend } from './useProfilesByBackend';

interface AgentsTreeProps {
  backends: AgentsBackend[];
  data: ProfilesByBackend;
  selection: AgentsSelection | null;
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  onSelectItem: (sel: AgentsSelection) => void;
}

/**
 * Backend-grouped master list for Agents shell mode. Mirrors BackendRow's group-header
 * language; offline backends are dimmed, non-expandable, and never reveal children.
 * Presentational only — data comes from useProfilesByBackend via the parent.
 */
export function AgentsTree({
  backends,
  data,
  selection,
  expandedBackendIds,
  onToggleBackend,
  onSelectItem,
}: AgentsTreeProps) {
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
            createLabel="New profile"
            onCreate={() => onSelectItem({ backendId, kind: 'new-profile' })}
          >
            {(() => {
              const profiles = data.profiles.get(backendId);
              const error = data.errors.get(backendId);

              if (!profiles && data.loading) {
                return <div className="px-2 text-xs text-muted-foreground/60">Loading…</div>;
              }
              if (error) {
                return (
                  <div className="px-2 text-xs text-muted-foreground/60">
                    Couldn't load profiles
                  </div>
                );
              }
              if (!profiles || profiles.length === 0) {
                return <div className="px-2 text-xs text-muted-foreground/60">No profiles</div>;
              }

              return profiles.map(profile => {
                const isSelected =
                  selection?.kind === 'profile' &&
                  selection.backendId === backendId &&
                  selection.id === profile.id;

                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => onSelectItem({ backendId, kind: 'profile', id: profile.id })}
                    className={`w-full text-left h-7 px-2 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                      isSelected
                        ? 'bg-secondary text-foreground'
                        : 'hover:bg-secondary hover:text-foreground text-muted-foreground'
                    }`}
                  >
                    <span className="truncate flex-1">{profile.name}</span>
                    {profile.isDefault && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">Default</span>
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
