import { useEffect, useState } from 'react';
import { Folder, Globe, ChevronRight, Shield } from 'lucide-react';
import type { Workflow, Automation } from '@zclaudia/shared';
import { BackendRow } from '../sidebar/BackendRow';
import { isInternalProject, displayProjectName } from './automation-types';
import type { AutomationApiType } from './useAutomationApi';
import type { AutomationTab } from './automation-types';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

interface ScopeBackend {
  backendId: string;
  name: string;
  online: boolean;
}
interface ScopeProject {
  id: string;
  name: string;
}

export interface AutomationTreeProps {
  tab: AutomationTab;
  api: AutomationApiType;
  activeBackendId: string | null;
  selectedProjectId?: string;
  backends: ScopeBackend[];
  getProjectsForBackend: (backendId: string) => ScopeProject[];
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  onSelectScope: (backendId: string, projectId?: string) => void;
}

const rowBase =
  'w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 hover:bg-secondary hover:text-foreground transition-colors';

/** Only the workflows/automations tabs let project nodes expand to item leaves; the rest don't. */
function tabIsExpandable(tab: AutomationTab): boolean {
  return tab === 'workflows' || tab === 'automations';
}

export function AutomationTree({
  tab,
  api,
  activeBackendId,
  selectedProjectId,
  backends,
  getProjectsForBackend,
  expandedBackendIds,
  onToggleBackend,
  onSelectScope,
}: AutomationTreeProps) {
  const selectedItemId = useTopLevelViewStore(s => s.selectedAutomationItemId);
  const selectItem = useTopLevelViewStore(s => s.selectAutomationItem);
  const refreshNonce = useTopLevelViewStore(s => s.automationListRefreshNonce);

  // Item leaves for workflows/automations (active backend only), grouped by projectId client-side.
  const [items, setItems] = useState<Array<Workflow | Automation>>([]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const expandable = tabIsExpandable(tab);

  useEffect(() => {
    setExpandedProjects(new Set()); // reset expansion when the tab changes
  }, [tab]);

  useEffect(() => {
    if (!expandable) {
      setItems([]);
      return;
    }
    let cancelled = false;
    if (tab === 'workflows') {
      api
        .get('/api/workflows')
        .then((list: Workflow[]) => {
          if (!cancelled) setItems(list);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    } else {
      api
        .get('/api/automations')
        .then((list: Automation[]) => {
          if (!cancelled) setItems(list);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, tab, expandable, refreshNonce]);

  const leavesFor = (project: ScopeProject): Array<Workflow | Automation> =>
    isInternalProject(project.name)
      ? items.filter(w => !w.projectId)
      : items.filter(w => w.projectId === project.id);

  /** Automations expose `enabled`; workflows expose `status`. Normalize the "active" dot. */
  const isItemActive = (item: Workflow | Automation): boolean =>
    'status' in item ? item.status === 'active' : item.enabled;

  const toggleProject = (key: string) =>
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  if (backends.length === 0) {
    return <p className="text-sm text-muted-foreground px-2">No backends online</p>;
  }

  return (
    <div className="space-y-2">
      {backends.map(backend => {
        const isActive = activeBackendId === backend.backendId;
        const projects = getProjectsForBackend(backend.backendId);
        return (
          <BackendRow
            key={backend.backendId}
            name={backend.name}
            online={backend.online}
            expanded={expandedBackendIds.includes(backend.backendId)}
            onToggle={() => onToggleBackend(backend.backendId)}
          >
            {/* system: global tasks — no project layer */}
            {tab === 'system' ? null : (
              <div className="space-y-0.5">
                {/* runs: "All projects" scope row */}
                {tab === 'runs' && (
                  <button
                    type="button"
                    aria-label="All projects"
                    onClick={() => onSelectScope(backend.backendId, undefined)}
                    className={`${rowBase} ${isActive && !selectedProjectId ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                  >
                    <Globe className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                    <span className="truncate">All projects</span>
                  </button>
                )}

                {projects.map(project => {
                  const key = `${backend.backendId}:${project.id}`;
                  const projectSelected = isActive && selectedProjectId === project.id;
                  // Expandable tabs show a chevron for every backend's projects. The expanded
                  // state is tracked regardless of which backend is active; clicking a project
                  // under a non-active backend activates it (via onSelectScope) and opens it in
                  // one click. Leaves only render once the backend is active, since the item
                  // list is fetched for the active backend only.
                  const isOpen = expandable && expandedProjects.has(key);
                  const showLeaves = isOpen && isActive;
                  return (
                    <div key={project.id}>
                      <button
                        type="button"
                        aria-label={project.name}
                        onClick={() => {
                          onSelectScope(backend.backendId, project.id);
                          if (expandable) toggleProject(key);
                        }}
                        className={`${rowBase} ${projectSelected ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                      >
                        {expandable ? (
                          <ChevronRight
                            size={14}
                            strokeWidth={2}
                            className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                        ) : (
                          <Folder className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                        )}
                        <span className="truncate">{displayProjectName(project.name)}</span>
                      </button>

                      {showLeaves &&
                        (() => {
                          const leaves = leavesFor(project);
                          return (
                            <div className="pl-4 space-y-0.5">
                              {leaves.map(w => {
                                const leafSelected = selectedItemId === w.id;
                                return (
                                  <button
                                    key={w.id}
                                    type="button"
                                    onClick={() => {
                                      onSelectScope(backend.backendId, project.id);
                                      selectItem(w.id);
                                    }}
                                    className={`${rowBase} ${leafSelected ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isItemActive(w) ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                                      aria-hidden
                                    />
                                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                                      <span className="text-xs truncate">{w.name}</span>
                                      {w.isSystem && (
                                        <Shield
                                          size={9}
                                          className="shrink-0 text-muted-foreground"
                                          aria-label="System Default"
                                        />
                                      )}
                                    </span>
                                  </button>
                                );
                              })}
                              {leaves.length === 0 && (
                                <p className="px-2 py-1 text-xs text-muted-foreground">No items</p>
                              )}
                            </div>
                          );
                        })()}
                    </div>
                  );
                })}

                {projects.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet</p>
                )}
              </div>
            )}
          </BackendRow>
        );
      })}
    </div>
  );
}
