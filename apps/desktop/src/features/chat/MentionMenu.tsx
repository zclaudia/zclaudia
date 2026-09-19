import { forwardRef } from 'react';
import { ChevronRight, FolderClosed } from 'lucide-react';
import type { FileEntry } from '@zclaudia/shared/files';
import { Icon } from '../../components/ui/Icon';
import { FileSymbol } from '../../components/filesymbols';

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

interface MentionMenuProps {
  currentPath: string;
  entries: FileEntry[];
  selectedIndex: number;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (entry: FileEntry) => void;
  /** Breadcrumb navigation to an absolute, `/`-separated path ("" = root). */
  onNavigate: (path: string) => void;
}

/**
 * `@` file-mention dropdown: breadcrumb path navigation plus the directory
 * listing. Rows carry `data-index` so the parent can scroll the keyboard
 * selection into view.
 */
export const MentionMenu = forwardRef<HTMLDivElement, MentionMenuProps>(function MentionMenu(
  { currentPath, entries, selectedIndex, isLoading, hasError, onSelect, onNavigate },
  ref
) {
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-lg overflow-y-auto max-h-64 z-10"
    >
      {/* Breadcrumb navigation */}
      {currentPath && (
        <div className="px-4 py-2 border-b border-border text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
          <button onClick={() => onNavigate('')} className="hover:text-foreground">
            root
          </button>
          {currentPath.split('/').map((part, idx, arr) => (
            <span key={idx} className="flex items-center gap-1">
              <span className="text-muted-foreground/50">/</span>
              <button
                onClick={() => onNavigate(arr.slice(0, idx + 1).join('/'))}
                className="hover:text-foreground"
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="px-4 py-3 text-muted-foreground text-sm">Loading...</div>
      ) : hasError ? (
        <div className="px-4 py-3 text-destructive text-sm">
          Failed to list files — check server connection
        </div>
      ) : entries.length === 0 ? (
        <div className="px-4 py-3 text-muted-foreground text-sm">No files found</div>
      ) : (
        entries.map((entry, index) => (
          <button
            key={entry.path}
            data-index={index}
            onClick={() => onSelect(entry)}
            className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-muted ${
              index === selectedIndex ? 'bg-muted' : ''
            }`}
          >
            {entry.type === 'directory' ? (
              <Icon icon={FolderClosed} size={16} className="text-muted-foreground" />
            ) : (
              <FileSymbol name={entry.name} size={16} />
            )}
            <span className="flex-1 truncate">{entry.name}</span>
            {entry.type === 'directory' && (
              <ChevronRight size={14} className="text-muted-foreground" />
            )}
            {entry.size !== undefined && (
              <span className="text-xs text-muted-foreground">{formatFileSize(entry.size)}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
});
