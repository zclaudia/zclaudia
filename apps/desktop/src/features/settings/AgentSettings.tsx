import { useState, useEffect, useCallback } from 'react';
import { listLlmProfilesForBackend } from '../../services/api';
import { fetchApiForBackend } from '../../services/api/base';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { ShortcutSettings } from './ShortcutSettings';
import { isDesktopTauri } from '../../utils/platform';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useSettingsTargetBackend } from '../../hooks/useSettingsTargetBackend';
import { TargetBackendBanner, NoTargetBackendNotice } from './ui/TargetBackendNotice';
import { Select } from '../../components/ui/Select';
import { ManagedRuntimeSettings } from './ManagedRuntimeSettings';

interface AgentCapabilities {
  tools: Array<{ id: string; name: string; description: string; scope: string[] }>;
  skills: Array<{ id: string; name: string; description: string }>;
  contextTemplates: string[];
  maxConcurrentTasks: number;
}

export function AgentSettings() {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [providers, setProviders] = useState<LlmProfileConfig[]>([]);
  const config = useAgentConfigStore(s => s.config);
  const loadConfig = useAgentConfigStore(s => s.loadConfig);
  const updateConfig = useAgentConfigStore(s => s.updateConfig);
  const loading = useAgentConfigStore(s => s.isLoading);
  const saving = useAgentConfigStore(s => s.isSaving);
  const error = useAgentConfigStore(s => s.error);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Resolve which backend this page edits: this device's local backend when
  // one exists (desktop), otherwise the active backend (mobile has no local
  // backend and this page is its only way to manage these settings). The
  // banner below makes a non-local target explicit to the user.
  const targetBackend = useSettingsTargetBackend();
  const { targetBackendId } = targetBackend;

  const loadData = useCallback(async () => {
    if (!targetBackendId) {
      setMetaLoading(false);
      return;
    }
    setMetaLoading(true);
    setMetaError(null);
    try {
      await loadConfig(targetBackendId);
      const [capsRes, providerList] = await Promise.all([
        fetchApiForBackend<AgentCapabilities>('/api/agent/capabilities', targetBackendId),
        listLlmProfilesForBackend(targetBackendId).catch(() => [] as LlmProfileConfig[]),
      ]);
      if (capsRes.success && capsRes.data) setCapabilities(capsRes.data);
      setProviders(providerList);
    } catch (err: unknown) {
      setMetaError(err instanceof Error ? err.message : 'Failed to load agent settings');
    } finally {
      setMetaLoading(false);
    }
  }, [loadConfig, targetBackendId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveConfig = useCallback(
    async (updates: { enabled?: boolean; llmProfileId?: string | null }) => {
      await updateConfig(updates, targetBackendId);
    },
    [updateConfig, targetBackendId]
  );

  if (!targetBackendId) {
    return (
      <div className="space-y-6">
        <NoTargetBackendNotice />
      </div>
    );
  }

  if (loading || metaLoading) {
    return (
      <div className="space-y-6">
        <div className="p-3 bg-secondary/50 rounded-lg text-sm text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  if ((error || metaError) && !config) {
    return (
      <div className="space-y-6">
        <div className="p-3 bg-destructive/10 rounded-lg text-sm">
          <p className="text-destructive">Could not load agent settings from server.</p>
          <p className="text-xs text-destructive/70 mt-1">{error || metaError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TargetBackendBanner target={targetBackend} />

      {/* General */}
      <div>
        <h3 className="text-sm font-medium mb-3">General</h3>
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm">Claudia</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Personal assistant with tools, skills, and task orchestration
              </p>
            </div>
            <button
              onClick={() => saveConfig({ enabled: !config?.enabled })}
              disabled={saving}
              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                config?.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  config?.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Provider */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm">Provider</span>
              <Select
                value={config?.llmProfileId || ''}
                onChange={next => saveConfig({ llmProfileId: next || null })}
                disabled={saving}
                size="md"
                align="right"
                triggerClassName="min-w-[180px]"
                options={[
                  { value: '', label: 'Default (same as chat)' },
                  ...providers.map(p => ({
                    value: p.id,
                    label: `${p.name}${p.isDefault ? ' (default)' : ''}`,
                  })),
                ]}
              />
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Choose which provider the agent uses
            </p>
          </div>
        </div>
      </div>

      {/* Global Shortcut - desktop only */}
      {isDesktopTauri() && (
        <div>
          <h3 className="text-sm font-medium mb-3">Shortcut</h3>
          <ShortcutSettings disabled={!config?.enabled} />
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium mb-3">Managed Agent CLIs</h3>
        {/* This page already shows the target-backend banner at the top. */}
        <ManagedRuntimeSettings hideTargetBanner />
      </div>

      {/* Capabilities */}
      {capabilities && (
        <div>
          <h3 className="text-sm font-medium mb-3">Capabilities</h3>
          <div className="space-y-2">
            {/* Tools */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">Tools</span>
                <span className="text-xs text-muted-foreground">{capabilities.tools.length}</span>
              </div>
              {capabilities.tools.length === 0 ? (
                <p className="text-xs text-muted-foreground">No agent tools registered.</p>
              ) : (
                <div className="space-y-1">
                  {capabilities.tools.map(tool => (
                    <div key={tool.id} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-foreground/80">{tool.name}</span>
                      <span className="text-muted-foreground truncate ml-2 max-w-[50%] text-right">
                        {tool.description}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Skills */}
            {capabilities.skills.length > 0 && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Skills</span>
                  <span className="text-xs text-muted-foreground">
                    {capabilities.skills.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {capabilities.skills.map(skill => (
                    <div key={skill.id} className="flex items-center justify-between text-xs">
                      <span className="text-foreground/80">{skill.name}</span>
                      {skill.description && (
                        <span className="text-muted-foreground truncate ml-2 max-w-[50%] text-right">
                          {skill.description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Runtime */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">Runtime</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Max Concurrent Tasks</span>
                  <span className="font-mono">{capabilities.maxConcurrentTasks}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Context Templates</span>
                  <span className="font-mono">{capabilities.contextTemplates.join(', ')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
