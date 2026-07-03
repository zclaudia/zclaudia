import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Folder, Loader2 } from 'lucide-react';
import type { DirectoryBrowseEntry } from '@zclaudia/shared';
import { browseDirectories } from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { Modal } from '../../components/ui/Modal';

interface DirectoryPickerModalProps {
  open: boolean;
  /** Backend whose filesystem is browsed (null = default/local). */
  backendId: string | null;
  /** Optional starting absolute path; falls back to the backend home dir. */
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

/**
 * Folder picker for choosing a directory on the selected backend's host.
 * Built on the shared Modal shell; renders above other modals (z-[110]) so it
 * works when opened nested from another dialog.
 */
export function DirectoryPickerModal({
  open,
  backendId,
  initialPath,
  onClose,
  onSelect,
}: DirectoryPickerModalProps) {
  const isMobile = useIsMobile();

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryBrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await browseDirectories({ path, backendId });
        setCurrentPath(res.path);
        setParent(res.parent);
        setDirectories(res.directories);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to read directory');
      } finally {
        setLoading(false);
      }
    },
    [backendId]
  );

  useEffect(() => {
    if (!open) return;
    void load(initialPath || undefined);
    // Seed only when the modal opens; subsequent navigation calls load() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Choose a folder"
      size="lg"
      placement="center"
      mobileFullscreen
      isMobile={isMobile}
      zClassName="z-[110]"
      footer={
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (currentPath) {
                onSelect(currentPath);
                onClose();
              }
            }}
            disabled={!currentPath || loading}
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-foreground shadow-apple-sm hover:bg-accent/80 disabled:opacity-50"
          >
            Use this folder
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          onClick={() => parent && load(parent)}
          disabled={!parent || loading}
          aria-label="Up one level"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ArrowUp size={16} strokeWidth={1.75} />
        </button>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          title={currentPath ?? ''}
        >
          {currentPath ?? '…'}
        </span>
      </div>
      <div className="min-h-[140px]">
        {error ? (
          <p className="px-4 py-6 text-sm text-destructive">{error}</p>
        ) : loading && directories.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : directories.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No subfolders here.</p>
        ) : (
          directories.map(dir => (
            <button
              key={dir.path}
              onClick={() => load(dir.path)}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <Folder size={16} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{dir.name}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
