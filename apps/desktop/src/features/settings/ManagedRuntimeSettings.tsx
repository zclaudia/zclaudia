import { useCallback, useEffect, useState } from 'react';
import type {
  ManagedRuntimeArtifactSummary,
  ManagedRuntimePolicy,
  ManagedRuntimeResolution,
} from '@zclaudia/shared/plugins/managed-runtimes';
import {
  garbageCollectManagedRuntimes,
  getManagedRuntimeSettings,
  installManagedRuntime,
  listManagedRuntimes,
  pinManagedRuntime,
  rollbackManagedRuntime,
  setManagedRuntimePolicy,
  testManagedRuntime,
  type ManagedRuntimeStatus,
} from '../../services/api';
import { useSettingsTargetBackend } from '../../hooks/useSettingsTargetBackend';
import { TargetBackendBanner, NoTargetBackendNotice } from './ui/TargetBackendNotice';
import { Select } from '../../components/ui/Select';

function formatBytes(value: number | undefined): string {
  if (value === undefined) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function compatibilityLabel(resolution: ManagedRuntimeResolution): string {
  const labels: Record<string, string> = {
    compatible: 'Compatible',
    missing: 'Not found',
    'too-old': 'Too old',
    'known-incompatible': 'Known incompatible',
    'untested-newer': 'Newer than tested',
    unparseable: 'Version unknown',
    'probe-failed': 'Probe failed',
    'not-declared': 'Not declared',
  };
  return labels[resolution.compatibilityState] ?? resolution.compatibilityState;
}

function statusTone(resolution: ManagedRuntimeResolution): string {
  if (resolution.status === 'resolved' && resolution.compatibilityState === 'compatible') {
    return 'text-success';
  }
  if (
    resolution.status === 'needs-approval' ||
    resolution.compatibilityState === 'untested-newer'
  ) {
    return 'text-warning';
  }
  return 'text-destructive';
}

export function ManagedRuntimeSettings({
  hideTargetBanner = false,
}: {
  /** Set when a parent page already renders its own target-backend banner. */
  hideTargetBanner?: boolean;
}) {
  // Downloads/installs land on this backend: the device's local backend when
  // one exists, otherwise the connected active backend (mobile). The banner
  // below names a non-local target so installs are never silently remote.
  const targetBackend = useSettingsTargetBackend();
  const backendId = targetBackend.targetBackendId;
  const [statuses, setStatuses] = useState<ManagedRuntimeStatus[]>([]);
  const [policy, setPolicy] = useState<ManagedRuntimePolicy>('managed-ask');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [approval, setApproval] = useState<ManagedRuntimeArtifactSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!backendId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [runtimeStatuses, settings] = await Promise.all([
        listManagedRuntimes(backendId),
        getManagedRuntimeSettings(backendId),
      ]);
      setStatuses(runtimeStatuses);
      setPolicy(settings.policy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load managed runtimes');
    } finally {
      setLoading(false);
    }
  }, [backendId]);

  useEffect(() => {
    // Data loading intentionally owns the initial loading state for this panel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const runAction = useCallback(
    async <T,>(
      key: string,
      action: () => Promise<T>,
      success: string | ((result: T) => string)
    ) => {
      setBusy(key);
      setError(null);
      setMessage(null);
      try {
        const result = await action();
        setMessage(typeof success === 'function' ? success(result) : success);
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Managed runtime action failed');
      } finally {
        setBusy(null);
      }
    },
    [reload]
  );

  if (!backendId) {
    return <NoTargetBackendNotice />;
  }

  if (loading) {
    return (
      <div
        data-testid="managed-runtime-settings-loading"
        className="p-3 bg-secondary/50 rounded-lg text-sm text-muted-foreground"
      >
        Loading managed Agent CLIs…
      </div>
    );
  }

  return (
    <div data-testid="managed-runtime-settings" className="space-y-3">
      {!hideTargetBanner && <TargetBackendBanner target={targetBackend} />}
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm">CLI resolution policy</span>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            Managed downloads never modify a system-wide CLI.
          </p>
        </div>
        <Select
          value={policy}
          onChange={next =>
            void runAction(
              'policy',
              async () => {
                await setManagedRuntimePolicy(backendId, next as ManagedRuntimePolicy);
              },
              `Policy changed to ${next}.`
            )
          }
          disabled={busy === 'policy'}
          size="md"
          align="right"
          triggerClassName="min-w-[150px]"
          options={[
            { value: 'system-only', label: 'System only' },
            { value: 'managed-ask', label: 'Ask before download' },
            { value: 'managed-auto', label: 'Auto for trusted' },
          ]}
        />
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-destructive/10 text-xs text-destructive">{error}</div>
      )}
      {message && (
        <div className="p-2.5 rounded-lg bg-success/10 text-xs text-success">{message}</div>
      )}

      {statuses.length === 0 ? (
        <div className="p-3 bg-secondary/50 rounded-lg text-xs text-muted-foreground">
          No active plugin declares runtime compatibility metadata. Older plugins continue using
          their existing CLI behavior.
        </div>
      ) : (
        statuses.map(status => {
          const resolution = status.resolution;
          const verification = resolution.verification;
          return (
            <div
              key={`${status.pluginId}:${status.runtime}`}
              data-testid={`managed-runtime-${status.runtime}`}
              className="p-3 bg-secondary/50 rounded-lg space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{status.runtime}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {status.pluginId} · plugin {status.pluginVersion}
                  </div>
                </div>
                <span className={`text-xs ${statusTone(resolution)}`}>
                  {compatibilityLabel(resolution)}
                </span>
              </div>

              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <span className="text-muted-foreground">Selected source</span>
                <span className="text-right break-all">
                  {resolution.source ?? 'none'}
                  {resolution.version ? ` · ${resolution.version}` : ''}
                </span>
                <span className="text-muted-foreground">Authentication</span>
                <span className="text-right">{resolution.authState}</span>
                <span className="text-muted-foreground">Checksum</span>
                <span className="text-right">
                  {verification.checksumVerified ? 'SHA-256 verified' : 'Not host-verified'}
                </span>
                {verification.signatureVerified !== undefined && (
                  <>
                    <span className="text-muted-foreground">Signature</span>
                    <span className="text-right">
                      {verification.signatureVerified ? 'Verified' : 'Not verified'}
                    </span>
                  </>
                )}
                {verification.provenanceVerified !== undefined && (
                  <>
                    <span className="text-muted-foreground">Provenance</span>
                    <span className="text-right">
                      {verification.provenanceVerified ? 'Verified' : 'Not verified'}
                    </span>
                  </>
                )}
                {verification.sourceUrl && (
                  <>
                    <span className="text-muted-foreground">Download source</span>
                    <span className="text-right break-all" title={verification.sourceUrl}>
                      {verification.sourceUrl}
                    </span>
                  </>
                )}
                {verification.size !== undefined && (
                  <>
                    <span className="text-muted-foreground">Download size</span>
                    <span className="text-right">{formatBytes(verification.size)}</span>
                  </>
                )}
                {verification.storagePath && (
                  <>
                    <span className="text-muted-foreground">Storage path</span>
                    <span className="text-right break-all font-mono">
                      {verification.storagePath}
                    </span>
                  </>
                )}
              </div>

              {(resolution.message || resolution.warning) && (
                <p className="text-[11px] text-muted-foreground">
                  {resolution.warning ?? resolution.message}
                </p>
              )}

              {status.installedVersions.length > 0 && (
                <div className="pt-1 border-t border-border/70">
                  <div className="text-[10px] text-muted-foreground mb-1">Installed versions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {status.installedVersions.map(version => (
                      <button
                        key={version}
                        type="button"
                        disabled={busy !== null || status.selectedVersion === version}
                        onClick={() =>
                          void runAction(
                            `${status.runtime}:pin:${version}`,
                            () => pinManagedRuntime(backendId, status, version),
                            `${status.runtime} ${version} is now pinned.`
                          )
                        }
                        className={`px-2 py-1 rounded text-[10px] border ${
                          status.selectedVersion === version
                            ? 'border-primary text-primary'
                            : 'border-border hover:bg-muted'
                        } disabled:opacity-60`}
                      >
                        {version}
                        {status.selectedVersion === version ? ' · pinned' : ''}
                      </button>
                    ))}
                    {status.selectedVersion && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void runAction(
                            `${status.runtime}:unpin`,
                            () => pinManagedRuntime(backendId, status),
                            `${status.runtime} managed pin was removed.`
                          )
                        }
                        className="px-2 py-1 rounded text-[10px] border border-border hover:bg-muted disabled:opacity-60"
                      >
                        Unpin
                      </button>
                    )}
                    {status.canRollback && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void runAction(
                            `${status.runtime}:rollback`,
                            () => rollbackManagedRuntime(backendId, status),
                            `${status.runtime} selection was rolled back.`
                          )
                        }
                        className="px-2 py-1 rounded text-[10px] border border-border hover:bg-muted disabled:opacity-60"
                      >
                        Roll back selection
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {resolution.artifact && (
                  <button
                    type="button"
                    onClick={() => setApproval(resolution.artifact ?? null)}
                    disabled={busy !== null}
                    className="px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-60"
                  >
                    Review download
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void runAction(
                      `${status.runtime}:test`,
                      async () => {
                        const tested = await testManagedRuntime(backendId, status);
                        if (tested.status !== 'resolved') {
                          throw new Error(tested.message ?? `Compatibility test: ${tested.status}`);
                        }
                      },
                      `${status.runtime} compatibility probe passed.`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-md border border-border text-xs hover:bg-muted disabled:opacity-60"
                >
                  Test compatibility
                </button>
              </div>
            </div>
          );
        })
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void runAction(
              'gc',
              () => garbageCollectManagedRuntimes(backendId),
              result =>
                result.removed.length === 0
                  ? 'No unreferenced managed runtimes were eligible for cleanup.'
                  : `Removed ${result.removed.length} unreferenced managed runtime(s).`
            )
          }
          className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Clean unreferenced runtimes
        </button>
      </div>

      {approval && (
        <div
          data-testid="managed-runtime-approval"
          className="p-3 rounded-lg border border-warning/50 bg-warning/5 space-y-2"
        >
          <div className="text-sm font-medium">
            Download {approval.runtime} {approval.version}?
          </div>
          <p className="text-[11px] text-muted-foreground">
            ZClaudia will download this artifact into its private runtime store, verify SHA-256,
            probe the executable, and keep your normal HOME, Keychain, and provider authentication
            environment unchanged.
          </p>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
            <span className="text-muted-foreground">Source</span>
            <span className="text-right break-all">{approval.url}</span>
            <span className="text-muted-foreground">Size</span>
            <span className="text-right">{formatBytes(approval.size)}</span>
            <span className="text-muted-foreground">SHA-256</span>
            <span className="text-right break-all font-mono">{approval.sha256}</span>
            <span className="text-muted-foreground">Extra verification</span>
            <span className="text-right">
              {[
                approval.signatureDeclared ? 'Ed25519 signature' : null,
                approval.provenanceDeclared ? 'provenance' : null,
              ]
                .filter(Boolean)
                .join(' + ') || 'SHA-256 only'}
            </span>
            <span className="text-muted-foreground">Auto trust</span>
            <span className="text-right">
              {approval.trustedForAuto ? 'Trusted' : 'Manual approval only'}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setApproval(null)}
              className="px-2.5 py-1.5 rounded-md border border-border text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                const artifact = approval;
                setApproval(null);
                void runAction(
                  `${artifact.runtime}:install`,
                  () => installManagedRuntime(backendId, artifact),
                  `${artifact.runtime} ${artifact.version} was installed and pinned.`
                );
              }}
              className="px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-60"
            >
              Confirm download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
