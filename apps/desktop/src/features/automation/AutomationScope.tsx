/**
 * Backend / project scoping for the automation tabs — the Agents shell's
 * model: no backend tree in the sidebar, a Backend chip row in the content
 * pane (All + each backend), rows grouped by backend under "All", and a
 * Project chip row once a single backend is picked.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Globe, FolderOpen } from 'lucide-react';
import type { Project } from '@zclaudia/shared';
import { FilterChips } from '../agents/ui/FilterChips';
import { Button } from '../../components/ui/Button';
import { TONE_DOT } from '../../components/ui/tone';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { getProjectsForBackend } from '../../services/api/projects';
import type { AutomationBackend } from './automation-types';
import { isInternalProject } from './automation-types';
import { useAutomationByBackend, type ByBackend } from './useAutomationByBackend';

export type ProjectInfoLite = Pick<Project, 'id' | 'name'>;

/** Projects per backend, so rows can name their project on any backend. */
export function useProjectsByBackend(backends: AutomationBackend[]): ByBackend<ProjectInfoLite[]> {
  return useAutomationByBackend<ProjectInfoLite[]>(backends, api =>
    api.get('/api/projects').then((list: Project[]) => list ?? [])
  );
}

/** Display name for a project on a backend; internal projects read as Global. */
export function projectLabel(
  projects: ByBackend<ProjectInfoLite[]>,
  backendId: string,
  projectId?: string
): string {
  if (!projectId) return 'Global';
  const project = projects.data.get(backendId)?.find(p => p.id === projectId);
  if (!project) return projectId.slice(0, 8);
  return isInternalProject(project.name) ? 'Global' : project.name;
}

/** Meta chunk "⊕ Global" / "▭ project-name". */
export function ScopeChunk({ projectId, label }: { projectId?: string; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {projectId ? (
        <FolderOpen size={12} strokeWidth={1.75} />
      ) : (
        <Globe size={12} strokeWidth={1.75} />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

interface ScopeChipsProps {
  backends: AutomationBackend[];
  /** Tabs whose records are project-scoped show the Project row too. */
  withProjects?: boolean;
}

export function AutomationScopeChips({ backends, withProjects = false }: ScopeChipsProps) {
  const backendFilter = useTopLevelViewStore(s => s.automationBackendFilter);
  const setBackendFilter = useTopLevelViewStore(s => s.setAutomationBackendFilter);
  const projectId = useTopLevelViewStore(s =>
    s.view.kind === 'automations' ? s.view.projectId : undefined
  );
  const setProjectFilter = useTopLevelViewStore(s => s.setAutomationProjectFilter);

  const showBackendRow = backends.length > 1 || backendFilter !== 'all';
  const selectedBackend =
    backendFilter !== 'all' ? backends.find(b => b.backendId === backendFilter) : undefined;
  const showProjectRow = withProjects && !!selectedBackend;

  const [projects, setProjects] = useState<ProjectInfoLite[]>([]);
  useEffect(() => {
    if (!showProjectRow || !selectedBackend) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    getProjectsForBackend(selectedBackend.backendId)
      .then(list => {
        if (!cancelled) setProjects(list.filter(p => !isInternalProject(p.name)));
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showProjectRow, selectedBackend]);

  const backendChips = useMemo(
    () => [
      { key: 'all', label: 'All' },
      ...backends.map(b => ({ key: b.backendId, label: b.name, online: b.online })),
    ],
    [backends]
  );
  const projectChips = useMemo(
    () => [
      { key: '', label: 'All projects' },
      ...projects.map(p => ({ key: p.id, label: p.name })),
    ],
    [projects]
  );

  if (!showBackendRow && !showProjectRow) return null;

  return (
    <div className="space-y-2">
      {showBackendRow && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted-foreground">Backend</span>
          <FilterChips chips={backendChips} activeKey={backendFilter} onSelect={setBackendFilter} />
        </div>
      )}
      {showProjectRow && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted-foreground">Project</span>
          <FilterChips
            chips={projectChips}
            activeKey={projectId ?? ''}
            onSelect={key => setProjectFilter(key || undefined)}
          />
        </div>
      )}
    </div>
  );
}

interface BackendGroupsProps<T> {
  backends: AutomationBackend[];
  catalog: ByBackend<T>;
  grouped: boolean;
  count: (items: T) => number;
  render: (items: T, backend: AutomationBackend) => ReactNode;
  /** Rendered when every backend came back empty. */
  empty: ReactNode;
}

/**
 * Lays rows out per backend. Under a single backend it renders that
 * backend's rows bare; under "All" with several backends each one gets a
 * header (dot + name + count) one level above the section labels.
 */
export function BackendGroups<T>({
  backends,
  catalog,
  grouped,
  count,
  render,
  empty,
}: BackendGroupsProps<T>) {
  const total = backends.reduce((n, b) => {
    const items = catalog.data.get(b.backendId);
    return n + (items ? count(items) : 0);
  }, 0);
  if (total === 0 && catalog.errors.size === 0) return <>{empty}</>;

  return (
    <div className="space-y-5">
      {backends.map(b => {
        const items = catalog.data.get(b.backendId);
        const error = catalog.errors.get(b.backendId);
        const n = items ? count(items) : 0;
        if (!grouped && !error && n === 0) return null;
        return (
          <section key={b.backendId} className="space-y-2.5">
            {grouped && (
              <div className="flex items-center gap-2 px-0.5">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${b.online ? TONE_DOT.success : TONE_DOT.neutral}`}
                />
                <h3 className="text-xs font-medium text-foreground">{b.name}</h3>
                <span className="text-2xs tabular-nums text-muted-foreground/60">{n}</span>
              </div>
            )}
            {error ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <span>
                  Couldn't load from {b.name}: {error}
                </span>
                <Button variant="outline" size="sm" onClick={catalog.refresh} className="shrink-0">
                  Retry
                </Button>
              </div>
            ) : items && n > 0 ? (
              render(items, b)
            ) : (
              <p className="px-0.5 text-xs text-muted-foreground">Nothing here yet</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
