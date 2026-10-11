import { create } from 'zustand';

export interface ActiveWorkspaceRoute {
  workspaceId: string;
  sessionId: string;
  projectId?: string;
  projectScoped: boolean;
}

interface RouteRegistration {
  owner: number;
  route: ActiveWorkspaceRoute;
}

interface WorkspaceRoutingState {
  registrations: RouteRegistration[];
  active: ActiveWorkspaceRoute | null;
}

/** UI routing is window-local. It never writes project metadata or layout persistence. */
export const useWorkspaceRoutingStore = create<WorkspaceRoutingState>(() => ({ registrations: [], active: null }));
let nextOwner = 0;

export function registerWorkspaceRoute(route: ActiveWorkspaceRoute): () => void {
  const owner = ++nextOwner;
  useWorkspaceRoutingStore.setState(state => ({
    registrations: [...state.registrations, { owner, route }], active: route,
  }));
  // An old cleanup cannot clear a newer owner, including StrictMode remounts.
  return () => useWorkspaceRoutingStore.setState(state => {
    const registrations = state.registrations.filter(item => item.owner !== owner);
    return { registrations, active: registrations.at(-1)?.route ?? null };
  });
}

export { sessionWorkspaceId, workspaceStorageKey } from '../utils/workspaceStorage';
