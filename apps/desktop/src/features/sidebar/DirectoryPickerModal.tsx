import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Folder, Loader2 } from 'lucide-react';
import type { DirectoryBrowseEntry } from '@zclaudia/shared';
import { browseDirectories } from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAndroidBack } from '../../hooks/useAndroidBack';

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
 * Folder picker for choosing a project root on the selected backend's host.
 * Navigation is driven by the backend (`/api/files/browse-dirs`) so it works
 * identically for local and remote backends.
 */
export function DirectoryPickerModal({ open, backendId, initialPath, onClose, onSelect }: DirectoryPickerModalProps) {
  const isMobile = useIsMobile();
  useAndroidBack(onClose, isMobile && open, 26);

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryBrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path?: string) => {
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
  }, [backendId]);

  useEffect(() => {
    if (!open) return;
    void load(initialPath || undefined);
    // Seed only when the modal opens; subsequent navigation calls load() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div
        className={`fixed z-50 bg-card flex flex-col ${
          isMobile
            ? 'inset-0 safe-top-pad safe-bottom-pad'
            : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] max-h-[80vh] rounded-lg shadow-2xl'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-border">
          <button
            onClick={() => parent && load(parent)}
            disabled={!parent || loading}
            aria-label="Up one level"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowUp size={16} strokeWidth={1.75} />
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={currentPath ?? ''}>
            {currentPath ?? '…'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hidden min-h-[140px]">
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">{error}</p>
          ) : loading && directories.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : directories.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No subfolders here.</p>
          ) : (
            directories.map((dir) => (
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

        <div className="flex gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={() => { if (currentPath) { onSelect(currentPath); onClose(); } }}
            disabled={!currentPath || loading}
            className="flex-1 px-3 py-2 bg-accent text-foreground font-medium shadow-apple-sm hover:bg-accent/80 rounded-lg text-sm disabled:opacity-50"
          >
            Use this folder
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
