import { ChevronRight, Plus } from 'lucide-react';
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
        const { backendId, name, online } = backend;
        const expanded = online && expandedBackendIds.includes(backendId);

        return (
          <div key={backendId} className="space-y-1">
            <div
              className={`group flex items-center rounded-md hover:bg-secondary transition-colors ${online ? '' : 'opacity-60'}`}
            >
              <button
                type="button"
                onClick={() => {
                  if (online) onToggleBackend(backendId);
                }}
                aria-expanded={online ? expanded : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-1 text-left"
              >
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {name}
                </span>
                {online && (
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className={`flex-shrink-0 text-muted-foreground/70 transition-transform ${expanded ? 'rotate-90' : ''}`}
                  />
                )}
              </button>
              {online && (
                <button
                  type="button"
                  onClick={() => onSelectItem({ backendId, kind: 'new' })}
                  className="mr-1 hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded-md hover:bg-accent group-hover:flex"
                  title="New profile"
                  aria-label="New profile"
                >
                  <Plus size={14} strokeWidth={2} className="text-muted-foreground" />
                </button>
              )}
            </div>

            {expanded && (
              <div className="ml-3 mt-0.5 space-y-0.5">
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
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            Default
                          </span>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
