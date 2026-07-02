import { create } from 'zustand';
import type {
  Project,
  Session,
  SlashCommand,
  LlmProfileConfig,
  ProviderCapabilities,
} from '@zclaudia/shared';
import { useRunStore } from './runStore';
import { useLlmProfileMetaStore } from './llmProfileMetaStore';
import { useServerStore } from './serverStore';
import { useOwnershipStore } from './ownershipStore';
import { parseBackendId } from './gatewayStore';
import {
  getControlPlaneMode,
  resolveCanonicalBackendId,
  resolveLocalBackendId,
} from '../utils/controlPlane';
import { useSelectionStore } from './selectionStore';
import { useRightWorkspaceStore } from './rightWorkspaceStore';

export type ProjectDashboardView =
  | 'home'
  | 'tasks'
  | 'local-prs'
  | 'issues'
  | 'spec'
  | 'supervisor'
  | 'git';

interface ProjectState {
  projects: Project[];
  sessions: Session[];
  dataServerId: string | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  dashboardViews: Record<string, ProjectDashboardView>;

  /**
   * Provider data is kept here for backward compatibility.
   * New code should use useLlmProfileMetaStore directly.
   * Writes are synced to llmProfileMetaStore automatically.
   */
  providers: LlmProfileConfig[];
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;

  // Actions — projects
  setProjects: (projects: Project[]) => void;
  replaceProjectsForBackend: (backendId: string, projects: Project[]) => void;
  upsertProjectForBackend: (backendId: string, project: Project) => void;
  removeProjectForBackend: (backendId: string, projectId: string) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  reorderProjects: (orderedIds: string[]) => void;

  // Actions — sessions
  setSessions: (sessions: Session[]) => void;
  mergeSessions: (incoming: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  setSessionActive: (sessionId: string, isActive: boolean) => void;
  reorderSessions: (projectId: string, orderedIds: string[]) => void;

  // Actions — providers (synced to llmProfileMetaStore)
  setProviders: (providers: LlmProfileConfig[]) => void;
  setDataServerId: (serverId: string | null) => void;

  // Actions — selection & UI
  selectProject: (id: string | null) => void;
  selectSession: (id: string | null, projectId?: string | null) => void;
  setDashboardView: (projectId: string, view: ProjectDashboardView) => void;

  // Actions — provider metadata (synced to llmProfileMetaStore)
  setProviderCommands: (llmProfileId: string, commands: SlashCommand[]) => void;
  setProviderCapabilities: (llmProfileId: string, capabilities: ProviderCapabilities) => void;
}

export const useProjectStore = create<ProjectState>(set => ({
  projects: [],
  sessions: [],
  providers: [],
  dataServerId: null,
  selectedProjectId: null,
  selectedSessionId: null,
  dashboardViews: {},
  providerCommands: {},
  providerCapabilities: {},

  // ── Project actions ──

  setProjects: projects => {
    const activeBackendId = resolveOwnershipBackendId();
    if (activeBackendId) {
      useOwnershipStore.getState().removeProjectOwnersByBackend(activeBackendId);
      useOwnershipStore.getState().setProjectOwners(
        projects.map(p => p.id),
        activeBackendId
      );
    }
    set({ projects });
  },

  replaceProjectsForBackend: (backendId, projects) =>
    set(state => {
      const ownership = useOwnershipStore.getState();
      const acceptedProjects = projects.filter(project => {
        const ownerBackendId = ownership.getProjectBackendId(project.id);
        if (ownerBackendId && ownerBackendId !== backendId) {
          console.warn(
            `[ProjectStore] Ignoring project snapshot collision for ${project.id}: owner=${ownerBackendId} incoming=${backendId}`
          );
          return false;
        }
        return true;
      });
      const acceptedById = new Map(acceptedProjects.map(p => [p.id, p]));

      // Shallow equality short-circuit: same set + same updatedAt for this backend
      const currentBackendProjects = state.projects.filter(
        project => ownership.getProjectBackendId(project.id) === backendId
      );
      if (
        currentBackendProjects.length === acceptedProjects.length &&
        currentBackendProjects.every(cur => {
          const incoming = acceptedById.get(cur.id);
          return incoming !== undefined && cur.updatedAt === incoming.updatedAt;
        })
      ) {
        return state;
      }

      // Order-preserving merge: walk the existing array, replace this-backend
      // entries in place, drop ones missing from the new snapshot, leave other
      // backends untouched. Brand-new projects from this backend get appended
      // at the end. Avoids segregating the array into [otherBackend, currentBackend]
      // which used to push the current backend's projects to the tail on every
      // snapshot replay.
      const seen = new Set<string>();
      const next: Project[] = [];
      for (const existing of state.projects) {
        const ownerBackendId = ownership.getProjectBackendId(existing.id);
        if (ownerBackendId === backendId || acceptedById.has(existing.id)) {
          const incoming = acceptedById.get(existing.id);
          if (!incoming) continue; // owned by this backend but no longer present in snapshot — drop
          next.push(mergeProjectPreservingFields(existing, incoming));
          seen.add(existing.id);
        } else {
          next.push(existing);
        }
      }
      for (const project of acceptedProjects) {
        if (seen.has(project.id)) continue;
        next.push(mergeProjectPreservingFields(undefined, project));
      }

      ownership.removeProjectOwnersByBackend(backendId);
      ownership.setProjectOwners(
        acceptedProjects.map(project => project.id),
        backendId
      );
      return { projects: next };
    }),

  upsertProjectForBackend: (backendId, project) =>
    set(state => {
      const ownership = useOwnershipStore.getState();
      const existingOwnerBackendId = ownership.getProjectBackendId(project.id);

      if (existingOwnerBackendId && existingOwnerBackendId !== backendId) {
        console.warn(
          `[ProjectStore] Ignoring project event collision for ${project.id}: owner=${existingOwnerBackendId} incoming=${backendId}`
        );
        return state;
      }

      ownership.setProjectOwner(project.id, backendId);
      const existingIndex = state.projects.findIndex(
        existingProject => existingProject.id === project.id
      );
      const mergedProject = mergeProjectPreservingFields(
        existingIndex >= 0 ? state.projects[existingIndex] : undefined,
        project
      );

      // Preserve array position whenever the project already exists — even if
      // ownership wasn't recorded (e.g. setProjects ran before activeServerId
      // was ready). Otherwise the project visibly jumps to the end on the
      // first project_upsert event after launch.
      if (existingIndex >= 0) {
        const next = state.projects.slice();
        next[existingIndex] = mergedProject;
        return { projects: next };
      }

      return { projects: [...state.projects, mergedProject] };
    }),

  removeProjectForBackend: (backendId, projectId) =>
    set(state => {
      const ownership = useOwnershipStore.getState();
      if (ownership.getProjectBackendId(projectId) !== backendId) {
        return state;
      }

      ownership.removeProjectOwner(projectId);
      return {
        projects: state.projects.filter(project => project.id !== projectId),
        sessions: state.sessions.filter(session => session.projectId !== projectId),
        selectedProjectId: state.selectedProjectId === projectId ? null : state.selectedProjectId,
        selectedSessionId:
          state.sessions.find(session => session.id === state.selectedSessionId)?.projectId ===
          projectId
            ? null
            : state.selectedSessionId,
      };
    }),

  addProject: project =>
    set(state => {
      const activeBackendId = resolveOwnershipBackendId();
      if (activeBackendId) {
        useOwnershipStore.getState().setProjectOwner(project.id, activeBackendId);
      }
      // Dedup by id: WebSocket project_upsert may have already added this project
      // before the HTTP response returned (race window common with remote backends
      // through the gateway). Without this guard the list shows the same project twice.
      const existingIndex = state.projects.findIndex(p => p.id === project.id);
      if (existingIndex >= 0) {
        const next = state.projects.slice();
        next[existingIndex] = mergeProjectPreservingFields(next[existingIndex], project);
        return { projects: next };
      }
      return { projects: [...state.projects, project] };
    }),

  updateProject: (id, updates) =>
    set(state => ({
      projects: state.projects.map(p => (p.id === id ? { ...p, ...updates } : p)),
    })),

  deleteProject: id =>
    set(state => {
      useOwnershipStore.getState().removeProjectOwner(id);
      return {
        projects: state.projects.filter(p => p.id !== id),
        sessions: state.sessions.filter(s => s.projectId !== id),
        selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
        selectedSessionId:
          state.sessions.find(s => s.id === state.selectedSessionId)?.projectId === id
            ? null
            : state.selectedSessionId,
      };
    }),

  reorderProjects: orderedIds =>
    set(state => {
      const idToProject = new Map(state.projects.map(p => [p.id, p]));
      const reordered = orderedIds.map(id => idToProject.get(id)).filter((p): p is Project => !!p);
      for (const p of state.projects) {
        if (!orderedIds.includes(p.id)) reordered.push(p);
      }
      return { projects: reordered };
    }),

  // ── Session actions ──

  setSessions: sessions => {
    assignSessionOwnersForSessions(sessions);
    set({ sessions });
  },

  mergeSessions: incoming =>
    set(state => {
      assignSessionOwnersForSessions(incoming);
      const merged = incoming.map(s => {
        const existing = state.sessions.find(e => e.id === s.id);
        if (!existing) {
          return { ...s, isActive: Boolean((s as Session & { isActive?: boolean }).isActive) };
        }

        const incomingIsActive = (s as Session & { isActive?: boolean }).isActive;
        const hasIncomingActive = typeof incomingIsActive === 'boolean';

        if (!hasIncomingActive) {
          return {
            ...s,
            isActive: Boolean((existing as Session & { isActive?: boolean }).isActive),
          };
        }

        if (existing.isActive && incomingIsActive === false) {
          const chat = useRunStore.getState();
          const hasForegroundRun = Object.entries(chat.activeRuns).some(
            ([runId, sid]) => sid === s.id && !chat.backgroundRunIds.has(runId)
          );
          if (hasForegroundRun) {
            return { ...s, isActive: true };
          }
        }

        return { ...s, isActive: incomingIsActive };
      });
      return { sessions: merged };
    }),

  addSession: session =>
    set(state => {
      assignSessionOwnersForSessions([session]);
      return { sessions: [...state.sessions, session] };
    }),

  updateSession: (id, updates) =>
    set(state => ({
      sessions: state.sessions.map(s => (s.id === id ? { ...s, ...updates } : s)),
    })),

  deleteSession: id =>
    set(state => {
      useOwnershipStore.getState().removeSessionOwner(id);
      useRightWorkspaceStore.getState().removeSession(id);
      return {
        sessions: state.sessions.filter(s => s.id !== id),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
      };
    }),

  setSessionActive: (sessionId, isActive) =>
    set(state => ({
      sessions: state.sessions.map(s => (s.id === sessionId ? { ...s, isActive } : s)),
    })),

  reorderSessions: (projectId, orderedIds) =>
    set(state => {
      const projectSessionIds = new Set(orderedIds);
      const idToSession = new Map(
        state.sessions.filter(s => s.projectId === projectId).map(s => [s.id, s])
      );
      const reordered = orderedIds.map(id => idToSession.get(id)).filter((s): s is Session => !!s);
      for (const s of state.sessions) {
        if (s.projectId === projectId && !projectSessionIds.has(s.id)) reordered.push(s);
      }
      const nextSessions: Session[] = [];
      let inserted = false;
      for (const session of state.sessions) {
        if (session.projectId === projectId) {
          if (!inserted) {
            nextSessions.push(...reordered);
            inserted = true;
          }
          continue;
        }
        nextSessions.push(session);
      }
      if (!inserted) {
        nextSessions.push(...reordered);
      }
      return { sessions: nextSessions };
    }),

  // ── Provider actions (synced to llmProfileMetaStore) ──

  setProviders: providers => {
    const getState = (useServerStore as { getState?: () => { activeServerId?: string | null } })
      .getState;
    useLlmProfileMetaStore.getState().setProviders(providers, getState?.().activeServerId);
  },

  setDataServerId: serverId => set({ dataServerId: serverId }),

  // ── Selection & UI actions ──

  selectProject: id =>
    set(state => {
      if (state.selectedProjectId === id) {
        return state;
      }
      useSelectionStore.getState().setSelectedProjectId(id);
      return { selectedProjectId: id };
    }),

  selectSession: (id, projectId) =>
    set(state => {
      if (state.selectedSessionId === id) {
        return state;
      }

      const session = state.sessions.find(s => s.id === id);
      const nextSelectedProjectId = projectId ?? session?.projectId ?? state.selectedProjectId;
      useSelectionStore.getState().setSelectedSessionId(id);
      useSelectionStore.getState().setSelectedProjectId(nextSelectedProjectId);

      return {
        selectedSessionId: id,
        selectedProjectId: nextSelectedProjectId,
      };
    }),

  setDashboardView: (projectId, view) =>
    set(state => {
      useSelectionStore.getState().setDashboardView(projectId, view);
      return {
        dashboardViews: {
          ...state.dashboardViews,
          [projectId]: view,
        },
      };
    }),

  // ── Provider metadata (synced to llmProfileMetaStore) ──

  setProviderCommands: (llmProfileId, commands) => {
    useLlmProfileMetaStore.getState().setProviderCommands(llmProfileId, commands);
  },

  setProviderCapabilities: (llmProfileId, capabilities) => {
    useLlmProfileMetaStore.getState().setProviderCapabilities(llmProfileId, capabilities);
  },
}));

function syncLegacyProviderSnapshot(activeServerId?: string | null): void {
  const providerMetaState = useLlmProfileMetaStore.getState();
  useProjectStore.setState({
    providers: providerMetaState.getProviders(activeServerId),
    providerCommands: providerMetaState.providerCommands,
    providerCapabilities: providerMetaState.providerCapabilities,
  });
}

function syncSelectionSnapshot(): void {
  const selectionState = useSelectionStore.getState();
  useProjectStore.setState({
    selectedProjectId: selectionState.selectedProjectId,
    selectedSessionId: selectionState.selectedSessionId,
    dashboardViews: selectionState.dashboardViews,
  });
}

const providerMetaSubscribe = (
  useLlmProfileMetaStore as typeof useLlmProfileMetaStore & {
    subscribe?: (listener: () => void) => () => void;
  }
).subscribe;

providerMetaSubscribe?.(() => {
  syncLegacyProviderSnapshot(useServerStore.getState().activeServerId);
});

const serverStoreSubscribe = (
  useServerStore as typeof useServerStore & {
    subscribe?: (
      listener: (
        state: ReturnType<typeof useServerStore.getState>,
        prevState: ReturnType<typeof useServerStore.getState>
      ) => void
    ) => () => void;
  }
).subscribe;

serverStoreSubscribe?.((state, prevState) => {
  if (state.activeServerId !== prevState.activeServerId) {
    syncLegacyProviderSnapshot(state.activeServerId);
  }
});

const selectionStoreSubscribe = (
  useSelectionStore as typeof useSelectionStore & {
    subscribe?: (listener: () => void) => () => void;
  }
).subscribe;

selectionStoreSubscribe?.(() => {
  syncSelectionSnapshot();
});

function resolveOwnershipBackendId(): string | null {
  const activeServerId = useServerStore.getState().activeServerId ?? null;
  if (!activeServerId) return null;

  const parsedBackendId = parseBackendId(activeServerId) ?? activeServerId;
  if (getControlPlaneMode() !== 'embedded-local') {
    return parsedBackendId;
  }

  return resolveCanonicalBackendId(parsedBackendId, resolveLocalBackendId() ?? parsedBackendId);
}

function resolveOwnershipBackendIdForSession(session: Session): string | null {
  const ownership = useOwnershipStore.getState();
  const projectOwnerBackendId = ownership.getProjectBackendId(session.projectId);
  if (projectOwnerBackendId) {
    return projectOwnerBackendId;
  }
  return resolveOwnershipBackendId();
}

function assignSessionOwnersForSessions(sessions: Session[]): void {
  const ownership = useOwnershipStore.getState();
  const grouped = new Map<string, string[]>();

  for (const session of sessions) {
    const backendId = resolveOwnershipBackendIdForSession(session);
    if (!backendId) continue;
    const list = grouped.get(backendId) ?? [];
    list.push(session.id);
    grouped.set(backendId, list);
  }

  for (const [backendId, sessionIds] of grouped) {
    ownership.setSessionOwners(sessionIds, backendId);
  }
}

function mergeProjectPreservingFields(existing: Project | undefined, incoming: Project): Project {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    rootPath: incoming.rootPath ?? existing.rootPath,
    defaultAgentProfileId: incoming.defaultAgentProfileId ?? existing.defaultAgentProfileId,
    systemPrompt: incoming.systemPrompt ?? existing.systemPrompt,
    permissionPolicy: incoming.permissionPolicy ?? existing.permissionPolicy,
    agent: incoming.agent ?? existing.agent,
  };
}
