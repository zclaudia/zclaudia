import { normalizeAgentRuntimeType, isPiAgentRuntime } from '@zclaudia/shared/core/agent-profile';
import { useEffect, useMemo } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useServerStore } from '../../../stores/serverStore';
import { useSessionConfigStore } from '../../../stores/sessionConfigStore';
import * as api from '../../../services/api';
import type { ProviderCapabilities, SlashCommand } from '@zclaudia/shared';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from '../../../actions/controlPlane';
import { useAgentProfileMetaStore } from '../../../stores/agentProfileMetaStore';
import { useAgentForSession } from '../../../hooks/useAgentForSession';

interface UseProviderCapabilitiesOptions {
  sessionId: string;
  isConnected: boolean;
}

export function useProviderCapabilities({
  sessionId,
  isConnected,
}: UseProviderCapabilitiesOptions) {
  const providerCommands = useLlmProfileMetaStore(s => s.providerCommands);
  const providerCapabilities = useLlmProfileMetaStore(s => s.providerCapabilities);
  const setProviderCapabilities = useLlmProfileMetaStore(s => s.setProviderCapabilities);
  const setProviderCommands = useLlmProfileMetaStore(s => s.setProviderCommands);
  const dataServerId = useProjectStore(s => s.dataServerId);
  const sessions = useProjectStore(s => s.sessions);
  const projects = useProjectStore(s => s.projects);
  const activeServerId = useServerStore(s => s.activeServerId);

  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId)
    : null;

  const agentProfilesLoaded = useAgentProfileMetaStore(s => s.loaded);
  const { agent, llm } = useAgentForSession(currentSession?.id);
  const runtimeType = normalizeAgentRuntimeType(agent?.runtimeType);
  const usesPiMetadata = isPiAgentRuntime(runtimeType);
  const llmProfileId = usesPiMetadata ? llm?.id : undefined;
  // Wait for agent profiles only while they are still loading. An orphaned
  // agentProfileId must not block capabilities forever after load completes.
  const isBackendDataReady =
    dataServerId != null &&
    dataServerId === activeServerId &&
    (!currentSession?.agentProfileId || agentProfilesLoaded);
  const providerScopeKey =
    resolveCanonicalBackendId(activeServerId ?? LEGACY_LOCAL_SERVER_ID, LEGACY_LOCAL_SERVER_ID) ||
    LEGACY_LOCAL_SERVER_ID;
  const metadataKey = usesPiMetadata ? llmProfileId || '_default' : `runtime:${runtimeType}`;
  const capsCacheKey = `${providerScopeKey}:${metadataKey}${runtimeType === 'cursor' ? `:${sessionId}:${currentSession?.sdkSessionId ?? 'new'}` : ''}`;
  const commandsCacheKey = `${providerScopeKey}:${metadataKey}`;

  // Fetch commands when provider or project changes (via HTTP)
  useEffect(() => {
    const projectRoot = currentProject?.rootPath;
    const controller = new AbortController();

    if (!isConnected || !isBackendDataReady) {
      return () => controller.abort();
    }

    if (llmProfileId) {
      api
        .getProviderCommands(llmProfileId, projectRoot || undefined, { signal: controller.signal })
        .then(commands => {
          setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('Failed to load provider commands:', err);
        });
    } else {
      api
        .getProviderTypeCommands(runtimeType, projectRoot || undefined, {
          signal: controller.signal,
        })
        .then(commands => {
          setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('Failed to load default commands:', err);
        });
    }

    return () => controller.abort();
  }, [
    runtimeType,
    currentProject?.rootPath,
    isConnected,
    isBackendDataReady,
    commandsCacheKey,
    llmProfileId,
    setProviderCommands,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isConnected || !isBackendDataReady) return () => controller.abort();
    if (providerCapabilities[capsCacheKey]) return () => controller.abort();

    const fetchCaps = llmProfileId
      ? api.getProviderCapabilities(llmProfileId, { signal: controller.signal })
      : runtimeType === 'cursor'
        ? api.getSessionCapabilities(sessionId, { signal: controller.signal })
        : api.getProviderTypeCapabilities(runtimeType, { signal: controller.signal });

    fetchCaps
      .then(caps => {
        setProviderCapabilities(capsCacheKey, caps);
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load provider capabilities:', err);
      });
    return () => controller.abort();
  }, [
    capsCacheKey,
    sessionId,
    runtimeType,
    llmProfileId,
    isConnected,
    isBackendDataReady,
    providerCapabilities,
    setProviderCapabilities,
  ]);

  const capabilities: ProviderCapabilities | null = providerCapabilities[capsCacheKey] || null;

  // When capabilities arrive for a session whose mode is not yet set, seed
  // the session mode from capabilities.defaultModeId so the ModeSelector shows
  // the provider-chosen default (e.g. 'default') instead of falling back to
  // the first capabilities entry. Only fires once per session-with-unset-mode.
  useEffect(() => {
    if (!capabilities) return;
    const chat = useSessionConfigStore.getState();
    if (chat.getMode(sessionId)) return;
    const next = capabilities.defaultModeId || capabilities.modes?.[0]?.id;
    if (next) chat.setMode(sessionId, next);
  }, [sessionId, capabilities]);

  const commands = useMemo<SlashCommand[]>(() => {
    const base = providerCommands[commandsCacheKey] || [];
    const extras: SlashCommand[] = [
      {
        command: '/new-cli-session',
        description: 'Reset underlying provider session (next message starts a fresh CLI session)',
        source: 'local',
      },
      {
        command: '/reset-cli-session',
        description: 'Alias of /new-cli-session',
        source: 'local',
      },
      {
        command: '/goal',
        description: 'Set an autonomous goal — /goal <objective>',
        source: 'local',
      },
    ];

    const seen = new Set(base.map(c => c.command));
    const merged = [...base];
    for (const cmd of extras) {
      if (!seen.has(cmd.command)) merged.push(cmd);
    }
    return merged;
  }, [providerCommands, commandsCacheKey]);

  return {
    llmProfileId,
    capabilities,
    commands,
    commandsCacheKey,
  };
}
