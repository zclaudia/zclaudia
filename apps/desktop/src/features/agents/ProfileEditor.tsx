import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
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
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import * as api from '../../services/api';
import { useRuntimeDescriptorStore } from '../../stores/runtimeDescriptorStore';
import { EditorSection, EditorRow, FieldLabel } from './ui/EditorSection';
import { EditorTabs } from './ui/EditorTabs';
import type { EditorTab } from './ui/EditorTabs';
import { useProfileAutosave } from './useProfileAutosave';
import { ProfileHeader } from './ui/ProfileHeader';
import type { DetailBadge } from './ui/DetailHeader';
import type { ActionsMenuAction } from './ui/ActionsMenu';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { Checkbox } from '../../components/ui/Checkbox';

/** First few tool names of a set, as a one-line hint under/next to its label. */
function toolSetPreview(tools: readonly string[]): string {
  return tools.slice(0, 4).join(', ') + (tools.length > 4 ? '...' : '');
}

/**
 * Parent must remount this component per identity — key it by
 * `${backendId}:${profile.id}`. The populate effect deliberately
 * depends on profile id only; prop-driven switching of backendId or same-id
 * content updates without a key change is not supported.
 */
export interface ProfileEditorProps {
  backendId: string;
  /** The profile being edited. Creation is handled by NewAgentProfileModal. */
  profile: AgentProfileConfig;
  onBack: () => void;
  backendName?: string;
  onSaved: (saved: AgentProfileConfig) => void;
  onDeleted: () => void;
  /** "⋯" menu entries for the header (set-default/delete live here). */
  headerActions?: ActionsMenuAction[];
}

type ThinkingLevelOption = '' | ThinkingLevel;
/** Runtime type is an open string set — plugins can register additional runtimes. */
type RuntimeOption = string;
type SkillDefaultModeOption = 'default' | SkillExecutionMode;
type SkillForkToolPolicyOption = 'default' | SkillForkToolPolicy;

/** Fallback descriptor for a runtime the active backend does not currently provide
 *  (e.g. its plugin is not installed/active). Keeps the editor renderable instead of crashing. */
function unavailableDescriptor(runtime: string): ProfileConfigDescriptor {
  return {
    runtime,
    label: runtime,
    enabled: false,
    model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'off' },
    hasCliPath: false,
    capabilities: { tools: 'unsupported', providers: 'unsupported', skills: 'unsupported' },
    authNote: `Runtime "${runtime}" is not available on this backend. Enable the plugin that provides it.`,
  };
}

const FIELD_CLASS =
  'w-full rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono`;
/**
 * Dropdown surface for the custom selectors below.
 *
 * Anchored to the trigger's right edge with a minimum width instead of simply
 * matching it: the triggers sit in a ~176px column at phone width, which is
 * plenty for the current value but far too narrow to browse full model ids in.
 * Growing leftwards keeps the panel on screen (the column's right edge is one
 * page gutter from the viewport edge).
 */
const SELECT_POPOVER_CLASS =
  'absolute right-0 top-full mt-1 min-w-[min(20rem,calc(100vw-2.5rem))] md:left-0 md:min-w-0 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden';

export const NAME_PLACEHOLDER = 'e.g., Default Coding Agent';

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

function CapabilityNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/55 p-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
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

export function ProfileEditor({
  backendId,
  profile,
  onBack,
  backendName,
  onSaved,
  headerActions,
}: ProfileEditorProps) {
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileConfig[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<api.WorkspaceSkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpServerStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state — mirror LlmProfileManager `form*` naming convention
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRuntimeType, setFormRuntimeType] = useState<RuntimeOption>('zclaudia');
  const [formLlmProfileId, setFormLlmProfileId] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formCliPath, setFormCliPath] = useState('');
  const [formFallbackLlmProfileId, setFormFallbackLlmProfileId] = useState('');
  const [formFallbackModel, setFormFallbackModel] = useState('');
  const [formFallbackOpen, setFormFallbackOpen] = useState(false);
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
  const [customizedToolSetIds, setCustomizedToolSetIds] = useState<BuiltinToolSetId[]>([]);
  const [expandedToolSetIds, setExpandedToolSetIds] = useState<BuiltinToolSetId[]>([]);
  const isMobile = useIsMobile();
  // On a phone the Prompt tab owns the whole screen, so the collapsed one-line
  // preview would waste it; start expanded there. Desktop keeps the preview
  // because the tab shares space with the rest of the editor.
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(isMobile);
  const [activeTab, setActiveTab] = useState<'model' | 'capabilities' | 'prompt'>('model');
  const [capabilityTab, setCapabilityTab] = useState<'tools' | 'providers' | 'skills'>('tools');
  // False until the form has been populated from `profile` (populate runs in an
  // effect, a render after mount). Autosave is gated on this so the empty
  // pre-hydration form is never seen as a dirty edit.
  const [hydrated, setHydrated] = useState(false);

  const isMounted = useIsMounted();

  // Captured once per mount (the editor is keyed by profile id, so this is stable
  // per identity). Used to decide null (clear existing) vs undefined (omit) for the
  // multimodal fallback — reading the live `profile` prop instead would re-fire a
  // no-op save after the saved profile round-trips back.
  const hadFallbackAtMount = useRef(Boolean(profile.multimodalFallback));
  const hadCliPathAtMount = useRef(Boolean(profile.cliPath));

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

  const populateForm = (agent: AgentProfileConfig) => {
    setFormName(agent.name);
    setFormDescription(agent.description ?? '');
    setFormRuntimeType(agent.runtimeType ?? 'zclaudia');
    setFormLlmProfileId(agent.llmProfileId);
    setFormModel(agent.model);
    setFormCliPath(agent.cliPath ?? '');
    setFormFallbackLlmProfileId(agent.multimodalFallback?.llmProfileId ?? '');
    setFormFallbackModel(agent.multimodalFallback?.model ?? '');
    setFormFallbackOpen(Boolean(agent.multimodalFallback));
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
    populateForm(profile);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

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

  const descriptors = useRuntimeDescriptorStore(s => s.getDescriptors(backendId));
  const descriptorFor = useCallback(
    (runtime: string): ProfileConfigDescriptor =>
      descriptors.find(d => d.runtime === runtime) ?? unavailableDescriptor(runtime),
    [descriptors]
  );
  const requiresLlmProfile = useCallback(
    (runtime: string) => descriptorFor(runtime).model.kind === 'llm-profile',
    [descriptorFor]
  );

  const buildPayload = useCallback(() => {
    const resolvedTools = resolveToolSelection(formToolSelection).builtinTools;
    const descriptor = descriptorFor(formRuntimeType);
    const trimmedFallbackModel = formFallbackModel.trim();
    const trimmedCliPath = formCliPath.trim();
    const multimodalFallback = !descriptor.model.multimodalFallback
      ? hadFallbackAtMount.current
        ? null
        : undefined
      : formFallbackLlmProfileId && trimmedFallbackModel
        ? { llmProfileId: formFallbackLlmProfileId, model: trimmedFallbackModel }
        : hadFallbackAtMount.current
          ? null
          : undefined;
    const cliPath = descriptor.hasCliPath
      ? trimmedCliPath || (hadCliPathAtMount.current ? null : undefined)
      : hadCliPathAtMount.current
        ? null
        : undefined;
    return {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      runtimeType: formRuntimeType,
      llmProfileId: formLlmProfileId,
      model: descriptor.model.kind === 'none' ? '' : formModel.trim(),
      cliPath,
      multimodalFallback,
      systemPrompt: formSystemPrompt,
      enabledTools: resolvedTools,
      toolSelection: formToolSelection,
      skillSelection: formSkillSelection,
      skillExecution: formSkillExecution,
      thinkingLevel:
        descriptor.model.thinkingLevel === 'selectable' && formThinkingLevel !== ''
          ? formThinkingLevel
          : undefined,
      isDefault: formIsDefault,
    };
  }, [
    formName,
    formDescription,
    formRuntimeType,
    formLlmProfileId,
    formModel,
    formCliPath,
    formFallbackLlmProfileId,
    formFallbackModel,
    formSystemPrompt,
    formToolSelection,
    formSkillSelection,
    formSkillExecution,
    formThinkingLevel,
    formIsDefault,
    descriptorFor,
  ]);

  const activeDescriptor = descriptorFor(formRuntimeType);
  const modelRequired = activeDescriptor.model.kind === 'llm-profile';

  const fallbackVisionValid =
    !activeDescriptor.model.multimodalFallback ||
    !formFallbackLlmProfileId ||
    fallbackModelValidForProfile(
      formFallbackModel.trim(),
      llmProfiles.find(p => p.id === formFallbackLlmProfileId)
    );

  const formValid = Boolean(
    formName.trim() &&
    (requiresLlmProfile(formRuntimeType) ? formLlmProfileId : true) &&
    (modelRequired ? formModel.trim() : true) &&
    fallbackVisionValid
  );

  const signature = useMemo(() => JSON.stringify(buildPayload()), [buildPayload]);

  const performAutosave = useCallback(async () => {
    const saved = await api.updateAgentProfileForBackend(backendId, profile.id, buildPayload());
    if (!isMounted()) return;
    onSaved(saved);
  }, [profile, backendId, buildPayload, isMounted, onSaved]);

  const autosave = useProfileAutosave({
    enabled: hydrated && profile.status !== 'readonly',
    valid: formValid,
    signature,
    save: performAutosave,
  });

  const handleRuntimeChange = (next: RuntimeOption) => {
    setFormRuntimeType(next);
    // Model ids are not interchangeable across runtimes → clear and let the form
    // sit in `pending` until a model is chosen for the new runtime.
    setFormModel('');
    if (descriptorFor(next).model.thinkingLevel !== 'selectable') {
      setFormThinkingLevel('');
    }
    if (!requiresLlmProfile(next)) {
      // Native runtimes don't bind an LLM profile or a multimodal fallback.
      setFormLlmProfileId('');
      setFormFallbackLlmProfileId('');
      setFormFallbackModel('');
      setFormFallbackOpen(false);
    }
  };

  const handleFallbackProfileChange = (id: string) => {
    setFormFallbackLlmProfileId(id);
    if (!id) {
      setFormFallbackModel('');
      return;
    }
    const nextProfile = llmProfiles.find(p => p.id === id);
    if (formFallbackModel && !fallbackModelValidForProfile(formFallbackModel, nextProfile)) {
      setFormFallbackModel('');
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

  // Per-area attachment tallies for the Capabilities sub-tab counts and the
  // aggregate capabilityCount badge on the top-level Capabilities tab.
  const enabledToolSetChips = builtinToolSetEntries.filter(set =>
    formToolSelection.sets.some(selected => selected.source === 'builtin' && selected.id === set.id)
  );
  const mcpProviderChips = externalProviders.filter(provider => provider.source === 'mcp');
  const pinnedSkillChips = (formSkillSelection.pinned ?? []).map(ref => {
    const key = skillRefKey(ref);
    const skill = skillCatalog.find(candidate => skillRefKey(skillRefFor(candidate)) === key);
    return {
      key,
      label: skill?.name || skill?.id || ref.id,
      skill,
    };
  });
  const systemPromptPreview = formSystemPrompt.trim().split('\n')[0] || '';

  // A read-only profile (deleted-while-in-use) is frozen: no autosave, no edits,
  // fields disabled. It can only be hard-deleted once no active session references it.
  const isReadonly = profile.status === 'readonly';

  const headerBadges: DetailBadge[] = [
    ...(backendName ? [{ label: backendName }] : []),
    ...(profile.isDefault ? [{ label: 'Default', tone: 'accent' as const }] : []),
    ...(isReadonly ? [{ label: 'Read-only', tone: 'neutral' as const }] : []),
  ];

  const capabilityCount =
    enabledToolSetChips.length + mcpProviderChips.length + pinnedSkillChips.length;
  const editorTabs: EditorTab[] = [
    { id: 'model', label: 'Model' },
    { id: 'capabilities', label: 'Capabilities', count: capabilityCount || undefined },
    { id: 'prompt', label: 'Prompt' },
  ];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ProfileHeader
        crumb="Agent Profiles"
        onBack={onBack}
        name={formName}
        onNameChange={setFormName}
        onFieldBlur={autosave.flush}
        namePlaceholder={NAME_PLACEHOLDER}
        badges={headerBadges}
        saveStatus={!isReadonly ? autosave.status : undefined}
        onRetry={autosave.retry}
        disabled={isReadonly}
        recordStatus={profile.recordStatus}
        actions={headerActions}
      />
      {isReadonly && (
        <div className="mx-4 my-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          This agent is referenced by active sessions and has been converted to read-only. Archive
          or delete those sessions to enable permanent deletion.
        </div>
      )}
      {formError && <p className="px-4 pb-2 text-xs text-destructive">{formError}</p>}
      <div className="flex-1 overflow-y-auto p-4">
        <div
          data-testid="agent-profile-editor"
          className="mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-4"
        >
          <EditorTabs
            tabs={editorTabs}
            active={activeTab}
            onChange={id => setActiveTab(id as typeof activeTab)}
          />

          {activeTab === 'model' && (
            <div className="flex flex-col gap-4">
              <EditorSection title="Runtime & model" flush overflowVisible>
                <div className="divide-y divide-border/60">
                  <EditorRow title="Description">
                    <textarea
                      value={formDescription}
                      onChange={e => setFormDescription(e.target.value)}
                      onBlur={autosave.flush}
                      placeholder="Add a description"
                      aria-label="Profile description"
                      disabled={isReadonly}
                      rows={2}
                      className={`${FIELD_CLASS} resize-y`}
                    />
                  </EditorRow>

                  <EditorRow
                    title="Agent Type"
                    control={
                      <div className="w-48 md:w-56">
                        <RuntimeSelector
                          aria-label="Agent Type"
                          value={formRuntimeType}
                          onChange={handleRuntimeChange}
                          options={descriptors.filter(d => d.enabled)}
                        />
                      </div>
                    }
                  />

                  {activeDescriptor.model.kind === 'llm-profile' && (
                    <>
                      <EditorRow
                        title="LLM Profile"
                        description="Required"
                        control={
                          <div className="w-48 md:w-56">
                            <LlmProfileSelector
                              hideLabel
                              aria-label="LLM Profile"
                              value={formLlmProfileId}
                              onChange={id => {
                                setFormLlmProfileId(id);
                                const newProfile = llmProfiles.find(p => p.id === id);
                                const newProfileModels = newProfile?.models;
                                if (
                                  formModel &&
                                  (!newProfileModels ||
                                    !newProfileModels.some(m => m.modelId === formModel))
                                ) {
                                  setFormModel('');
                                }
                              }}
                              profiles={llmProfiles}
                            />
                          </div>
                        }
                      />
                      <EditorRow
                        title="Model"
                        description="Required"
                        control={
                          <div className="w-48 md:w-56">
                            <ModelSelector
                              hideLabel
                              aria-label="Model"
                              value={formModel}
                              onChange={setFormModel}
                              llmProfile={llmProfiles.find(p => p.id === formLlmProfileId)}
                            />
                          </div>
                        }
                      >
                        <ModelDeclarationWarning
                          formModel={formModel}
                          llmProfile={llmProfiles.find(p => p.id === formLlmProfileId)}
                        />
                      </EditorRow>
                    </>
                  )}

                  {activeDescriptor.model.kind === 'native' && (
                    <EditorRow
                      title={<label htmlFor="agent-profile-native-model">Model</label>}
                      description="Leave blank to use the runtime's default model."
                      layout="stack"
                      control={
                        <input
                          id="agent-profile-native-model"
                          type="text"
                          value={formModel}
                          onChange={e => setFormModel(e.target.value)}
                          onBlur={autosave.flush}
                          placeholder="Auto (default)"
                          className={`${FIELD_CLASS} md:w-56`}
                        />
                      }
                    />
                  )}

                  {activeDescriptor.model.kind === 'none' && (
                    <EditorRow
                      title="Model"
                      control={
                        <span aria-label="Model" className="text-sm text-muted-foreground">
                          Auto (CLI default)
                        </span>
                      }
                    />
                  )}

                  {activeDescriptor.hasCliPath && (
                    <EditorRow
                      title={<label htmlFor="agent-profile-cli-path">CLI Path</label>}
                      description={`Optional — custom ${activeDescriptor.label} CLI binary`}
                      layout="stack"
                      control={
                        <div className="w-full md:w-56">
                          <input
                            id="agent-profile-cli-path"
                            type="text"
                            aria-label="CLI Path (optional)"
                            value={formCliPath}
                            onChange={e => setFormCliPath(e.target.value)}
                            onBlur={autosave.flush}
                            placeholder="/path/to/cli"
                            className={MONO_FIELD_CLASS}
                          />
                        </div>
                      }
                    />
                  )}

                  {activeDescriptor.model.thinkingLevel === 'selectable' && (
                    <EditorRow
                      title="Thinking Level"
                      control={
                        <div className="w-48 md:w-56">
                          <ThinkingLevelSelector
                            hideLabel
                            aria-label="Thinking Level"
                            value={formThinkingLevel}
                            onChange={setFormThinkingLevel}
                          />
                        </div>
                      }
                    />
                  )}

                  {activeDescriptor.model.thinkingLevel === 'auto' && (
                    <EditorRow
                      title="Thinking Level"
                      control={
                        <span aria-label="Thinking Level" className="text-sm text-muted-foreground">
                          Auto
                        </span>
                      }
                    />
                  )}
                </div>

                {activeDescriptor.authNote && (
                  <p className="mx-4 mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
                    {activeDescriptor.authNote}
                  </p>
                )}
              </EditorSection>

              {activeDescriptor.model.multimodalFallback && (
                <EditorSection
                  title="Multimodal fallback"
                  description="Route image input to a vision-capable model."
                  flush
                >
                  {formFallbackOpen || formFallbackLlmProfileId ? (
                    <MultimodalFallbackSection
                      llmProfiles={llmProfiles}
                      profileId={formFallbackLlmProfileId}
                      model={formFallbackModel}
                      onProfileChange={handleFallbackProfileChange}
                      onModelChange={setFormFallbackModel}
                      onFlush={autosave.flush}
                      onRemove={() => {
                        setFormFallbackLlmProfileId('');
                        setFormFallbackModel('');
                        setFormFallbackOpen(false);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setFormFallbackOpen(true)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span aria-hidden="true" className="text-base leading-none">
                        +
                      </span>
                      Add fallback model
                    </button>
                  )}
                </EditorSection>
              )}
            </div>
          )}

          {activeTab === 'capabilities' && (
            <div className="flex flex-col gap-4">
              <EditorSection
                title="Capabilities"
                description="Configure built-in tools, external providers, and skill execution for this profile."
              >
                <EditorTabs
                  variant="sub"
                  active={capabilityTab}
                  onChange={id => setCapabilityTab(id as typeof capabilityTab)}
                  tabs={[
                    {
                      id: 'tools',
                      label: 'Tools',
                      count:
                        activeDescriptor.capabilities.tools === 'profile'
                          ? enabledToolSetChips.length || undefined
                          : undefined,
                    },
                    {
                      id: 'providers',
                      label: 'Providers',
                      count:
                        activeDescriptor.capabilities.providers === 'profile'
                          ? mcpProviderChips.length || undefined
                          : undefined,
                    },
                    {
                      id: 'skills',
                      label: 'Skills',
                      count:
                        activeDescriptor.capabilities.skills === 'profile'
                          ? pinnedSkillChips.length || undefined
                          : undefined,
                    },
                  ]}
                />

                {capabilityTab === 'tools' &&
                  (activeDescriptor.capabilities.tools === 'profile' ? (
                    <>
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
                                <Checkbox
                                  checked={checked}
                                  onChange={() => toggleToolSet(set.id)}
                                  aria-label={`enable full tool set ${set.id}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => toggleToolSetExpanded(set.id)}
                                  aria-label={`expand tool set ${set.id}`}
                                  aria-expanded={expanded}
                                  className="min-w-0 flex-1 py-1 text-left"
                                >
                                  {/* The set name is what identifies the row, so it
                                      keeps the first line to itself at phone width;
                                      the tool preview drops below rather than
                                      competing for the same shrinkable space. */}
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="min-w-0 flex-1 truncate font-medium">
                                      {set.label}
                                    </div>
                                    <span className="hidden shrink-0 rounded-full bg-background/70 border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground md:inline-block">
                                      {set.tools.length} tools
                                    </span>
                                    <span className="hidden min-w-0 flex-[2] truncate text-xs text-muted-foreground md:block">
                                      {toolSetPreview(set.tools)}
                                    </span>
                                    <ChevronRight
                                      size={14}
                                      strokeWidth={2}
                                      aria-hidden="true"
                                      className={`shrink-0 text-muted-foreground/70 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                    />
                                  </div>
                                  {/* The count rides the preview line on a phone so the
                                      set name keeps the first line to itself. */}
                                  <div className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
                                    {set.tools.length} tools · {toolSetPreview(set.tools)}
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleToolSetCustomize(set.id)}
                                  aria-label={`customize tool set ${set.id}`}
                                  className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors max-md:py-2 ${
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
                                          <span
                                            className="block truncate font-mono text-xs"
                                            title={tool}
                                          >
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
                    </>
                  ) : (
                    <CapabilityNote
                      title="Claude provides its own tools"
                      body="Built-in tool sets are not injected into the Claude runtime. Only plugin, skill, and interaction tools bridge through the claudia-plugins MCP server."
                    />
                  ))}

                {capabilityTab === 'providers' &&
                  (activeDescriptor.capabilities.providers === 'profile' ? (
                    <div className="rounded-lg text-sm max-md:border-0 max-md:bg-transparent max-md:p-0 md:border md:border-border md:bg-secondary/50 md:p-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">Configured MCP servers</p>
                          <span className="text-[10px] text-muted-foreground">
                            {externalProviders.filter(provider => provider.source === 'mcp').length}{' '}
                            selected
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
                            const state =
                              status?.state ?? (server.enabled ? 'configured' : 'disabled');
                            return (
                              <div
                                key={server.id}
                                className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-background/60 px-2 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span
                                      className="truncate font-mono text-xs"
                                      title={`mcp/${server.name}`}
                                    >
                                      mcp/{server.name}
                                    </span>
                                    <span
                                      className={`shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] ${
                                        state === 'connected'
                                          ? 'text-success'
                                          : state === 'failed'
                                            ? 'text-destructive'
                                            : state === 'needs-auth'
                                              ? 'text-warning'
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
                                  <div
                                    key={label}
                                    className="rounded-md bg-background/60 px-2 py-2"
                                  >
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
                  ) : (
                    <CapabilityNote
                      title="Managed by ~/.claude"
                      body="MCP providers for the Claude runtime come from your ~/.claude configuration and aren't set per profile here."
                    />
                  ))}

                {capabilityTab === 'skills' &&
                  (activeDescriptor.capabilities.skills === 'profile' ? (
                    <div className="rounded-lg text-sm max-md:border-0 max-md:bg-transparent max-md:p-0 md:border md:border-border md:bg-secondary/50 md:p-3">
                      <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                        <span>{skillProviderCount} sources</span>
                        <span>{skillIncludeCount} included</span>
                        <span>{pinnedSkillCount} pinned inline</span>
                        <span>{skillPolicyOverrideCount} policy overrides</span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {(['workspace', 'external', 'plugin'] as SkillSource[]).map(source => (
                          <label
                            key={source}
                            className="flex cursor-pointer items-center gap-2 rounded-md bg-background/60 px-2 py-1.5 text-xs capitalize max-md:py-2.5"
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
                                      checked={
                                        executionOverride?.allowedModes?.includes('inline') ?? false
                                      }
                                      onChange={() => toggleSkillAllowedMode(skill, 'inline')}
                                      aria-label={`allow inline skill ${key}`}
                                    />
                                    Allow inline
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={
                                        executionOverride?.allowedModes?.includes('fork') ?? false
                                      }
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
                  ) : (
                    <CapabilityNote
                      title="Managed by ~/.claude"
                      body="Skills for the Claude runtime come from your ~/.claude configuration and aren't set per profile here."
                    />
                  ))}
              </EditorSection>
            </div>
          )}

          {activeTab === 'prompt' && (
            <div className="flex flex-col gap-4">
              <EditorSection title="System Prompt">
                {systemPromptExpanded ? (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setSystemPromptExpanded(false)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Collapse
                      </button>
                    </div>
                    <textarea
                      value={formSystemPrompt}
                      onChange={e => setFormSystemPrompt(e.target.value)}
                      onBlur={autosave.flush}
                      placeholder="You are a helpful coding agent..."
                      rows={9}
                      // Grows to fill the phone screen (the tab is otherwise
                      // mostly empty space below a 180px box); fixed on desktop,
                      // where the editor shares the viewport.
                      className={`${MONO_FIELD_CLASS} min-h-[55vh] resize-y md:min-h-[180px]`}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSystemPromptExpanded(true)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/55 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {systemPromptPreview || 'No system prompt set — click to edit.'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">Edit</span>
                  </button>
                )}
              </EditorSection>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MultimodalFallbackSection({
  llmProfiles,
  profileId,
  model,
  onProfileChange,
  onModelChange,
  onRemove,
  onFlush,
}: {
  llmProfiles: LlmProfileConfig[];
  profileId: string;
  model: string;
  onProfileChange: (id: string) => void;
  onModelChange: (v: string) => void;
  onRemove: () => void;
  onFlush: () => void;
}) {
  const fallbackProfile = llmProfiles.find(p => p.id === profileId);
  const declaredModels = fallbackProfile?.models ?? [];
  const hasDeclaredModels = declaredModels.length > 0;
  const visionModels = visionCapableModels(fallbackProfile);
  const modelValue =
    hasDeclaredModels && !visionModels.some(entry => entry.modelId === model) ? '' : model;
  return (
    <>
      <div className="divide-y divide-border/60">
        <EditorRow
          title="Fallback LLM Profile"
          control={
            <div className="w-48 md:w-56">
              <select
                aria-label="Fallback LLM Profile"
                value={profileId}
                onChange={event => onProfileChange(event.target.value)}
                onBlur={onFlush}
                className={FIELD_CLASS}
              >
                <option value="">None</option>
                {llmProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        {profileId && hasDeclaredModels && (
          <EditorRow
            title="Fallback Model"
            description="Must support image input"
            control={
              <div className="w-48 md:w-56">
                <select
                  aria-label="Fallback Model"
                  value={modelValue}
                  onChange={event => onModelChange(event.target.value)}
                  onBlur={onFlush}
                  disabled={visionModels.length === 0}
                  className={`${FIELD_CLASS} disabled:opacity-50`}
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
              </div>
            }
          />
        )}

        {profileId && !hasDeclaredModels && (
          <EditorRow
            title="Fallback Model"
            description="Must support image input"
            control={
              <div className="w-48 md:w-56">
                <input
                  type="text"
                  aria-label="Fallback Model"
                  value={model}
                  onChange={event => onModelChange(event.target.value)}
                  onBlur={onFlush}
                  placeholder="model id"
                  className={MONO_FIELD_CLASS}
                />
              </div>
            }
          />
        )}

        <EditorRow
          title={
            <span className="text-xs text-muted-foreground">
              {profileId ? 'Vision fallback enabled' : 'No fallback selected'}
            </span>
          }
          control={
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Remove fallback
            </button>
          }
        />
      </div>

      {profileId && hasDeclaredModels && visionModels.length === 0 && (
        <p className="mx-4 mb-4 text-xs text-warning">
          No Vision-capable models declared on this LLM profile.
        </p>
      )}
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
  const known = models.some(m => m.modelId === trimmed);
  if (known) return null;
  return (
    <p className="text-xs text-warning mt-1">
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
  hideLabel = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  llmProfile: LlmProfileConfig | undefined;
  hideLabel?: boolean;
  'aria-label'?: string;
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
      {!hideLabel && <FieldLabel>Model *</FieldLabel>}
      <button
        type="button"
        onClick={() => hasModels && setOpen(!open)}
        disabled={!hasModels}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left font-mono disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && hasModels && (
        <div className={`${SELECT_POPOVER_CLASS} max-h-72 overflow-y-auto`}>
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

function LlmProfileSelector({
  value,
  onChange,
  profiles,
  hideLabel = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  profiles: LlmProfileConfig[];
  hideLabel?: boolean;
  'aria-label'?: string;
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
      {!hideLabel && <FieldLabel>LLM Profile *</FieldLabel>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
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
        <div className={SELECT_POPOVER_CLASS}>
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
  hideLabel = false,
  'aria-label': ariaLabel,
}: {
  value: ThinkingLevelOption;
  onChange: (v: ThinkingLevelOption) => void;
  hideLabel?: boolean;
  'aria-label'?: string;
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
      {!hideLabel && <FieldLabel>Thinking Level</FieldLabel>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>{selected?.label ?? 'Auto'}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className={SELECT_POPOVER_CLASS}>
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

function RuntimeSelector({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: RuntimeOption;
  onChange: (v: RuntimeOption) => void;
  options: ProfileConfigDescriptor[];
  'aria-label'?: string;
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

  const selected = options.find(o => o.runtime === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className={SELECT_POPOVER_CLASS}>
          {options.map(opt => (
            <button
              key={opt.runtime}
              type="button"
              onClick={() => {
                onChange(opt.runtime);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                opt.runtime === value
                  ? 'text-primary font-medium bg-muted/40'
                  : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {opt.runtime === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
