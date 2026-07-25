import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, CaseSensitive, X } from 'lucide-react';
import { findContentMatches, type ContentMatch } from './contentSearch';
import { useDebounce } from '../../hooks/useDebounce';

interface FileContentSearchInputProps {
  content: string;
  query: string;
  caseSensitive: boolean;
  onQueryChange: (query: string) => void;
  onToggleCaseSensitive: () => void;
  onSelectMatch: (match: ContentMatch | null) => void;
  onClose: () => void;
  initialActiveIndex?: number;
}

export function FileContentSearchInput({
  content,
  query,
  caseSensitive,
  onQueryChange,
  onToggleCaseSensitive,
  onSelectMatch,
  onClose,
  initialActiveIndex = 0,
}: FileContentSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localQuery, setLocalQuery] = useState(query);
  const lastQueryPropRef = useRef(query);
  const debouncedQuery = useDebounce(localQuery, 120);
  // Use a search key to reset navigation automatically whenever the effective
  // search parameters change. navNonce is relative to the current search key.
  const searchKey = `${debouncedQuery}:${caseSensitive ? 's' : 'i'}`;
  const [navNonce, setNavNonce] = useState(0);

  // Sync local query when the parent query changes (e.g. opening pre-filled or
  // external updates). Updates are filtered to avoid overwriting user typing.
  useEffect(() => {
    if (lastQueryPropRef.current !== query) {
      lastQueryPropRef.current = query;
      setLocalQuery(query);
    }
  }, [query]);

  const matches = useMemo(
    () => findContentMatches(content, debouncedQuery, caseSensitive),
    [content, debouncedQuery, caseSensitive]
  );
  const matchCount = matches.length;

  useEffect(() => {
    if (debouncedQuery !== query) {
      onQueryChange(debouncedQuery);
    }
  }, [debouncedQuery, onQueryChange, query]);

  const activeIndex = useMemo(() => {
    if (matchCount === 0) return 0;
    const index = (initialActiveIndex + navNonce) % matchCount;
    return index < 0 ? index + matchCount : index;
  }, [initialActiveIndex, matchCount, navNonce]);

  // Reset navigation back to the initial match whenever the search key changes.
  // The synchronous reset is intentional: when query/case change we must restart
  // from the first match so the index and scroll target stay in sync with results.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavNonce(0);
  }, [searchKey]);

  // Notify parent when the active match changes (so the panel can scroll).
  useEffect(() => {
    const selected = matches[activeIndex] ?? null;
    onSelectMatch(selected);
  }, [matches, activeIndex, onSelectMatch]);

  // Auto-focus on mount and whenever the input is shown.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const goToPrevious = useCallback(() => {
    if (matchCount === 0) return;
    setNavNonce(n => n - 1);
  }, [matchCount]);

  const goToNext = useCallback(() => {
    if (matchCount === 0) return;
    setNavNonce(n => n + 1);
  }, [matchCount]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevious();
      } else {
        goToNext();
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQuery(e.target.value);
  };

  return (
    <div className="border-b border-border bg-background/95 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={localQuery}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Find in file..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          aria-label="Find in file"
        />
        {matchCount > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {activeIndex + 1}/{matchCount}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={goToPrevious}
            disabled={matchCount === 0}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Previous match"
          >
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={goToNext}
            disabled={matchCount === 0}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Next match"
          >
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onToggleCaseSensitive}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              caseSensitive
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
            title={caseSensitive ? 'Case sensitive' : 'Case insensitive'}
            aria-label={caseSensitive ? 'Case sensitive' : 'Case insensitive'}
            aria-pressed={caseSensitive}
          >
            <CaseSensitive className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close search"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
