import { create } from 'zustand';
import { usePluginStore } from './pluginStore';

const CACHE_MAX = 30;
const TREE_WIDTH_MIN = 160;
const TREE_WIDTH_MAX = 520;
const TREE_WIDTH_DEFAULT = 256;

interface FileViewerState {
  // Panel open state
  isOpen: boolean;
  // Currently viewed file
  filePath: string | null; // relative path from project root
  projectRoot: string | null;
  // File content
  content: string | null;
  loading: boolean;
  error: string | null;
  /**
   * mtime (ms since epoch) of the file content currently displayed. Used by the
   * panel's staleness poll to decide whether a re-fetch is needed. `null` when
   * no content has been loaded yet (forces an initial fetch).
   */
  knownMtimeMs: number | null;
  // Optional line target — when set, FileViewerPanel scrolls to targetLine
  // and highlights the [targetLine, targetEndLine ?? targetLine] range.
  targetLine: number | null;
  targetEndLine: number | null;
  // Bumped each time a target is set so the panel can re-scroll even when
  // the user clicks the same reference twice.
  targetNonce: number;
  // Search mode (Cmd+P)
  searchOpen: boolean;
  // File tree visibility (desktop)
  showTree: boolean;
  // File tree width (desktop)
  treeWidthPx: number;
  // Full-screen overlay (mobile)
  fullscreen: boolean;
  // LRU content cache  (key = "projectRoot\0relativePath")
  contentCache: Map<string, CacheEntry>;

  openFile: (
    projectRoot: string,
    relativePath: string,
    targetLine?: number,
    targetEndLine?: number
  ) => void;
  setContent: (content: string, mtimeMs?: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  close: () => void;
  togglePanel: () => void;
  setShowTree: (show: boolean) => void;
  toggleTree: () => void;
  setTreeWidthPx: (widthPx: number) => void;
  setSearchOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
  getCached: (projectRoot: string, relativePath: string) => string | undefined;
  /** Remove a cached entry so the next open forces a fresh fetch. */
  invalidate: (projectRoot: string, relativePath: string) => void;
}

function cacheKey(root: string, path: string) {
  return `${root}\0${path}`;
}

/** Cached file payload: the text plus the mtime it was read at. */
interface CacheEntry {
  content: string;
  mtimeMs: number;
}

function clampTreeWidth(widthPx: number) {
  return Math.max(TREE_WIDTH_MIN, Math.min(TREE_WIDTH_MAX, Math.round(widthPx)));
}

export const useFileViewerStore = create<FileViewerState>((set, get) => ({
  isOpen: false,
  filePath: null,
  projectRoot: null,
  content: null,
  loading: false,
  error: null,
  knownMtimeMs: null,
  targetLine: null,
  targetEndLine: null,
  targetNonce: 0,
  searchOpen: false,
  showTree: true,
  treeWidthPx: TREE_WIDTH_DEFAULT,
  fullscreen: false,
  contentCache: new Map(),

  openFile: (
    projectRoot: string,
    relativePath: string,
    targetLine?: number,
    targetEndLine?: number
  ) => {
    const key = cacheKey(projectRoot, relativePath);
    const cached = get().contentCache.get(key);
    set(state => ({
      isOpen: true,
      filePath: relativePath,
      projectRoot,
      content: cached?.content ?? null,
      knownMtimeMs: cached?.mtimeMs ?? null,
      // Display cached content instantly when available; the panel still runs a
      // freshness check in the background so external edits are picked up.
      loading: !cached,
      error: null,
      targetLine: targetLine ?? null,
      targetEndLine: targetEndLine ?? null,
      targetNonce: state.targetNonce + 1,
      searchOpen: false,
    }));
    // Show file viewer panel in bottom panel
    usePluginStore.getState().updatePanelVisibility('file-viewer', true);
  },

  setContent: (content: string, mtimeMs?: number) => {
    const { filePath, projectRoot, contentCache } = get();
    // Default to "now" when no mtime is supplied so callers that don't track
    // mtime still produce a fresh-ish cache entry.
    const stamp = mtimeMs ?? Date.now();
    if (filePath && projectRoot) {
      const key = cacheKey(projectRoot, filePath);
      // LRU eviction: delete then re-insert to move to end
      contentCache.delete(key);
      contentCache.set(key, { content, mtimeMs: stamp });
      if (contentCache.size > CACHE_MAX) {
        const oldest = contentCache.keys().next().value;
        if (oldest !== undefined) contentCache.delete(oldest);
      }
    }
    set({ content, knownMtimeMs: stamp, loading: false });
  },

  setLoading: (loading: boolean) => set({ loading }),

  setError: (error: string | null) => set({ error, loading: false }),

  close: () => {
    set({
      isOpen: false,
      searchOpen: false,
      fullscreen: false,
      targetLine: null,
      targetEndLine: null,
    });
    // Hide file viewer panel in bottom panel
    usePluginStore.getState().updatePanelVisibility('file-viewer', false);
  },

  togglePanel: () => {
    const next = !get().isOpen;
    set({ isOpen: next });
    usePluginStore.getState().updatePanelVisibility('file-viewer', next);
  },

  setShowTree: (show: boolean) => set({ showTree: show }),

  toggleTree: () => set(state => ({ showTree: !state.showTree })),

  setTreeWidthPx: widthPx => set({ treeWidthPx: clampTreeWidth(widthPx) }),

  setSearchOpen: (open: boolean) => set({ searchOpen: open, isOpen: open ? true : undefined }),

  setFullscreen: (open: boolean) => set({ fullscreen: open }),

  getCached: (projectRoot: string, relativePath: string) =>
    get().contentCache.get(cacheKey(projectRoot, relativePath))?.content,

  invalidate: (projectRoot: string, relativePath: string) => {
    const { contentCache, filePath, projectRoot: curRoot } = get();
    contentCache.delete(cacheKey(projectRoot, relativePath));
    // If the invalidated file is the one currently displayed, drop its mtime so
    // the next staleness check treats it as unknown and forces a fresh fetch.
    const isCurrent =
      filePath === relativePath && curRoot === projectRoot && !!filePath && !!curRoot;
    set({ contentCache: new Map(contentCache), ...(isCurrent ? { knownMtimeMs: null } : {}) });
  },
}));
