/**
 * Agents management content rendered inline in the main pane.
 *
 * Selection comes from the sidebar's AgentsTree/SkillsTree (via topLevelViewStore);
 * this component owns only the detail header + editor body. Saves and deletes bump
 * the shared refresh nonce so the trees refetch; profile mutations additionally
 * refresh the global agent stores when the edited backend is the app's active
 * backend (skills mutations never touch those stores).
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import { resolveCanonicalBackendId } from '../../utils/controlPlane';
import { ProfileEditor } from './ProfileEditor';
import { SkillEditor } from './SkillEditor';
import { SkillDirsEditor } from './SkillDirsEditor';
import type { AgentsBackend } from './agents-types';
import type { ProfilesByBackend } from './useProfilesByBackend';
import type { SkillsByBackend } from './useSkillsByBackend';

interface AgentsContentProps {
  backends: AgentsBackend[];
  data: ProfilesByBackend;
  skillsData: SkillsByBackend;
}

function EmptyState({ noun, hint }: { noun: 'profile' | 'skill' | 'MCP server'; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">Select a {noun}</p>
      <p className="mt-1 text-xs opacity-60">
        {hint ?? `Choose a ${noun} from the sidebar, or create one with +.`}
      </p>
    </div>
  );
}

/** Detail header (title + backend name) over a scrollable, width-capped body. */
function DetailShell({
  title,
  backendName,
  children,
}: {
  title: string;
  backendName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-3">
        <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
        {backendName && <span className="text-xs text-muted-foreground/60">{backendName}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>
    </div>
  );
}

export function AgentsContent({ backends, data, skillsData }: AgentsContentProps) {
  const view = useTopLevelViewStore(s => s.view);
  const selection = useTopLevelViewStore(s => s.agentsSelection);
  const selectAgentsItem = useTopLevelViewStore(s => s.selectAgentsItem);
  const bumpAgentsRefresh = useTopLevelViewStore(s => s.bumpAgentsRefresh);
  const activeServerId = useServerStore(s => s.activeServerId);
  const localBackendId = useFacadeStore(s => s.localBackendId);

  // Optimistic overlay: handleProfileSaved re-selects the saved id before the
  // nonce refetch lands, so the fetched map is briefly stale. Holding the
  // just-saved profile keeps the editor visible (no empty-state flash) until
  // the refetch becomes authoritative.
  const [savedOverlay, setSavedOverlay] = useState<{
    backendId: string;
    profile: AgentProfileConfig;
  } | null>(null);

  // Drop the overlay once the fetched map contains its id (the fetch is now
  // authoritative) or when the selection moves to a different identity.
  useEffect(() => {
    if (!savedOverlay) return;
    const matchesSelection =
      selection?.kind === 'profile' &&
      selection.backendId === savedOverlay.backendId &&
      selection.id === savedOverlay.profile.id;
    const fetched = (data.profiles.get(savedOverlay.backendId) ?? []).some(
      p => p.id === savedOverlay.profile.id
    );
    if (!matchesSelection || fetched) setSavedOverlay(null);
  }, [savedOverlay, selection, data]);

  // Skill counterpart to the profile overlay. SkillEditor's onSaved only
  // reports the id (not the full object), so this marker can't carry a record
  // for the editor to render from — it just remembers "this id was just saved"
  // so the detail pane keeps its chrome (muted loading body) instead of
  // flashing the empty state while the nonce refetch is in flight.
  const [savedSkillMarker, setSavedSkillMarker] = useState<{
    backendId: string;
    id: string;
  } | null>(null);

  // Drop the marker once the fetched map contains its id or the selection moves
  // to a different identity — mirrors the profile overlay's lifecycle.
  useEffect(() => {
    if (!savedSkillMarker) return;
    const matchesSelection =
      selection?.kind === 'skill' &&
      selection.backendId === savedSkillMarker.backendId &&
      selection.id === savedSkillMarker.id;
    const fetched = (skillsData.skills.get(savedSkillMarker.backendId) ?? []).some(
      s => s.id === savedSkillMarker.id
    );
    if (!matchesSelection || fetched) setSavedSkillMarker(null);
  }, [savedSkillMarker, selection, skillsData]);

  if (!selection) {
    const activeTab = view.kind === 'agents' ? view.tab : 'profiles';
    return <EmptyState noun={activeTab === 'skills' ? 'skill' : 'profile'} />;
  }

  const editedBackendId = selection.backendId;
  const backendName = backends.find(b => b.backendId === editedBackendId)?.name;

  // Mirrors what the old settings Agents tab used to do after mutations: keep
  // the app-wide agent profile cache and readiness gate fresh — but only when the edited
  // backend is the one the rest of the app is talking to. activeServerId may
  // still hold the legacy 'local' id while editedBackendId is canonical, so
  // canonicalize before comparing. Profile-specific: skills mutations must not
  // trigger this.
  const refreshGlobalStoresIfActive = () => {
    const activeBackendId = resolveCanonicalBackendId(activeServerId, localBackendId);
    if (editedBackendId === activeBackendId) {
      void useAgentProfileMetaStore.getState().loadAll();
      void useAgentReadinessStore.getState().refresh();
    }
  };

  const handleSkillSaved = (id: string) => {
    setSavedSkillMarker({ backendId: editedBackendId, id });
    bumpAgentsRefresh();
    // Create mode lands on the newly created skill's id; the marker bridges the
    // gap until the refetch delivers the record.
    selectAgentsItem({ backendId: editedBackendId, kind: 'skill', id });
  };

  const handleSkillDeleted = () => {
    selectAgentsItem(null);
    bumpAgentsRefresh();
  };

  switch (selection.kind) {
    case 'profile':
    case 'new-profile': {
      const fetchedProfile =
        selection.kind === 'profile'
          ? ((data.profiles.get(selection.backendId) ?? []).find(p => p.id === selection.id) ??
            null)
          : null;
      const overlayProfile =
        selection.kind === 'profile' &&
        savedOverlay &&
        savedOverlay.backendId === selection.backendId &&
        savedOverlay.profile.id === selection.id
          ? savedOverlay.profile
          : null;
      // The fetched object wins once it exists; the overlay only bridges the gap.
      const profile = fetchedProfile ?? overlayProfile;

      // Stale selection (e.g. the profile was deleted elsewhere) falls back to the
      // quiet empty state rather than an editor for a phantom record. When the
      // backend's fetch failed we say so — a missing profile then means "couldn't
      // load", not "deleted".
      if (selection.kind === 'profile' && !profile) {
        return (
          <EmptyState
            noun="profile"
            hint={
              data.errors.has(selection.backendId)
                ? "Couldn't load profiles for this backend."
                : undefined
            }
          />
        );
      }

      const handleSaved = (saved: AgentProfileConfig) => {
        setSavedOverlay({ backendId: editedBackendId, profile: saved });
        bumpAgentsRefresh();
        // Create mode lands on the newly created profile's id; the editor remounts
        // (its key flips from ':new' to the id) populated from the overlay.
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
        <DetailShell title={title} backendName={backendName}>
          <ProfileEditor
            key={`${editedBackendId}:${selection.kind === 'profile' ? selection.id : 'new'}`}
            backendId={editedBackendId}
            profile={profile}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        </DetailShell>
      );
    }

    case 'skill': {
      // Skill ids are unique per backend: the server dedups across sources
      // (skill-tools.ts loadAndCacheSkills/addPluginSkills).
      const skill =
        (skillsData.skills.get(editedBackendId) ?? []).find(s => s.id === selection.id) ?? null;

      if (!skill) {
        const justSaved =
          savedSkillMarker !== null &&
          savedSkillMarker.backendId === editedBackendId &&
          savedSkillMarker.id === selection.id;
        if (skillsData.loading || justSaved) {
          // A refetch is in flight (or a save's nonce bump hasn't landed yet):
          // keep the detail chrome instead of flashing the empty state.
          return (
            <DetailShell title={selection.id} backendName={backendName}>
              <p className="text-sm text-muted-foreground">Loading…</p>
            </DetailShell>
          );
        }
        // Stale selection after the fetch settled — same fallback semantics as
        // profiles: quiet empty state, with an error hint when the fetch failed.
        return (
          <EmptyState
            noun="skill"
            hint={
              skillsData.errors.has(editedBackendId)
                ? "Couldn't load skills for this backend."
                : undefined
            }
          />
        );
      }

      return (
        <DetailShell title={skill.name || skill.id} backendName={backendName}>
          <SkillEditor
            key={`${editedBackendId}:${selection.id}`}
            backendId={editedBackendId}
            skill={skill}
            onSaved={handleSkillSaved}
            onDeleted={handleSkillDeleted}
          />
        </DetailShell>
      );
    }

    case 'new-skill': {
      return (
        <DetailShell title="New skill" backendName={backendName}>
          <SkillEditor
            key={`${editedBackendId}:new`}
            backendId={editedBackendId}
            skill={null}
            onSaved={handleSkillSaved}
            onDeleted={handleSkillDeleted}
          />
        </DetailShell>
      );
    }

    case 'skill-dirs': {
      // A failed dirs fetch must never present an editable empty list: the
      // editor PUTs the whole array on every add/remove, so seeding it with []
      // would silently wipe the backend's configured dirs on the first edit.
      if (skillsData.dirsFailed.has(editedBackendId)) {
        return (
          <DetailShell title="External directories" backendName={backendName}>
            <p className="text-sm text-muted-foreground">
              Couldn't load directories for this backend.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Editing is disabled until the list can be loaded.
            </p>
          </DetailShell>
        );
      }

      const dirs = skillsData.dirs.get(editedBackendId);
      // A missing entry while the fetch is in flight means "not loaded yet",
      // not "empty" — same wipe hazard as a failed fetch.
      if (!dirs && skillsData.loading) {
        return (
          <DetailShell title="External directories" backendName={backendName}>
            <p className="text-sm text-muted-foreground">Loading…</p>
          </DetailShell>
        );
      }

      return (
        <DetailShell title="External directories" backendName={backendName}>
          <SkillDirsEditor
            key={editedBackendId}
            backendId={editedBackendId}
            dirs={dirs ?? []}
            diagnostics={skillsData.diagnostics.get(editedBackendId) ?? []}
            onSaved={bumpAgentsRefresh}
          />
        </DetailShell>
      );
    }

    case 'mcp-server':
    case 'new-mcp-server': {
      // Phase 3 Task 7 replaces this placeholder.
      return <EmptyState noun="MCP server" />;
    }

    default: {
      // Exhaustiveness gate: adding a selection kind must fail compilation
      // here until it gets a case above.
      const unhandled: never = selection;
      return unhandled;
    }
  }
}
