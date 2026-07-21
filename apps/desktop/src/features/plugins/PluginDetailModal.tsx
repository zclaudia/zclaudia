import { useMemo, useState } from 'react';
import { FolderCog, PackagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import type { InstalledPlugin } from '../../stores/pluginStore';
import { confirm } from '../../stores/confirmDialogStore';
import { rollbackPluginPackage, uninstallPluginPackage } from '../../services/api/plugin-packages';
import { Badge } from '../../components/ui/Badge';
import { PluginPermissionsPreview } from './ui/PluginPermissionsPreview';
import { PluginRequirementStatus } from './ui/PluginRequirementStatus';

export function PluginDetailModal({
  plugin,
  open,
  onClose,
  onChanged,
  onInstallAnother,
  onManageDirectories,
}: {
  plugin: InstalledPlugin | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onInstallAnother: () => void;
  onManageDirectories: () => void;
}) {
  const rollbackVersions = useMemo(
    () => plugin?.availableVersions.filter(version => version !== plugin.activeVersion) ?? [],
    [plugin]
  );
  const [rollbackVersion, setRollbackVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!plugin) return null;

  const selectedRollbackVersion = rollbackVersions.includes(rollbackVersion)
    ? rollbackVersion
    : (rollbackVersions[0] ?? '');

  const close = () => {
    if (busy) return;
    setError(null);
    setRollbackVersion('');
    onClose();
  };

  const rollback = async () => {
    if (!selectedRollbackVersion) return;
    const accepted = await confirm({
      title: 'Roll back plugin?',
      message: `${plugin.manifest.name} will switch from ${plugin.activeVersion} to ${selectedRollbackVersion} and remain inactive.`,
      confirmLabel: 'Roll back',
    });
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      await rollbackPluginPackage(plugin.manifest.id, selectedRollbackVersion);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not roll back plugin');
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async () => {
    const accepted = await confirm({
      title: 'Uninstall plugin?',
      message: `${plugin.manifest.name} and all locally retained versions will be removed.`,
      confirmLabel: 'Uninstall',
      destructive: true,
    });
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      await uninstallPluginPackage(plugin.manifest.id);
      await onChanged();
      setError(null);
      setRollbackVersion('');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not uninstall plugin');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      ariaLabel={`Plugin details: ${plugin.manifest.name}`}
      title={plugin.manifest.name}
      size="lg"
    >
      <div className="space-y-5 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{plugin.manifest.id}</span>
            <Badge label={`v${plugin.manifest.version}`} tone="neutral" />
            <Badge
              label={plugin.source === 'managed' ? 'Managed package' : 'Development directory'}
              tone={plugin.source === 'managed' ? 'accent' : 'neutral'}
            />
            <Badge
              label={
                plugin.status === 'active'
                  ? 'Active'
                  : plugin.status === 'error'
                    ? 'Error'
                    : 'Inactive'
              }
              tone={plugin.status === 'active' ? 'accent' : 'neutral'}
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {plugin.manifest.description}
          </p>
          <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground/80">
            {plugin.path}
          </p>
        </div>

        {plugin.error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {plugin.error}
          </div>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-medium text-foreground">Runtime requirements</h3>
          <PluginRequirementStatus requirements={plugin.requirements} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium text-foreground">Requested permissions</h3>
          <PluginPermissionsPreview permissions={(plugin.manifest.permissions ?? []) as string[]} />
        </section>

        {plugin.source === 'managed' ? (
          <section className="space-y-3 rounded-xl border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-medium text-foreground">Package versions</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Selected: {plugin.activeVersion ?? plugin.manifest.version}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setRollbackVersion('');
                  onInstallAnother();
                }}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-secondary disabled:opacity-40"
              >
                <PackagePlus className="h-3.5 w-3.5" /> Install another version
              </button>
            </div>

            {rollbackVersions.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedRollbackVersion}
                  onChange={event => setRollbackVersion(event.target.value)}
                  aria-label="Rollback version"
                  className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                >
                  {rollbackVersions.map(version => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void rollback()}
                  disabled={busy || !selectedRollbackVersion}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-secondary disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Roll back
                </button>
              </div>
            )}

            <div className="flex justify-end border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => void uninstall()}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Uninstall
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-border/60 p-3">
            <h3 className="text-xs font-medium text-foreground">Development plugin</h3>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              This plugin is loaded directly from a development directory. Manage its files and
              versions outside ZClaudia.
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRollbackVersion('');
                onManageDirectories();
              }}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-secondary"
            >
              <FolderCog className="h-3.5 w-3.5" /> Manage directories
            </button>
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
