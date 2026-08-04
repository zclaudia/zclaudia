import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { DirectoryPickerModal } from './DirectoryPickerModal';

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  onNameChange: (name: string) => void;
  rootPath: string;
  onRootPathChange: (path: string) => void;
  onCreate: () => void;
  creatingProject: boolean;
  isConnected: boolean;
  isMobile?: boolean;
  /** Online backends the project can be created on. */
  backends: { backendId: string; name: string; online: boolean }[];
  selectedBackendId: string | null;
  onSelectedBackendIdChange: (backendId: string) => void;
}

/**
 * "New project" dialog — the modal counterpart to NewSessionModal. Backend
 * picker (when more than one is online), name, and a browse-or-type working
 * directory, with a Create/Cancel footer.
 */
export function NewProjectModal({
  open,
  onClose,
  name,
  onNameChange,
  rootPath,
  onRootPathChange,
  onCreate,
  creatingProject,
  isConnected,
  isMobile = false,
  backends,
  selectedBackendId,
  onSelectedBackendIdChange,
}: NewProjectModalProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const backendId = selectedBackendId ?? backends[0]?.backendId ?? null;
  const canCreate = !!name.trim() && isConnected && !creatingProject;

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const submit = () => {
    if (canCreate) onCreate();
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={submit} disabled={!canCreate}>
        {creatingProject ? 'Creating…' : 'Create'}
      </Button>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        ariaLabel="New project"
        title="New project"
        footer={footer}
        size="md"
        mobileFullscreen
        isMobile={isMobile}
      >
        <div className="flex flex-col gap-4 px-4 py-4">
          {backends.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Backend</span>
              <Select
                ariaLabel="Create in backend"
                value={backendId ?? ''}
                onChange={onSelectedBackendIdChange}
                block
                size="md"
                triggerClassName="!h-9 !rounded-xl !text-[13px]"
                options={backends.map(b => ({ value: b.backendId, label: b.name }))}
              />
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Name</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="Project name"
              className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Working directory</span>
            <div className="flex h-9 items-center overflow-hidden rounded-xl border border-border bg-background transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/50">
              <input
                type="text"
                aria-label="Working directory"
                value={rootPath}
                onChange={e => onRootPathChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder="e.g. ~/code/my-project"
                className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[12px] text-foreground placeholder:font-sans placeholder:text-muted-foreground/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label="Browse for folder"
                title="Browse for folder"
                className="flex h-full flex-shrink-0 items-center border-l border-border px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <FolderOpen size={15} strokeWidth={1.75} />
              </button>
            </div>
            <span className="px-0.5 text-[11px] text-muted-foreground/60">
              Leave empty to use the default location.
            </span>
          </div>
        </div>
      </Modal>

      <DirectoryPickerModal
        open={pickerOpen}
        backendId={backendId}
        initialPath={rootPath.trim() || undefined}
        onClose={() => setPickerOpen(false)}
        onSelect={path => onRootPathChange(path)}
      />
    </>
  );
}
