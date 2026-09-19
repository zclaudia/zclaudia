import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { FileEntry } from '@zclaudia/shared';
import * as api from '../../../services/api';

/** State for the @ mention feature. */
export interface MentionState {
  isActive: boolean;
  triggerIndex: number;
  query: string;
  currentPath: string;
  entries: FileEntry[];
  selectedIndex: number;
  isLoading: boolean;
  hasError: boolean;
}

export const initialMentionState: MentionState = {
  isActive: false,
  triggerIndex: -1,
  query: '',
  currentPath: '',
  entries: [],
  selectedIndex: 0,
  isLoading: false,
  hasError: false,
};

// Simple debounce function
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * State machine for the composer's `@` file-mention feature: detects the
 * `@path/…` trigger under the caret, fetches debounced directory listings
 * from the file-reference API, and tracks the dropdown's selection. The
 * text/caret mutations for a chosen entry stay in the composer (they edit the
 * textarea value), so this hook only owns detection + list state.
 */
export function useMentionState(listRef: RefObject<HTMLDivElement | null>) {
  const [mentionState, setMentionState] = useState<MentionState>(initialMentionState);

  // Detect @ mention in text
  const detectMention = useCallback(
    (text: string, cursorPos: number): { triggerIndex: number; query: string } | null => {
      // Find the last @ before cursor that's not preceded by a non-space character
      for (let i = cursorPos - 1; i >= 0; i--) {
        const char = text[i];
        if (char === '@') {
          // Check if @ is at start or preceded by whitespace
          if (i === 0 || /\s/.test(text[i - 1])) {
            return {
              triggerIndex: i,
              query: text.substring(i + 1, cursorPos),
            };
          }
          break;
        }
        // Stop if we hit whitespace (except within the path)
        if (char === ' ' || char === '\n' || char === '\t') {
          break;
        }
      }
      return null;
    },
    []
  );

  // Parse query into path components
  const parseQuery = useCallback((query: string) => {
    const pathParts = query.split('/');
    const currentPath = pathParts.slice(0, -1).join('/');
    const searchQuery = pathParts[pathParts.length - 1];
    return { currentPath, searchQuery };
  }, []);

  // Fetch directory entries
  const fetchEntries = useCallback(
    async (
      projectRootPath: string,
      relativePath: string,
      query: string,
      resolvedBackendId?: string | null
    ) => {
      if (!projectRootPath) return;

      setMentionState(prev => ({ ...prev, isLoading: true, hasError: false }));

      try {
        const result = await api.listDirectory({
          projectRoot: projectRootPath,
          relativePath,
          query,
          maxResults: 20,
          backendId: resolvedBackendId,
        });

        setMentionState(prev => ({
          ...prev,
          entries: result.entries,
          isLoading: false,
          selectedIndex: 0,
        }));
      } catch (error) {
        console.error('Failed to fetch directory listing:', error);
        setMentionState(prev => ({ ...prev, entries: [], isLoading: false, hasError: true }));
      }
    },
    []
  );

  // Debounced fetch
  const debouncedFetchEntries = useMemo(() => debounce(fetchEntries, 150), [fetchEntries]);

  // Scroll selected mention into view
  useEffect(() => {
    if (mentionState.isActive && listRef.current) {
      const selectedElement = listRef.current.querySelector(
        `[data-index="${mentionState.selectedIndex}"]`
      ) as HTMLElement;
      if (selectedElement?.scrollIntoView) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [mentionState.selectedIndex, mentionState.isActive]);

  return {
    mentionState,
    setMentionState,
    detectMention,
    parseQuery,
    fetchEntries,
    debouncedFetchEntries,
  };
}
