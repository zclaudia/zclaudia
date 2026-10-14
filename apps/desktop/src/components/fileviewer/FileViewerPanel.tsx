import { useLayoutEffect, useRef, useState, useEffect, useMemo } from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useWorkspaceTool } from '../workspace/WorkspaceToolContext';
import { themes as prismThemes } from 'prism-react-renderer';
import { useListRef } from 'react-window';
import { ChevronLeft, FileText } from 'lucide-react';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { IconButton } from '../ui/Button';
import { FileSearchInput } from './FileSearchInput';
import { FileContentSearchInput } from './FileContentSearchInput';
import { FileTree } from './FileTree';
import { MarkdownFileContent } from './MarkdownFileContent';
import { FileSymbol } from '../filesymbols';
import { matchesByLine, findContentMatches, type ContentMatch } from './contentSearch';
import { FileDiagnosticsSummary } from './FileDiagnostics';
import { diagnosticsByLine } from './fileDiagnosticsModel';
import { useFileDiagnostics } from './useFileDiagnostics';
import { useWorkspaceVisible } from '../workspace/WorkspaceContext';
import { detectLanguage } from './detectLanguage';
import { VirtualizedCodeView } from './VirtualizedCodeView';
import { useFileContentPolling } from './useFileContentPolling';
import { usePanelWidth, useResizableTree } from './useResizableTree';
import { resolveProjectBackendId } from './FileViewerActions';

// FileViewerActions lives in its own file now; keep this path working for
// existing consumers (builtinPanels renders it in the shared BottomPanel header).
export { FileViewerActions } from './FileViewerActions';

/** Splits a relative path into directory segments + filename for breadcrumb display. */
function breadcrumbSegments(relativePath: string): { dirs: string[]; file: string } {
  const parts = relativePath.split('/').filter(Boolean);
  const file = parts.pop() ?? relativePath;
  return { dirs: parts, file };
}

interface FileViewerPanelProps {
  projectRoot: string;
}

const TREE_WIDTH_MIN = 160;
/** The code keeps at least this much width beside the tree. */
const CODE_WIDTH_MIN = 320;
const TREE_WIDTH_MAX = 520;

export function FileViewerPanel({ projectRoot }: FileViewerPanelProps) {
  const visible = useWorkspaceVisible();
  const tool = useWorkspaceTool();
  const isMobile = useIsMobile();
  const store = useFileViewerStore();
  const {
    loading,
    searchOpen,
    inFileSearchOpen,
    inFileSearchQuery,
    inFileSearchCaseSensitive,
    targetLine,
    targetEndLine,
    targetNonce,
    openFile,
    setContent,
    setError,
    setSearchOpen,
    setInFileSearchOpen,
    setInFileSearchQuery,
    toggleInFileSearchCaseSensitive,
    showTree,
    treeWidthPx,
    setTreeWidthPx,
    backToTree,
    markdownSourceView,
  } = store;
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = usePanelWidth(panelRef);
  // Too narrow for the tree (at its minimum) beside usable code: one at a time.
  const compactLayout =
    !isMobile && panelWidth !== null && panelWidth < TREE_WIDTH_MIN + CODE_WIDTH_MIN;
  const compact = isMobile || compactLayout;
  const setCompactLayout = useFileViewerStore(s => s.setCompactLayout);
  // Layout phase: FileViewerActions builds the shared BottomPanel header from
  // this store value, so it needs it before first paint or the tree toggle
  // flickers for one frame when the panel opens or is resized.
  useLayoutEffect(() => setCompactLayout(compactLayout), [compactLayout, setCompactLayout]);
  // Guard: when the store still holds state pointing at a different project
  // (e.g. user just switched session/project), treat the viewer as if no file
  // is selected. SessionChatLayout's effect will close()/reset the store
  // shortly; this prevents rendering stale content during the transition.
  // `error` is gated the same way: close() does not clear it, so an unrelated
  // error must not leak into the new project's panel and force read mode.
  const projectMatches =
    (!store.projectRoot || store.projectRoot === projectRoot) &&
    (!tool?.backendId || !store.backendId || tool.backendId === store.backendId);
  const filePath = projectMatches ? store.filePath : null;
  const content = projectMatches ? store.content : null;
  const error = projectMatches ? store.error : null;
  const fileBackendId = tool?.backendId ?? store.backendId ?? resolveProjectBackendId(projectRoot);
  const listRef = useListRef(null);
  const fileDiagnostics = useFileDiagnostics({
    projectRoot,
    filePath,
    backendId: fileBackendId,
    version: projectMatches ? store.knownMtimeMs : null,
  });
  const diagnosticLines = useMemo(
    () => diagnosticsByLine(fileDiagnostics.diagnostics),
    [fileDiagnostics.diagnostics]
  );
  const diagnosticGutter =
    fileDiagnostics.state !== 'unavailable' && fileDiagnostics.state !== 'loading';

  const [activeMatch, setActiveMatch] = useState<ContentMatch | null>(null);

  const { resolvedTheme } = useTheme();

  useFileContentPolling({
    filePath,
    projectRoot,
    backendId: fileBackendId,
    visible,
    setContent,
    setError,
  });

  const handleSearchSelect = (relativePath: string) => {
    if (fileBackendId) openFile(projectRoot, relativePath, undefined, undefined, fileBackendId);
    else openFile(projectRoot, relativePath);
  };

  const lang = filePath ? detectLanguage(filePath) : 'text';
  const codeTheme = isDarkTheme(resolvedTheme) ? prismThemes.oneDark : prismThemes.oneLight;
  const isMarkdown = lang === 'markdown';
  // Markdown renders as a preview by default; the toolbar toggle switches to
  // the raw source, which reuses the virtualized code view (line numbers,
  // line-based search & scroll-to-line all behave like any other code file).
  const showMarkdownPreview = isMarkdown && !markdownSourceView;

  // In-file search state derived from the store. We keep the active match in a
  // local state so the panel can scroll the virtualized list to it.
  const matches = useMemo(() => {
    if (!content || !inFileSearchOpen) return [];
    return findContentMatches(content, inFileSearchQuery, inFileSearchCaseSensitive);
  }, [content, inFileSearchOpen, inFileSearchQuery, inFileSearchCaseSensitive]);
  const matchesByLineMap = useMemo(() => matchesByLine(matches), [matches]);
  const activeMatchLine = activeMatch?.line ?? null;
  const activeMatchColumn = activeMatch?.start ?? 0;
  // Index of the active match within the full match list, used by the markdown
  // renderer's DOM-based highlighter to pick the active match.
  const activeMatchIndex = useMemo(() => {
    if (!activeMatch) return 0;
    const idx = matches.findIndex(
      m => m.line === activeMatch.line && m.start === activeMatch.start && m.end === activeMatch.end
    );
    return idx < 0 ? 0 : idx;
  }, [activeMatch, matches]);

  // Scroll the virtualized list to the active match line whenever it changes.
  useEffect(() => {
    if (!activeMatch || showMarkdownPreview) return;
    if (loading || !content) return;
    const id = window.setTimeout(() => {
      try {
        listRef.current?.scrollToRow({
          index: Math.max(0, activeMatch.line - 1),
          align: 'center',
          behavior: 'auto',
        });
      } catch {
        // Ignore out-of-range transitions.
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeMatch, content, loading, showMarkdownPreview, listRef]);

  // Keyboard shortcut: Cmd/Ctrl+F opens in-file search, Escape closes it.
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (content) setInFileSearchOpen(true);
      }
      if (e.key === 'Escape' && inFileSearchOpen) {
        e.preventDefault();
        setInFileSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, inFileSearchOpen, setInFileSearchOpen, visible]);

  const headerIcon = filePath ? (
    <FileSymbol
      name={filePath.split('/').pop() ?? filePath}
      className="flex w-3.5 h-3.5 flex-shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5"
    />
  ) : (
    <FileText className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/70" aria-hidden="true" />
  );
  const highlightStart = targetLine ?? null;
  const highlightEnd = targetEndLine ?? targetLine ?? null;
  const showFileTree = compact ? !filePath : showTree;
  const contentLayoutClass = isMobile ? (showFileTree ? 'flex flex-col' : 'block') : 'flex';
  // The tree never squeezes the code below CODE_WIDTH_MIN; the user's width
  // comes back when the panel is wide enough again.
  const treeWidth =
    panelWidth === null
      ? treeWidthPx
      : Math.max(TREE_WIDTH_MIN, Math.min(treeWidthPx, panelWidth - CODE_WIDTH_MIN));

  const beginTreeResize = useResizableTree({ isMobile, treeWidth, setTreeWidthPx });

  // Scroll the virtualized list to the target line when one is set / changed.
  useEffect(() => {
    if (!highlightStart || showMarkdownPreview) return;
    if (loading || !content) return;
    // Defer one tick so Highlight has already produced tokens by the time
    // the list responds to scrollToRow.
    const id = window.setTimeout(() => {
      try {
        listRef.current?.scrollToRow({
          index: Math.max(0, highlightStart - 1),
          align: 'center',
          behavior: 'auto',
        });
      } catch {
        // Out-of-range can happen during transitions; ignore safely.
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [highlightStart, content, loading, showMarkdownPreview, targetNonce, listRef]);

  const isBrowseMode = !filePath && !loading && !error;

  return (
    <div ref={panelRef} className="flex flex-col h-full overflow-hidden">
      {isBrowseMode ? (
        <>
          {/* Browse: search field is the toolbar, tree fills the panel */}
          <FileSearchInput
            projectRoot={projectRoot}
            backendId={fileBackendId}
            onSelect={handleSearchSelect}
            onClose={() => setSearchOpen(false)}
          />
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileTree
              projectRoot={projectRoot}
              backendId={fileBackendId}
              selectedPath={filePath}
              onOpenFile={handleSearchSelect}
            />
          </div>
        </>
      ) : (
        <>
          {/* Read: breadcrumb toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background/95 flex-shrink-0 min-w-0">
            {compact && filePath && (
              <IconButton
                size="sm"
                onClick={backToTree}
                aria-label="Back to file tree"
                className="-ml-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
              </IconButton>
            )}
            {headerIcon}
            {filePath &&
              (() => {
                const { dirs, file } = breadcrumbSegments(filePath);
                return (
                  <span
                    className="flex min-w-0 items-center gap-1 text-xs truncate"
                    title={filePath}
                  >
                    {dirs.map((dir, i) => (
                      <span key={i} className="flex items-center gap-1 text-muted-foreground/80">
                        <span className="truncate">{dir}</span>
                        <span aria-hidden="true" className="text-muted-foreground/40">
                          /
                        </span>
                      </span>
                    ))}
                    <span className="truncate text-foreground">{file}</span>
                  </span>
                );
              })()}
            {filePath && content && !showMarkdownPreview && (
              <span className="ml-auto flex flex-shrink-0 items-center">
                <FileDiagnosticsSummary
                  result={fileDiagnostics}
                  onJump={line =>
                    fileBackendId
                      ? openFile(projectRoot, filePath, line, undefined, fileBackendId)
                      : openFile(projectRoot, filePath, line)
                  }
                />
              </span>
            )}
          </div>

          {searchOpen && (
            <FileSearchInput
              projectRoot={projectRoot}
              backendId={fileBackendId}
              onSelect={handleSearchSelect}
              onClose={() => setSearchOpen(false)}
            />
          )}

          {inFileSearchOpen && content && (
            <FileContentSearchInput
              content={content}
              query={inFileSearchQuery}
              caseSensitive={inFileSearchCaseSensitive}
              onQueryChange={setInFileSearchQuery}
              onToggleCaseSensitive={toggleInFileSearchCaseSensitive}
              onSelectMatch={setActiveMatch}
              onClose={() => setInFileSearchOpen(false)}
            />
          )}

          <div className={`flex-1 min-h-0 overflow-hidden ${contentLayoutClass}`}>
            {showFileTree && (
              <>
                <div
                  data-testid="file-tree-pane"
                  className={
                    isMobile
                      ? 'h-2/5 min-h-[180px] flex-shrink-0 border-b border-border'
                      : 'flex-shrink-0 border-r border-border'
                  }
                  style={isMobile ? undefined : { width: `${treeWidth}px` }}
                >
                  <FileTree
                    projectRoot={projectRoot}
                    backendId={fileBackendId}
                    selectedPath={filePath}
                    onOpenFile={handleSearchSelect}
                  />
                </div>
                {!isMobile && (
                  <div
                    role="separator"
                    aria-label="Resize file tree"
                    aria-orientation="vertical"
                    aria-valuemin={TREE_WIDTH_MIN}
                    aria-valuemax={TREE_WIDTH_MAX}
                    aria-valuenow={treeWidth}
                    className="-ml-px h-full w-2 flex-shrink-0 cursor-col-resize touch-none border-l border-transparent transition-colors hover:border-border hover:bg-muted/60"
                    onMouseDown={beginTreeResize}
                    onTouchStart={beginTreeResize}
                  />
                )}
              </>
            )}
            <div className="flex-1 min-h-0 min-w-0 h-full overflow-hidden">
              {loading && (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Loading...
                </div>
              )}
              {error && (
                <div className="flex items-center justify-center h-full text-destructive text-sm px-4 text-center">
                  {error}
                </div>
              )}
              {content &&
                !loading &&
                (showMarkdownPreview ? (
                  <div className="h-full overflow-auto">
                    <MarkdownFileContent
                      content={content}
                      highlightQuery={inFileSearchOpen ? inFileSearchQuery : undefined}
                      highlightCaseSensitive={inFileSearchCaseSensitive}
                      highlightActiveIndex={activeMatchIndex}
                    />
                  </div>
                ) : (
                  <VirtualizedCodeView
                    content={content}
                    language={lang}
                    theme={codeTheme}
                    highlightStart={highlightStart}
                    highlightEnd={highlightEnd}
                    listRef={listRef}
                    matchesByLine={matchesByLineMap}
                    activeMatchLine={activeMatchLine}
                    activeMatchColumn={activeMatchColumn}
                    diagnosticLines={diagnosticLines}
                    diagnosticGutter={diagnosticGutter}
                  />
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
