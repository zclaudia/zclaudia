import { useRef, useState } from 'react';
import { CheckCircle2, FileArchive, Loader2, PackageCheck, Upload } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import {
  inspectPluginPackage,
  installPluginPackage,
  type PluginPackagePreview,
} from '../../services/api/plugin-packages';
import { ApiError } from '../../services/api/unwrap';
import { PluginPermissionsPreview } from './ui/PluginPermissionsPreview';
import { PluginRequirementStatus } from './ui/PluginRequirementStatus';

type InstallPhase = 'select' | 'checking' | 'review' | 'installing' | 'complete';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PhaseSteps({ phase }: { phase: InstallPhase }) {
  const current =
    phase === 'select'
      ? 0
      : phase === 'checking'
        ? 1
        : phase === 'review'
          ? 2
          : phase === 'installing'
            ? 3
            : 4;
  return (
    <div className="grid grid-cols-4 gap-1" aria-label="Installation progress">
      {['Select', 'Validate', 'Confirm', 'Result'].map((label, index) => (
        <div key={label} className="space-y-1">
          <div className={`h-1 rounded-full ${index <= current ? 'bg-primary' : 'bg-secondary'}`} />
          <div className="text-[10px] text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

export function PluginInstallModal({
  open,
  onClose,
  onInstalled,
  onViewPlugin,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: () => Promise<void> | void;
  onViewPlugin: (pluginId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<InstallPhase>('select');
  const [preview, setPreview] = useState<PluginPackagePreview | null>(null);
  const [installedId, setInstalledId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase('select');
    setPreview(null);
    setInstalledId(null);
    setError(null);
  };

  const inspect = async (file: File) => {
    setPhase('checking');
    setError(null);
    try {
      const result = await inspectPluginPackage(file);
      setPreview(result);
      setPhase('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not validate plugin package');
      setPhase('select');
    }
  };

  const install = async () => {
    if (!preview) return;
    setPhase('installing');
    setError(null);
    try {
      const result = await installPluginPackage(preview.token);
      setInstalledId(result.id);
      await onInstalled();
      setPhase('complete');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not install plugin');
      // An expired preview token can never succeed on retry — drop the dead
      // preview and return to file selection instead of leaving the user on a
      // Review screen whose Install button fails every time.
      if (cause instanceof ApiError && cause.code === 'PACKAGE_PREVIEW_EXPIRED') {
        setPreview(null);
        setPhase('select');
      } else {
        setPhase('review');
      }
    }
  };

  const close = () => {
    if (phase !== 'installing') {
      reset();
      onClose();
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      {phase === 'review' && (
        <button
          type="button"
          onClick={() => {
            setPreview(null);
            setError(null);
            setPhase('select');
          }}
          className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-secondary"
        >
          Choose another
        </button>
      )}
      {(phase === 'select' || phase === 'checking' || phase === 'review') && (
        <button
          type="button"
          onClick={close}
          disabled={phase === 'checking'}
          className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-40"
        >
          Cancel
        </button>
      )}
      {phase === 'review' && (
        <button
          type="button"
          onClick={() => void install()}
          className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {preview?.action === 'update'
            ? 'Install update'
            : preview?.action === 'reinstall'
              ? 'Reinstall'
              : 'Install'}
        </button>
      )}
      {phase === 'complete' && installedId && (
        <>
          <button
            type="button"
            onClick={close}
            className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-secondary"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              onViewPlugin(installedId);
            }}
            className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            View plugin
          </button>
        </>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      ariaLabel="Install plugin"
      title="Install plugin"
      size="lg"
      footer={footer}
    >
      <div className="space-y-4 p-4">
        <PhaseSteps phase={phase} />

        {phase === 'select' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center hover:bg-secondary/30"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Upload className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <span className="text-sm font-medium text-foreground">Choose a .zplugin package</span>
              <span className="text-[11px] text-muted-foreground">
                The package is validated before any plugin code is installed or executed.
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".zplugin,application/zip"
              className="hidden"
              aria-label="Choose plugin package"
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void inspect(file);
              }}
            />
          </div>
        )}

        {(phase === 'checking' || phase === 'installing') && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {phase === 'checking' ? 'Validating package…' : 'Installing plugin…'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {phase === 'checking'
                  ? 'Checking archive integrity, paths, metadata, and compatibility.'
                  : 'Selecting the new version atomically. It will remain inactive.'}
              </p>
            </div>
          </div>
        )}

        {phase === 'review' && preview && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileArchive className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-sm font-medium text-foreground">{preview.manifest.name}</h3>
                  <span className="text-xs text-muted-foreground">v{preview.manifest.version}</span>
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {preview.manifest.id}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{preview.manifest.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-secondary/30 p-2.5">
                <div className="text-muted-foreground">Package</div>
                <div className="mt-0.5 truncate text-foreground">{preview.fileName}</div>
              </div>
              <div className="rounded-lg bg-secondary/30 p-2.5">
                <div className="text-muted-foreground">Contents</div>
                <div className="mt-0.5 text-foreground">
                  {preview.fileCount.toLocaleString()} files · {formatBytes(preview.unpackedSize)}
                </div>
              </div>
              <div className="col-span-2 rounded-lg bg-secondary/30 p-2.5">
                <div className="text-muted-foreground">SHA-256</div>
                <div className="mt-0.5 truncate font-mono text-foreground" title={preview.sha256}>
                  {preview.sha256}
                </div>
              </div>
            </div>

            <section className="space-y-2">
              <h4 className="text-xs font-medium text-foreground">Runtime requirements</h4>
              <PluginRequirementStatus requirements={preview.requirements} />
            </section>
            <section className="space-y-2">
              <h4 className="text-xs font-medium text-foreground">Requested permissions</h4>
              <PluginPermissionsPreview permissions={preview.permissions as string[]} />
            </section>
            {preview.warnings.length > 0 && (
              <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <h4 className="text-xs font-medium text-amber-700 dark:text-amber-300">Review</h4>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-amber-700 dark:text-amber-300">
                  {preview.warnings.map(warning => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-[11px] text-muted-foreground">
              The plugin will be installed but not activated. You can enable it from its card after
              reviewing the details.
            </p>
          </div>
        )}

        {phase === 'complete' && preview && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                {preview.manifest.name} installed
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Version {preview.manifest.version} is selected and currently inactive.
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
              <PackageCheck className="h-3.5 w-3.5" /> Package verified
            </div>
          </div>
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
