import type { AutomationBackend } from '../automation-types';
import type { AutomationTabScope } from '../AutomationContent';

export function makeBackend(backendId: string, name = backendId, online = true): AutomationBackend {
  return { backendId, name, online };
}

/** A tab scope over the given (online) backends; grouped when more than one. */
export function makeScope(
  backends: AutomationBackend[],
  opts: { projectId?: string; projects?: Map<string, { id: string; name: string }[]> } = {}
): AutomationTabScope {
  const online = backends.filter(b => b.online);
  return {
    allBackends: backends,
    backends: online,
    grouped: online.length > 1,
    projectId: opts.projectId,
    projects: {
      data: opts.projects ?? new Map(),
      errors: new Map(),
      loading: false,
      refresh: () => {},
    },
  };
}
