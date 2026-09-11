import { useCallback, useEffect, useState } from 'react';
import { apiCallForBackend } from '../../services/api/unwrap';
import type { ManagedRuntimeStatus } from '../../services/api/managed-runtimes';
import { confirm } from '../../stores/confirmDialogStore';
import { RuntimeLoginHelp } from './RuntimeLoginHelp';

/** Uses the same active backend as the plugin list, including remote clients. */
export function BuiltinRuntimeDetails({
  pluginId,
  backendId,
  onManageProfiles,
}: {
  pluginId: string;
  backendId: string | null;
  onManageProfiles: () => void;
}) {
  const [status, setStatus] = useState<ManagedRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void apiCallForBackend<ManagedRuntimeStatus[]>(backendId, '/api/managed-runtimes', {
      signal: controller.signal,
    })
      .then(items => {
        if (!controller.signal.aborted)
          setStatus(items.find(item => item.pluginId === pluginId) ?? null);
      })
      .catch(cause => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not inspect runtime');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pluginId, refresh, backendId]);

  const install = useCallback(async () => {
    const artifact = status?.resolution.artifact;
    if (!artifact) return;
    if (
      !(await confirm({
        title: `Install ${artifact.runtime} CLI?`,
        message: `Download version ${artifact.version} on this plugin's backend. Source: ${artifact.url}`,
        confirmLabel: 'Install CLI',
      }))
    )
      return;
    setInstalling(true);
    setError(null);
    try {
      await apiCallForBackend(backendId, '/api/managed-runtimes/install', {
        method: 'POST',
        body: JSON.stringify({
          pluginId: artifact.pluginId,
          pluginVersion: artifact.pluginVersion,
          runtime: artifact.runtime,
          version: artifact.version,
          approved: true,
          pin: true,
        }),
      });
      setRefresh(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not install CLI');
    } finally {
      setInstalling(false);
    }
  }, [status, backendId]);

  const resolution = status?.resolution;
  return (
    <section
      className="space-y-2 rounded-xl border border-border/60 p-3"
      aria-label="Runtime status"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium">CLI on this backend</h3>
        <button
          type="button"
          disabled={loading || installing}
          onClick={() => setRefresh(value => value + 1)}
          className="text-xs text-primary disabled:opacity-50"
        >
          Refresh status
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Checking CLI…</p>
      ) : resolution ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>Status</dt>
            <dd>{resolution.status}</dd>
            <dt>Version</dt>
            <dd>{resolution.version ?? 'Not detected'}</dd>
            <dt>Source</dt>
            <dd>{resolution.source ?? 'Not selected'}</dd>
            <dt>Compatibility</dt>
            <dd>{resolution.compatibilityState}</dd>
            <dt>Authentication</dt>
            <dd>{resolution.authState}</dd>
          </dl>
          {resolution.executablePath && (
            <p className="break-all font-mono text-[11px]">{resolution.executablePath}</p>
          )}
          {resolution.message && (
            <p className="text-xs text-muted-foreground">{resolution.message}</p>
          )}
          {resolution.artifact && resolution.status !== 'resolved' && (
            <button
              type="button"
              disabled={installing}
              onClick={() => void install()}
              className="rounded-lg border border-border px-3 py-1 text-xs"
            >
              {installing ? 'Installing…' : 'Install CLI'}
            </button>
          )}
        </>
      ) : (
        !error && (
          <p className="text-xs text-muted-foreground">Enable this runtime to inspect its CLI.</p>
        )
      )}
      {!loading && (
        <RuntimeLoginHelp
          key={`${pluginId}:${resolution?.executablePath ?? ''}`}
          pluginId={pluginId}
          executablePath={resolution?.executablePath}
          authState={resolution?.authState}
        />
      )}
      <button type="button" onClick={onManageProfiles} className="text-xs text-primary">
        Configure agent profiles
      </button>
      <p className="text-[11px] text-muted-foreground">
        An agent profile can override this executable path. Use that profile's CLI when logging in.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
