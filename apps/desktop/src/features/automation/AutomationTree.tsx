import { useEffect, useState } from 'react';
import { Folder, Globe, ChevronRight, Shield } from 'lucide-react';
import type { Workflow } from '@zclaudia/shared';
import { BackendRow } from '../sidebar/BackendRow';
import { isInternalProject } from './automation-types';
import type { AutomationApiType } from './useAutomationApi';
import type { AutomationTab } from './automation-types';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

interface ScopeBackend { backendId: string; name: string; online: boolean }
interface ScopeProject { id: string; name: string }

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

/** workflows/automations 这两个 tab 的项目节点可展开到条目;其余不展开。 */
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
  const selectedItemId = useTopLevelViewStore((s) => s.selectedAutomationItemId);
  const selectItem = useTopLevelViewStore((s) => s.selectAutomationItem);
  const refreshNonce = useTopLevelViewStore((s) => s.automationListRefreshNonce);

  // workflows/automations 的条目(仅 active backend),按 projectId 客户端分组。
  const [items, setItems] = useState<Workflow[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const expandable = tabIsExpandable(tab);

  useEffect(() => {
    setExpandedProjects(new Set()); // 切 tab 重置展开
  }, [tab]);

  useEffect(() => {
    if (!expandable) { setItems([]); return; }
    let cancelled = false;
    const path = tab === 'workflows' ? '/api/workflows' : '/api/automations';
    api.get(path)
      .then((list: Workflow[]) => {
        if (cancelled) return;
        const filtered = tab === 'workflows'
          ? list.filter((w) => w.authoringMode !== 'simple')
          : list;
        setItems(filtered);
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [api, tab, expandable, refreshNonce]);

  const leavesFor = (project: ScopeProject): Workflow[] =>
    isInternalProject(project.name)
      ? items.filter((w) => !w.projectId)
      : items.filter((w) => w.projectId === project.id);

  const toggleProject = (key: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (backends.length === 0) {
    return <p className="text-sm text-muted-foreground px-2">No backends online</p>;
  }

  return (
    <div className="space-y-2">
      {backends.map((backend) => {
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
            {/* system: 全局任务,不展示项目层 */}
            {tab === 'system' ? null : (
              <div className="space-y-0.5">
                {/* runs: All projects 作用域行 */}
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

                {projects.map((project) => {
                  const key = `${backend.backendId}:${project.id}`;
                  const projectSelected = isActive && selectedProjectId === project.id;
                  // 只有 active backend 的项目能展开条目(api 绑定 active backend)。
                  const canExpand = expandable && isActive;
                  const isOpen = canExpand && expandedProjects.has(key);
                  return (
                    <div key={project.id}>
                      <button
                        type="button"
                        aria-label={project.name}
                        onClick={() => {
                          if (canExpand) {
                            onSelectScope(backend.backendId, project.id);
                            toggleProject(key);
                          } else {
                            onSelectScope(backend.backendId, project.id);
                          }
                        }}
                        className={`${rowBase} ${projectSelected ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
                      >
                        {canExpand ? (
                          <ChevronRight
                            size={14}
                            strokeWidth={2}
                            className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                        ) : (
                          <Folder className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                        )}
                        <span className="truncate">{project.name}</span>
                      </button>

                      {isOpen && (
                        <div className="pl-4 space-y-0.5">
                          {leavesFor(project).map((w) => {
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
                                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${w.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                                  aria-hidden
                                />
                                <span className="flex-1 min-w-0 flex items-center gap-1.5">
                                  <span className="text-xs truncate">{w.name}</span>
                                  {w.isSystem && <Shield size={9} className="shrink-0 text-muted-foreground" aria-label="System Default" />}
                                </span>
                              </button>
                            );
                          })}
                          {leavesFor(project).length === 0 && (
                            <p className="px-2 py-1 text-xs text-muted-foreground">No items</p>
                          )}
                        </div>
                      )}
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
