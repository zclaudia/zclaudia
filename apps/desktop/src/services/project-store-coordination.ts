// Cross-store coordination for projectStore. The store keeps its actions,
// but every read/write of another store (ownership, provider metadata,
// selection, run activity, server connection) goes through this service so
// projectStore stays a plain state container with no store-to-store imports.
//
// The provider/selection helpers feed projectStore's legacy mirror fields:
// projectStore.providers/providerCommands/providerCapabilities mirror
// llmProfileMetaStore, and selectedProjectId/selectedSessionId/dashboardViews
// mirror selectionStore. The mirroring subscriptions are registered from
// projectStore (so they exist as soon as the store module loads) but resolve
// the other stores here.
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';
import type { Session } from '@zclaudia/shared/core/session';
import type { SlashCommand } from '@zclaudia/shared/features/commands';
import {
  getControlPlaneMode,
  resolveCanonicalBackendId,
  resolveLocalBackendId,
} from '../actions/controlPlane';
import { getActiveServerId } from './active-backend-coordination';
import { useLlmProfileMetaStore } from '../stores/llmProfileMetaStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useRunStore } from '../stores/runStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useServerStore } from '../stores/serverStore';
import { parseBackendId } from '../stores/gatewayStore';
import type { ProjectDashboardView } from '../stores/selectionTypes';

// ── Backend resolution ────────────────────────────────────────────

/**
 * The backend id that "the currently connected server" maps to for ownership
 * purposes: gateway server ids are unwrapped, and in embedded-local mode the
 * canonical local backend wins.
 */
export function resolveOwnershipBackendId(): string | null {
  const activeServerId = getActiveServerId();
  if (!activeServerId) return null;

  const parsedBackendId = parseBackendId(activeServerId) ?? activeServerId;
  if (getControlPlaneMode() !== 'embedded-local') {
    return parsedBackendId;
  }

  return resolveCanonicalBackendId(parsedBackendId, resolveLocalBackendId() ?? parsedBackendId);
}

// ── Project ownership bookkeeping ─────────────────────────────────

export function getProjectOwnerBackendId(projectId: string): string | null {
  return useOwnershipStore.getState().getProjectBackendId(projectId);
}

export function recordProjectOwner(projectId: string, backendId: string): void {
  useOwnershipStore.getState().setProjectOwner(projectId, backendId);
}

export function recordProjectOwners(projectIds: string[], backendId: string): void {
  useOwnershipStore.getState().setProjectOwners(projectIds, backendId);
}

export function releaseProjectOwner(projectId: string): void {
  useOwnershipStore.getState().removeProjectOwner(projectId);
}

export function releaseProjectOwnersForBackend(backendId: string): void {
  useOwnershipStore.getState().removeProjectOwnersByBackend(backendId);
}

// ── Session ownership assignment ──────────────────────────────────

/**
 * Record ownership for the given sessions: a session inherits its project's
 * owner backend when known, otherwise it falls back to the active backend.
 */
export function assignSessionOwners(sessions: Session[]): void {
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

function resolveOwnershipBackendIdForSession(session: Session): string | null {
  const projectOwnerBackendId = useOwnershipStore.getState().getProjectBackendId(session.projectId);
  if (projectOwnerBackendId) {
    return projectOwnerBackendId;
  }
  return resolveOwnershipBackendId();
}

// ── Run activity read ─────────────────────────────────────────────

/** Whether the session still has a non-background (foreground) run. */
export function sessionHasForegroundRun(sessionId: string): boolean {
  const chat = useRunStore.getState();
  return Object.entries(chat.activeRuns).some(
    ([runId, sid]) => sid === sessionId && !chat.backgroundRunIds.has(runId)
  );
}

// ── Provider metadata mirror (llmProfileMetaStore) ────────────────

export interface LegacyProviderSnapshot {
  providers: LlmProfileConfig[];
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;
}

export function getProviderMetaSnapshot(activeServerId?: string | null): LegacyProviderSnapshot {
  const providerMetaState = useLlmProfileMetaStore.getState();
  return {
    providers: providerMetaState.getProviders(activeServerId),
    providerCommands: providerMetaState.providerCommands,
    providerCapabilities: providerMetaState.providerCapabilities,
  };
}

export function applyProvidersToMetaStore(providers: LlmProfileConfig[]): void {
  useLlmProfileMetaStore.getState().setProviders(providers, getActiveServerId());
}

export function applyProviderCommands(llmProfileId: string, commands: SlashCommand[]): void {
  useLlmProfileMetaStore.getState().setProviderCommands(llmProfileId, commands);
}

export function applyProviderCapabilities(
  llmProfileId: string,
  capabilities: ProviderCapabilities
): void {
  useLlmProfileMetaStore.getState().setProviderCapabilities(llmProfileId, capabilities);
}

/**
 * Notify `onSync` whenever the mirrored provider metadata may have changed:
 * on every llmProfileMetaStore update (with the currently active server) and
 * on active-server switches (providers are keyed per backend).
 */
export function subscribeLegacyProviderSync(onSync: (activeServerId: string | null) => void): void {
  const providerMetaSubscribe = (
    useLlmProfileMetaStore as typeof useLlmProfileMetaStore & {
      subscribe?: (listener: () => void) => () => void;
    }
  ).subscribe;
  providerMetaSubscribe?.(() => onSync(getActiveServerId()));

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
      onSync(state.activeServerId);
    }
  });
}

// ── Selection mirror (selectionStore) ─────────────────────────────

export interface LegacySelectionSnapshot {
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  dashboardViews: Record<string, ProjectDashboardView>;
}

export function getSelectionSnapshot(): LegacySelectionSnapshot {
  const selectionState = useSelectionStore.getState();
  return {
    selectedProjectId: selectionState.selectedProjectId,
    selectedSessionId: selectionState.selectedSessionId,
    dashboardViews: selectionState.dashboardViews,
  };
}

export function pushSelectedProject(projectId: string | null): void {
  useSelectionStore.getState().setSelectedProjectId(projectId);
}

export function pushSelectedSession(sessionId: string | null, projectId: string | null): void {
  const selection = useSelectionStore.getState();
  selection.setSelectedSessionId(sessionId);
  selection.setSelectedProjectId(projectId);
}

export function pushDashboardView(projectId: string, view: ProjectDashboardView): void {
  useSelectionStore.getState().setDashboardView(projectId, view);
}

/** Notify `onSync` on every selectionStore update. */
export function subscribeLegacySelectionSync(onSync: () => void): void {
  const selectionStoreSubscribe = (
    useSelectionStore as typeof useSelectionStore & {
      subscribe?: (listener: () => void) => () => void;
    }
  ).subscribe;
  selectionStoreSubscribe?.(onSync);
}
