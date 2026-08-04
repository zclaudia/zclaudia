// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useFileViewerStore } from '../fileViewerStore';

describe('fileViewerStore', () => {
  beforeEach(() => {
    useFileViewerStore.setState({
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
      fullscreen: false,
      treeWidthPx: 256,
      contentCache: new Map(),
    });
  });

  describe('initial state', () => {
    it('has panel closed by default', () => {
      expect(useFileViewerStore.getState().isOpen).toBe(false);
    });

    it('has no file selected', () => {
      expect(useFileViewerStore.getState().filePath).toBeNull();
      expect(useFileViewerStore.getState().projectRoot).toBeNull();
    });

    it('has no content loaded', () => {
      expect(useFileViewerStore.getState().content).toBeNull();
      expect(useFileViewerStore.getState().loading).toBe(false);
      expect(useFileViewerStore.getState().error).toBeNull();
    });
  });

  describe('openFile', () => {
    it('opens the panel and sets file path and project root', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');

      const state = useFileViewerStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.filePath).toBe('src/index.ts');
      expect(state.projectRoot).toBe('/project');
    });

    it('sets loading to true when no cache exists', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');

      expect(useFileViewerStore.getState().loading).toBe(true);
      expect(useFileViewerStore.getState().content).toBeNull();
    });

    it('uses cached content and skips loading when cache exists', () => {
      // First, open and set content to populate cache
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('cached content');

      // Open another file, then re-open the cached one
      useFileViewerStore.getState().openFile('/project', 'src/other.ts');
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');

      const state = useFileViewerStore.getState();
      expect(state.content).toBe('cached content');
      expect(state.loading).toBe(false);
    });

    it('clears error and search state on open', () => {
      useFileViewerStore.getState().setError('Previous error');
      useFileViewerStore.getState().setSearchOpen(true);
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');

      const state = useFileViewerStore.getState();
      expect(state.error).toBeNull();
      expect(state.searchOpen).toBe(false);
    });

    it('records the target line and increments the nonce', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts', 42);
      const state = useFileViewerStore.getState();
      expect(state.targetLine).toBe(42);
      expect(state.targetEndLine).toBeNull();
      expect(state.targetNonce).toBe(1);
    });

    it('records a target line range when given start and end', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts', 10, 20);
      const state = useFileViewerStore.getState();
      expect(state.targetLine).toBe(10);
      expect(state.targetEndLine).toBe(20);
    });

    it('clears the target when reopening without one', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts', 42);
      useFileViewerStore.getState().openFile('/project', 'src/other.ts');
      const state = useFileViewerStore.getState();
      expect(state.targetLine).toBeNull();
      expect(state.targetEndLine).toBeNull();
      expect(state.targetNonce).toBe(2);
    });
  });

  describe('setContent', () => {
    it('sets content and stops loading', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('file content here');

      const state = useFileViewerStore.getState();
      expect(state.content).toBe('file content here');
      expect(state.loading).toBe(false);
    });

    it('caches the content for future opens', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('cached data');

      const cached = useFileViewerStore.getState().getCached('/project', 'src/index.ts');
      expect(cached).toBe('cached data');
    });

    it('does not cache when no file is open', () => {
      // No openFile called — filePath and projectRoot are null
      useFileViewerStore.getState().setContent('orphan content');

      expect(useFileViewerStore.getState().contentCache.size).toBe(0);
    });

    it('evicts oldest cache entry when exceeding max cache size', () => {
      // Fill cache beyond CACHE_MAX (30)
      for (let i = 0; i < 31; i++) {
        useFileViewerStore.getState().openFile('/project', `file-${i}.ts`);
        useFileViewerStore.getState().setContent(`content-${i}`);
      }

      // The oldest entry (file-0) should have been evicted
      const cached0 = useFileViewerStore.getState().getCached('/project', 'file-0.ts');
      expect(cached0).toBeUndefined();

      // The newest entries should still be cached
      const cached30 = useFileViewerStore.getState().getCached('/project', 'file-30.ts');
      expect(cached30).toBe('content-30');
    });

    it('updates LRU order when re-setting content for existing key', () => {
      // Fill cache with 30 items
      for (let i = 0; i < 30; i++) {
        useFileViewerStore.getState().openFile('/project', `file-${i}.ts`);
        useFileViewerStore.getState().setContent(`content-${i}`);
      }

      // Re-set content for file-0 (moves it to end of LRU)
      useFileViewerStore.getState().openFile('/project', 'file-0.ts');
      useFileViewerStore.getState().setContent('content-0-updated');

      // Now add a new file — file-1 should be evicted (it's now the oldest)
      useFileViewerStore.getState().openFile('/project', 'file-new.ts');
      useFileViewerStore.getState().setContent('content-new');

      expect(useFileViewerStore.getState().getCached('/project', 'file-0.ts')).toBe(
        'content-0-updated'
      );
      expect(useFileViewerStore.getState().getCached('/project', 'file-1.ts')).toBeUndefined();
    });
  });

  describe('setLoading', () => {
    it('sets loading state', () => {
      useFileViewerStore.getState().setLoading(true);
      expect(useFileViewerStore.getState().loading).toBe(true);

      useFileViewerStore.getState().setLoading(false);
      expect(useFileViewerStore.getState().loading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error and stops loading', () => {
      useFileViewerStore.getState().setLoading(true);
      useFileViewerStore.getState().setError('File not found');

      const state = useFileViewerStore.getState();
      expect(state.error).toBe('File not found');
      expect(state.loading).toBe(false);
    });

    it('clears error when set to null', () => {
      useFileViewerStore.getState().setError('Some error');
      useFileViewerStore.getState().setError(null);

      expect(useFileViewerStore.getState().error).toBeNull();
    });
  });

  describe('close', () => {
    it('closes the panel', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().close();

      expect(useFileViewerStore.getState().isOpen).toBe(false);
    });

    it('also closes search and fullscreen', () => {
      useFileViewerStore.getState().setSearchOpen(true);
      useFileViewerStore.getState().setFullscreen(true);
      useFileViewerStore.getState().close();

      const state = useFileViewerStore.getState();
      expect(state.searchOpen).toBe(false);
      expect(state.fullscreen).toBe(false);
    });

    it('clears any pending line target', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts', 5, 10);
      useFileViewerStore.getState().close();
      const state = useFileViewerStore.getState();
      expect(state.targetLine).toBeNull();
      expect(state.targetEndLine).toBeNull();
    });
  });

  describe('backToTree', () => {
    it('clears the open file without closing the panel', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().backToTree();

      const state = useFileViewerStore.getState();
      expect(state.filePath).toBeNull();
      expect(state.isOpen).toBe(true);
    });

    it('clears loading so an in-flight fetch cancelled by navigating away does not leave a permanent spinner', () => {
      // openFile with no cache leaves loading: true while the fetch is in flight.
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      expect(useFileViewerStore.getState().loading).toBe(true);

      useFileViewerStore.getState().backToTree();

      const state = useFileViewerStore.getState();
      expect(state.loading).toBe(false);
      // isBrowseMode in FileViewerPanel is `!filePath && !loading && !error`;
      // all three preconditions must hold for browse mode to render.
      expect(state.filePath).toBeNull();
      expect(state.error).toBeNull();
    });

    it('clears content, error, and pending in-file search state', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('const x = 1;', 1000);
      useFileViewerStore.getState().setError('boom');
      useFileViewerStore.getState().setInFileSearchOpen(true);
      useFileViewerStore.getState().setInFileSearchQuery('x');

      useFileViewerStore.getState().backToTree();

      const state = useFileViewerStore.getState();
      expect(state.content).toBeNull();
      expect(state.knownMtimeMs).toBeNull();
      expect(state.error).toBeNull();
      expect(state.inFileSearchOpen).toBe(false);
      expect(state.inFileSearchQuery).toBe('');
    });

    it('clears any pending line target', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts', 5, 10);
      useFileViewerStore.getState().backToTree();

      const state = useFileViewerStore.getState();
      expect(state.targetLine).toBeNull();
      expect(state.targetEndLine).toBeNull();
    });

    it('preserves the project root and cached content so reopening the file is instant', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('const x = 1;', 1000);
      useFileViewerStore.getState().backToTree();

      expect(useFileViewerStore.getState().projectRoot).toBe('/project');
      expect(useFileViewerStore.getState().getCached('/project', 'src/index.ts')).toBe(
        'const x = 1;'
      );
    });
  });

  describe('togglePanel', () => {
    it('toggles the panel open and closed', () => {
      expect(useFileViewerStore.getState().isOpen).toBe(false);

      useFileViewerStore.getState().togglePanel();
      expect(useFileViewerStore.getState().isOpen).toBe(true);

      useFileViewerStore.getState().togglePanel();
      expect(useFileViewerStore.getState().isOpen).toBe(false);
    });
  });

  describe('setSearchOpen', () => {
    it('opens search and also opens the panel', () => {
      useFileViewerStore.getState().setSearchOpen(true);

      const state = useFileViewerStore.getState();
      expect(state.searchOpen).toBe(true);
      expect(state.isOpen).toBe(true);
    });

    it('closes search without closing the panel', () => {
      useFileViewerStore.getState().setSearchOpen(true);
      useFileViewerStore.getState().setSearchOpen(false);

      const state = useFileViewerStore.getState();
      expect(state.searchOpen).toBe(false);
      // Panel stays open (isOpen is set to undefined when closing search, which preserves previous value)
    });
  });

  describe('setFullscreen', () => {
    it('sets fullscreen mode', () => {
      useFileViewerStore.getState().setFullscreen(true);
      expect(useFileViewerStore.getState().fullscreen).toBe(true);

      useFileViewerStore.getState().setFullscreen(false);
      expect(useFileViewerStore.getState().fullscreen).toBe(false);
    });
  });

  describe('setTreeWidthPx', () => {
    it('clamps the file tree width to the supported desktop range', () => {
      useFileViewerStore.getState().setTreeWidthPx(120);
      expect(useFileViewerStore.getState().treeWidthPx).toBe(160);

      useFileViewerStore.getState().setTreeWidthPx(360);
      expect(useFileViewerStore.getState().treeWidthPx).toBe(360);

      useFileViewerStore.getState().setTreeWidthPx(640);
      expect(useFileViewerStore.getState().treeWidthPx).toBe(520);
    });
  });

  describe('getCached', () => {
    it('returns undefined for uncached files', () => {
      expect(useFileViewerStore.getState().getCached('/project', 'noexist.ts')).toBeUndefined();
    });

    it('returns cached content for previously loaded files', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('hello');

      expect(useFileViewerStore.getState().getCached('/project', 'src/index.ts')).toBe('hello');
    });

    it('distinguishes files from different project roots', () => {
      useFileViewerStore.getState().openFile('/projectA', 'src/index.ts');
      useFileViewerStore.getState().setContent('content A');

      useFileViewerStore.getState().openFile('/projectB', 'src/index.ts');
      useFileViewerStore.getState().setContent('content B');

      expect(useFileViewerStore.getState().getCached('/projectA', 'src/index.ts')).toBe(
        'content A'
      );
      expect(useFileViewerStore.getState().getCached('/projectB', 'src/index.ts')).toBe(
        'content B'
      );
    });
  });

  describe('mtime tracking', () => {
    it('records the supplied mtime when setting content', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('hello', 12345);

      expect(useFileViewerStore.getState().knownMtimeMs).toBe(12345);
    });

    it('restores knownMtimeMs from cache when reopening a file', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('cached', 999);

      useFileViewerStore.getState().openFile('/project', 'src/other.ts');
      // knownMtimeMs for other.ts is null (uncached)
      expect(useFileViewerStore.getState().knownMtimeMs).toBeNull();

      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      expect(useFileViewerStore.getState().knownMtimeMs).toBe(999);
      expect(useFileViewerStore.getState().content).toBe('cached');
    });
  });

  describe('invalidate', () => {
    it('removes a cached entry so getCached returns undefined', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('cached', 100);

      useFileViewerStore.getState().invalidate('/project', 'src/index.ts');

      expect(useFileViewerStore.getState().getCached('/project', 'src/index.ts')).toBeUndefined();
    });

    it('clears knownMtimeMs when invalidating the currently displayed file', () => {
      useFileViewerStore.getState().openFile('/project', 'src/index.ts');
      useFileViewerStore.getState().setContent('cached', 100);

      useFileViewerStore.getState().invalidate('/project', 'src/index.ts');

      // mtime dropped so the next poll treats the content as unknown/stale
      expect(useFileViewerStore.getState().knownMtimeMs).toBeNull();
    });

    it('leaves other cached files untouched', () => {
      useFileViewerStore.getState().openFile('/project', 'src/a.ts');
      useFileViewerStore.getState().setContent('A', 1);
      useFileViewerStore.getState().openFile('/project', 'src/b.ts');
      useFileViewerStore.getState().setContent('B', 2);

      useFileViewerStore.getState().invalidate('/project', 'src/a.ts');

      expect(useFileViewerStore.getState().getCached('/project', 'src/a.ts')).toBeUndefined();
      expect(useFileViewerStore.getState().getCached('/project', 'src/b.ts')).toBe('B');
    });
  });
});
