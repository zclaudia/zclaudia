import { normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared/core/mcp';
import { defaultSkillSelection, skillRefKey } from '@zclaudia/shared/core/skills';
import {
  BUILTIN_TOOL_SETS,
  legacyEnabledToolsToSelection,
  resolveToolSelection,
} from '@zclaudia/shared/core/tools';
import {
  defaultEngineModeFor,
  resolveProfileConfigDescriptor,
  type ProfileConfigDescriptor,
} from '@zclaudia/shared/core/profile-config-descriptor';
import * as api from '../../services/api';
import { useRuntimeDescriptorStore } from '../../stores/runtimeDescriptorStore';
import { EditorSection, EditorRow } from './ui/EditorSection';
import { EditorTabs } from './ui/EditorTabs';
import type { EditorTab } from './ui/EditorTabs';
import { useProfileAutosave } from './useProfileAutosave';
import { ProfileHeader } from './ui/ProfileHeader';
import type { DetailBadge } from './ui/DetailHeader';
import type { ActionsMenuAction } from './ui/ActionsMenu';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { McpProvidersPanel } from './profile-editor/McpProvidersPanel';
import { ModelDeclarationWarning } from './profile-editor/ModelDeclarationWarning';
import { ModelSelector } from './profile-editor/ModelSelector';
import { LlmProfileSelector } from './profile-editor/LlmProfileSelector';
import { SkillsPanel } from './profile-editor/SkillsPanel';
import { ThinkingLevelSelector } from './profile-editor/ThinkingLevelSelector';
import type { ThinkingLevelOption } from './profile-editor/ThinkingLevelSelector';
import { RuntimeSelector } from './profile-editor/RuntimeSelector';
import type { RuntimeOption } from './profile-editor/RuntimeSelector';
import { ToolSetsPanel } from './profile-editor/ToolSetsPanel';
import { MultimodalFallbackSection } from './profile-editor/MultimodalFallbackSection';
import { useToolSetSelection } from './profile-editor/useToolSetSelection';
import { useSkillSelection } from './profile-editor/useSkillSelection';
import {
  EDITABLE_BUILTIN_TOOL_SET_IDS,
  fallbackModelValidForProfile,
  skillRefFor,
  unavailableDescriptor,
} from './profile-editor/derive';
import { FIELD_CLASS, MONO_FIELD_CLASS } from './profile-editor/styles';

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

export const NAME_PLACEHOLDER = 'e.g., Default Coding Agent';

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
  const [formRuntimeType, setFormRuntimeType] = useState<RuntimeOption>(
    normalizeAgentRuntimeType()
  );
  /** Engine mode of the selected runtime ('' when the runtime declares no modes). */
  const [formEngineMode, setFormEngineMode] = useState('');
  const [formLlmProfileId, setFormLlmProfileId] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formCliPath, setFormCliPath] = useState('');
  const [formFallbackLlmProfileId, setFormFallbackLlmProfileId] = useState('');
  const [formFallbackModel, setFormFallbackModel] = useState('');
  const [formFallbackOpen, setFormFallbackOpen] = useState(false);
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const {
    formToolSelection,
    customizedToolSetIds,
    expandedToolSetIds,
    applySelection: applyToolSelection,
    toggleToolSetExpanded,
    toggleToolSet,
    toggleToolSetCustomize,
    toggleCustomTool,
    mcpProviderSelected,
    toggleMcpProvider,
  } = useToolSetSelection();
  const {
    formSkillSelection,
    formSkillExecution,
    applySelection: applySkillSelection,
    skillSourceEnabled,
    toggleSkillSource,
    skillVisibility,
    setSkillVisibility,
    togglePinnedSkill,
    skillExecutionOverrideFor,
    setSkillDefaultMode,
    setSkillForkToolPolicy,
    toggleSkillAllowedMode,
  } = useSkillSelection();
  const [formThinkingLevel, setFormThinkingLevel] = useState<ThinkingLevelOption>('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
    setFormRuntimeType(normalizeAgentRuntimeType(agent.runtimeType));
    setFormEngineMode(agent.engineMode ?? '');
    setFormLlmProfileId(agent.llmProfileId ?? '');
    setFormModel(agent.model);
    setFormCliPath(agent.cliPath ?? '');
    setFormFallbackLlmProfileId(agent.multimodalFallback?.llmProfileId ?? '');
    setFormFallbackModel(agent.multimodalFallback?.model ?? '');
    setFormFallbackOpen(Boolean(agent.multimodalFallback));
    setFormSystemPrompt(agent.systemPrompt);
    const nextToolSelection =
      agent.toolSelection ?? legacyEnabledToolsToSelection(agent.enabledTools);
    applyToolSelection(nextToolSelection);
    applySkillSelection(
      agent.skillSelection ?? defaultSkillSelection,
      agent.skillExecution ?? { overrides: [] }
    );
    setFormThinkingLevel((agent.thinkingLevel ?? '') as ThinkingLevelOption);
    setFormIsDefault(agent.isDefault ?? false);
    setFormError(null);
  };

  useEffect(() => {
    populateForm(profile);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

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

  // Dual-mode runtimes: the effective editor descriptor is the projection of
  // the selected engine mode; the raw payload still carries mode + binding so
  // the backend validates the whole configuration atomically.
  const activeDescriptor = useMemo(() => {
    const base = descriptorFor(formRuntimeType);
    if (!base.engineModes?.length) return base;
    const resolved = resolveProfileConfigDescriptor(
      base,
      formRuntimeType,
      formEngineMode || base.defaultEngineMode || null
    );
    return resolved.ok ? resolved.descriptor : base;
  }, [descriptorFor, formRuntimeType, formEngineMode]);
  const activeEngineModeDeclared = Boolean(descriptorFor(formRuntimeType).engineModes?.length);

  const buildPayload = useCallback(() => {
    const resolvedTools = resolveToolSelection(formToolSelection).builtinTools;
    const baseDescriptor = descriptorFor(formRuntimeType);
    const descriptor = activeDescriptor;
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
    // SDK modes reject a CLI path (FIELD_NOT_APPLICABLE), so a draft path is
    // cleared atomically with the mode switch — not left for the backend to
    // reject. Legacy single-mode behaviour is preserved.
    const cliPath = descriptor.hasCliPath
      ? trimmedCliPath || (hadCliPathAtMount.current ? null : undefined)
      : hadCliPathAtMount.current
        ? null
        : undefined;
    return {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      runtimeType: formRuntimeType,
      // Engine mode + binding + model travel as one atomic configuration.
      engineMode: activeEngineModeDeclared
        ? formEngineMode || baseDescriptor.defaultEngineMode || 'cli'
        : undefined,
      llmProfileId: formLlmProfileId || '',
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
    formEngineMode,
    activeEngineModeDeclared,
    activeDescriptor,
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
    (modelRequired ? formLlmProfileId && formModel.trim() : true) &&
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
    const nextBase = descriptorFor(next);
    setFormRuntimeType(next);
    // Engine mode resets to the runtime's declared default.
    setFormEngineMode(defaultEngineModeFor(nextBase) ?? '');
    // Model ids are not interchangeable across runtimes → clear and let the form
    // sit in `pending` until a model is chosen for the new runtime.
    setFormModel('');
    if (nextBase.model.thinkingLevel !== 'selectable') {
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

  /**
   * Switching engine modes keeps the other drafts in the editor but enforces
   * the target mode's rules atomically: entering SDK clears the CLI path
   * draft, and autosave stays `pending` until the whole configuration is
   * valid — the backend never sees a transient "sdk without a profile".
   */
  const handleEngineModeChange = (next: string) => {
    setFormEngineMode(next);
    if (next === 'sdk') {
      setFormCliPath('');
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
  const externalProviders = formToolSelection.providers ?? [];

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
    // Backend and default-ness are context; read-only changes what you can do.
    ...(backendName ? [{ label: backendName, secondary: true }] : []),
    ...(profile.isDefault ? [{ label: 'Default', tone: 'accent' as const, secondary: true }] : []),
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

                  {activeEngineModeDeclared &&
                    (() => {
                      const base = descriptorFor(formRuntimeType);
                      const modes = base.engineModes ?? [];
                      return (
                        <EditorRow
                          title="Run Mode"
                          description="Applies to new sessions; started sessions keep their original connection binding"
                          control={
                            <div className="flex flex-col gap-1.5">
                              {modes.map(mode => (
                                <label
                                  key={mode.id}
                                  className="flex cursor-pointer items-start gap-2"
                                >
                                  <input
                                    type="radio"
                                    name="engine-mode"
                                    className="mt-1"
                                    checked={
                                      (formEngineMode || base.defaultEngineMode || 'cli') ===
                                      mode.id
                                    }
                                    onChange={() => handleEngineModeChange(mode.id)}
                                    disabled={isReadonly}
                                  />
                                  <span className="text-sm">{mode.label}</span>
                                </label>
                              ))}
                            </div>
                          }
                        />
                      );
                    })()}

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

                {capabilityTab === 'tools' && (
                  <ToolSetsPanel
                    descriptor={activeDescriptor}
                    entries={builtinToolSetEntries}
                    formToolSelection={formToolSelection}
                    customizedToolSetIds={customizedToolSetIds}
                    expandedToolSetIds={expandedToolSetIds}
                    toggleToolSet={toggleToolSet}
                    toggleToolSetExpanded={toggleToolSetExpanded}
                    toggleToolSetCustomize={toggleToolSetCustomize}
                    toggleCustomTool={toggleCustomTool}
                  />
                )}

                {capabilityTab === 'providers' && (
                  <McpProvidersPanel
                    descriptor={activeDescriptor}
                    formToolSelection={formToolSelection}
                    mcpServers={mcpServers}
                    mcpStatuses={mcpStatuses}
                    mcpProviderSelected={mcpProviderSelected}
                    toggleMcpProvider={toggleMcpProvider}
                  />
                )}

                {capabilityTab === 'skills' && (
                  <SkillsPanel
                    descriptor={activeDescriptor}
                    skillCatalog={skillCatalog}
                    formSkillSelection={formSkillSelection}
                    formSkillExecution={formSkillExecution}
                    skillSourceEnabled={skillSourceEnabled}
                    toggleSkillSource={toggleSkillSource}
                    skillVisibility={skillVisibility}
                    setSkillVisibility={setSkillVisibility}
                    togglePinnedSkill={togglePinnedSkill}
                    skillExecutionOverrideFor={skillExecutionOverrideFor}
                    setSkillDefaultMode={setSkillDefaultMode}
                    setSkillForkToolPolicy={setSkillForkToolPolicy}
                    toggleSkillAllowedMode={toggleSkillAllowedMode}
                  />
                )}
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
