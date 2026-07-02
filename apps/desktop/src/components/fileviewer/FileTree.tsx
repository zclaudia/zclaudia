import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react';
import type { FileEntry } from '@zclaudia/shared';
import * as api from '../../services/api';
import { FileTypeIcon } from './fileIcons';

interface FileTreeProps {
  projectRoot: string;
  backendId?: string | null;
  selectedPath?: string | null;
  onOpenFile: (relativePath: string) => void;
}

type EntryMap = Record<string, FileEntry[]>;
type FlagMap = Record<string, boolean>;
type ErrorMap = Record<string, string | null>;

function entryIndent(depth: number) {
  return { paddingLeft: `${0.625 + depth * 0.875}rem` };
}

function parentPath(path: string) {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function shouldAutoExpand(selectedPath: string | null | undefined, dirPath: string) {
  if (!selectedPath) return false;
  return parentPath(selectedPath) === dirPath || selectedPath.startsWith(`${dirPath}/`);
}

export function FileTree({ projectRoot, backendId, selectedPath, onOpenFile }: FileTreeProps) {
  const [entriesByPath, setEntriesByPath] = useState<EntryMap>({});
  const [expandedPaths, setExpandedPaths] = useState<FlagMap>({ '': true });
  const [loadingPaths, setLoadingPaths] = useState<FlagMap>({});
  const [errorByPath, setErrorByPath] = useState<ErrorMap>({});

  const loadDirectory = useCallback(
    async (relativePath: string) => {
      setLoadingPaths(state => ({ ...state, [relativePath]: true }));
      setErrorByPath(state => ({ ...state, [relativePath]: null }));

      try {
        const result = await api.listDirectory({
          projectRoot,
          relativePath,
          backendId: backendId ?? undefined,
        });
        setEntriesByPath(state => ({ ...state, [relativePath]: result.entries }));
      } catch (err) {
        setErrorByPath(state => ({
          ...state,
          [relativePath]: err instanceof Error ? err.message : 'Failed to load directory',
        }));
      } finally {
        setLoadingPaths(state => ({ ...state, [relativePath]: false }));
      }
    },
    [backendId, projectRoot]
  );

  useEffect(() => {
    setEntriesByPath({});
    setExpandedPaths({ '': true });
    setLoadingPaths({});
    setErrorByPath({});
    void loadDirectory('');
  }, [loadDirectory]);

  const toggleDirectory = (path: string) => {
    const willExpand = !(expandedPaths[path] ?? shouldAutoExpand(selectedPath, path));
    setExpandedPaths(state => ({ ...state, [path]: willExpand }));
    if (willExpand && !entriesByPath[path]) {
      void loadDirectory(path);
    }
  };

  const renderEntries = (relativePath: string, depth: number): ReactNode => {
    const entries = entriesByPath[relativePath] ?? [];
    const loading = loadingPaths[relativePath];
    const error = errorByPath[relativePath];

    return (
      <>
        {error && (
          <div className="px-2 py-1 text-sm text-destructive" style={entryIndent(depth)}>
            {error}
          </div>
        )}
        {loading && !entries.length && (
          <div
            className="flex items-center gap-2 h-7 px-2 text-sm text-muted-foreground"
            style={entryIndent(depth)}
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            <span>Loading...</span>
          </div>
        )}
        {entries.map(entry => {
          const isDirectory = entry.type === 'directory';
          const isSelected = !isDirectory && selectedPath === entry.path;
          const autoExpand = isDirectory && shouldAutoExpand(selectedPath, entry.path);
          const isExpanded = expandedPaths[entry.path] ?? autoExpand;
          const showChildren = isDirectory && isExpanded;
          const FolderIcon = showChildren ? FolderOpen : Folder;

          return (
            <div key={entry.path}>
              <button
                type="button"
                onClick={() => (isDirectory ? toggleDirectory(entry.path) : onOpenFile(entry.path))}
                className={`group w-full flex items-center gap-1.5 h-7 px-2 text-left text-sm min-w-0 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:ring-inset ${
                  isSelected
                    ? 'bg-muted text-foreground shadow-[inset_2px_0_0_hsl(var(--muted-foreground))]'
                    : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
                }`}
                style={entryIndent(depth)}
                title={entry.path}
                aria-current={isSelected ? 'page' : undefined}
                aria-expanded={isDirectory ? showChildren : undefined}
              >
                <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-muted-foreground/80 group-hover:text-foreground">
                  {isDirectory ? (
                    showChildren ? (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    )
                  ) : null}
                </span>
                {isDirectory ? (
                  <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-muted-foreground">
                    <FolderIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <FileTypeIcon
                    name={entry.name}
                    className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5"
                  />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
              {showChildren && renderEntries(entry.path, depth + 1)}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="h-full overflow-auto py-1" data-testid="file-tree">
      {renderEntries('', 0)}
    </div>
  );
}
