import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { AgentProfileConfig, ThinkingLevel, LlmProfileConfig } from '@zclaudia/shared';
import { ALL_TOOL_NAMES } from '@zclaudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import * as api from '../../services/api';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { isMobileBackendUsable } from '../../services/mobileConnectionState';

interface AgentManagerProps {
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean;
  readOnly?: boolean;
}

type ThinkingLevelOption = '' | ThinkingLevel;
const THINKING_LEVEL_OPTIONS: { value: ThinkingLevelOption; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

export function AgentManager({ isOpen, onClose, inline = false, readOnly = false }: AgentManagerProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });

  const [agents, setAgents] = useState<AgentProfileConfig[]>([]);
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentProfileConfig | null>(null);

  // Form state — mirror LlmProfileManager `form*` naming convention
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLlmProfileId, setFormLlmProfileId] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formEnabledTools, setFormEnabledTools] = useState<string[]>([]);
  const [formThinkingLevel, setFormThinkingLevel] = useState<ThinkingLevelOption>('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [listError, setListError] = useState<string | null>(null);
  const [pendingDeleteAgentId, setPendingDeleteAgentId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);

  useAndroidBack(onClose, isOpen && !inline, 20);

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
    setPendingDeleteAgentId(null);
  };

  const loadData = async () => {
    if (!isConnected) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [agentData, llmData] = await Promise.all([
        api.listAgentProfiles(),
        api.listLlmProfiles(),
      ]);
      setAgents(agentData);
      setLlmProfiles(llmData);
    } catch (error) {
      console.error('Failed to load agent profiles:', error);
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (inline) {
      if (isConnected) {
        loadData();
      }
    } else {
      if (isOpen && isConnected) {
        loadData();
      }
    }
  }, [isOpen, isConnected, inline]);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current !== null) {
        window.clearTimeout(deleteConfirmTimeoutRef.current);
      }
    };
  }, []);

  const resetForm = () => {
    clearDeleteConfirmation();
    setFormName('');
    setFormDescription('');
    setFormLlmProfileId('');
    setFormModel('');
    setFormSystemPrompt('');
    setFormEnabledTools([]);
    setFormThinkingLevel('');
    setFormIsDefault(false);
    setFormError(null);
    setEditingAgent(null);
    setShowAddForm(false);
  };

  const openEditForm = (agent: AgentProfileConfig) => {
    clearDeleteConfirmation();
    setFormName(agent.name);
    setFormDescription(agent.description ?? '');
    setFormLlmProfileId(agent.llmProfileId);
    setFormModel(agent.model);
    setFormSystemPrompt(agent.systemPrompt);
    setFormEnabledTools(agent.enabledTools);
    setFormThinkingLevel((agent.thinkingLevel ?? '') as ThinkingLevelOption);
    setFormIsDefault(agent.isDefault ?? false);
    setFormError(null);
    setEditingAgent(agent);
    setShowAddForm(true);
  };

  const toggleTool = (tool: string) => {
    setFormEnabledTools((current) =>
      current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool]
    );
  };

  const handleSubmit = async () => {
    if (!formName.trim()) return;
    if (!formLlmProfileId) {
      setFormError('LLM Profile is required');
      return;
    }
    if (!formModel.trim()) {
      setFormError('Model is required');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        llmProfileId: formLlmProfileId,
        model: formModel.trim(),
        systemPrompt: formSystemPrompt,
        enabledTools: formEnabledTools,
        thinkingLevel: formThinkingLevel === '' ? undefined : formThinkingLevel,
        isDefault: formIsDefault,
      };

      if (editingAgent) {
        await api.updateAgentProfile(editingAgent.id, payload);
      } else {
        await api.createAgentProfile(payload);
      }

      await loadData();
      resetForm();
    } catch (error) {
      console.error('Failed to save agent profile:', error);
      const message = error instanceof Error ? error.message : String(error);
      setFormError(`Failed to ${editingAgent ? 'update' : 'create'} agent: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingAgentId) return;

    if (pendingDeleteAgentId !== id) {
      clearDeleteConfirmation();
      setPendingDeleteAgentId(id);
      deleteConfirmTimeoutRef.current = window.setTimeout(() => {
        setPendingDeleteAgentId((current) => (current === id ? null : current));
        deleteConfirmTimeoutRef.current = null;
      }, 3000);
      return;
    }

    clearDeleteConfirmation();
    setDeletingAgentId(id);
    setListError(null);
    try {
      await api.deleteAgentProfile(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete agent profile:', error);
      const message = error instanceof Error ? error.message : String(error);
      setListError(message);
    } finally {
      setDeletingAgentId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    clearDeleteConfirmation();
    setListError(null);
    try {
      await api.setDefaultAgentProfile(id);
      await loadData();
    } catch (error) {
      console.error('Failed to set default agent profile:', error);
      const message = error instanceof Error ? error.message : String(error);
      setListError(message);
    }
  };

  if (!isOpen) return null;

  const content = !isConnected ? (
    <p className="text-muted-foreground text-center py-8">Connect to a server first</p>
  ) : loading ? (
    <p className="text-muted-foreground text-center py-8">Loading...</p>
  ) : loadError ? (
    <p className="text-destructive text-center py-8">{loadError}</p>
  ) : showAddForm && !readOnly ? (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Name *</label>
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g., Default Coding Agent"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Description (optional)</label>
        <textarea
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          placeholder="What this agent is for"
          rows={2}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <LlmProfileSelector
        value={formLlmProfileId}
        onChange={(id) => {
          setFormLlmProfileId(id);
          // Clearing the model when the LLM profile changes avoids referencing
          // a model id that doesn't exist in the new profile's models list.
          const newProfile = llmProfiles.find((p) => p.id === id);
          const newProfileModels = newProfile?.models;
          if (formModel && (!newProfileModels || !newProfileModels.some((m) => m.modelId === formModel))) {
            setFormModel('');
          }
        }}
        profiles={llmProfiles}
      />

      <ModelSelector
        value={formModel}
        onChange={setFormModel}
        llmProfile={llmProfiles.find((p) => p.id === formLlmProfileId)}
      />

      <ModelDeclarationWarning
        formModel={formModel}
        llmProfile={llmProfiles.find((p) => p.id === formLlmProfileId)}
      />

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">System Prompt</label>
        <textarea
          value={formSystemPrompt}
          onChange={(e) => setFormSystemPrompt(e.target.value)}
          placeholder="You are a helpful coding agent..."
          rows={10}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Enabled Tools</label>
        <div className="flex flex-wrap gap-2">
          {ALL_TOOL_NAMES.map((tool) => {
            const checked = formEnabledTools.includes(tool);
            return (
              <label
                key={tool}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                  checked
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTool(tool)}
                  aria-label={`enable tool ${tool}`}
                  className="rounded-md border-border"
                />
                <span className="font-mono text-xs">{tool}</span>
              </label>
            );
          })}
        </div>
      </div>

      <ThinkingLevelSelector value={formThinkingLevel} onChange={setFormThinkingLevel} />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="agentIsDefault"
          checked={formIsDefault}
          onChange={(e) => setFormIsDefault(e.target.checked)}
          className="rounded-md border-border bg-secondary"
        />
        <label htmlFor="agentIsDefault" className="text-sm">
          Set as default agent
        </label>
      </div>

      {formError && (
        <p className="text-xs text-destructive">{formError}</p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!formName.trim() || saving}
          className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : editingAgent ? 'Update' : 'Create'}
        </button>
        <button
          onClick={resetForm}
          className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    /* Agent List */
    <div className="space-y-2">
      {listError && (
        <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
          {listError}
        </p>
      )}
      {(agents ?? []).length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No agents configured.<br />
          Add an agent to get started.
        </p>
      ) : (
        (agents ?? []).map((agent) => {
          const llm = llmProfiles.find((p) => p.id === agent.llmProfileId);
          return (
            <div
              key={agent.id}
              className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg hover:bg-secondary"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{agent.name}</span>
                  {agent.isDefault && (
                    <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded-md">
                      Default
                    </span>
                  )}
                </div>
                {agent.description && (
                  <div className="text-xs text-muted-foreground truncate mt-1">{agent.description}</div>
                )}
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  {agent.model} · {llm ? llm.name : `LLM ${agent.llmProfileId.slice(0, 8)}…`}
                </div>
                {agent.enabledTools.length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    tools: {agent.enabledTools.join(', ')}
                  </div>
                )}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1 ml-2">
                  {!agent.isDefault && (
                    <button
                      onClick={() => handleSetDefault(agent.id)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                      title="Set as default"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => openEditForm(agent)}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    disabled={deletingAgentId !== null}
                    className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
                      pendingDeleteAgentId === agent.id
                        ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                        : 'hover:bg-secondary text-destructive hover:text-destructive'
                    }`}
                    title={pendingDeleteAgentId === agent.id ? 'Click again to confirm delete' : 'Delete'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {!readOnly && (
        <button
          onClick={() => {
            clearDeleteConfirmation();
            // Pre-select default LLM profile when adding
            const defaultLlm = llmProfiles.find((p) => p.isDefault) ?? llmProfiles[0];
            if (defaultLlm && !formLlmProfileId) setFormLlmProfileId(defaultLlm.id);
            setShowAddForm(true);
          }}
          className="w-full py-2 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-muted-foreground hover:text-foreground flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Agent
        </button>
      )}
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[600px] md:max-h-[80vh] bg-card rounded-lg shadow-xl z-50 flex flex-col border border-border">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">Agent Management</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{content}</div>
      </div>
    </>
  );
}

/**
 * Soft warning shown beneath the model input when the agent profile's selected
 * model id is not declared on the bound LLM profile's `models` list. We skip
 * the warning when the LLM profile is missing, its `models` list is undefined
 * or empty (backwards-compat / undeclared profile), or the model input is
 * blank.
 */
function ModelDeclarationWarning({
  formModel,
  llmProfile,
}: {
  formModel: string;
  llmProfile: LlmProfileConfig | undefined;
}) {
  const trimmed = formModel.trim();
  if (!trimmed) return null;
  const models = llmProfile?.models;
  if (!models || models.length === 0) return null;
  const known = models.some((m) => m.modelId === trimmed);
  if (known) return null;
  return (
    <p className="text-xs text-amber-600 mt-1">
      This model is not declared on the selected LLM profile. The agent will work but will fall back to pi-ai registry defaults for context window / max tokens.
    </p>
  );
}

/**
 * F2: Model is now a dropdown rather than a free-text input. The valid set
 * comes from the bound LLM profile's `models` list, which the LlmProfileManager
 * now requires at least one of. We still render a degraded state for legacy
 * profiles created before the requirement, so historical agent profiles don't
 * break when their bound LLM profile has no models declared.
 */
function ModelSelector({
  value,
  onChange,
  llmProfile,
}: {
  value: string;
  onChange: (v: string) => void;
  llmProfile: LlmProfileConfig | undefined;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const models = llmProfile?.models ?? [];
  const hasModels = models.length > 0;
  const selectedEntry = models.find((m) => m.modelId === value);
  const displayLabel = selectedEntry
    ? selectedEntry.displayName || selectedEntry.modelId
    : value
      ? value
      : hasModels
        ? 'Select a model'
        : 'No models available — declare models on the LLM profile';

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">Model *</label>
      <button
        type="button"
        onClick={() => hasModels && setOpen(!open)}
        disabled={!hasModels}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left disabled:opacity-50 disabled:cursor-not-allowed font-mono"
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && hasModels && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden max-h-72 overflow-y-auto">
          {models.map((m) => {
            const label = m.displayName || m.modelId;
            return (
              <button
                key={m.modelId}
                type="button"
                onClick={() => {
                  onChange(m.modelId);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  m.modelId === value ? 'text-primary font-medium bg-primary/5' : 'text-foreground hover:bg-secondary/80'
                }`}
              >
                <span className="w-4 flex-shrink-0">
                  {m.modelId === value && <Check size={14} strokeWidth={2.5} />}
                </span>
                <span className="font-mono truncate">{label}</span>
                {label !== m.modelId && (
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">{m.modelId}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LlmProfileSelector({
  value,
  onChange,
  profiles,
}: {
  value: string;
  onChange: (v: string) => void;
  profiles: LlmProfileConfig[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = profiles.find((p) => p.id === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">LLM Profile *</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left"
      >
        <span>{selected ? selected.name : (profiles.length === 0 ? 'No LLM profiles available' : 'Select an LLM profile')}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && profiles.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                p.id === value ? 'text-primary font-medium bg-primary/5' : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {p.id === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              <span className="truncate">{p.name}</span>
              {p.isDefault && (
                <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] rounded-md">Default</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingLevelSelector({
  value,
  onChange,
}: {
  value: ThinkingLevelOption;
  onChange: (v: ThinkingLevelOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = THINKING_LEVEL_OPTIONS.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">Thinking Level</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left"
      >
        <span>{selected?.label ?? 'Auto'}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden">
          {THINKING_LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value || 'auto'}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                opt.value === value ? 'text-primary font-medium bg-primary/5' : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {opt.value === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
