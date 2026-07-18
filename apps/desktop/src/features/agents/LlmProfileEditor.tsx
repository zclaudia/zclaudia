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
 */

import { useState, useEffect, useRef, useMemo, useId } from 'react';
import { ChevronDown, Check, AlertTriangle } from 'lucide-react';
import type { LlmProfileConfig, LlmProfileCompat, ContextWindowSource } from '@zclaudia/shared';
import { LLM_PROVIDER_TYPES } from '@zclaudia/shared';
import {
  createLlmProfileForBackend,
  updateLlmProfileForBackend,
  fetchModelsForLlmProfilePreviewForBackend,
  probeLlmProfileModelPreviewForBackend,
  resolveContextWindowPreviewForBackend,
} from '../../services/api';
import type { LlmProfilePreviewInput } from '../../services/api';
import { CodexOAuthSection } from './CodexOAuthSection';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { EditorSection, EditorRow, FieldLabel } from './ui/EditorSection';
import { EditorTabs } from './ui/EditorTabs';
import type { EditorTab } from './ui/EditorTabs';
import { ProfileHeader } from './ui/ProfileHeader';
import type { DetailBadge } from './ui/DetailHeader';
import { useProfileAutosave } from './useProfileAutosave';
import {
  draftsToEntries,
  entryToDraft,
  generateRowUid,
  validateModelDraftRow,
  type ModelRowDraft,
} from './llmProfileModelDraft';

const RESERVED_HEADER_KEYS = new Set(['authorization', 'content-type', 'host']);

/** Field styling shared with the agent profile editor (ProfileEditor). */
const FIELD_CLASS =
  'w-full rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono`;
/** Compact variant for the dense model-row grid; append a border-color class. */
const MODEL_FIELD_BASE =
  'w-full rounded-md border bg-background/70 px-2 py-1.5 text-sm text-foreground shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';

export const LLM_NAME_PLACEHOLDER = 'e.g., Local ZClaudia Agent';

export interface LlmProfileEditorProps {
  backendId: string;
  /** null = create mode */
  profile: LlmProfileConfig | null;
  /** Display name of the target backend, shown as a header badge. */
  backendName?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

export function LlmProfileEditor({
  backendId,
  profile,
  backendName,
  onBack,
  onSaved,
}: LlmProfileEditorProps) {
  // Form state — initialized from `profile` (keyed remount contract).
  const initialHasCompat = Boolean(profile?.compat && Object.keys(profile.compat).length > 0);
  const [formName, setFormName] = useState(profile?.name ?? '');
  const [formProviderType, setFormProviderType] = useState<string>(
    profile?.providerType ?? 'anthropic'
  );
  const [formBaseUrl, setFormBaseUrl] = useState(profile?.baseUrl || '');
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
  const testStatusTimersRef = useRef<Map<string, number>>(new Map());
  /**
   * The persisted identity this editor targets. Starts as the profile prop's
   * id (edit mode) or null (create mode) — but a create-mode save performed by
   * CodexOAuthSection's onBeforeSignIn (which persists without notifying the
   * parent, so the keyed remount doesn't tear down the in-flight OAuth modal)
   * promotes it, ensuring the next Save updates instead of creating a
   * duplicate.
   */
  const savedIdRef = useRef<string | null>(profile?.id ?? null);

  useEffect(() => {
    const timers = testStatusTimersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

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
      models: draftsToEntries(formModels),
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
  }, [formName, isCodexProvider, hasAtLeastOneModelEntry, formModels, formRequestHeaders, formCompat]);

  const autosaveSignature = useMemo(
    () =>
      JSON.stringify({
        name: formName,
        providerType: formProviderType,
        baseUrl: formBaseUrl,
        apiKey: formApiKey,
        compat: formCompat,
        requestHeaders: formRequestHeaders,
        isDefault: formIsDefault,
        cacheRetention: formCacheRetention,
        cacheMarkers: formCacheMarkers,
        models: formModels.map(
          ({ rowUid, testStatus: _testStatus, ...model }) => ({ rowUid, ...model })
        ),
      }),
    [
      formName,
      formProviderType,
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
      const modelsArr = isCodexProvider ? [] : draftsToEntries(formModels);
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

  const updateModelRowByUid = (rowUid: string, patch: Partial<ModelRowDraft>) => {
    setFormModels(rows => rows.map(r => (r.rowUid === rowUid ? { ...r, ...patch } : r)));
  };

  const removeModelRow = (index: number) => {
    if (formModelsSaveError) setFormModelsSaveError(null);
    const row = formModels[index];
    if (row) {
      const t = testStatusTimersRef.current.get(row.rowUid);
      if (t != null) {
        window.clearTimeout(t);
        testStatusTimersRef.current.delete(row.rowUid);
      }
    }
    setFormModels(rows => rows.filter((_, i) => i !== index));
  };

  const scheduleClearTestStatus = (rowUid: string) => {
    const existing = testStatusTimersRef.current.get(rowUid);
    if (existing != null) window.clearTimeout(existing);
    const id = window.setTimeout(() => {
      testStatusTimersRef.current.delete(rowUid);
      setFormModels(rows =>
        rows.map(r => (r.rowUid === rowUid ? { ...r, testStatus: undefined } : r))
      );
    }, 6000);
    testStatusTimersRef.current.set(rowUid, id);
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

  const handleProbeModel = async (index: number) => {
    const row = formModels[index];
    const modelId = row?.modelId.trim();
    if (!row || !modelId) return;
    const rowUid = row.rowUid;
    // F2: probe-preview accepts the form draft so we can Test before saving.
    updateModelRowByUid(rowUid, { testStatus: { kind: 'running' } });
    try {
      const previewInput = buildPreviewInputFromForm();
      const result = await probeLlmProfileModelPreviewForBackend(backendId, previewInput, modelId);
      if (result.ok) {
        updateModelRowByUid(rowUid, { testStatus: { kind: 'ok', latencyMs: result.latencyMs } });
      } else {
        updateModelRowByUid(rowUid, { testStatus: { kind: 'fail', error: result.error } });
      }
    } catch (err) {
      updateModelRowByUid(rowUid, {
        testStatus: { kind: 'fail', error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      scheduleClearTestStatus(rowUid);
    }
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
    ...(backendName ? [{ label: backendName }] : []),
    ...(formIsDefault ? [{ label: 'Default', tone: 'accent' as const }] : []),
    { label: providerLabel, tone: 'neutral' as const },
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
          control={
            <div className="w-56">
              <ProviderTypeSelector
                hideLabel
                value={formProviderType}
                onChange={setFormProviderType}
              />
            </div>
          }
        />
        {isAnthropicProvider && (
          <EditorRow
            title="Prompt cache retention"
            description='Anthropic prompt caching. "Off" is an escape hatch for proxies that reject cache_control.'
            align="start"
            control={
              <select
                value={formCacheRetention}
                onChange={e =>
                  setFormCacheRetention(e.target.value as 'default' | 'none' | 'short' | 'long')
                }
                aria-label="Prompt cache retention"
                className={`${FIELD_CLASS} w-56`}
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
                      onProbe={handleProbeModel}
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
                    {formCompatError && <p className="text-xs text-destructive">{formCompatError}</p>}
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

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex (ChatGPT Plus/Pro)',
};

const PROVIDER_TYPE_OPTIONS: { value: string; label: string }[] = LLM_PROVIDER_TYPES.map(value => ({
  value,
  label: PROVIDER_TYPE_LABELS[value] ?? value,
}));

interface ModelsSectionProps {
  backendId: string;
  models: ModelRowDraft[];
  providerType: string;
  fetching: boolean;
  fetchError: string | null;
  saveError: string | null;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<ModelRowDraft>) => void;
  onRemove: (index: number) => void;
  onFetch: () => void;
  onProbe: (index: number) => void;
  /**
   * Build a snapshot of the *current* form draft for the F3 resolve-preview
   * call. Each ModelRow uses this to ask the server "what context window
   * would the runtime resolve for my modelId if I left the override blank?".
   */
  buildPreviewInput: () => LlmProfilePreviewInput;
}

function ModelsSection({
  backendId,
  models,
  providerType,
  fetching,
  fetchError,
  saveError,
  onAdd,
  onUpdate,
  onRemove,
  onFetch,
  onProbe,
  buildPreviewInput,
}: ModelsSectionProps) {
  // F2: Fetch/Test now hit the preview endpoints, so neither needs the profile
  // to be saved or the form to be pristine. The only remaining hard gate is
  // providerType (the preview validator requires it).
  const fetchDisabledReason = !providerType ? 'Pick a provider type first' : undefined;
  const fetchDisabled = !providerType || fetching;
  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onFetch}
          disabled={fetchDisabled}
          title={fetchDisabledReason}
          className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
        >
          {fetching ? 'Fetching…' : 'Fetch from /models'}
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
        >
          + Add model
        </button>
      </div>
      {fetchError && <p className="mb-2 text-xs text-destructive">{fetchError}</p>}
      {saveError && <p className="mb-2 text-xs text-destructive">{saveError}</p>}
      {models.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No models declared. Add at least one model entry before saving — agent profiles bound to
          this LLM profile pick their model id from this list.
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((row, idx) => (
            <ModelRow
              key={row.rowUid}
              backendId={backendId}
              index={idx}
              row={row}
              allRows={models}
              providerType={providerType}
              onChange={patch => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
              onProbe={() => onProbe(idx)}
              buildPreviewInput={buildPreviewInput}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ModelRowProps {
  backendId: string;
  index: number;
  row: ModelRowDraft;
  allRows: ModelRowDraft[];
  providerType: string;
  onChange: (patch: Partial<ModelRowDraft>) => void;
  onRemove: () => void;
  onProbe: () => void;
  buildPreviewInput: () => LlmProfilePreviewInput;
}

interface ResolvedPreviewState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  value?: number;
  source?: ContextWindowSource;
  /**
   * Cross-provider matched pi-ai provider id when `source === 'pi_ai_registry'`.
   * Lets the helper text annotate e.g. "from registry (deepseek)" when an
   * OpenAI-compat profile borrows a registered model id from another provider.
   */
  matchedProvider?: string;
}

function ModelRow({
  backendId,
  index,
  row,
  allRows,
  providerType,
  onChange,
  onRemove,
  onProbe,
  buildPreviewInput,
}: ModelRowProps) {
  const errs = validateModelDraftRow(row, allRows, index);
  const isRunning = row.testStatus?.kind === 'running';
  const testDisabled = !providerType || isRunning || !row.modelId.trim() || !!errs.modelId;
  const testDisabledReason = !providerType
    ? 'Pick a provider type first'
    : !row.modelId.trim()
      ? 'Enter a model id first'
      : errs.modelId
        ? `Fix model id (${errs.modelId}) first`
        : undefined;

  // F3: when contextWindow is left blank, ask the server what the runtime would
  // resolve for this modelId so users see "if you save this row blank, X via
  // Y" inline. Debounced so a fast typer doesn't fan out a request per
  // keystroke; a version counter ensures stale responses don't overwrite the
  // freshest result.
  const [resolved, setResolved] = useState<ResolvedPreviewState>({ status: 'idle' });
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  const modelIdInput = row.modelId.trim();
  const contextOverrideEmpty = !row.contextWindowStr.trim();
  const helperEligible = !!providerType && !!modelIdInput && contextOverrideEmpty && !errs.modelId;

  useEffect(() => {
    // Clear any pending debounce on every input change (in-flight responses
    // are neutralized by the request-id staleness guard below). If we're no
    // longer eligible (override filled, modelId cleared, etc.) just reset to
    // idle — the UI hides the helper text in those cases.
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!helperEligible) {
      // Don't surface stale results when the helper isn't applicable.
      if (resolved.status !== 'idle') setResolved({ status: 'idle' });
      return;
    }

    const myRequestId = ++requestIdRef.current;
    setResolved({ status: 'loading' });

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      const previewInput = buildPreviewInput();
      // Self-edit guard: strip the current row's own contextWindow override
      // (it's empty by the helperEligible gate, but also strip the entry's
      // maxTokens / displayName aren't relevant — we only need to neutralize
      // contextWindow). This way `resolveContextWindow` walks past the
      // profile_entry layer for *this* model id and reports what the next
      // layer (pi_ai_registry / openai_compat_default / fallback) would supply.
      const sanitizedModels = (previewInput.models ?? []).map(entry => {
        if (entry.modelId !== modelIdInput) return entry;
        const { contextWindow: _omitContextWindow, ...rest } = entry;
        void _omitContextWindow;
        return rest;
      });

      resolveContextWindowPreviewForBackend(backendId, {
        ...previewInput,
        models: sanitizedModels,
        modelId: modelIdInput,
      })
        .then(data => {
          if (myRequestId !== requestIdRef.current) return; // stale
          setResolved({
            status: 'ok',
            value: data.value,
            source: data.source,
            matchedProvider: data.matchedProvider,
          });
        })
        .catch(() => {
          if (myRequestId !== requestIdRef.current) return; // stale
          setResolved({ status: 'error' });
        });
    }, 300);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
    // We intentionally depend on the inputs that drive the request shape.
    // buildPreviewInput is recreated on every parent render — that's fine
    // because the debounce + version guard makes redundant calls safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helperEligible, modelIdInput, providerType, backendId, row.displayName, row.maxTokensStr]);

  // Clean up on unmount (covers row removal too).
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <input
            type="text"
            value={row.modelId}
            onChange={e => onChange({ modelId: e.target.value })}
            placeholder="model id (e.g. claude-opus-4-7)"
            aria-label="model id"
            className={`${MODEL_FIELD_BASE} font-mono ${errs.modelId ? 'border-destructive' : 'border-border/70'}`}
          />
          {errs.modelId && (
            <p className="text-[10px] text-destructive mt-0.5">
              {errs.modelId === 'duplicate'
                ? 'duplicate model id in this profile'
                : 'model id is required'}
            </p>
          )}
        </div>
        <input
          type="text"
          value={row.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder="display name (optional)"
          aria-label="display name"
          className={`${MODEL_FIELD_BASE} border-border/70`}
        />
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.contextWindowStr}
            onChange={e => onChange({ contextWindowStr: e.target.value })}
            placeholder="context window (optional override)"
            aria-label="context window"
            className={`${MODEL_FIELD_BASE} font-mono ${errs.contextWindow ? 'border-destructive' : 'border-border/70'}`}
          />
          {errs.contextWindow && (
            <p className="text-[10px] text-destructive mt-0.5">
              contextWindow {errs.contextWindow}
            </p>
          )}
          <ResolvedContextWindowHint
            state={resolved}
            eligible={helperEligible}
            modelId={modelIdInput}
          />
        </div>
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.maxTokensStr}
            onChange={e => onChange({ maxTokensStr: e.target.value })}
            placeholder="max tokens (optional override)"
            aria-label="max tokens"
            className={`${MODEL_FIELD_BASE} font-mono ${errs.maxTokens ? 'border-destructive' : 'border-border/70'}`}
          />
          {errs.maxTokens && (
            <p className="text-[10px] text-destructive mt-0.5">maxTokens {errs.maxTokens}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <ModelTestStatus status={row.testStatus} />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={row.supportsImage}
              onChange={e =>
                onChange({ supportsImage: e.target.checked, inputModalitiesTouched: true })
              }
              aria-label={`model ${row.modelId.trim() || index + 1} supports image input`}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Vision
          </label>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onProbe}
            disabled={testDisabled}
            title={testDisabledReason}
            className="rounded-md border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {isRunning ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove model"
            className="rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper text shown directly beneath the contextWindow input, explaining
 * (when the user hasn't typed an override) which value + source the runtime
 * would resolve. Fallback rendering uses an amber AlertTriangle to make
 * "we don't actually know" visually distinct from "we have a sourced value".
 */
function ResolvedContextWindowHint({
  state,
  eligible,
  modelId,
}: {
  state: ResolvedPreviewState;
  eligible: boolean;
  /**
   * The current row's modelId (already trimmed). Only used by the
   * openai_compat_default warning, which calls it out by name so the user
   * sees *which* id failed to match the registry.
   */
  modelId: string;
}) {
  if (!eligible) return null;
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return <p className="text-[10px] text-muted-foreground mt-0.5">Resolving…</p>;
  }
  if (state.status === 'error') {
    return <p className="text-[10px] text-muted-foreground mt-0.5">—</p>;
  }
  // 'ok'
  if (state.value == null || state.source == null) return null;
  const formatted = state.value.toLocaleString();
  switch (state.source) {
    case 'profile_entry':
      // Theoretically unreachable because we strip our own override before
      // calling — leave a sane label in case a *different* row declares the
      // same modelId (rare; still informative).
      return (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Using {formatted} via this profile's override
        </p>
      );
    case 'pi_ai_registry':
      // F4: registry hits can come from a cross-provider sweep (e.g. running
      // `deepseek-v4` through an openai-compat proxy resolves to provider
      // `deepseek`). Annotate parenthetically when matchedProvider is set so
      // users see which provider's spec we adopted. Per UX, never expose
      // "pi-ai" in user-facing copy.
      return (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Using {formatted} from registry
          {state.matchedProvider ? ` (${state.matchedProvider})` : ''}
        </p>
      );
    case 'openai_compat_default':
      // F4: openai-compat proxies hand back a 128k literal when nothing in
      // the registry matched the model id. Surface this as a distinct amber
      // warning so users can tell "we guessed 128k for compat" apart from
      // "we got a real spec from the registry".
      return (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Using {formatted} default for openai-compat. No registry match for "{modelId}" — declare
            contextWindow above or use a known model id.
          </span>
        </p>
      );
    case 'fallback':
      return (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Falls back to {formatted} — no spec found. Declare contextWindow above or add to LLM
            profile.
          </span>
        </p>
      );
    default:
      return null;
  }
}

function ModelTestStatus({ status }: { status: ModelRowDraft['testStatus'] }) {
  if (!status) return <span className="text-[11px] text-muted-foreground" />;
  if (status.kind === 'running')
    return <span className="text-[11px] text-muted-foreground">Probing…</span>;
  if (status.kind === 'ok')
    return (
      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
        ✓ {status.latencyMs} ms
      </span>
    );
  return (
    <span className="text-[11px] text-destructive truncate max-w-[280px]" title={status.error}>
      ✗ {status.error}
    </span>
  );
}

interface FetchModelsPickerDialogProps {
  candidates: string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function FetchModelsPickerDialog({
  candidates,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onCancel,
  onConfirm,
}: FetchModelsPickerDialogProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the first control (the close button) when the dialog mounts, and
  // wire Escape to close it — the backdrop-click close (below) stays as is.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // Trap Tab/Shift+Tab focus within the dialog so keyboard users can't tab
  // out into the (visually obscured but still-present) editor behind it.
  const handleTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleTrapKeyDown}
        className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[480px] md:max-h-[70vh] bg-card rounded-lg shadow-xl z-[60] flex flex-col border border-border"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id={titleId} className="text-sm font-semibold">
            Import models from /models
          </h3>
          <button
            ref={closeButtonRef}
            onClick={onCancel}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
            aria-label="Close picker"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground">
          <span>
            {candidates.length} candidates — {selected.size} selected
          </span>
          <div className="flex gap-2">
            <button onClick={onSelectAll} className="hover:text-foreground">
              All
            </button>
            <button onClick={onSelectNone} className="hover:text-foreground">
              None
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {candidates.map(id => (
            <label
              key={id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => onToggle(id)}
                className="rounded-md border-border bg-secondary"
              />
              <span className="text-sm font-mono">{id}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 p-3 border-t border-border">
          <button
            onClick={onConfirm}
            disabled={selected.size === 0}
            className="flex-1 px-3 py-2 bg-muted/60 text-foreground hover:bg-muted rounded-md text-sm font-medium disabled:opacity-50"
          >
            Add {selected.size} model{selected.size === 1 ? '' : 's'}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

function ProviderTypeSelector({
  value,
  onChange,
  hideLabel = false,
}: {
  value: string;
  onChange: (v: string) => void;
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Roving focus: whenever the popup opens (or the active option changes via
  // arrow keys), move DOM focus onto that option so screen readers announce
  // it and further arrow/Enter/Escape keydowns land on the listbox.
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const selectedIndex = PROVIDER_TYPE_OPTIONS.findIndex(o => o.value === value);
  const selected = PROVIDER_TYPE_OPTIONS[selectedIndex];

  const openList = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectOption = (index: number) => {
    const opt = PROVIDER_TYPE_OPTIONS[index];
    if (!opt) return;
    onChange(opt.value);
    closeList();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeList();
    }
  };

  const handleOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, PROVIDER_TYPE_OPTIONS.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectOption(index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeList();
    }
  };

  return (
    <div ref={ref} className="relative">
      {!hideLabel && <FieldLabel>Provider Type</FieldLabel>}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleTriggerKeyDown}
        className={`${FIELD_CLASS} flex items-center justify-between text-left`}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Provider Type"
          className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden"
        >
          {PROVIDER_TYPE_OPTIONS.map((opt, index) => (
            <button
              key={opt.value}
              ref={el => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              tabIndex={-1}
              onClick={() => selectOption(index)}
              onKeyDown={e => handleOptionKeyDown(e, index)}
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
