import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search as SearchIcon,
  X,
  FileText,
  Wrench,
  MessageSquare,
  CornerDownLeft,
  SlidersHorizontal,
  Clock,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { SearchFilters } from '../../components/SearchFilters';
import { timeAgo } from '../../utils/timeAgo';
import type { SearchModalProps } from './types';

function normalizeSearchPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

function resultIcon(resultType?: string) {
  if (resultType === 'file')
    return <FileText size={15} strokeWidth={1.75} aria-label="File result" />;
  if (resultType && resultType !== 'message')
    return <Wrench size={15} strokeWidth={1.75} aria-label="Tool result" />;
  return <MessageSquare size={15} strokeWidth={1.75} aria-label="Message result" />;
}

/**
 * Centered command-palette style search modal (desktop).
 * Replaces the old sidebar-anchored dropdown with a focused overlay dialog:
 * arrow keys move the highlight, Enter opens, Esc / backdrop / × close.
 */
export function SearchModal({ open, onClose, search, sessions, onResultSelect }: SearchModalProps) {
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    isSearching,
    searchHistory,
    showFilters,
    setShowFilters,
    searchFilters,
    hasMoreResults,
    isLoadingMore,
    searchInputRef,
    handleSearch,
    handleLoadMore,
    handleSelectHistoryItem,
    handleClearHistory,
    handleFiltersChange,
  } = search;

  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement>(null);

  const hasQuery = !!searchQuery.trim();
  const showingHistory = !hasQuery && searchHistory.length > 0;
  const navCount = hasQuery ? searchResults.length : showingHistory ? searchHistory.length : 0;

  // Reset the highlight when the result set or mode changes (adjust-during-render
  // instead of an effect, per React guidance).
  const navKey = `${searchQuery}|${searchResults.length}|${showingHistory}`;
  const [lastNavKey, setLastNavKey] = useState(navKey);
  if (navKey !== lastNavKey) {
    setLastNavKey(navKey);
    setActiveIndex(0);
  }

  // Focus the input whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, searchInputRef]);

  // Keep the highlighted row in view as the user arrows through.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectResult = useCallback(
    (r: (typeof searchResults)[number]) => {
      onResultSelect(r.sessionId, r.id, r.ownerBackendId);
      setSearchQuery('');
      setSearchResults([]);
      onClose();
    },
    [onResultSelect, setSearchQuery, setSearchResults, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, Math.max(navCount - 1, 0)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        if (hasQuery && searchResults[activeIndex]) {
          e.preventDefault();
          selectResult(searchResults[activeIndex]);
        } else if (showingHistory && searchHistory[activeIndex]) {
          e.preventDefault();
          handleSelectHistoryItem(searchHistory[activeIndex].query);
        }
      }
    },
    [
      navCount,
      hasQuery,
      searchResults,
      activeIndex,
      showingHistory,
      searchHistory,
      selectResult,
      handleSelectHistoryItem,
    ]
  );

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} ariaLabel="Search" size="2xl">
      <div onKeyDown={handleKeyDown}>
        {/* Header / input row */}
        <div className="flex items-center gap-2.5 px-4 py-3">
          <SearchIcon
            size={18}
            strokeWidth={1.75}
            className="flex-shrink-0 text-muted-foreground"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search messages and sessions…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`rounded-md p-1.5 hover:bg-secondary ${showFilters ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}
            title="Filters"
            aria-label="Filters"
          >
            <SlidersHorizontal size={16} strokeWidth={1.75} />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close search"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="border-t border-border px-3 py-2">
            <SearchFilters
              filters={searchFilters}
              sessions={sessions}
              onFiltersChange={handleFiltersChange}
              onClose={() => setShowFilters(false)}
            />
          </div>
        )}

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto border-t border-border">
          {/* History (empty query) */}
          {showingHistory && (
            <div className="py-1.5">
              <div className="flex items-center justify-between px-4 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">Recent Searches</span>
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              {searchHistory.map((entry, i) => (
                <button
                  key={entry.id}
                  ref={i === activeIndex ? activeRowRef : undefined}
                  onClick={() => handleSelectHistoryItem(entry.query)}
                  onMouseMove={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === activeIndex ? 'bg-secondary' : ''}`}
                >
                  <Clock
                    size={15}
                    strokeWidth={1.75}
                    className="flex-shrink-0 text-muted-foreground"
                  />
                  <span className="flex-1 truncate text-sm text-foreground">{entry.query}</span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {entry.resultCount} results
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Empty state (no query, no history) */}
          {!hasQuery && !showingHistory && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Type to search your messages and sessions
            </div>
          )}

          {/* Results */}
          {hasQuery && (
            <>
              {isSearching && searchResults.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No results for “{searchQuery.trim()}”
                </div>
              ) : (
                <div className="py-1.5">
                  {searchResults.map((r, i) => (
                    <button
                      key={r.id}
                      ref={i === activeIndex ? activeRowRef : undefined}
                      onClick={() => selectResult(r)}
                      onMouseMove={() => setActiveIndex(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === activeIndex ? 'bg-secondary' : ''}`}
                    >
                      <span className="flex-shrink-0 text-muted-foreground">
                        {resultIcon(r.resultType)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {r.sessionName || 'Untitled'}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {normalizeSearchPreview(r.content)}
                        </span>
                      </span>
                      {i === activeIndex ? (
                        <CornerDownLeft
                          size={14}
                          strokeWidth={1.75}
                          className="flex-shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">
                          {timeAgo(r.createdAt)}
                        </span>
                      )}
                    </button>
                  ))}
                  {hasMoreResults && (
                    <button
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      onMouseMove={() => setActiveIndex(-1)}
                      className="w-full px-4 py-2.5 text-center text-xs text-primary hover:bg-secondary disabled:opacity-50"
                    >
                      {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} shown)`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
