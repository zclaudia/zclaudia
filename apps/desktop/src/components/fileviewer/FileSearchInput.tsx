import { useState, useRef, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import * as api from '../../services/api';
import type { FileEntry } from '@zclaudia/shared';
import { FileTypeIcon } from './fileIcons';

interface FileSearchInputProps {
  projectRoot: string;
  backendId?: string | null;
  onSelect: (relativePath: string) => void;
  onClose: () => void;
}

export function FileSearchInput({ projectRoot, backendId, onSelect, onClose }: FileSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch results on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.listDirectory({
          projectRoot,
          backendId,
          query: query.trim(),
          maxResults: 20,
        });
        setResults(result.entries.filter(e => e.type === 'file'));
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [backendId, query, projectRoot]);

  const handleSelect = useCallback((entry: FileEntry) => {
    onSelect(entry.path);
  }, [onSelect]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      setSelectedIndex(0);
    }
  };

  const renderFileName = (path: string) => {
    const parts = path.split('/');
    const name = parts.pop() ?? path;
    const directory = parts.join('/');
    return { directory, name };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

  return (
    <div className="border-b border-border bg-background/95 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search files by name..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {!query && (
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted/40 px-1.5 text-[10px] font-medium text-muted-foreground">
            Cmd P
          </kbd>
        )}
        {query && !loading && results.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {results.length}
          </span>
        )}
        {loading && (
          <span className="text-xs text-muted-foreground">...</span>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto">
          {results.map((entry, idx) => {
            const { directory, name } = renderFileName(entry.path);
            return (
              <button
                key={entry.path}
                onClick={() => handleSelect(entry)}
                className={`w-full text-left px-3 py-1.5 text-sm font-mono flex items-center gap-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:ring-inset ${
                  idx === selectedIndex
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-secondary/80'
                }`}
              >
                <FileTypeIcon name={name} className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5" />
                <span className="sr-only">{entry.path}</span>
                <span className="min-w-0 flex-1 truncate" aria-hidden="true">
                  <span>{directory ? `${directory}/` : ''}</span>
                  <span className="font-semibold">{name}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {query && !loading && results.length === 0 && (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          No files found for <span className="font-mono text-foreground">{query}</span>
        </div>
      )}
    </div>
  );
}
