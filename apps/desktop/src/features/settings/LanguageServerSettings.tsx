import { useCallback, useEffect, useState } from 'react';
import { Braces } from 'lucide-react';
import type {
  LanguageServerState,
  LanguageServersOverview,
} from '@zclaudia/shared/core/language-servers';
import { getLanguageServers, setLanguageServersEnabled } from '../../services/api';
import { CopyableCommand } from '../../components/ui/CopyableCommand';
import { Toggle } from '../../components/ui/Toggle';
import { TONE_DOT, type Tone } from '../../components/ui/tone';
import { useSettingsTargetBackend } from '../../hooks/useSettingsTargetBackend';
import { SettingsGroup, SettingsRow } from './ui/SettingsGroup';

const POLL_MS = 5_000;

/** Last path segment of a workspace root, POSIX or Windows. */
function rootName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

const STATE_LABEL: Record<LanguageServerState, string> = {
  idle: 'Not running',
  starting: 'Starting…',
  ready: 'Ready',
  stopped: 'Crashed, restarting',
  failed: 'Failed',
  missing: 'Not installed',
};

const STATE_TONE: Record<LanguageServerState, Tone> = {
  idle: 'neutral',
  starting: 'warning',
  stopped: 'warning',
  ready: 'success',
  failed: 'destructive',
  missing: 'neutral',
};

/**
 * Master switch for the language servers the ZClaudia agent uses (type
 * errors after edits, LSPTool), plus every server instance on the target
 * backend. Turning it off stops them all.
 */
export function LanguageServerSettings() {
  const { targetBackendId } = useSettingsTargetBackend();
  const [overview, setOverview] = useState<LanguageServersOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      try {
        setOverview(await getLanguageServers(targetBackendId, { refresh }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load language servers');
      }
    },
    [targetBackendId]
  );

  useEffect(() => {
    if (!targetBackendId) return;
    // Opening Settings re-probes, so a server installed a moment ago shows up.
    void load(true);
    const interval = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(interval);
  }, [load, targetBackendId]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      setOverview(await setLanguageServersEnabled(enabled, targetBackendId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update language servers');
    } finally {
      setSaving(false);
    }
  };

  const servers = overview?.servers ?? [];
  return (
    <SettingsGroup>
      <SettingsRow
        icon={<Braces className="h-4 w-4" strokeWidth={1.75} />}
        title="Type checking and code navigation"
        description="Report type errors after each edit and answer LSPTool queries for ZClaudia agents. TypeScript is built in; Python, Go and Rust are used when installed."
        control={
          <Toggle
            checked={overview?.enabled ?? false}
            onChange={enabled => void toggle(enabled)}
            disabled={!overview || saving}
            aria-label="Language servers"
          />
        }
      />
      {error && (
        <div className="px-4 py-3 text-xs text-destructive" role="alert">
          {error}
        </div>
      )}
      {overview?.enabled && (
        <SettingsRow title="Servers" description="Start on first use, stop after 10 minutes idle.">
          {servers.length === 0 ? (
            <p className="text-xs text-muted-foreground">None started yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="language-server-list">
              {servers.map(server => (
                <li key={`${server.id}:${server.root}`} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${TONE_DOT[STATE_TONE[server.state]]}`}
                    />
                    <span className="text-foreground">{server.name}</span>
                    <span className="truncate text-muted-foreground" title={server.root}>
                      {rootName(server.root)}
                    </span>
                    <span className="ml-auto flex-shrink-0 text-muted-foreground">
                      {STATE_LABEL[server.state]}
                      {server.state === 'ready' && ` · ${server.openDocuments} open`}
                    </span>
                  </div>
                  {server.lastError && server.state !== 'ready' && (
                    <p className="mt-0.5 break-words pl-4 text-2xs text-destructive">
                      {server.lastError}
                    </p>
                  )}
                  {server.installHint && (
                    <div className="mt-1 pl-4">
                      <CopyableCommand command={server.installHint} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
