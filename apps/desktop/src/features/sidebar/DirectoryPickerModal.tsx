import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, ChevronRight, Folder, Loader2 } from 'lucide-react';
import type { DirectoryBrowseEntry } from '@zclaudia/shared';
import { browseDirectories } from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { Button } from '../../components/ui/Button';
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
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (currentPath) {
                onSelect(currentPath);
                onClose();
              }
            }}
            disabled={!currentPath || loading}
          >
            Use this folder
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button
          onClick={() => parent && load(parent)}
          disabled={!parent || loading}
          aria-label="Up one level"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
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
      <div className="min-h-[140px] p-2">
        {error ? (
          <p className="px-2.5 py-6 text-sm text-destructive">{error}</p>
        ) : loading && directories.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : directories.length === 0 ? (
          <p className="px-2.5 py-6 text-sm text-muted-foreground">No subfolders here.</p>
        ) : (
          directories.map(dir => (
            <button
              key={dir.path}
              onClick={() => load(dir.path)}
              className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-secondary"
            >
              <Folder
                size={16}
                strokeWidth={1.75}
                className="flex-shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">{dir.name}</span>
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className="flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
              />
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
