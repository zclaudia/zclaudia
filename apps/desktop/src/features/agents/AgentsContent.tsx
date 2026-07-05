/**
 * Agents management content rendered inline in the main pane.
 *
 * Selection comes from the sidebar's AgentsTree (via topLevelViewStore); this
 * component owns only the detail header + ProfileEditor body. Saves and deletes
 * bump the shared refresh nonce so the tree refetches, and refresh the global
 * agent stores when the edited backend is the app's active backend.
 */

import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import { resolveCanonicalBackendId } from '../../utils/controlPlane';
import { ProfileEditor } from './ProfileEditor';
import type { AgentsBackend } from './agents-types';
import type { ProfilesByBackend } from './useProfilesByBackend';

interface AgentsContentProps {
  backends: AgentsBackend[];
  data: ProfilesByBackend;
}

function EmptyState({ hint }: { hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">Select a profile</p>
      <p className="mt-1 text-xs opacity-60">
        {hint ?? 'Choose a profile from the sidebar, or create one with +.'}
      </p>
    </div>
  );
}

export function AgentsContent({ backends, data }: AgentsContentProps) {
  const selection = useTopLevelViewStore(s => s.agentsSelection);
  const selectAgentsItem = useTopLevelViewStore(s => s.selectAgentsItem);
  const bumpAgentsRefresh = useTopLevelViewStore(s => s.bumpAgentsRefresh);
  const activeServerId = useServerStore(s => s.activeServerId);
  const localBackendId = useFacadeStore(s => s.localBackendId);

  if (!selection) {
    return <EmptyState />;
  }

  const profile =
    selection.kind === 'profile'
      ? ((data.profiles.get(selection.backendId) ?? []).find(p => p.id === selection.id) ?? null)
      : null;

  // Stale selection (e.g. the profile was deleted elsewhere) falls back to the
  // quiet empty state rather than an editor for a phantom record. When the
  // backend's fetch failed we say so — a missing profile then means "couldn't
  // load", not "deleted".
  if (selection.kind === 'profile' && !profile) {
    return (
      <EmptyState
        hint={
          data.errors.has(selection.backendId)
            ? "Couldn't load profiles for this backend."
            : undefined
        }
      />
    );
  }

  const editedBackendId = selection.backendId;
  const backendName = backends.find(b => b.backendId === editedBackendId)?.name;

  // Mirrors what the old settings Agents tab used to do after mutations: keep
  // the app-wide agent profile cache and readiness gate fresh — but only when the edited
  // backend is the one the rest of the app is talking to. activeServerId may
  // still hold the legacy 'local' id while editedBackendId is canonical, so
  // canonicalize before comparing.
  const refreshGlobalStoresIfActive = () => {
    const activeBackendId = resolveCanonicalBackendId(activeServerId, localBackendId);
    if (editedBackendId === activeBackendId) {
      void useAgentProfileMetaStore.getState().loadAll();
      void useAgentReadinessStore.getState().refresh();
    }
  };

  const handleSaved = (saved: AgentProfileConfig) => {
    bumpAgentsRefresh();
    // Create mode lands on the newly created profile's id.
    selectAgentsItem({ backendId: editedBackendId, kind: 'profile', id: saved.id });
    refreshGlobalStoresIfActive();
  };

  const handleDeleted = () => {
    selectAgentsItem(null);
    bumpAgentsRefresh();
    refreshGlobalStoresIfActive();
  };

  const title = selection.kind === 'profile' ? (profile?.name ?? '') : 'New profile';

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-3">
        <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
        {backendName && <span className="text-xs text-muted-foreground/60">{backendName}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">
          <ProfileEditor
            key={`${editedBackendId}:${selection.kind === 'profile' ? selection.id : 'new'}`}
            backendId={editedBackendId}
            profile={profile}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        </div>
      </div>
    </div>
  );
}
