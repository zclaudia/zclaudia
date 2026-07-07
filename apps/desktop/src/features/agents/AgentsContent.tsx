/**
 * Agents management content rendered inline in the main pane.
 *
 * Selection comes from the sidebar's AgentsTree/SkillsTree/McpServersTree/
 * ProvidersTree (via topLevelViewStore); this component owns only the detail
 * header + editor body. Saves and deletes bump the shared refresh nonce so the
 * trees refetch; profile and provider mutations additionally refresh the global
 * stores when the edited backend is the app's active backend (skills and MCP
 * mutations never touch those stores).
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import { resolveCanonicalBackendId } from '../../utils/controlPlane';
import { listLlmProfilesForBackend } from '../../services/api';
import { ProfileEditor } from './ProfileEditor';
import { SkillEditor } from './SkillEditor';
import { SkillDirsEditor } from './SkillDirsEditor';
import { McpServerEditor } from './McpServerEditor';
import { LlmProfileEditor } from './LlmProfileEditor';
import { useSavedBridge } from './useSavedBridge';
import { BrowseView } from './BrowseView';
import { NewItemMenu, resolveNewTarget } from './NewItemMenu';
import { useAgentsLibrary } from './useAgentsLibrary';
import type { AgentsBackend, AgentsSelection, LibraryItem } from './agents-types';
import type { ProfilesByBackend } from './useProfilesByBackend';
import type { SkillsByBackend } from './useSkillsByBackend';
import type { McpServersByBackend } from './useMcpServersByBackend';
import type { LlmProfilesByBackend } from './useLlmProfilesByBackend';

interface AgentsContentProps {
  backends: AgentsBackend[];
  data: ProfilesByBackend;
  skillsData: SkillsByBackend;
  mcpData: McpServersByBackend;
  providersData: LlmProfilesByBackend;
}

type EmptyStateNoun = 'profile' | 'skill' | 'MCP server' | 'provider';

// Pre-articled labels: `a ${noun}` would produce "a MCP server".
const NOUN_WITH_ARTICLE: Record<EmptyStateNoun, string> = {
  profile: 'a profile',
  skill: 'a skill',
  'MCP server': 'an MCP server',
  provider: 'a provider',
};

function EmptyState({ noun, hint }: { noun: EmptyStateNoun; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">Select {NOUN_WITH_ARTICLE[noun]}</p>
      <p className="mt-1 text-xs opacity-60">
        {hint ?? `Choose ${NOUN_WITH_ARTICLE[noun]} from the sidebar, or create one with +.`}
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

export function AgentsContent({
  backends,
  data,
  skillsData,
  mcpData,
  providersData,
}: AgentsContentProps) {
  const view = useTopLevelViewStore(s => s.view);
  const selection = useTopLevelViewStore(s => s.agentsSelection);
  const selectAgentsItem = useTopLevelViewStore(s => s.selectAgentsItem);
  const bumpAgentsRefresh = useTopLevelViewStore(s => s.bumpAgentsRefresh);
  const activeServerId = useServerStore(s => s.activeServerId);
  const localBackendId = useFacadeStore(s => s.localBackendId);

  const activeTab = view.kind === 'agents' ? view.tab : 'all';
  const backendFilter = useTopLevelViewStore(s => s.agentsBackendFilter);
  const setBackendFilter = useTopLevelViewStore(s => s.setAgentsBackendFilter);
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  const libraryItems = useAgentsLibrary(
    {
      profiles: data.profiles,
      skills: skillsData.skills,
      servers: mcpData.servers,
      llmProfiles: providersData.profiles,
    },
    backends,
    { tab: activeTab, backendFilter }
  );

  const openItem = (item: LibraryItem) =>
    selectAgentsItem(
      item.kind === 'profile'
        ? { backendId: item.backendId, kind: 'profile', id: item.id }
        : item.kind === 'skill'
          ? { backendId: item.backendId, kind: 'skill', id: item.id }
          : item.kind === 'mcp-server'
            ? { backendId: item.backendId, kind: 'mcp-server', id: item.id }
            : { backendId: item.backendId, kind: 'llm-profile', id: item.id }
    );

  const backendForNew = () =>
    backendFilter !== 'all' ? backendFilter : (backends[0]?.backendId ?? localBackendId ?? '');

  const startNew = () => {
    const target = resolveNewTarget(activeTab);
    if (target === 'menu') {
      setNewMenuOpen(true);
      return;
    }
    selectAgentsItem({ backendId: backendForNew(), kind: target } as AgentsSelection);
  };

  // Just-saved bridges: save handlers re-select the saved id before the nonce
  // refetch lands, so the fetched maps are briefly stale. Each bridge remembers
  // what was just saved until the refetch delivers it — or SETTLES without it
  // (then the normal stale/error branches take over; see useSavedBridge).
  //
  // Profiles carry the full saved object (the editor keeps rendering from it,
  // no empty-state flash); skills' onSaved only reports the id, so that bridge
  // is an id-only marker that just keeps the Loading chrome up.
  const profileBridge = useSavedBridge<AgentProfileConfig>({
    loading: data.loading,
    contains: (backendId, id) => (data.profiles.get(backendId) ?? []).some(p => p.id === id),
  });
  const skillBridge = useSavedBridge<never>({
    loading: skillsData.loading,
    contains: (backendId, id) => (skillsData.skills.get(backendId) ?? []).some(s => s.id === id),
  });
  // MCP mirrors skills: McpServerEditor's onSaved reports only the id.
  const mcpBridge = useSavedBridge<never>({
    loading: mcpData.loading,
    contains: (backendId, id) => (mcpData.servers.get(backendId) ?? []).some(s => s.id === id),
  });
  // Providers mirror MCP: LlmProfileEditor's onSaved reports only the id.
  const llmProfileBridge = useSavedBridge<never>({
    loading: providersData.loading,
    contains: (backendId, id) =>
      (providersData.profiles.get(backendId) ?? []).some(p => p.id === id),
  });

  if (!selection) {
    return (
      <div className="relative h-full">
        <BrowseView
          tab={activeTab}
          backendFilter={backendFilter}
          backends={backends}
          items={libraryItems}
          onOpen={openItem}
          onSelectBackendFilter={setBackendFilter}
          onNew={startNew}
        />
        {newMenuOpen && (
          <div className="absolute right-4 top-14">
            <NewItemMenu
              onPick={kind => {
                setNewMenuOpen(false);
                selectAgentsItem({ backendId: backendForNew(), kind } as AgentsSelection);
              }}
              onClose={() => setNewMenuOpen(false)}
            />
          </div>
        )}
      </div>
    );
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

  // Provider (LLM profile) counterpart of refreshGlobalStoresIfActive.
  //
  // Key audit of useLlmProfileMetaStore.providersByBackend: every writer keys
  // by the RAW activeServerId — useDataLoader/SessionChatWindow/
  // WorkflowEditorWindow call projectStore.setProviders(), which forwards
  // `useServerStore.getState().activeServerId` verbatim, and the settings
  // components (ProjectSettings/PermissionSettings) pass `activeServerId`
  // explicitly. Every reader (useSidebarData, useChatSession,
  // useAgentForSession, LocalPRCard, projectStore.getProviders) also passes the
  // raw `activeServerId`. So the map is uniformly keyed on the raw active id,
  // which may still be the legacy 'local' string rather than the canonical
  // backend id. We therefore always cache under the canonical edited backend id
  // (future-proof, harmless) AND, when the edited backend is the active one but
  // the raw key differs (the legacy-'local' case), mirror under the raw key so
  // today's readers actually see the fresh list.
  const syncLlmProfileGlobalStoresIfActive = async () => {
    const activeBackendId = resolveCanonicalBackendId(activeServerId, localBackendId);
    const editedIsActive = editedBackendId === activeBackendId;
    if (editedIsActive) {
      // Provider mutations can flip agent readiness (e.g. adding the first
      // credentialed profile) — refresh the gate like the profiles path does.
      void useAgentReadinessStore.getState().refresh();
    }
    try {
      const list = await listLlmProfilesForBackend(editedBackendId);
      const { setProviders } = useLlmProfileMetaStore.getState();
      setProviders(list, editedBackendId);
      if (editedIsActive && activeServerId && activeServerId !== editedBackendId) {
        setProviders(list, activeServerId);
      }
    } catch (err) {
      // Best-effort cache refresh: the Providers tree still refetches via the
      // nonce bump, and stale global data self-heals on the next data load.
      console.warn('[AgentsContent] provider cache refresh failed:', err);
    }
  };

  const handleSkillSaved = (id: string) => {
    skillBridge.record(editedBackendId, id);
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
      const bridged =
        selection.kind === 'profile'
          ? profileBridge.lookup(selection.backendId, selection.id)
          : undefined;
      const bridgedProfile = bridged !== undefined && bridged !== true ? bridged : null;
      // The fetched object wins once it exists; the bridge only spans the gap.
      const profile = fetchedProfile ?? bridgedProfile;

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
        profileBridge.record(editedBackendId, saved.id, saved);
        bumpAgentsRefresh();
        // Create mode lands on the newly created profile's id; the editor remounts
        // (its key flips from ':new' to the id) populated from the bridge.
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
        const justSaved = skillBridge.lookup(editedBackendId, selection.id) === true;
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

    case 'llm-profile':
    case 'new-llm-profile': {
      const llmProfile =
        selection.kind === 'llm-profile'
          ? ((providersData.profiles.get(editedBackendId) ?? []).find(p => p.id === selection.id) ??
            null)
          : null;

      if (selection.kind === 'llm-profile' && !llmProfile) {
        const justSaved = llmProfileBridge.lookup(editedBackendId, selection.id) === true;
        if (providersData.loading || justSaved) {
          // A refetch is in flight (or a save's nonce bump hasn't landed yet):
          // keep the detail chrome instead of flashing the empty state.
          return (
            <DetailShell title={selection.id} backendName={backendName}>
              <p className="text-sm text-muted-foreground">Loading…</p>
            </DetailShell>
          );
        }
        // Stale selection after the fetch settled — same fallback semantics as
        // the other tabs: quiet empty state, with an error hint when the fetch
        // failed.
        return (
          <EmptyState
            noun="provider"
            hint={
              providersData.errors.has(editedBackendId)
                ? "Couldn't load providers for this backend."
                : undefined
            }
          />
        );
      }

      // Unlike skills/MCP — and like agent profiles — provider mutations feed
      // the app-wide caches (LLM profile list + readiness gate).
      const handleSaved = (id: string) => {
        llmProfileBridge.record(editedBackendId, id);
        bumpAgentsRefresh();
        // Create mode lands on the newly created provider's id; the marker
        // bridges the gap until the refetch delivers the record.
        selectAgentsItem({ backendId: editedBackendId, kind: 'llm-profile', id });
        void syncLlmProfileGlobalStoresIfActive();
      };

      const handleDeleted = () => {
        selectAgentsItem(null);
        bumpAgentsRefresh();
        void syncLlmProfileGlobalStoresIfActive();
      };

      const title = selection.kind === 'llm-profile' ? (llmProfile?.name ?? '') : 'New provider';

      return (
        <DetailShell title={title} backendName={backendName}>
          <LlmProfileEditor
            key={`${editedBackendId}:${selection.kind === 'llm-profile' ? selection.id : 'new'}`}
            backendId={editedBackendId}
            profile={llmProfile}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        </DetailShell>
      );
    }

    case 'mcp-server':
    case 'new-mcp-server': {
      const server =
        selection.kind === 'mcp-server'
          ? ((mcpData.servers.get(editedBackendId) ?? []).find(s => s.id === selection.id) ?? null)
          : null;

      if (selection.kind === 'mcp-server' && !server) {
        const justSaved = mcpBridge.lookup(editedBackendId, selection.id) === true;
        if (mcpData.loading || justSaved) {
          // A refetch is in flight (or a save's nonce bump hasn't landed yet):
          // keep the detail chrome instead of flashing the empty state.
          return (
            <DetailShell title={selection.id} backendName={backendName}>
              <p className="text-sm text-muted-foreground">Loading…</p>
            </DetailShell>
          );
        }
        // Stale selection after the fetch settled — same fallback semantics as
        // profiles/skills: quiet empty state, with an error hint when the fetch failed.
        return (
          <EmptyState
            noun="MCP server"
            hint={
              mcpData.errors.has(editedBackendId)
                ? "Couldn't load MCP servers for this backend."
                : undefined
            }
          />
        );
      }

      // Statuses are keyed by server NAME (not id) — see useMcpServersByBackend.
      // A missing statuses entry means "statuses unavailable" and renders as
      // undefined status (the editor treats it as not connected).
      const status = server ? mcpData.statuses.get(editedBackendId)?.[server.name] : undefined;

      // Like skills — and unlike profiles — MCP mutations never touch the
      // global profile stores.
      const handleSaved = (id: string) => {
        mcpBridge.record(editedBackendId, id);
        bumpAgentsRefresh();
        // Create mode lands on the newly created server's id; the marker bridges
        // the gap until the refetch delivers the record.
        selectAgentsItem({ backendId: editedBackendId, kind: 'mcp-server', id });
      };

      const handleDeleted = () => {
        selectAgentsItem(null);
        bumpAgentsRefresh();
      };

      const title = selection.kind === 'mcp-server' ? (server?.name ?? '') : 'New MCP server';

      return (
        <DetailShell title={title} backendName={backendName}>
          <McpServerEditor
            key={`${editedBackendId}:${selection.kind === 'mcp-server' ? selection.id : 'new'}`}
            backendId={editedBackendId}
            server={server}
            status={status}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            // Connect/disconnect/refresh/toggle/oauth changed connection state —
            // bump so the statuses refetch.
            onStatusChanged={bumpAgentsRefresh}
          />
        </DetailShell>
      );
    }

    default: {
      // Exhaustiveness gate: adding a selection kind must fail compilation
      // here until it gets a case above.
      const unhandled: never = selection;
      return unhandled;
    }
  }
}
