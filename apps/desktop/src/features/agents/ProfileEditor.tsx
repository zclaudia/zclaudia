import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type {
  AgentProfileConfig,
  ThinkingLevel,
  LlmProfileConfig,
  McpServerConfig,
  McpServerStatus,
  ToolName,
  ToolSelection,
  SkillSelection,
  SkillRef,
  SkillSource,
  SkillExecutionSelection,
  SkillExecutionMode,
  SkillForkToolPolicy,
} from '@zclaudia/shared';
import {
  BUILTIN_TOOL_SETS,
  BUILTIN_TOOL_METADATA,
  builtinToolRef,
  defaultToolSelection,
  legacyEnabledToolsToSelection,
  resolveToolSelection,
  defaultSkillSelection,
  skillRefKey,
} from '@zclaudia/shared';
import * as api from '../../services/api';

export interface ProfileEditorProps {
  backendId: string;
  /** null = create mode */
  profile: AgentProfileConfig | null;
  onSaved: (saved: AgentProfileConfig) => void;
  onDeleted: () => void;
}

type ThinkingLevelOption = '' | ThinkingLevel;
type SkillDefaultModeOption = 'default' | SkillExecutionMode;
type SkillForkToolPolicyOption = 'default' | SkillForkToolPolicy;
const THINKING_LEVEL_OPTIONS: { value: ThinkingLevelOption; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

type BuiltinToolSetId = keyof typeof BUILTIN_TOOL_SETS;

const EDITABLE_BUILTIN_TOOL_SET_IDS = (Object.keys(BUILTIN_TOOL_SETS) as BuiltinToolSetId[]).filter(
  setId => setId !== 'all-builtin'
);

type LlmProfileModelEntry = NonNullable<LlmProfileConfig['models']>[number];

function modelSupportsVision(entry: LlmProfileModelEntry): boolean {
  return entry.inputModalities?.includes('image') ?? false;
}

function visionCapableModels(profile: LlmProfileConfig | undefined): LlmProfileModelEntry[] {
  return (profile?.models ?? []).filter(modelSupportsVision);
}

function fallbackModelValidForProfile(
  model: string,
  profile: LlmProfileConfig | undefined
): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  const models = profile?.models;
  if (!models || models.length === 0) return true;
  return models.some(entry => entry.modelId === trimmed && modelSupportsVision(entry));
}

function isBuiltinRefForTools(
  ref: ToolSelection['include'][number],
  tools: readonly ToolName[]
): boolean {
  return ref.source === 'builtin' && tools.includes(ref.name);
}

function removeBuiltinRefsForTools(
  refs: ToolSelection['include'],
  tools: readonly ToolName[]
): ToolSelection['include'] {
  return refs.filter(ref => !isBuiltinRefForTools(ref, tools));
}

function deriveCustomizedToolSetIds(selection: ToolSelection): BuiltinToolSetId[] {
  return EDITABLE_BUILTIN_TOOL_SET_IDS.filter(setId => {
    const set = BUILTIN_TOOL_SETS[setId];
    const hasFullSet = selection.sets.some(
      selected => selected.source === 'builtin' && selected.id === setId
    );
    if (hasFullSet) return false;
    return (
      selection.include.some(ref => isBuiltinRefForTools(ref, set.tools)) ||
      selection.exclude.some(ref => isBuiltinRefForTools(ref, set.tools))
    );
  });
}

function externalProviderLabel(provider: NonNullable<ToolSelection['providers']>[number]): string {
  if (provider.source === 'mcp') return `mcp/${provider.serverId}`;
  return provider.providerId
    ? `plugin/${provider.pluginId}/${provider.providerId}`
    : `plugin/${provider.pluginId}`;
}

function externalToolRefLabel(ref: ToolSelection['include'][number]): string | undefined {
  if (ref.source === 'mcp') return `mcp/${ref.server}/${ref.tool}`;
  if (ref.source === 'plugin') return `plugin/${ref.pluginId}/${ref.toolId}`;
  return undefined;
}

function formatPinnedExternalToolCount(count: number): string {
  return `${count} pinned external ${count === 1 ? 'tool' : 'tools'}`;
}

function mcpTrustSummaryLabels(server: McpServerConfig): string[] {
  const policy = server.trustPolicy;
  const labels = [
    `trust ${policy?.trustLevel ?? 'untrusted'}`,
    `default ${policy?.defaultRiskAction ?? 'ask'}`,
    `readonly hints ${policy?.trustReadOnlyHint ? 'trusted' : 'untrusted'}`,
  ];
  for (const level of ['low', 'medium', 'high'] as const) {
    const action = policy?.riskActions?.[level];
    if (action) labels.push(`${level} ${action}`);
  }
  return labels;
}

export function ProfileEditor({ backendId, profile, onSaved, onDeleted }: ProfileEditorProps) {
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileConfig[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<api.WorkspaceSkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpServerStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state — mirror LlmProfileManager `form*` naming convention
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLlmProfileId, setFormLlmProfileId] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formFallbackLlmProfileId, setFormFallbackLlmProfileId] = useState('');
  const [formFallbackModel, setFormFallbackModel] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formToolSelection, setFormToolSelection] = useState<ToolSelection>(defaultToolSelection);
  const [formSkillSelection, setFormSkillSelection] =
    useState<SkillSelection>(defaultSkillSelection);
  const [formSkillExecution, setFormSkillExecution] = useState<SkillExecutionSelection>({
    overrides: [],
  });
  const [formThinkingLevel, setFormThinkingLevel] = useState<ThinkingLevelOption>('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customizedToolSetIds, setCustomizedToolSetIds] = useState<BuiltinToolSetId[]>([]);
  const [expandedToolSetIds, setExpandedToolSetIds] = useState<BuiltinToolSetId[]>([]);

  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
    setPendingDelete(false);
  };

  // Supporting catalogs for the target backend. Skills / MCP failures degrade
  // gracefully to empty catalogs — only the LLM profile list is a hard error.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const llmData = await api.listLlmProfilesForBackend(backendId);
        if (cancelled) return;
        setLlmProfiles(llmData);
        try {
          const skills = await api.getWorkspaceSkillsForBackend(backendId);
          if (!cancelled) setSkillCatalog(skills);
        } catch {
          if (!cancelled) setSkillCatalog([]);
        }
        try {
          const [servers, statuses] = await Promise.all([
            api.getMcpServersForBackend(backendId),
            api.getMcpServerStatusesForBackend(backendId),
          ]);
          if (!cancelled) {
            setMcpServers(servers);
            setMcpStatuses(Object.fromEntries(statuses.map(status => [status.name, status])));
          }
        } catch {
          if (!cancelled) {
            setMcpServers([]);
            setMcpStatuses({});
          }
        }
      } catch (error) {
        console.error('Failed to load agent profile catalogs:', error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLoadError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [backendId]);

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
    setFormFallbackLlmProfileId('');
    setFormFallbackModel('');
    setFormSystemPrompt('');
    setFormToolSelection(defaultToolSelection);
    setFormSkillSelection(defaultSkillSelection);
    setFormSkillExecution({ overrides: [] });
    setFormThinkingLevel('');
    setFormIsDefault(false);
    setFormError(null);
    setCustomizedToolSetIds([]);
    setExpandedToolSetIds([]);
  };

  const populateForm = (agent: AgentProfileConfig) => {
    clearDeleteConfirmation();
    setFormName(agent.name);
    setFormDescription(agent.description ?? '');
    setFormLlmProfileId(agent.llmProfileId);
    setFormModel(agent.model);
    setFormFallbackLlmProfileId(agent.multimodalFallback?.llmProfileId ?? '');
    setFormFallbackModel(agent.multimodalFallback?.model ?? '');
    setFormSystemPrompt(agent.systemPrompt);
    const nextToolSelection =
      agent.toolSelection ?? legacyEnabledToolsToSelection(agent.enabledTools);
    setFormToolSelection(nextToolSelection);
    setFormSkillSelection(agent.skillSelection ?? defaultSkillSelection);
    setFormSkillExecution(agent.skillExecution ?? { overrides: [] });
    setCustomizedToolSetIds(deriveCustomizedToolSetIds(nextToolSelection));
    setExpandedToolSetIds([]);
    setFormThinkingLevel((agent.thinkingLevel ?? '') as ThinkingLevelOption);
    setFormIsDefault(agent.isDefault ?? false);
    setFormError(null);
  };

  useEffect(() => {
    if (profile) {
      populateForm(profile);
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Create mode: pre-select the default LLM profile once the catalog arrives
  // (mirrors AgentManager's Add Agent pre-selection).
  useEffect(() => {
    if (profile) return;
    if (llmProfiles.length === 0) return;
    setFormLlmProfileId(current => {
      if (current) return current;
      const defaultLlm = llmProfiles.find(p => p.isDefault) ?? llmProfiles[0];
      return defaultLlm ? defaultLlm.id : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, llmProfiles]);

  const toggleToolSetExpanded = (setId: BuiltinToolSetId) => {
    setExpandedToolSetIds(current =>
      current.includes(setId) ? current.filter(id => id !== setId) : [...current, setId]
    );
  };

  const toggleToolSet = (setId: keyof typeof BUILTIN_TOOL_SETS) => {
    setFormToolSelection(current => {
      const set = BUILTIN_TOOL_SETS[setId];
      const exists = current.sets.some(set => set.source === 'builtin' && set.id === setId);
      return {
        ...current,
        sets: exists
          ? current.sets.filter(set => !(set.source === 'builtin' && set.id === setId))
          : [...current.sets, { source: 'builtin', id: setId }],
        include: removeBuiltinRefsForTools(current.include, set.tools),
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      };
    });
    setCustomizedToolSetIds(current => current.filter(id => id !== setId));
  };

  const toggleToolSetCustomize = (setId: BuiltinToolSetId) => {
    const set = BUILTIN_TOOL_SETS[setId];
    const customActive = customizedToolSetIds.includes(setId);
    if (customActive) {
      setCustomizedToolSetIds(current => current.filter(id => id !== setId));
      setFormToolSelection(current => ({
        ...current,
        include: removeBuiltinRefsForTools(current.include, set.tools),
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      }));
      return;
    }

    setCustomizedToolSetIds(current => [...current.filter(id => id !== setId), setId]);
    setExpandedToolSetIds(current => (current.includes(setId) ? current : [...current, setId]));
    setFormToolSelection(current => {
      const fullSetActive = current.sets.some(
        selected => selected.source === 'builtin' && selected.id === setId
      );
      const currentlyResolved = new Set(resolveToolSelection(current).builtinTools);
      const selectedTools = fullSetActive
        ? set.tools
        : set.tools.filter(tool => currentlyResolved.has(tool));
      return {
        ...current,
        sets: current.sets.filter(
          selected => !(selected.source === 'builtin' && selected.id === setId)
        ),
        include: [
          ...removeBuiltinRefsForTools(current.include, set.tools),
          ...selectedTools.map(builtinToolRef),
        ],
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      };
    });
  };

  const toggleCustomTool = (setId: BuiltinToolSetId, tool: ToolName) => {
    const set = BUILTIN_TOOL_SETS[setId];
    const ref = builtinToolRef(tool);
    setFormToolSelection(current => {
      const include = current.include.filter(
        item => !(item.source === 'builtin' && item.name === tool)
      );
      const selected = current.include.some(
        item => item.source === 'builtin' && item.name === tool
      );
      return {
        ...current,
        sets: current.sets.filter(
          selectedSet => !(selectedSet.source === 'builtin' && selectedSet.id === setId)
        ),
        include: selected ? include : [...include, ref],
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      };
    });
    setCustomizedToolSetIds(current => (current.includes(setId) ? current : [...current, setId]));
  };

  const mcpProviderSelected = (serverName: string) =>
    (formToolSelection.providers ?? []).some(
      provider => provider.source === 'mcp' && provider.serverId === serverName
    );

  const toggleMcpProvider = (serverName: string) => {
    setFormToolSelection(current => {
      const providers = current.providers ?? [];
      const selected = providers.some(
        provider => provider.source === 'mcp' && provider.serverId === serverName
      );
      return {
        ...current,
        providers: selected
          ? providers.filter(
              provider => !(provider.source === 'mcp' && provider.serverId === serverName)
            )
          : [...providers, { source: 'mcp', serverId: serverName }],
      };
    });
  };

  const skillSourceEnabled = (source: SkillSource) =>
    (formSkillSelection.providers ?? []).some(provider => provider.source === source);

  const toggleSkillSource = (source: SkillSource) => {
    setFormSkillSelection(current => {
      const providers = current.providers ?? [];
      return {
        ...current,
        providers: providers.some(provider => provider.source === source)
          ? providers.filter(provider => provider.source !== source)
          : [...providers, { source } as NonNullable<SkillSelection['providers']>[number]],
      };
    });
  };

  const skillRefFor = (skill: api.WorkspaceSkillInfo): SkillRef => ({
    source: skill.source ?? 'workspace',
    id: skill.id,
  });

  const skillVisibility = (skill: api.WorkspaceSkillInfo): 'default' | 'include' | 'exclude' => {
    const key = skillRefKey(skillRefFor(skill));
    if ((formSkillSelection.exclude ?? []).some(ref => skillRefKey(ref) === key)) return 'exclude';
    if ((formSkillSelection.include ?? []).some(ref => skillRefKey(ref) === key)) return 'include';
    return 'default';
  };

  const setSkillVisibility = (
    skill: api.WorkspaceSkillInfo,
    visibility: 'default' | 'include' | 'exclude'
  ) => {
    const ref = skillRefFor(skill);
    const key = skillRefKey(ref);
    setFormSkillSelection(current => ({
      ...current,
      include:
        visibility === 'include'
          ? [...(current.include ?? []).filter(item => skillRefKey(item) !== key), ref]
          : (current.include ?? []).filter(item => skillRefKey(item) !== key),
      exclude:
        visibility === 'exclude'
          ? [...(current.exclude ?? []).filter(item => skillRefKey(item) !== key), ref]
          : (current.exclude ?? []).filter(item => skillRefKey(item) !== key),
      pinned:
        visibility === 'exclude'
          ? (current.pinned ?? []).filter(item => skillRefKey(item) !== key)
          : current.pinned,
    }));
  };

  const togglePinnedSkill = (skill: api.WorkspaceSkillInfo) => {
    const ref = skillRefFor(skill);
    const key = skillRefKey(ref);
    setFormSkillSelection(current => {
      const pinned = current.pinned ?? [];
      const selected = pinned.some(item => skillRefKey(item) === key);
      return {
        ...current,
        pinned: selected ? pinned.filter(item => skillRefKey(item) !== key) : [...pinned, ref],
      };
    });
  };

  const skillExecutionOverrideFor = (skill: api.WorkspaceSkillInfo) => {
    const key = skillRefKey(skillRefFor(skill));
    return (formSkillExecution.overrides ?? []).find(override => skillRefKey(override.ref) === key);
  };

  const updateSkillExecutionOverride = (
    skill: api.WorkspaceSkillInfo,
    patch: Partial<NonNullable<SkillExecutionSelection['overrides']>[number]>
  ) => {
    const ref = skillRefFor(skill);
    const key = skillRefKey(ref);
    setFormSkillExecution(current => {
      const existing = (current.overrides ?? []).find(
        override => skillRefKey(override.ref) === key
      );
      const next = {
        ...existing,
        ref,
        ...patch,
      };
      const normalized = {
        ref,
        ...(next.allowedModes && next.allowedModes.length > 0
          ? { allowedModes: next.allowedModes }
          : {}),
        ...(next.defaultMode ? { defaultMode: next.defaultMode } : {}),
        ...(next.forkToolPolicy ? { forkToolPolicy: next.forkToolPolicy } : {}),
      };
      const hasPolicy = Boolean(
        normalized.allowedModes || normalized.defaultMode || normalized.forkToolPolicy
      );
      const others = (current.overrides ?? []).filter(
        override => skillRefKey(override.ref) !== key
      );
      return { overrides: hasPolicy ? [...others, normalized] : others };
    });
  };

  const setSkillDefaultMode = (skill: api.WorkspaceSkillInfo, mode: SkillDefaultModeOption) => {
    updateSkillExecutionOverride(skill, { defaultMode: mode === 'default' ? undefined : mode });
  };

  const setSkillForkToolPolicy = (
    skill: api.WorkspaceSkillInfo,
    policy: SkillForkToolPolicyOption
  ) => {
    updateSkillExecutionOverride(skill, {
      forkToolPolicy: policy === 'default' ? undefined : policy,
    });
  };

  const toggleSkillAllowedMode = (skill: api.WorkspaceSkillInfo, mode: SkillExecutionMode) => {
    const current = skillExecutionOverrideFor(skill)?.allowedModes ?? [];
    const selected = current.includes(mode);
    updateSkillExecutionOverride(skill, {
      allowedModes: selected ? current.filter(item => item !== mode) : [...current, mode],
    });
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
    const fallbackProfile = llmProfiles.find(p => p.id === formFallbackLlmProfileId);
    const trimmedFallbackModel = formFallbackModel.trim();
    if (
      formFallbackLlmProfileId &&
      !fallbackModelValidForProfile(trimmedFallbackModel, fallbackProfile)
    ) {
      setFormError('Fallback model must support image input on the selected LLM profile');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const resolvedTools = resolveToolSelection(formToolSelection).builtinTools;
      const multimodalFallback =
        formFallbackLlmProfileId && trimmedFallbackModel
          ? { llmProfileId: formFallbackLlmProfileId, model: trimmedFallbackModel }
          : profile?.multimodalFallback
            ? null
            : undefined;
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        llmProfileId: formLlmProfileId,
        model: formModel.trim(),
        multimodalFallback,
        systemPrompt: formSystemPrompt,
        enabledTools: resolvedTools,
        toolSelection: formToolSelection,
        skillSelection: formSkillSelection,
        skillExecution: formSkillExecution,
        thinkingLevel: formThinkingLevel === '' ? undefined : formThinkingLevel,
        isDefault: formIsDefault,
      };

      const saved = profile
        ? await api.updateAgentProfileForBackend(backendId, profile.id, payload)
        : await api.createAgentProfileForBackend(backendId, payload);

      onSaved(saved);
    } catch (error) {
      console.error('Failed to save agent profile:', error);
      const message = error instanceof Error ? error.message : String(error);
      setFormError(`Failed to ${profile ? 'update' : 'create'} agent: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!profile || deleting) return;

    if (!pendingDelete) {
      clearDeleteConfirmation();
      setPendingDelete(true);
      deleteConfirmTimeoutRef.current = window.setTimeout(() => {
        setPendingDelete(false);
        deleteConfirmTimeoutRef.current = null;
      }, 3000);
      return;
    }

    clearDeleteConfirmation();
    setDeleting(true);
    setFormError(null);
    try {
      await api.deleteAgentProfileForBackend(backendId, profile.id);
      onDeleted();
    } catch (error) {
      console.error('Failed to delete agent profile:', error);
      const message = error instanceof Error ? error.message : String(error);
      setFormError(message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading...</p>;
  }

  if (loadError) {
    return <p className="text-destructive text-center py-8">{loadError}</p>;
  }

  const builtinToolSetEntries = EDITABLE_BUILTIN_TOOL_SET_IDS.map(setId => ({
    ...BUILTIN_TOOL_SETS[setId],
    id: setId,
  }));
  const resolvedBuiltinTools = resolveToolSelection(formToolSelection).builtinTools;
  const externalProviders = formToolSelection.providers ?? [];
  const pinnedExternalToolLabels = formToolSelection.include.flatMap(ref => {
    const label = externalToolRefLabel(ref);
    return label ? [label] : [];
  });
  const skillProviderCount = formSkillSelection.providers?.length ?? 0;
  const skillIncludeCount = formSkillSelection.include?.length ?? 0;
  const pinnedSkillCount = formSkillSelection.pinned?.length ?? 0;
  const skillPolicyOverrideCount = formSkillExecution.overrides?.length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Name *</label>
        <input
          type="text"
          value={formName}
          onChange={e => setFormName(e.target.value)}
          placeholder="e.g., Default Coding Agent"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Description (optional)
        </label>
        <textarea
          value={formDescription}
          onChange={e => setFormDescription(e.target.value)}
          placeholder="What this agent is for"
          rows={2}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <LlmProfileSelector
        value={formLlmProfileId}
        onChange={id => {
          setFormLlmProfileId(id);
          // Clearing the model when the LLM profile changes avoids referencing
          // a model id that doesn't exist in the new profile's models list.
          const newProfile = llmProfiles.find(p => p.id === id);
          const newProfileModels = newProfile?.models;
          if (
            formModel &&
            (!newProfileModels || !newProfileModels.some(m => m.modelId === formModel))
          ) {
            setFormModel('');
          }
        }}
        profiles={llmProfiles}
      />

      <ModelSelector
        value={formModel}
        onChange={setFormModel}
        llmProfile={llmProfiles.find(p => p.id === formLlmProfileId)}
      />

      <ModelDeclarationWarning
        formModel={formModel}
        llmProfile={llmProfiles.find(p => p.id === formLlmProfileId)}
      />

      <MultimodalFallbackSelector
        profiles={llmProfiles}
        profileId={formFallbackLlmProfileId}
        model={formFallbackModel}
        onProfileChange={id => {
          setFormFallbackLlmProfileId(id);
          if (!id) {
            setFormFallbackModel('');
            return;
          }
          const nextProfile = llmProfiles.find(p => p.id === id);
          if (formFallbackModel && !fallbackModelValidForProfile(formFallbackModel, nextProfile)) {
            setFormFallbackModel('');
          }
        }}
        onModelChange={setFormFallbackModel}
      />

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          System Prompt
        </label>
        <textarea
          value={formSystemPrompt}
          onChange={e => setFormSystemPrompt(e.target.value)}
          placeholder="You are a helpful coding agent..."
          rows={10}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        />
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Tool Sets</label>
          <div className="space-y-2">
            {builtinToolSetEntries.map(set => {
              const checked = formToolSelection.sets.some(
                selected => selected.source === 'builtin' && selected.id === set.id
              );
              const customized = customizedToolSetIds.includes(set.id);
              const expanded = expandedToolSetIds.includes(set.id);
              return (
                <div
                  key={set.id}
                  className={`min-w-0 rounded-lg border p-3 text-sm transition-colors ${
                    checked
                      ? 'bg-muted/60 border-primary/45 text-primary shadow-sm'
                      : customized
                        ? 'bg-secondary/80 border-primary/25 text-foreground'
                        : 'bg-secondary/60 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleToolSet(set.id)}
                      aria-label={`enable full tool set ${set.id}`}
                      className="rounded-md border-border shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => toggleToolSetExpanded(set.id)}
                      aria-label={`expand tool set ${set.id}`}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-medium truncate">{set.label}</div>
                        <span className="shrink-0 rounded-full bg-background/70 border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {set.tools.length} tools
                        </span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {set.tools.slice(0, 4).join(', ')}
                          {set.tools.length > 4 ? '...' : ''}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleToolSetCustomize(set.id)}
                      aria-label={`customize tool set ${set.id}`}
                      className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        customized
                          ? 'border-primary/40 bg-muted/60 text-primary'
                          : 'border-border bg-background/70 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {customized ? 'Custom' : 'Customize'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-1 border-t border-border/70 pt-2">
                      {set.tools.map(tool => {
                        const selected = customized
                          ? formToolSelection.include.some(
                              ref => ref.source === 'builtin' && ref.name === tool
                            )
                          : checked;
                        const metadata = BUILTIN_TOOL_METADATA[tool];
                        return (
                          <label
                            key={tool}
                            className={`flex items-start gap-3 rounded-md bg-background/60 px-2 py-2 ${
                              customized ? 'cursor-pointer hover:bg-background/80' : ''
                            }`}
                          >
                            {customized ? (
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleCustomTool(set.id, tool)}
                                aria-label={`select tool ${tool}`}
                                className="mt-0.5 shrink-0"
                              />
                            ) : (
                              <span
                                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${selected ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-xs" title={tool}>
                                {tool}
                              </span>
                              <span
                                className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                                title={metadata.description || metadata.label}
                              >
                                {metadata.description || metadata.label}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Resolved built-in tools: {resolvedBuiltinTools.join(', ') || 'none'}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            External Tool Providers
          </label>
          <div className="rounded-lg border border-border bg-secondary/50 p-3 text-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Configured MCP servers</p>
                <span className="text-[10px] text-muted-foreground">
                  {externalProviders.filter(provider => provider.source === 'mcp').length} selected
                </span>
              </div>
              {mcpServers.length === 0 ? (
                <p className="rounded-md bg-background/60 px-2 py-2 text-xs text-muted-foreground">
                  No MCP servers configured.
                </p>
              ) : (
                mcpServers.map(server => {
                  const status = mcpStatuses[server.name];
                  const selected = mcpProviderSelected(server.name);
                  const state = status?.state ?? (server.enabled ? 'configured' : 'disabled');
                  return (
                    <div
                      key={server.id}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-background/60 px-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs" title={`mcp/${server.name}`}>
                            mcp/{server.name}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] ${
                              state === 'connected'
                                ? 'text-green-400'
                                : state === 'failed'
                                  ? 'text-red-400'
                                  : state === 'needs-auth'
                                    ? 'text-orange-300'
                                    : 'text-muted-foreground'
                            }`}
                          >
                            {state}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">
                          tools {status?.inventory?.tools ?? 'unknown'} | resources{' '}
                          {status?.inventory?.resources ?? 'unknown'} | prompts{' '}
                          {status?.inventory?.prompts ?? 'unknown'}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {mcpTrustSummaryLabels(server).map(label => (
                            <span
                              key={label}
                              className="rounded-full bg-secondary/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleMcpProvider(server.name)}
                        className={`shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors ${
                          selected
                            ? 'bg-muted text-primary hover:bg-muted'
                            : 'bg-secondary text-muted-foreground hover:text-foreground'
                        } disabled:opacity-50`}
                      >
                        {selected ? 'Remove' : 'Add'}
                      </button>
                    </div>
                  );
                })
              )}
              {externalProviders.some(provider => provider.source === 'plugin') && (
                <div className="border-t border-border/70 pt-2">
                  <p className="mb-1 text-xs text-muted-foreground">Plugin providers</p>
                  {externalProviders
                    .filter(provider => provider.source === 'plugin')
                    .map(provider => {
                      const label = externalProviderLabel(provider);
                      return (
                        <div key={label} className="rounded-md bg-background/60 px-2 py-2">
                          <span className="font-mono text-xs" title={label}>
                            {label}
                          </span>
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            not yet connected
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            <div className="mt-2 border-t border-border/70 pt-2">
              <p className="text-[10px] text-muted-foreground">
                {formatPinnedExternalToolCount(pinnedExternalToolLabels.length)}
              </p>
              {pinnedExternalToolLabels.length > 0 && (
                <p
                  className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                  title={pinnedExternalToolLabels.join(', ')}
                >
                  {pinnedExternalToolLabels.join(', ')}
                </p>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Skills</label>
          <div className="rounded-lg border border-border bg-secondary/50 p-3 text-sm">
            <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              <span>{skillProviderCount} sources</span>
              <span>{skillIncludeCount} included</span>
              <span>{pinnedSkillCount} pinned inline</span>
              <span>{skillPolicyOverrideCount} policy overrides</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['workspace', 'external', 'plugin'] as SkillSource[]).map(source => (
                <label
                  key={source}
                  className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5 text-xs capitalize"
                >
                  <input
                    type="checkbox"
                    checked={skillSourceEnabled(source)}
                    onChange={() => toggleSkillSource(source)}
                    aria-label={`enable ${source} skills`}
                  />
                  {source}
                </label>
              ))}
            </div>
            <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
              {skillCatalog.length === 0 ? (
                <p className="text-xs text-muted-foreground">No skills discovered.</p>
              ) : (
                skillCatalog.map(skill => {
                  const ref = skillRefFor(skill);
                  const key = skillRefKey(ref);
                  const pinned = (formSkillSelection.pinned ?? []).some(
                    item => skillRefKey(item) === key
                  );
                  const executionOverride = skillExecutionOverrideFor(skill);
                  return (
                    <div key={key} className="rounded-md bg-background/60 px-2 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate font-medium text-xs"
                          title={`${ref.source}/${skill.id}`}
                        >
                          {skill.name || skill.id}
                        </span>
                        <select
                          aria-label={`skill visibility ${key}`}
                          value={skillVisibility(skill)}
                          onChange={event =>
                            setSkillVisibility(
                              skill,
                              event.target.value as 'default' | 'include' | 'exclude'
                            )
                          }
                          className="rounded border border-border bg-secondary px-1 py-0.5 text-[10px]"
                        >
                          <option value="default">Default</option>
                          <option value="include">Include</option>
                          <option value="exclude">Exclude</option>
                        </select>
                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={pinned}
                            disabled={skillVisibility(skill) === 'exclude'}
                            onChange={() => togglePinnedSkill(skill)}
                            aria-label={`pin skill ${key}`}
                          />
                          Pin
                        </label>
                      </div>
                      <p
                        className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                        title={skill.description || `${ref.source}/${skill.id}`}
                      >
                        {ref.source}/{skill.id} · {skill.description || 'No description'}
                      </p>
                      <div className="mt-2 grid gap-2 border-t border-border/60 pt-2 sm:grid-cols-2">
                        <label className="min-w-0 text-[10px] text-muted-foreground">
                          <span className="mb-1 block">Default mode</span>
                          <select
                            aria-label={`skill default mode ${key}`}
                            value={executionOverride?.defaultMode ?? 'default'}
                            onChange={event =>
                              setSkillDefaultMode(
                                skill,
                                event.target.value as SkillDefaultModeOption
                              )
                            }
                            className="w-full rounded border border-border bg-secondary px-1 py-0.5 text-[10px]"
                          >
                            <option value="default">Default</option>
                            <option value="inline">Inline</option>
                            <option value="fork">Fork</option>
                          </select>
                        </label>
                        <label className="min-w-0 text-[10px] text-muted-foreground">
                          <span className="mb-1 block">Fork tools</span>
                          <select
                            aria-label={`skill fork tool policy ${key}`}
                            value={executionOverride?.forkToolPolicy ?? 'default'}
                            onChange={event =>
                              setSkillForkToolPolicy(
                                skill,
                                event.target.value as SkillForkToolPolicyOption
                              )
                            }
                            className="w-full rounded border border-border bg-secondary px-1 py-0.5 text-[10px]"
                          >
                            <option value="default">Default</option>
                            <option value="read-only">Read-only</option>
                            <option value="web">Web</option>
                            <option value="workspace-edit">Workspace edit</option>
                            <option value="agent-default">Agent default</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={executionOverride?.allowedModes?.includes('inline') ?? false}
                            onChange={() => toggleSkillAllowedMode(skill, 'inline')}
                            aria-label={`allow inline skill ${key}`}
                          />
                          Allow inline
                        </label>
                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={executionOverride?.allowedModes?.includes('fork') ?? false}
                            onChange={() => toggleSkillAllowedMode(skill, 'fork')}
                            aria-label={`allow fork skill ${key}`}
                          />
                          Allow fork
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <ThinkingLevelSelector value={formThinkingLevel} onChange={setFormThinkingLevel} />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="agentIsDefault"
          checked={formIsDefault}
          onChange={e => setFormIsDefault(e.target.checked)}
          className="rounded-md border-border bg-secondary"
        />
        <label htmlFor="agentIsDefault" className="text-sm">
          Set as default agent
        </label>
      </div>

      {formError && <p className="text-xs text-destructive">{formError}</p>}

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!formName.trim() || saving}
          className="flex-1 px-4 py-2 bg-muted/60 text-foreground hover:bg-muted rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : profile ? 'Update' : 'Create'}
        </button>
        {profile && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              pendingDelete
                ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                : 'bg-secondary text-destructive hover:bg-secondary/80'
            }`}
            title={pendingDelete ? 'Click again to confirm delete' : 'Delete'}
          >
            {deleting ? 'Deleting...' : pendingDelete ? 'Confirm delete' : 'Delete'}
          </button>
        )}
      </div>
    </div>
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
  const known = models.some(m => m.modelId === trimmed);
  if (known) return null;
  return (
    <p className="text-xs text-amber-600 mt-1">
      This model is not declared on the selected LLM profile. The agent will work but will fall back
      to pi-ai registry defaults for context window / max tokens.
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
  const selectedEntry = models.find(m => m.modelId === value);
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
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && hasModels && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden max-h-72 overflow-y-auto">
          {models.map(m => {
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
                  m.modelId === value
                    ? 'text-primary font-medium bg-muted/40'
                    : 'text-foreground hover:bg-secondary/80'
                }`}
              >
                <span className="w-4 flex-shrink-0">
                  {m.modelId === value && <Check size={14} strokeWidth={2.5} />}
                </span>
                <span className="font-mono truncate">{label}</span>
                {label !== m.modelId && (
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                    {m.modelId}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MultimodalFallbackSelector({
  profiles,
  profileId,
  model,
  onProfileChange,
  onModelChange,
}: {
  profiles: LlmProfileConfig[];
  profileId: string;
  model: string;
  onProfileChange: (v: string) => void;
  onModelChange: (v: string) => void;
}) {
  const selectedProfile = profiles.find(profile => profile.id === profileId);
  const declaredModels = selectedProfile?.models ?? [];
  const visionModels = visionCapableModels(selectedProfile);
  const hasDeclaredModels = declaredModels.length > 0;
  const modelValue =
    hasDeclaredModels && !visionModels.some(entry => entry.modelId === model) ? '' : model;

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
      <label className="block text-sm font-medium text-muted-foreground">Multimodal fallback</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-xs text-muted-foreground">
          <span className="mb-1 block">Fallback LLM Profile</span>
          <select
            aria-label="Fallback LLM Profile"
            value={profileId}
            onChange={event => onProfileChange(event.target.value)}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">None</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>

        {profileId && hasDeclaredModels && (
          <label className="min-w-0 text-xs text-muted-foreground">
            <span className="mb-1 block">Fallback Model</span>
            <select
              aria-label="Fallback Model"
              value={modelValue}
              onChange={event => onModelChange(event.target.value)}
              disabled={visionModels.length === 0}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">Select a Vision-capable model</option>
              {visionModels.map(entry => {
                const label = entry.displayName || entry.modelId;
                return (
                  <option key={entry.modelId} value={entry.modelId}>
                    {label === entry.modelId ? label : `${label} (${entry.modelId})`}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        {profileId && !hasDeclaredModels && (
          <label className="min-w-0 text-xs text-muted-foreground">
            <span className="mb-1 block">Fallback Model</span>
            <input
              type="text"
              aria-label="Fallback Model"
              value={model}
              onChange={event => onModelChange(event.target.value)}
              placeholder="model id"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary font-mono"
            />
          </label>
        )}
      </div>
      {profileId && hasDeclaredModels && visionModels.length === 0 && (
        <p className="text-xs text-amber-600">
          No Vision-capable models declared on this LLM profile.
        </p>
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

  const selected = profiles.find(p => p.id === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">LLM Profile *</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left"
      >
        <span>
          {selected
            ? selected.name
            : profiles.length === 0
              ? 'No LLM profiles available'
              : 'Select an LLM profile'}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && profiles.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden">
          {profiles.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                p.id === value
                  ? 'text-primary font-medium bg-muted/40'
                  : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {p.id === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              <span className="truncate">{p.name}</span>
              {p.isDefault && (
                <span className="ml-auto px-1.5 py-0.5 bg-muted/60 text-primary text-[10px] rounded-md">
                  Default
                </span>
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

  const selected = THINKING_LEVEL_OPTIONS.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">Thinking Level</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left"
      >
        <span>{selected?.label ?? 'Auto'}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden">
          {THINKING_LEVEL_OPTIONS.map(opt => (
            <button
              key={opt.value || 'auto'}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                opt.value === value
                  ? 'text-primary font-medium bg-muted/40'
                  : 'text-foreground hover:bg-secondary/80'
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
