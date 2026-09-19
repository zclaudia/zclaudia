/**
 * Backend-scoped LLM profile (provider) editor
 *
 * Standalone create/edit form for one LLM profile on one backend, extracted
 * from the old settings Providers tab's monolith (LlmProfileManager). Talks to
 * the ForBackend API variants directly — no global store; the parent syncs
 * stores via onSaved. Autosaves on change (no explicit Save button).
 *
 * Matches the agent profile editor (ProfileEditor) design language: it owns its
 * own ProfileHeader (breadcrumb + inline-editable name + badges + save
 * indicator) and lays fields out with EditorSection / EditorRow. Delete and
 * set-default are not in the editor — they live on the library card in
 * AgentsContent (handleDeleteLlmProfile / handleSetLlmProfileDefault).
 *
 * Parent must remount this component per identity — key it by
 * `${backendId}:${profile?.id ?? 'new'}`. Form state initializes from the
 * `profile` prop on mount only; prop-driven switching of backendId or profile
 * without a key change is not supported.
 *
 * Deliberately not carried over from the old settings tab's component: the
 * profile list view (the Agents tree replaces it), modal chrome, readOnly
 * mode, useLlmProfileMetaStore / useAgentReadinessStore syncing, and alert()
 * error surfacing (inline errors instead).
 *
 * Presentational subcomponents and pure helpers live in ./llm-profile-editor/
 * (ModelsSection / ModelRow / the fetch picker / the provider selector, the
 * test-model and context-window-resolve hooks, and the derive/styles modules).
 */

import { useState, useRef, useMemo } from 'react';
import type { LlmProfileConfig, LlmProfileCompat } from '@zclaudia/shared';
import { resolveLlmProfileProtocols } from '@zclaudia/shared/core/llm-profile';
import {
  createLlmProfileForBackend,
  updateLlmProfileForBackend,
  fetchModelsForLlmProfilePreviewForBackend,
} from '../../services/api';
import type { LlmProfilePreviewInput } from '../../services/api';
import { CodexOAuthSection } from './CodexOAuthSection';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { EditorSection, EditorRow } from './ui/EditorSection';
import { EditorTabs } from './ui/EditorTabs';
import type { EditorTab } from './ui/EditorTabs';
import { ProfileHeader } from './ui/ProfileHeader';
import type { DetailBadge } from './ui/DetailHeader';
import type { ActionsMenuAction } from './ui/ActionsMenu';
import { useProfileAutosave } from './useProfileAutosave';
import {
  draftsToEntries,
  entryToDraft,
  generateRowUid,
  validateModelDraftRow,
  type ModelRowDraft,
} from './llmProfileModelDraft';
import { ModelsSection } from './llm-profile-editor/ModelsSection';
import { FetchModelsPickerDialog } from './llm-profile-editor/FetchModelsPickerDialog';
import { ProviderTypeSelector } from './llm-profile-editor/ProviderTypeSelector';
import { useModelTestState } from './llm-profile-editor/useModelTestState';
import {
  RESERVED_HEADER_KEYS,
  PROVIDER_TYPE_LABELS,
  serializeModelEntries,
} from './llm-profile-editor/derive';
import { FIELD_CLASS, MONO_FIELD_CLASS } from './llm-profile-editor/styles';

export const LLM_NAME_PLACEHOLDER = 'e.g., Local ZClaudia Agent';

export interface LlmProfileEditorProps {
  backendId: string;
  /** null = create mode */
  profile: LlmProfileConfig | null;
  /** Display name of the target backend, shown as a header badge. */
  backendName?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
  /** "⋯" menu entries for the header (set-default/delete live here). */
  headerActions?: ActionsMenuAction[];
}

export function LlmProfileEditor({
  backendId,
  profile,
  backendName,
  onBack,
  onSaved,
  headerActions,
}: LlmProfileEditorProps) {
  // Form state — initialized from `profile` (keyed remount contract).
  const initialHasCompat = Boolean(profile?.compat && Object.keys(profile.compat).length > 0);
  const [formName, setFormName] = useState(profile?.name ?? '');
  const [formProviderType, setFormProviderType] = useState<string>(
    profile?.providerType ?? 'anthropic'
  );
  const [formBaseUrl, setFormBaseUrl] = useState(profile?.baseUrl || '');
  const [formProtocols, setFormProtocols] = useState(profile?.supportedProtocols ?? null);
  const [formApiKey, setFormApiKey] = useState(profile?.apiKey || '');
  const [formCompat, setFormCompat] = useState(
    initialHasCompat ? JSON.stringify(profile?.compat, null, 2) : ''
  );
  const [formCompatError, setFormCompatError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'connection' | 'models' | 'advanced'>('connection');
  const [formRequestHeaders, setFormRequestHeaders] = useState(
    profile?.requestHeaders ? JSON.stringify(profile.requestHeaders, null, 2) : ''
  );
  const [formRequestHeadersError, setFormRequestHeadersError] = useState<string | null>(null);
  // Set-default now lives on the library card; the editor only carries the
  // current value through to the payload (and the header "Default" badge).
  const [formIsDefault] = useState(profile?.isDefault || false);
  const [formCacheRetention, setFormCacheRetention] = useState<
    'default' | 'none' | 'short' | 'long'
  >(profile?.cacheRetention ?? 'default');
  const [formCacheMarkers, setFormCacheMarkers] = useState(
    profile?.compat?.cacheControlFormat === 'anthropic'
  );
  const [formModels, setFormModels] = useState<ModelRowDraft[]>(
    profile?.models ? profile.models.map(entryToDraft) : []
  );
  const [formModelsSaveError, setFormModelsSaveError] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchPicker, setFetchPicker] = useState<{
    candidates: string[];
    selected: Set<string>;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * The persisted identity this editor targets. Starts as the profile prop's
   * id (edit mode) or null (create mode) — but a create-mode save performed by
   * CodexOAuthSection's onBeforeSignIn (which persists without notifying the
   * parent, so the keyed remount doesn't tear down the in-flight OAuth modal)
   * promotes it, ensuring the next Save updates instead of creating a
   * duplicate.
   */
  const savedIdRef = useRef<string | null>(profile?.id ?? null);

  /**
   * Build a `LlmProfilePreviewInput` snapshot of the *current form state* for
   * the pre-save fetch/probe preview endpoints. Unlike the legacy /:id/models
   * routes, the preview endpoints don't need the profile to be persisted —
   * they accept providerType + baseUrl + apiKey + headers + models directly,
   * so Fetch / Test can run on a brand-new create form and reflect unsaved
   * edits without a save-first round trip.
   *
   * We parse requestHeaders defensively here; on JSON parse failure we fall
   * back to omitting them rather than throwing, mirroring the lenient behavior
   * the server-side preview validator already accepts.
   */
  const buildPreviewInputFromForm = (): LlmProfilePreviewInput => {
    let requestHeadersObj: Record<string, string> | undefined;
    if (formRequestHeaders.trim()) {
      try {
        const parsed = JSON.parse(formRequestHeaders);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          requestHeadersObj =
            Object.keys(parsed).length > 0 ? (parsed as Record<string, string>) : undefined;
        }
      } catch {
        // Surfaced separately by Save validation; leave headers undefined here.
      }
    }
    return {
      providerType: formProviderType,
      baseUrl: formBaseUrl.trim() || undefined,
      apiKey: formApiKey.trim() || undefined,
      requestHeaders: requestHeadersObj,
      models: serializeModelEntries(formModels, formProviderType),
    };
  };

  /**
   * Whether the form has at least one valid model row that would serialize to
   * a real entry on Save. F2 makes "no declared models" a hard save error —
   * the runtime needs an explicit declaration so context windows resolve from
   * the profile rather than silently falling back to pi-ai defaults.
   */
  const hasAtLeastOneModelEntry = draftsToEntries(formModels).length > 0;
  const isCodexProvider = formProviderType === 'openai-codex';
  const isAnthropicProvider = formProviderType === 'anthropic';
  const formValid = useMemo(() => {
    if (!formName.trim()) return false;
    if (!isCodexProvider) {
      if (!hasAtLeastOneModelEntry) return false;
      for (let i = 0; i < formModels.length; i += 1) {
        const row = formModels[i];
        const isEmpty =
          !row.modelId.trim() &&
          !row.displayName.trim() &&
          !row.contextWindowStr.trim() &&
          !row.maxTokensStr.trim() &&
          !row.supportsImage;
        if (!isEmpty) {
          const errors = validateModelDraftRow(row, formModels, i);
          if (errors.modelId || errors.contextWindow || errors.maxTokens) return false;
        }
      }
      for (const source of [formRequestHeaders, formCompat]) {
        const trimmed = source.trim();
        if (!trimmed || trimmed === '{}') continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
        } catch {
          return false;
        }
      }
    }
    return true;
  }, [
    formName,
    isCodexProvider,
    hasAtLeastOneModelEntry,
    formModels,
    formRequestHeaders,
    formCompat,
  ]);

  const autosaveSignature = useMemo(
    () =>
      JSON.stringify({
        name: formName,
        providerType: formProviderType,
        supportedProtocols: formProtocols,
        baseUrl: formBaseUrl,
        apiKey: formApiKey,
        compat: formCompat,
        requestHeaders: formRequestHeaders,
        isDefault: formIsDefault,
        cacheRetention: formCacheRetention,
        cacheMarkers: formCacheMarkers,
        models: formModels.map(({ rowUid, testStatus: _testStatus, ...model }) => ({
          rowUid,
          ...model,
        })),
      }),
    [
      formName,
      formProviderType,
      formProtocols,
      formBaseUrl,
      formApiKey,
      formCompat,
      formRequestHeaders,
      formIsDefault,
      formCacheRetention,
      formCacheMarkers,
      formModels,
    ]
  );

  const handleSubmit = async (
    opts: { notify?: boolean } = {}
  ): Promise<LlmProfileConfig | null> => {
    const notify = opts.notify ?? true;
    if (!formName.trim()) return null;

    setSaveError(null);
    try {
      let requestHeadersObj: Record<string, string> | undefined;
      if (isCodexProvider) {
        setFormRequestHeadersError(null);
      } else if (formRequestHeaders.trim()) {
        try {
          const parsed = JSON.parse(formRequestHeaders);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setFormRequestHeadersError('Request headers must be a JSON object');
            return null;
          }
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== 'string') {
              setFormRequestHeadersError(`Header "${key}" value must be a string`);
              return null;
            }
            if (RESERVED_HEADER_KEYS.has(key.toLowerCase())) {
              setFormRequestHeadersError(
                `Header "${key}" is reserved (managed by API key); remove it from Request Headers`
              );
              return null;
            }
          }
          requestHeadersObj =
            Object.keys(parsed).length > 0 ? (parsed as Record<string, string>) : undefined;
          setFormRequestHeadersError(null);
        } catch (err) {
          setFormRequestHeadersError(
            `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
          );
          return null;
        }
      } else {
        setFormRequestHeadersError(null);
      }

      let compatObj: LlmProfileCompat | undefined;
      const compatTrimmed = formCompat.trim();
      if (isCodexProvider) {
        setFormCompatError(null);
      } else if (compatTrimmed && compatTrimmed !== '{}') {
        try {
          const parsed = JSON.parse(compatTrimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (Object.keys(parsed).length > 0) {
              compatObj = parsed as LlmProfileCompat;
            }
          } else {
            setFormCompatError('Compat must be a JSON object');
            return null;
          }
        } catch {
          setFormCompatError('Invalid JSON in compat field');
          return null;
        }
      }
      setFormCompatError(null);

      // Checkbox state owns the cacheControlFormat key; the freeform compat JSON
      // textarea keeps every other key as-is.
      const compatMerged: Record<string, unknown> = { ...(compatObj ?? {}) };
      if (formCacheMarkers) compatMerged.cacheControlFormat = 'anthropic';
      else delete compatMerged.cacheControlFormat;
      const compatOut =
        !isCodexProvider && Object.keys(compatMerged).length > 0 ? compatMerged : undefined;

      // Models — block save if any row has an inline error (duplicate / empty
      // id / non-positive-integer override). Empty rows are silently dropped.
      // Row-level errors already surface inline; this banner just points the
      // user at the offending row so they don't have to scan a long list.
      let modelsSaveError: string | null = null;
      if (!isCodexProvider) {
        for (let i = 0; i < formModels.length; i += 1) {
          const row = formModels[i];
          if (
            !row.modelId.trim() &&
            !row.displayName.trim() &&
            !row.contextWindowStr.trim() &&
            !row.maxTokensStr.trim() &&
            !row.supportsImage
          ) {
            continue; // fully empty — drop on serialize
          }
          const errs = validateModelDraftRow(row, formModels, i);
          if (errs.modelId || errs.contextWindow || errs.maxTokens) {
            modelsSaveError = `Fix model row ${i + 1} before saving (${errs.modelId ?? errs.contextWindow ?? errs.maxTokens}).`;
            break;
          }
        }
      }
      if (modelsSaveError) {
        setFormModelsSaveError(modelsSaveError);
        return null;
      }
      const modelsArr = isCodexProvider ? [] : serializeModelEntries(formModels, formProviderType);
      // F2: a profile with no declared models is no longer accepted. Agent
      // profiles consume `llmProfile.models` to choose which model id to send
      // and to resolve the context window — saving an empty list silently
      // forces them back to the pi-ai registry fallback path.
      // Exception: openai-codex profiles fetch their model list via OAuth, so
      // an empty models array is valid on initial save.
      if (modelsArr.length === 0 && formProviderType !== 'openai-codex') {
        setFormModelsSaveError('Add at least one model before saving');
        return null;
      }
      setFormModelsSaveError(null);

      const cacheRetentionValue = formCacheRetention === 'default' ? null : formCacheRetention;
      const baseData = {
        name: formName.trim(),
        providerType: formProviderType,
        supportedProtocols: formProtocols,
        baseUrl: isCodexProvider ? null : formBaseUrl.trim() || undefined,
        apiKey: isCodexProvider ? null : formApiKey.trim() || undefined,
        compat: isCodexProvider ? null : (compatOut as LlmProfileCompat | undefined),
        requestHeaders: isCodexProvider ? null : requestHeadersObj,
        models: modelsArr,
        isDefault: formIsDefault,
      };

      const updateTargetId = savedIdRef.current;
      let saved: LlmProfileConfig;
      if (updateTargetId) {
        // PUT null clears the cacheRetention field on the server side.
        saved = await updateLlmProfileForBackend(backendId, updateTargetId, {
          ...baseData,
          cacheRetention: isAnthropicProvider ? cacheRetentionValue : null,
        });
      } else {
        // POST ignores null server-side; only send a defined value.
        saved = await createLlmProfileForBackend(backendId, {
          ...baseData,
          ...(isAnthropicProvider && cacheRetentionValue !== null
            ? { cacheRetention: cacheRetentionValue }
            : {}),
        });
      }

      const savedProfile = saved && typeof saved.id === 'string' ? saved : null;
      if (savedProfile) {
        savedIdRef.current = savedProfile.id;
        if (notify) onSaved(savedProfile.id);
      }
      return savedProfile;
    } catch (error) {
      console.error('Failed to save provider:', error);
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(`Failed to ${savedIdRef.current ? 'update' : 'create'} provider: ${message}`);
      return null;
    }
  };

  const autosave = useProfileAutosave({
    enabled: true,
    valid: formValid,
    signature: autosaveSignature,
    save: async () => {
      const saved = await handleSubmit();
      if (!saved) throw new Error('Unable to save provider');
    },
  });

  const { probeModel, clearTestStatusTimer } = useModelTestState({
    backendId,
    formModels,
    setFormModels,
    buildPreviewInput: buildPreviewInputFromForm,
  });

  const addEmptyModelRow = () => {
    if (formModelsSaveError) setFormModelsSaveError(null);
    setFormModels(rows => [
      ...rows,
      {
        rowUid: generateRowUid(),
        modelId: '',
        displayName: '',
        contextWindowStr: '',
        maxTokensStr: '',
        dialect: '',
        supportsImage: false,
        inputModalitiesTouched: false,
      },
    ]);
  };

  const updateModelRow = (index: number, patch: Partial<ModelRowDraft>) => {
    if (formModelsSaveError) setFormModelsSaveError(null);
    setFormModels(rows => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeModelRow = (index: number) => {
    if (formModelsSaveError) setFormModelsSaveError(null);
    const row = formModels[index];
    if (row) {
      clearTestStatusTimer(row.rowUid);
    }
    setFormModels(rows => rows.filter((_, i) => i !== index));
  };

  const handleFetchModels = async () => {
    // F2: Fetch now uses the preview endpoint, which accepts the current form
    // shape directly — works for brand-new (unsaved) profiles and reflects
    // unsaved edits without requiring a save round-trip first.
    if (!formProviderType) {
      setFetchModelsError('Provider type is required before fetching models.');
      return;
    }
    setFetchModelsError(null);
    setFetchingModels(true);
    try {
      const previewInput = buildPreviewInputFromForm();
      const result = await fetchModelsForLlmProfilePreviewForBackend(backendId, previewInput);
      if (!result.ok) {
        setFetchModelsError(result.error);
        return;
      }
      // Filter out ids already in the form so the picker is just net-new.
      const existing = new Set(formModels.map(r => r.modelId.trim()).filter(Boolean));
      const candidates = result.models.filter(id => !existing.has(id));
      if (candidates.length === 0) {
        setFetchModelsError('No new model ids returned (all candidates are already in the list).');
        return;
      }
      setFetchPicker({ candidates, selected: new Set(candidates) });
    } catch (err) {
      setFetchModelsError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingModels(false);
    }
  };

  const confirmFetchPicker = () => {
    if (!fetchPicker) return;
    const existing = new Set(formModels.map(r => r.modelId.trim()).filter(Boolean));
    const toAdd = Array.from(fetchPicker.selected).filter(id => !existing.has(id));
    if (toAdd.length > 0) {
      setFormModels(rows => [
        ...rows,
        ...toAdd.map<ModelRowDraft>(modelId => ({
          rowUid: generateRowUid(),
          modelId,
          displayName: '',
          contextWindowStr: '',
          maxTokensStr: '',
          dialect: '',
          supportsImage: false,
          inputModalitiesTouched: false,
        })),
      ]);
    }
    setFetchPicker(null);
  };

  /**
   * CodexOAuthSection credential/model changes need the parent to refetch. In
   * the old manager this was a loadProfiles() refetch; here the parent owns
   * the data, so we surface it as onSaved with the persisted id.
   */
  const handleCredentialsChanged = () => {
    const id = savedIdRef.current;
    if (id) onSaved(id);
  };

  const codexOAuthProfile: LlmProfileConfig = profile ?? {
    id: '__new_codex_profile__',
    name: formName.trim() || 'Codex',
    providerType: 'openai-codex',
    isDefault: formIsDefault,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const providerLabel = PROVIDER_TYPE_LABELS[formProviderType] ?? formProviderType;
  const headerBadges: DetailBadge[] = [
    ...(backendName ? [{ label: backendName, secondary: true }] : []),
    ...(formIsDefault ? [{ label: 'Default', tone: 'accent' as const, secondary: true }] : []),
    // The Provider Type field sits directly below and says the same thing.
    { label: providerLabel, tone: 'neutral' as const, secondary: true },
  ];

  const modelCount = draftsToEntries(formModels).length;
  const editorTabs: EditorTab[] = [
    { id: 'connection', label: 'Connection' },
    { id: 'models', label: 'Models', count: modelCount || undefined },
    { id: 'advanced', label: 'Advanced' },
  ];

  // Provider Type (+ Anthropic cache retention) — shared by the Connection tab
  // and the tab-less Codex layout, so the provider can always be switched.
  const providerSection = (
    <EditorSection title="Provider" flush overflowVisible>
      <div className="divide-y divide-border/60">
        <EditorRow
          title="Provider Type"
          // Provider labels run long ("OpenAI Codex (ChatGPT Plus/Pro)"), so this
          // one keeps the full width below md rather than truncating.
          layout="stack"
          control={
            <div className="w-full md:w-56">
              <ProviderTypeSelector
                hideLabel
                value={formProviderType}
                onChange={value => {
                  setFormProviderType(value);
                  setFormProtocols(null);
                }}
              />
            </div>
          }
        />
        {isAnthropicProvider && (
          <EditorRow
            title="Prompt cache retention"
            description='Anthropic prompt caching. "Off" is an escape hatch for proxies that reject cache_control.'
            align="start"
            layout="stack"
            control={
              <select
                value={formCacheRetention}
                onChange={e =>
                  setFormCacheRetention(e.target.value as 'default' | 'none' | 'short' | 'long')
                }
                aria-label="Prompt cache retention"
                className={`${FIELD_CLASS} md:w-56`}
              >
                <option value="default">Default (short, 5 min TTL)</option>
                <option value="long">Long (1 hour TTL, higher write cost)</option>
                <option value="none">Off (no cache_control markers)</option>
                <option value="short">Short (explicit 5 min TTL)</option>
              </select>
            }
          />
        )}
      </div>
    </EditorSection>
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ProfileHeader
        crumb="LLM Providers"
        onBack={onBack}
        name={formName}
        onNameChange={setFormName}
        onFieldBlur={autosave.flush}
        namePlaceholder={LLM_NAME_PLACEHOLDER}
        badges={headerBadges}
        saveStatus={autosave.status}
        onRetry={autosave.retry}
        recordStatus={profile?.recordStatus}
        actions={headerActions}
      />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-4">
          {isCodexProvider ? (
            // Codex only has OAuth sign-in — no Base URL / API Key / model rows /
            // compat — so it skips the tab bar entirely.
            <>
              {providerSection}
              <EditorSection title="Authentication">
                <CodexOAuthSection
                  backendId={backendId}
                  profile={codexOAuthProfile}
                  onCredentialsChanged={handleCredentialsChanged}
                  onBeforeSignIn={
                    !profile || profile.providerType !== 'openai-codex'
                      ? () => handleSubmit({ notify: false })
                      : undefined
                  }
                />
              </EditorSection>
            </>
          ) : (
            <>
              <EditorTabs
                tabs={editorTabs}
                active={activeTab}
                onChange={id => setActiveTab(id as typeof activeTab)}
              />

              {activeTab === 'connection' && (
                <div className="flex flex-col gap-4">
                  {providerSection}
                  <EditorSection title="Connection">
                    <div>
                      <FormField label="Base URL (optional)">
                        {f => (
                          <Input
                            {...f}
                            type="text"
                            value={formBaseUrl}
                            onChange={e => setFormBaseUrl(e.target.value)}
                            onBlur={autosave.flush}
                            placeholder="http://api.example.com/v1"
                            className="font-mono"
                          />
                        )}
                      </FormField>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Override default endpoint. Required for OpenAI-compatible third-party
                        proxies (e.g. DeepSeek, Moonshot, local gateways).
                      </p>
                    </div>

                    <div>
                      {formProviderType === 'openai' && (
                        <label className="mb-4 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={resolveLlmProfileProtocols({
                              providerType: formProviderType,
                              baseUrl: formBaseUrl,
                              supportedProtocols: formProtocols,
                            }).protocols.includes('openai-responses')}
                            onChange={event => {
                              const protocols = resolveLlmProfileProtocols({
                                providerType: formProviderType,
                                baseUrl: formBaseUrl,
                                supportedProtocols: formProtocols,
                              }).protocols;
                              setFormProtocols(
                                event.target.checked
                                  ? [...new Set([...protocols, 'openai-responses' as const])]
                                  : protocols.filter(p => p !== 'openai-responses')
                              );
                            }}
                          />
                          Endpoint supports Responses (required for Codex SDK)
                        </label>
                      )}
                      <FormField label="API Key (optional)">
                        {f => (
                          <Input
                            {...f}
                            type="password"
                            value={formApiKey}
                            onChange={e => setFormApiKey(e.target.value)}
                            onBlur={autosave.flush}
                            placeholder="sk-..."
                            autoComplete="off"
                            className="font-mono"
                          />
                        )}
                      </FormField>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Stored on the server. Falls back to environment if omitted.
                      </p>
                    </div>
                  </EditorSection>
                </div>
              )}

              {activeTab === 'models' && (
                <div className="flex flex-col gap-4">
                  <EditorSection
                    title="Models"
                    description="Agent profiles bound to this provider pick their model id from this list."
                  >
                    <ModelsSection
                      backendId={backendId}
                      models={formModels}
                      providerType={formProviderType}
                      fetching={fetchingModels}
                      fetchError={fetchModelsError}
                      saveError={formModelsSaveError}
                      onAdd={addEmptyModelRow}
                      onUpdate={updateModelRow}
                      onRemove={removeModelRow}
                      onFetch={handleFetchModels}
                      onProbe={probeModel}
                      buildPreviewInput={buildPreviewInputFromForm}
                    />
                  </EditorSection>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="flex flex-col gap-4">
                  <EditorSection
                    title="Request headers"
                    description="Extra HTTP headers added to LLM API requests. Authorization / Content-Type / Host are reserved."
                  >
                    <textarea
                      value={formRequestHeaders}
                      onChange={e => {
                        setFormRequestHeaders(e.target.value);
                        if (formRequestHeadersError) setFormRequestHeadersError(null);
                      }}
                      placeholder={`{
	"X-Org-Id": "abc",
	"User-Agent": "ZClaudia/1.0"
}`}
                      rows={5}
                      aria-label="Request Headers (JSON)"
                      className={`${MONO_FIELD_CLASS} resize-y ${formRequestHeadersError ? 'border-destructive' : ''}`}
                    />
                    {formRequestHeadersError && (
                      <p className="mt-1 text-xs text-destructive">{formRequestHeadersError}</p>
                    )}
                  </EditorSection>

                  <EditorSection
                    title="Compatibility overrides"
                    description="Per-provider capability overrides for OpenAI-compatible proxies. Leave empty for defaults."
                  >
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        id="cacheMarkers"
                        checked={formCacheMarkers}
                        onChange={e => setFormCacheMarkers(e.target.checked)}
                        aria-label="Anthropic-style cache markers"
                        className="mt-0.5"
                      />
                      <span>
                        Anthropic-style cache markers (enable when routing Claude through an
                        OpenAI-compatible proxy)
                      </span>
                    </label>
                    <textarea
                      value={formCompat}
                      onChange={e => {
                        setFormCompat(e.target.value);
                        if (formCompatError) setFormCompatError(null);
                      }}
                      placeholder={`{
	"supportsDeveloperRole": false,
	"supportsReasoningEffort": true,
	"supportsStrictMode": false
}`}
                      rows={5}
                      aria-label="Compat JSON"
                      className={`${MONO_FIELD_CLASS} resize-y`}
                    />
                    {formCompatError && (
                      <p className="text-xs text-destructive">{formCompatError}</p>
                    )}
                  </EditorSection>
                </div>
              )}
            </>
          )}

          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>
      </div>

      {fetchPicker && (
        <FetchModelsPickerDialog
          candidates={fetchPicker.candidates}
          selected={fetchPicker.selected}
          onToggle={id => {
            setFetchPicker(cur => {
              if (!cur) return cur;
              const next = new Set(cur.selected);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return { ...cur, selected: next };
            });
          }}
          onSelectAll={() =>
            setFetchPicker(cur => (cur ? { ...cur, selected: new Set(cur.candidates) } : cur))
          }
          onSelectNone={() => setFetchPicker(cur => (cur ? { ...cur, selected: new Set() } : cur))}
          onCancel={() => setFetchPicker(null)}
          onConfirm={confirmFetchPicker}
        />
      )}
    </div>
  );
}
