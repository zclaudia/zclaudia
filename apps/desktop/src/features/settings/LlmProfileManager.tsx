import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { LlmProfileConfig, LlmProfileCompat, LlmProfileModelEntry } from '@zclaudia/shared';
import { LLM_PROVIDER_TYPES } from '@zclaudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import * as api from '../../services/api';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { isMobileBackendUsable } from '../../services/mobileConnectionState';

/** Lightweight PCP capability summary for UI display (mirrors server manifests) */
type CapLevel = 'strict' | 'best_effort' | 'none';
interface CapabilitySummary {
  stream: CapLevel;
  tools: CapLevel;
  interactions: CapLevel;
  backgroundTask: CapLevel;
}
const PROVIDER_CAPABILITIES: Record<string, CapabilitySummary> = {
  anthropic: { stream: 'strict', tools: 'none', interactions: 'none', backgroundTask: 'none' },
};

const RESERVED_HEADER_KEYS = new Set(['authorization', 'content-type', 'host']);

/**
 * Draft shape used by the Models repeater. We keep contextWindow / maxTokens as
 * raw strings so the editor can distinguish "empty (no override)" from
 * "0/non-numeric (validation error)" without lossy coercion on every keystroke.
 */
interface ModelRowDraft {
  modelId: string;
  displayName: string;
  contextWindowStr: string;
  maxTokensStr: string;
  /** Last probe result; cleared after a few seconds via a setTimeout. */
  testStatus?:
    | { kind: 'running' }
    | { kind: 'ok'; latencyMs: number }
    | { kind: 'fail'; error: string };
}

function entryToDraft(entry: LlmProfileModelEntry): ModelRowDraft {
  return {
    modelId: entry.modelId,
    displayName: entry.displayName ?? '',
    contextWindowStr: entry.contextWindow != null ? String(entry.contextWindow) : '',
    maxTokensStr: entry.maxTokens != null ? String(entry.maxTokens) : '',
  };
}

function parsePositiveInteger(raw: string): { value: number | undefined; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: undefined, error: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { value: undefined, error: 'must be a positive integer' };
  }
  return { value: n, error: null };
}

interface ModelRowError {
  modelId?: string;
  contextWindow?: string;
  maxTokens?: string;
}

function validateModelDraftRow(draft: ModelRowDraft, allDrafts: ModelRowDraft[], index: number): ModelRowError {
  const err: ModelRowError = {};
  const id = draft.modelId.trim();
  if (!id) {
    err.modelId = 'required';
  } else {
    const dup = allDrafts.findIndex((d, i) => i !== index && d.modelId.trim() === id);
    if (dup !== -1) err.modelId = 'duplicate';
  }
  const cw = parsePositiveInteger(draft.contextWindowStr);
  if (cw.error) err.contextWindow = cw.error;
  const mt = parsePositiveInteger(draft.maxTokensStr);
  if (mt.error) err.maxTokens = mt.error;
  return err;
}

/**
 * Serialize draft rows into the wire shape. Drops rows with empty modelId so a
 * half-typed "Add model" row never blocks save.
 */
function draftsToEntries(drafts: ModelRowDraft[]): LlmProfileModelEntry[] {
  const out: LlmProfileModelEntry[] = [];
  for (const d of drafts) {
    const id = d.modelId.trim();
    if (!id) continue;
    const entry: LlmProfileModelEntry = { modelId: id };
    const display = d.displayName.trim();
    if (display) entry.displayName = display;
    const cw = parsePositiveInteger(d.contextWindowStr);
    if (cw.value !== undefined) entry.contextWindow = cw.value;
    const mt = parsePositiveInteger(d.maxTokensStr);
    if (mt.value !== undefined) entry.maxTokens = mt.value;
    out.push(entry);
  }
  return out;
}

function CapabilityTags({ providerType }: { providerType: string }) {
  const caps = PROVIDER_CAPABILITIES[providerType];
  if (!caps) return null;

  const tags: Array<{ label: string; level: CapLevel }> = [
    { label: 'Stream', level: caps.stream },
    { label: 'Tools', level: caps.tools },
    { label: 'Interactions', level: caps.interactions },
    ...(caps.backgroundTask !== 'none' ? [{ label: 'Background', level: caps.backgroundTask }] : []),
  ];

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {tags.map(({ label, level }) => (
        <span
          key={label}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] rounded-full border ${
            level === 'strict'
              ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
              : 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5'
          }`}
        >
          <span className={`inline-block w-1 h-1 rounded-full ${level === 'strict' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

interface LlmProfileManagerProps {
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean;  // When true, renders without modal wrapper
  readOnly?: boolean;
}

export function LlmProfileManager({ isOpen, onClose, inline = false, readOnly = false }: LlmProfileManagerProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });
  const storeProfiles = useLlmProfileMetaStore((s) => s.getProviders(activeServerId));

  const [profiles, setProfiles] = useState<LlmProfileConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<LlmProfileConfig | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formProviderType, setFormProviderType] = useState<string>('anthropic');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formCompat, setFormCompat] = useState('');
  const [formCompatError, setFormCompatError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formRequestHeaders, setFormRequestHeaders] = useState('');
  const [formRequestHeadersError, setFormRequestHeadersError] = useState<string | null>(null);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formModels, setFormModels] = useState<ModelRowDraft[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchPicker, setFetchPicker] = useState<{ candidates: string[]; selected: Set<string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);
  const testStatusTimersRef = useRef<Map<number, number>>(new Map());

  useAndroidBack(onClose, isOpen && !inline, 20);

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
    setPendingDeleteProfileId(null);
  };

  const loadProfiles = async () => {
    if (!isConnected) return;
    const current = useLlmProfileMetaStore.getState().getProviders(activeServerId);
    if (current.length > 0) {
      setProfiles(current);
    }
    setLoading(true);
    try {
      const data = await api.listLlmProfiles();
      setProfiles(data);
      // Sync to global store so Sidebar's profile dropdown stays current
      useLlmProfileMetaStore.getState().setProviders(data, activeServerId);
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (storeProfiles.length > 0) {
      setProfiles(storeProfiles);
    }
  }, [storeProfiles]);

  useEffect(() => {
    // For inline mode, always load when connected
    // For modal mode, only load when open and connected
    if (inline) {
      if (isConnected) {
        loadProfiles();
      }
    } else {
      if (isOpen && isConnected) {
        loadProfiles();
      }
    }
  }, [isOpen, isConnected, inline]);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current !== null) {
        window.clearTimeout(deleteConfirmTimeoutRef.current);
      }
      for (const t of testStatusTimersRef.current.values()) window.clearTimeout(t);
      testStatusTimersRef.current.clear();
    };
  }, []);

  const clearAllTestTimers = () => {
    for (const t of testStatusTimersRef.current.values()) window.clearTimeout(t);
    testStatusTimersRef.current.clear();
  };

  const resetForm = () => {
    clearDeleteConfirmation();
    clearAllTestTimers();
    setFormName('');
    setFormProviderType('anthropic');
    setFormBaseUrl('');
    setFormApiKey('');
    setFormCompat('');
    setFormCompatError(null);
    setShowAdvanced(false);
    setFormRequestHeaders('');
    setFormRequestHeadersError(null);
    setFormIsDefault(false);
    setFormModels([]);
    setFetchModelsError(null);
    setFetchPicker(null);
    setEditingProfile(null);
    setShowAddForm(false);
  };

  const openEditForm = (profile: LlmProfileConfig) => {
    clearDeleteConfirmation();
    clearAllTestTimers();
    setFormName(profile.name);
    setFormProviderType(profile.providerType);
    setFormBaseUrl(profile.baseUrl || '');
    setFormApiKey(profile.apiKey || '');
    const hasCompat = profile.compat && Object.keys(profile.compat).length > 0;
    setFormCompat(hasCompat ? JSON.stringify(profile.compat, null, 2) : '');
    setFormCompatError(null);
    setShowAdvanced(Boolean(hasCompat));
    setFormRequestHeaders(profile.requestHeaders ? JSON.stringify(profile.requestHeaders, null, 2) : '');
    setFormRequestHeadersError(null);
    setFormIsDefault(profile.isDefault || false);
    setFormModels(profile.models ? profile.models.map(entryToDraft) : []);
    setFetchModelsError(null);
    setFetchPicker(null);
    setEditingProfile(profile);
    setShowAddForm(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) return;

    setSaving(true);
    try {
      let requestHeadersObj: Record<string, string> | undefined;
      if (formRequestHeaders.trim()) {
        try {
          const parsed = JSON.parse(formRequestHeaders);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setFormRequestHeadersError('Request headers must be a JSON object');
            setSaving(false);
            return;
          }
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== 'string') {
              setFormRequestHeadersError(`Header "${key}" value must be a string`);
              setSaving(false);
              return;
            }
            if (RESERVED_HEADER_KEYS.has(key.toLowerCase())) {
              setFormRequestHeadersError(`Header "${key}" is reserved (managed by API key); remove it from Request Headers`);
              setSaving(false);
              return;
            }
          }
          requestHeadersObj = Object.keys(parsed).length > 0 ? parsed as Record<string, string> : undefined;
          setFormRequestHeadersError(null);
        } catch (err) {
          setFormRequestHeadersError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
          setSaving(false);
          return;
        }
      } else {
        setFormRequestHeadersError(null);
      }

      let compatObj: LlmProfileCompat | undefined;
      const compatTrimmed = formCompat.trim();
      if (compatTrimmed && compatTrimmed !== '{}') {
        try {
          const parsed = JSON.parse(compatTrimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (Object.keys(parsed).length > 0) {
              compatObj = parsed as LlmProfileCompat;
            }
          } else {
            setFormCompatError('Compat must be a JSON object');
            setSaving(false);
            return;
          }
        } catch {
          setFormCompatError('Invalid JSON in compat field');
          setSaving(false);
          return;
        }
      }
      setFormCompatError(null);

      // Models — block save if any row has an inline error (duplicate / empty
      // id / non-positive-integer override). Empty rows are silently dropped.
      for (let i = 0; i < formModels.length; i += 1) {
        const row = formModels[i];
        if (!row.modelId.trim() && !row.displayName.trim() && !row.contextWindowStr.trim() && !row.maxTokensStr.trim()) {
          continue; // fully empty — drop on serialize
        }
        const errs = validateModelDraftRow(row, formModels, i);
        if (errs.modelId || errs.contextWindow || errs.maxTokens) {
          alert(`Fix the model row ${i + 1} before saving (${errs.modelId ?? errs.contextWindow ?? errs.maxTokens}).`);
          setSaving(false);
          return;
        }
      }
      const modelsArr = draftsToEntries(formModels);

      const data = {
        name: formName.trim(),
        providerType: formProviderType,
        baseUrl: formBaseUrl.trim() || undefined,
        apiKey: formApiKey.trim() || undefined,
        compat: compatObj,
        requestHeaders: requestHeadersObj,
        models: modelsArr,
        isDefault: formIsDefault
      };

      if (editingProfile) {
        await api.updateLlmProfile(editingProfile.id, data);
      } else {
        await api.createLlmProfile(data);
      }

      await loadProfiles();
      resetForm();
    } catch (error) {
      console.error('Failed to save provider:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to ${editingProfile ? 'update' : 'create'} provider: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const addEmptyModelRow = () => {
    setFormModels((rows) => [
      ...rows,
      { modelId: '', displayName: '', contextWindowStr: '', maxTokensStr: '' },
    ]);
  };

  const updateModelRow = (index: number, patch: Partial<ModelRowDraft>) => {
    setFormModels((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeModelRow = (index: number) => {
    const t = testStatusTimersRef.current.get(index);
    if (t != null) {
      window.clearTimeout(t);
      testStatusTimersRef.current.delete(index);
    }
    setFormModels((rows) => rows.filter((_, i) => i !== index));
  };

  const scheduleClearTestStatus = (index: number) => {
    const existing = testStatusTimersRef.current.get(index);
    if (existing != null) window.clearTimeout(existing);
    const id = window.setTimeout(() => {
      testStatusTimersRef.current.delete(index);
      setFormModels((rows) => rows.map((r, i) => (i === index ? { ...r, testStatus: undefined } : r)));
    }, 6000);
    testStatusTimersRef.current.set(index, id);
  };

  const handleFetchModels = async () => {
    if (!editingProfile?.id) return;
    setFetchModelsError(null);
    setFetchingModels(true);
    try {
      const result = await api.fetchModelsForLlmProfile(editingProfile.id);
      if (!result.ok) {
        setFetchModelsError(result.error);
        return;
      }
      // Filter out ids already in the form so the picker is just net-new.
      const existing = new Set(formModels.map((r) => r.modelId.trim()).filter(Boolean));
      const candidates = result.models.filter((id) => !existing.has(id));
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
    const existing = new Set(formModels.map((r) => r.modelId.trim()).filter(Boolean));
    const toAdd = Array.from(fetchPicker.selected).filter((id) => !existing.has(id));
    if (toAdd.length > 0) {
      setFormModels((rows) => [
        ...rows,
        ...toAdd.map<ModelRowDraft>((modelId) => ({
          modelId,
          displayName: '',
          contextWindowStr: '',
          maxTokensStr: '',
        })),
      ]);
    }
    setFetchPicker(null);
  };

  const handleProbeModel = async (index: number) => {
    if (!editingProfile?.id) return;
    const row = formModels[index];
    const modelId = row?.modelId.trim();
    if (!modelId) return;
    updateModelRow(index, { testStatus: { kind: 'running' } });
    try {
      const result = await api.probeLlmProfileModel(editingProfile.id, modelId);
      if (result.ok) {
        updateModelRow(index, { testStatus: { kind: 'ok', latencyMs: result.latencyMs } });
      } else {
        updateModelRow(index, { testStatus: { kind: 'fail', error: result.error } });
      }
    } catch (err) {
      updateModelRow(index, { testStatus: { kind: 'fail', error: err instanceof Error ? err.message : String(err) } });
    } finally {
      scheduleClearTestStatus(index);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingProfileId) return;

    if (pendingDeleteProfileId !== id) {
      clearDeleteConfirmation();
      setPendingDeleteProfileId(id);
      deleteConfirmTimeoutRef.current = window.setTimeout(() => {
        setPendingDeleteProfileId((current) => (current === id ? null : current));
        deleteConfirmTimeoutRef.current = null;
      }, 3000);
      return;
    }

    clearDeleteConfirmation();
    setDeletingProfileId(id);
    try {
      await api.deleteLlmProfile(id);
      await loadProfiles();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to delete provider: ${message}`);
    } finally {
      setDeletingProfileId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    clearDeleteConfirmation();
    try {
      await api.setDefaultLlmProfile(id);
      await loadProfiles();
    } catch (error) {
      console.error('Failed to set default provider:', error);
    }
  };

  if (!isOpen) return null;

  // Content rendering - shared between modal and inline modes
  const content = !isConnected ? (
    <p className="text-muted-foreground text-center py-8">Connect to a server first</p>
  ) : loading ? (
    <p className="text-muted-foreground text-center py-8">Loading...</p>
  ) : showAddForm && !readOnly ? (
    /* Add/Edit Form */
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Name *</label>
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g., Local ZClaudia Agent"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <ProviderTypeSelector value={formProviderType} onChange={setFormProviderType} />

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Base URL (optional)</label>
        <input
          type="text"
          value={formBaseUrl}
          onChange={(e) => setFormBaseUrl(e.target.value)}
          placeholder="http://api.example.com/v1"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Override default endpoint (required for openai-custom)
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">API Key (optional)</label>
        <input
          type="password"
          value={formApiKey}
          onChange={(e) => setFormApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Stored on the server. Falls back to environment if omitted.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Request Headers (JSON)</label>
        <textarea
          value={formRequestHeaders}
          onChange={(e) => {
            setFormRequestHeaders(e.target.value);
            if (formRequestHeadersError) setFormRequestHeadersError(null);
          }}
          placeholder={`{
"X-Org-Id": "abc",
"User-Agent": "ZClaudia/1.0"
}`}
          rows={5}
          className={`w-full px-3 py-2 bg-secondary border ${formRequestHeadersError ? 'border-destructive' : 'border-border'} rounded-lg text-sm focus:outline-none focus:border-primary font-mono`}
        />
        {formRequestHeadersError ? (
          <p className="text-xs text-destructive mt-1">{formRequestHeadersError}</p>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">
            Extra HTTP headers added to LLM API requests. Authorization / Content-Type / Host are reserved.
          </p>
        )}
      </div>

      <ModelsSection
        models={formModels}
        profileSaved={Boolean(editingProfile?.id)}
        fetching={fetchingModels}
        fetchError={fetchModelsError}
        onAdd={addEmptyModelRow}
        onUpdate={updateModelRow}
        onRemove={removeModelRow}
        onFetch={handleFetchModels}
        onProbe={handleProbeModel}
      />

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${showAdvanced ? 'rotate-0' : '-rotate-90'}`}
          />
          Advanced (compat)
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <textarea
              value={formCompat}
              onChange={(e) => {
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
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Per-provider capability overrides (JSON object). Leave empty for defaults.
            </p>
            {formCompatError && (
              <p className="text-xs text-destructive mt-1">{formCompatError}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isDefault"
          checked={formIsDefault}
          onChange={(e) => setFormIsDefault(e.target.checked)}
          className="rounded-md border-border bg-secondary"
        />
        <label htmlFor="isDefault" className="text-sm">
          Set as default runtime
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!formName.trim() || saving || !!formRequestHeadersError}
          className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : editingProfile ? 'Update' : 'Create'}
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
    /* Profile List */
    <div className="space-y-2">
      {(profiles ?? []).length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No providers configured.<br />
          Add a provider to get started.
        </p>
      ) : (
        (profiles ?? []).map((profile) => (
          <div
            key={profile.id}
            className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg hover:bg-secondary"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{profile.name}</span>
                {profile.isDefault && (
                  <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded-md">
                    Default
                  </span>
                )}
                <span className="px-1.5 py-0.5 bg-secondary text-muted-foreground text-xs rounded-md">
                  {profile.providerType || 'anthropic'}
                </span>
              </div>
              {profile.baseUrl && (
                <div className="text-xs text-muted-foreground truncate font-mono mt-1">
                  {profile.baseUrl}
                </div>
              )}
              <CapabilityTags providerType={profile.providerType || 'anthropic'} />
            </div>
            {!readOnly && (
            <div className="flex items-center gap-1 ml-2">
              {!profile.isDefault && (
                <button
                  onClick={() => handleSetDefault(profile.id)}
                  className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Set as default"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => openEditForm(profile)}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                title="Edit"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(profile.id)}
                disabled={deletingProfileId !== null}
                className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
                  pendingDeleteProfileId === profile.id
                    ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                    : 'hover:bg-secondary text-destructive hover:text-destructive'
                }`}
                title={pendingDeleteProfileId === profile.id ? 'Click again to confirm delete' : 'Delete'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
            )}
          </div>
        ))
      )}

      {!readOnly && (
      <button
        onClick={() => {
          clearDeleteConfirmation();
          setShowAddForm(true);
        }}
        className="w-full py-2 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-muted-foreground hover:text-foreground flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Provider
      </button>
      )}
    </div>
  );

  const fetchPickerOverlay = fetchPicker ? (
    <FetchModelsPickerDialog
      candidates={fetchPicker.candidates}
      selected={fetchPicker.selected}
      onToggle={(id) => {
        setFetchPicker((cur) => {
          if (!cur) return cur;
          const next = new Set(cur.selected);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { ...cur, selected: next };
        });
      }}
      onSelectAll={() => setFetchPicker((cur) => (cur ? { ...cur, selected: new Set(cur.candidates) } : cur))}
      onSelectNone={() => setFetchPicker((cur) => (cur ? { ...cur, selected: new Set() } : cur))}
      onCancel={() => setFetchPicker(null)}
      onConfirm={confirmFetchPicker}
    />
  ) : null;

  // Inline mode - just return the content
  if (inline) {
    return (
      <>
        {content}
        {fetchPickerOverlay}
      </>
    );
  }

  // Modal mode - wrap with backdrop and modal container
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[600px] md:max-h-[80vh] bg-card rounded-lg shadow-xl z-50 flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">Provider Management</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {content}
        </div>
      </div>
      {fetchPickerOverlay}
    </>
  );
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-custom': 'OpenAI-compatible (custom)',
};

const PROVIDER_TYPE_OPTIONS: { value: string; label: string }[] = LLM_PROVIDER_TYPES.map((value) => ({
  value,
  label: PROVIDER_TYPE_LABELS[value] ?? value,
}));

interface ModelsSectionProps {
  models: ModelRowDraft[];
  profileSaved: boolean;
  fetching: boolean;
  fetchError: string | null;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<ModelRowDraft>) => void;
  onRemove: (index: number) => void;
  onFetch: () => void;
  onProbe: (index: number) => void;
}

function ModelsSection({
  models,
  profileSaved,
  fetching,
  fetchError,
  onAdd,
  onUpdate,
  onRemove,
  onFetch,
  onProbe,
}: ModelsSectionProps) {
  const fetchDisabledReason = !profileSaved ? 'Save the profile first to fetch models' : undefined;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-muted-foreground">Models</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onFetch}
            disabled={!profileSaved || fetching}
            title={fetchDisabledReason}
            className="px-2.5 py-1 text-xs rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-50"
          >
            {fetching ? 'Fetching…' : 'Fetch from /models'}
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="px-2.5 py-1 text-xs rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground"
          >
            + Add model
          </button>
        </div>
      </div>
      {fetchError && (
        <p className="text-xs text-destructive mb-2">{fetchError}</p>
      )}
      {models.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No models declared. Agent profiles bound to this LLM profile will fall back to pi-ai registry defaults for whatever model id they request.
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((row, idx) => (
            <ModelRow
              key={idx}
              index={idx}
              row={row}
              allRows={models}
              profileSaved={profileSaved}
              onChange={(patch) => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
              onProbe={() => onProbe(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ModelRowProps {
  index: number;
  row: ModelRowDraft;
  allRows: ModelRowDraft[];
  profileSaved: boolean;
  onChange: (patch: Partial<ModelRowDraft>) => void;
  onRemove: () => void;
  onProbe: () => void;
}

function ModelRow({ index, row, allRows, profileSaved, onChange, onRemove, onProbe }: ModelRowProps) {
  const errs = validateModelDraftRow(row, allRows, index);
  const isRunning = row.testStatus?.kind === 'running';
  const testDisabled = !profileSaved || isRunning || !row.modelId.trim() || !!errs.modelId;
  const testDisabledReason = !profileSaved
    ? 'Save the profile first to test models'
    : !row.modelId.trim()
      ? 'Enter a model id first'
      : errs.modelId
        ? `Fix model id (${errs.modelId}) first`
        : undefined;

  return (
    <div className="p-3 bg-secondary/40 border border-border rounded-lg space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <input
            type="text"
            value={row.modelId}
            onChange={(e) => onChange({ modelId: e.target.value })}
            placeholder="model id (e.g. claude-opus-4-7)"
            aria-label="model id"
            className={`w-full px-2 py-1.5 bg-background border ${errs.modelId ? 'border-destructive' : 'border-border'} rounded-md text-sm focus:outline-none focus:border-primary font-mono`}
          />
          {errs.modelId && (
            <p className="text-[10px] text-destructive mt-0.5">
              {errs.modelId === 'duplicate' ? 'duplicate model id in this profile' : 'model id is required'}
            </p>
          )}
        </div>
        <input
          type="text"
          value={row.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder="display name (optional)"
          aria-label="display name"
          className="w-full px-2 py-1.5 bg-background border border-border rounded-md text-sm focus:outline-none focus:border-primary"
        />
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.contextWindowStr}
            onChange={(e) => onChange({ contextWindowStr: e.target.value })}
            placeholder="context window (optional override)"
            aria-label="context window"
            className={`w-full px-2 py-1.5 bg-background border ${errs.contextWindow ? 'border-destructive' : 'border-border'} rounded-md text-sm focus:outline-none focus:border-primary font-mono`}
          />
          {errs.contextWindow && (
            <p className="text-[10px] text-destructive mt-0.5">contextWindow {errs.contextWindow}</p>
          )}
        </div>
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.maxTokensStr}
            onChange={(e) => onChange({ maxTokensStr: e.target.value })}
            placeholder="max tokens (optional override)"
            aria-label="max tokens"
            className={`w-full px-2 py-1.5 bg-background border ${errs.maxTokens ? 'border-destructive' : 'border-border'} rounded-md text-sm focus:outline-none focus:border-primary font-mono`}
          />
          {errs.maxTokens && (
            <p className="text-[10px] text-destructive mt-0.5">maxTokens {errs.maxTokens}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ModelTestStatus status={row.testStatus} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onProbe}
            disabled={testDisabled}
            title={testDisabledReason}
            className="px-2.5 py-1 text-xs rounded-md border border-border bg-background hover:bg-secondary text-foreground disabled:opacity-50"
          >
            {isRunning ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove model"
            className="px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-destructive/10 text-destructive"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelTestStatus({ status }: { status: ModelRowDraft['testStatus'] }) {
  if (!status) return <span className="text-[11px] text-muted-foreground" />;
  if (status.kind === 'running') return <span className="text-[11px] text-muted-foreground">Probing…</span>;
  if (status.kind === 'ok') return <span className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ {status.latencyMs} ms</span>;
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
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onCancel} />
      <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[480px] md:max-h-[70vh] bg-card rounded-lg shadow-xl z-[60] flex flex-col border border-border">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Import models from /models</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
            aria-label="Close picker"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground">
          <span>{candidates.length} candidates — {selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onSelectAll} className="hover:text-foreground">All</button>
            <button onClick={onSelectNone} className="hover:text-foreground">None</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {candidates.map((id) => (
            <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary cursor-pointer">
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
            className="flex-1 px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium disabled:opacity-50"
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

function ProviderTypeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

  const selected = PROVIDER_TYPE_OPTIONS.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">Provider Type</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden">
          {PROVIDER_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
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
