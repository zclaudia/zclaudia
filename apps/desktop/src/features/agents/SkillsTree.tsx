import { FolderCog } from 'lucide-react';
import { BackendGroup } from './BackendGroup';
import type { AgentsBackend, AgentsSelection } from './agents-types';
import type { SkillsByBackend } from './useSkillsByBackend';

interface SkillsTreeProps {
  backends: AgentsBackend[];
  data: SkillsByBackend;
  selection: AgentsSelection | null;
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  onSelectItem: (sel: AgentsSelection) => void;
}

/**
 * Backend-grouped master list for the Skills tab of Agents shell mode. Mirrors AgentsTree's
 * structure: one BackendGroup per backend, skill rows with trailing source/blocked tags, and a
 * footer row per group linking to that backend's external skill directories.
 * Presentational only — data comes from useSkillsByBackend via the parent.
 */
export function SkillsTree({
  backends,
  data,
  selection,
  expandedBackendIds,
  onToggleBackend,
  onSelectItem,
}: SkillsTreeProps) {
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
            createLabel="New skill"
            onCreate={() => onSelectItem({ backendId, kind: 'new-skill' })}
          >
            {(() => {
              const skills = data.skills.get(backendId);
              const error = data.errors.get(backendId);

              if (!skills && data.loading) {
                return <div className="px-2 text-xs text-muted-foreground/60">Loading…</div>;
              }
              if (error) {
                return (
                  <div className="px-2 text-xs text-muted-foreground/60">Couldn't load skills</div>
                );
              }

              const isDirsSelected =
                selection?.kind === 'skill-dirs' && selection.backendId === backendId;
              const footer = (
                <button
                  key="__skill-dirs__"
                  type="button"
                  onClick={() => onSelectItem({ backendId, kind: 'skill-dirs' })}
                  className={`w-full text-left h-7 px-2 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                    isDirsSelected
                      ? 'bg-secondary text-foreground'
                      : 'hover:bg-secondary hover:text-foreground text-muted-foreground'
                  }`}
                >
                  <FolderCog size={14} strokeWidth={2} className="text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">External directories</span>
                </button>
              );

              if (!skills || skills.length === 0) {
                return (
                  <>
                    <div className="px-2 text-xs text-muted-foreground/60">No skills</div>
                    {footer}
                  </>
                );
              }

              return (
                <>
                  {skills.map(skill => {
                    const isSelected =
                      selection?.kind === 'skill' &&
                      selection.backendId === backendId &&
                      selection.id === skill.id;
                    const showSourceTag = skill.source === 'external' || skill.source === 'plugin';
                    const isBlocked = skill.eligible === false;

                    return (
                      <button
                        key={`${skill.source ?? 'workspace'}:${skill.id}`}
                        type="button"
                        onClick={() => onSelectItem({ backendId, kind: 'skill', id: skill.id })}
                        className={`w-full text-left h-7 px-2 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                          isSelected
                            ? 'bg-secondary text-foreground'
                            : 'hover:bg-secondary hover:text-foreground text-muted-foreground'
                        }`}
                      >
                        <span className="truncate flex-1">{skill.name || skill.id}</span>
                        {showSourceTag && (
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            {skill.source}
                          </span>
                        )}
                        {isBlocked && (
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            blocked
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {footer}
                </>
              );
            })()}
          </BackendGroup>
        );
      })}
    </div>
  );
}
