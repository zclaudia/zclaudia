import { Folder, Globe } from 'lucide-react';
import { BackendRow } from './BackendRow';

interface ScopeBackend {
  backendId: string;
  name: string;
  online: boolean;
}

interface ScopeProject {
  id: string;
  name: string;
}

interface AutomationScopeListProps {
  backends: ScopeBackend[];
  getProjectsForBackend: (backendId: string) => ScopeProject[];
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  activeBackendId: string | null;
  selectedProjectId?: string;
  /** Scope automations to this backend, clearing any project filter. */
  onSelectBackend: (backendId: string) => void;
  /** Scope automations to this project within its backend. */
  onSelectProject: (backendId: string, projectId: string) => void;
}

/**
 * Sidebar backend/project list used while in automation mode. Reuses BackendRow
 * for the backend grouping; each backend exposes an "All projects" (global)
 * filter row plus one row per project. Selecting a row sets the automation scope.
 */
export function AutomationScopeList({
  backends,
  getProjectsForBackend,
  expandedBackendIds,
  onToggleBackend,
  activeBackendId,
  selectedProjectId,
  onSelectBackend,
  onSelectProject,
}: AutomationScopeListProps) {
  const rowBase = 'w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 hover:bg-secondary hover:text-foreground transition-colors';

  if (backends.length === 0) {
    return <p className="text-sm text-muted-foreground px-2">No backends online</p>;
  }

  return (
    <div className="space-y-2">
      {backends.map((backend) => {
        const projects = getProjectsForBackend(backend.backendId);
        const expanded = expandedBackendIds.includes(backend.backendId);
        const isActiveBackend = activeBackendId === backend.backendId;
        const allActive = isActiveBackend && !selectedProjectId;
        return (
          <BackendRow
            key={backend.backendId}
            name={backend.name}
            online={backend.online}
            expanded={expanded}
            onToggle={() => onToggleBackend(backend.backendId)}
          >
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => onSelectBackend(backend.backendId)}
                aria-label="All projects"
                className={`${rowBase} ${allActive ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
              >
                <Globe className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                <span className="truncate">All projects</span>
              </button>

              {projects.map((project) => {
                const active = isActiveBackend && selectedProjectId === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProject(backend.backendId, project.id)}
                    aria-label={project.name}
                    className={`${rowBase} ${active ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                  >
                    <Folder className="w-4 h-4 flex-shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="truncate">{project.name}</span>
                  </button>
                );
              })}

              {projects.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet</p>
              )}
            </div>
          </BackendRow>
        );
      })}
    </div>
  );
}
