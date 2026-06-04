import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { LlmProfileConfig, LlmProfileCompat } from '@zclaudia/shared';
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
  const [saving, setSaving] = useState(false);
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);

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
    };
  }, []);

  const resetForm = () => {
    clearDeleteConfirmation();
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
    setEditingProfile(null);
    setShowAddForm(false);
  };

  const openEditForm = (profile: LlmProfileConfig) => {
    clearDeleteConfirmation();
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

      const data = {
        name: formName.trim(),
        providerType: formProviderType,
        baseUrl: formBaseUrl.trim() || undefined,
        apiKey: formApiKey.trim() || undefined,
        compat: compatObj,
        requestHeaders: requestHeadersObj,
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

  // Inline mode - just return the content
  if (inline) {
    return content;
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
