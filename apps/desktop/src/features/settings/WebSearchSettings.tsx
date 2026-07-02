import { useEffect, useState } from 'react';
import type { WebSearchConfig, WebSearchConfigSource } from '@zclaudia/shared';
import { getWebSearchConfig, updateWebSearchConfig } from '../../services/api';

function sourceLabel(source: WebSearchConfigSource): string {
  switch (source) {
    case 'stored':
      return 'Stored';
    case 'env':
      return 'Environment';
    default:
      return 'Not configured';
  }
}

function SourceBadge({ source }: { source: WebSearchConfigSource }) {
  const configured = source !== null;
  return (
    <span
      className={`text-xs px-2 py-1 rounded-md ${
        configured ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
      }`}
    >
      {sourceLabel(source)}
    </span>
  );
}

interface WebSearchSettingsProps {
  readOnly?: boolean;
}

export function WebSearchSettings({ readOnly = false }: WebSearchSettingsProps) {
  const [config, setConfig] = useState<WebSearchConfig | null>(null);
  const [braveApiKey, setBraveApiKey] = useState('');
  const [searxngBaseUrl, setSearxngBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWebSearchConfig()
      .then(data => {
        if (cancelled) return;
        setConfig(data);
        setBraveApiKey('');
        setSearxngBaseUrl(data.searxngBaseUrl ?? '');
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load Web Search config');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaved(false);
      setError(null);
      const updated = await updateWebSearchConfig({
        ...(braveApiKey.trim() ? { braveApiKey: braveApiKey.trim() } : {}),
        searxngBaseUrl: searxngBaseUrl.trim() || null,
      });
      setConfig(updated);
      setBraveApiKey('');
      setSearxngBaseUrl(updated.searxngBaseUrl ?? '');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Web Search config');
    } finally {
      setSaving(false);
    }
  };

  const handleClearBraveKey = async () => {
    try {
      setSaving(true);
      setSaved(false);
      setError(null);
      const updated = await updateWebSearchConfig({ braveApiKey: null });
      setConfig(updated);
      setBraveApiKey('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear Brave key');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">Web Search</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the providers used by the built-in WebSearch tool.
        </p>
      </div>

      {readOnly && (
        <div className="bg-muted/60 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground">
          Viewing a remote server. Web Search settings are read-only here.
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {saved && (
        <div className="bg-success/10 border border-success/25 rounded-lg p-3">
          <p className="text-sm text-success">Web Search configuration saved.</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground">
                Brave Search API Key
              </label>
              <p className="text-xs text-muted-foreground mt-1">Used first when configured.</p>
            </div>
            <SourceBadge source={config?.braveApiKeySource ?? null} />
          </div>
          <input
            type="password"
            value={braveApiKey}
            onChange={event => setBraveApiKey(event.target.value)}
            placeholder={config?.braveApiKey ? 'Configured; enter a new key to replace' : 'brv-...'}
            disabled={readOnly || saving}
            autoComplete="off"
            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Environment fallback: ZCLAUDIA_BRAVE_SEARCH_API_KEY or BRAVE_SEARCH_API_KEY.
            </p>
            <button
              type="button"
              onClick={handleClearBraveKey}
              disabled={readOnly || saving || config?.braveApiKeySource !== 'stored'}
              className="px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear Stored Key
            </button>
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground">SearXNG Base URL</label>
              <p className="text-xs text-muted-foreground mt-1">
                Used after Brave and before DuckDuckGo fallback.
              </p>
            </div>
            <SourceBadge source={config?.searxngBaseUrlSource ?? null} />
          </div>
          <input
            type="url"
            value={searxngBaseUrl}
            onChange={event => setSearxngBaseUrl(event.target.value)}
            placeholder="https://search.example.com"
            disabled={readOnly || saving}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-60"
          />
          <p className="text-xs text-muted-foreground">
            Environment fallback: ZCLAUDIA_SEARXNG_BASE_URL or SEARXNG_BASE_URL.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-t border-border pt-4">
        <div className="text-xs text-muted-foreground">
          Provider order: Brave, SearXNG, DuckDuckGo HTML fallback.
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={readOnly || saving}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
