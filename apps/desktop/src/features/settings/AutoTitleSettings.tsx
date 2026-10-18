import { useEffect, useState } from 'react';
import { Sparkles, Cpu } from 'lucide-react';
import type { AutoTitleConfig } from '@zclaudia/shared/core/server';
import { getAutoTitleConfig, updateAutoTitleConfig } from '../../services/api';
import { SettingsGroup, SettingsRow } from './ui/SettingsGroup';
import { Toggle } from '../../components/ui/Toggle';

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Session auto-title settings: master switch + optional dedicated model. */
export function AutoTitleSettings() {
  const [config, setConfig] = useState<AutoTitleConfig | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAutoTitleConfig()
      .then(data => {
        if (cancelled) return;
        setConfig(data);
        setModelDraft(data.model ?? '');
      })
      .catch(err => {
        if (!cancelled) setError(errorMessage(err, 'Failed to load session title settings'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (enabled: boolean) => {
    if (!config) return;
    const previous = config;
    setConfig({ ...config, enabled });
    try {
      setConfig(await updateAutoTitleConfig({ enabled }));
      setError('');
    } catch (err) {
      setConfig(previous);
      setError(errorMessage(err, 'Failed to update session title settings'));
    }
  };

  const commitModel = async () => {
    if (!config) return;
    const model = modelDraft.trim();
    if (model === (config.model ?? '')) return;
    try {
      setConfig(await updateAutoTitleConfig({ model: model || null }));
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to update session title settings'));
    }
  };

  return (
    <SettingsGroup label="Session titles">
      <SettingsRow
        icon={<Sparkles className="w-4 h-4" strokeWidth={1.75} />}
        title="Auto-generate titles"
        description="Generate a short AI title for unnamed sessions after each reply"
        control={
          <Toggle
            checked={config?.enabled ?? false}
            onChange={enabled => void handleToggle(enabled)}
            disabled={!config}
            aria-label="Auto-generate session titles"
          />
        }
      />
      <SettingsRow
        icon={<Cpu className="w-4 h-4" strokeWidth={1.75} />}
        title="Title model"
        description="Model id used to generate titles. Leave empty to use each session's own model."
        control={
          <input
            type="text"
            value={modelDraft}
            placeholder="Session's model"
            aria-label="Title model"
            onChange={e => setModelDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void commitModel();
              if (e.key === 'Escape') {
                setModelDraft(config?.model ?? '');
                e.currentTarget.blur();
              }
            }}
            onBlur={() => void commitModel()}
            disabled={!config}
            className="w-56 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
          />
        }
      />
      {error && <p className="px-4 pb-3 text-xs text-destructive">{error}</p>}
    </SettingsGroup>
  );
}
