import {
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { Highlight, themes as prismThemes, type PrismTheme, type Token } from 'prism-react-renderer';
import { List, useListRef, type RowComponentProps, type ListImperativeAPI } from 'react-window';
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import * as api from '../../services/api';
import { FileSearchInput } from './FileSearchInput';
import { FileTree } from './FileTree';
import { MarkdownFileContent } from './MarkdownFileContent';
import { FileTypeIcon } from './fileIcons';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow, buildWindowTitle, getConnectionParams } from '../../utils/popoutWindow';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', md: 'markdown', py: 'python', rs: 'rust',
  go: 'go', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'toml',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml', svg: 'xml',
  sql: 'sql', graphql: 'graphql',
  rb: 'ruby', java: 'java', kt: 'kotlin',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', m: 'objectivec',
  lua: 'lua', r: 'r', pl: 'perl',
  dockerfile: 'docker', makefile: 'makefile',
};

function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  if (fileName === 'dockerfile') return 'docker';
  if (fileName === 'makefile') return 'makefile';
  const ext = fileName.split('.').pop() || '';
  return EXT_TO_LANG[ext] || 'text';
}

/** Splits a relative path into directory segments + filename for breadcrumb display. */
function breadcrumbSegments(relativePath: string): { dirs: string[]; file: string } {
  const parts = relativePath.split('/').filter(Boolean);
  const file = parts.pop() ?? relativePath;
  return { dirs: parts, file };
}

interface FileViewerPanelProps {
  projectRoot: string;
}

/** Row height (px) — must match lineHeight below so virtualization aligns rows. */
const ROW_HEIGHT_PX = 20;
const TREE_WIDTH_MIN = 160;
const TREE_WIDTH_MAX = 520;

type CodeRowExtraProps = {
  tokens: Token[][];
  getLineProps: (input: { line: Token[] }) => { style?: CSSProperties; className?: string };
  getTokenProps: (input: { token: Token }) => {
    style?: CSSProperties;
    className?: string;
    children?: React.ReactNode;
  };
  highlightStart: number | null;
  highlightEnd: number | null;
  lineNumberWidth: string;
};

function CodeRow({
  index,
  style,
  tokens,
  getLineProps,
  getTokenProps,
  highlightStart,
  highlightEnd,
  lineNumberWidth,
}: RowComponentProps<CodeRowExtraProps>) {
  const line = tokens[index];
  if (!line) return null;
  const lineNumber = index + 1;
  const inRange =
    highlightStart != null && highlightEnd != null
      && lineNumber >= highlightStart && lineNumber <= highlightEnd;
  const lineProps = getLineProps({ line });
  const themeBg = (lineProps.style?.backgroundColor as string | undefined) ?? undefined;
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        whiteSpace: 'pre',
        backgroundColor: inRange ? 'hsl(var(--primary) / 0.12)' : themeBg,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: lineNumberWidth,
          paddingLeft: '0.5rem',
          paddingRight: '0.75rem',
          textAlign: 'right',
          userSelect: 'none',
          opacity: 0.5,
          flexShrink: 0,
        }}
      >
        {lineNumber}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {line.map((token, key) => {
          const tokenProps = getTokenProps({ token });
          return (
            <span key={key} style={tokenProps.style} className={tokenProps.className}>
              {token.content}
            </span>
          );
        })}
      </span>
    </div>
  );
}

interface VirtualizedCodeViewProps {
  content: string;
  language: string;
  theme: PrismTheme;
  highlightStart: number | null;
  highlightEnd: number | null;
  listRef: React.RefObject<ListImperativeAPI | null>;
}

/**
 * Tokenizes once via Prism and renders only the visible rows via react-window.
 * Bounds main-thread work so even 10k-line files don't block the UI on render
 * (Prism tokenization itself is still synchronous but the DOM cost is constant).
 */
function VirtualizedCodeView({
  content,
  language,
  theme,
  highlightStart,
  highlightEnd,
  listRef,
}: VirtualizedCodeViewProps) {
  const lineCount = useMemo(() => content.split(/\r?\n/).length, [content]);
  const lineNumberWidth = `${Math.max(2, String(lineCount).length) + 2}ch`;

  return (
    <Highlight code={content} language={language} theme={theme}>
      {({ tokens, getLineProps, getTokenProps, style: themeStyle }) => (
        <List<CodeRowExtraProps>
          rowCount={tokens.length}
          rowHeight={ROW_HEIGHT_PX}
          rowComponent={CodeRow}
          rowProps={{
            tokens,
            getLineProps,
            getTokenProps,
            highlightStart,
            highlightEnd,
            lineNumberWidth,
          }}
          listRef={listRef}
          style={{
            ...themeStyle,
            height: '100%',
            width: '100%',
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            lineHeight: `${ROW_HEIGHT_PX}px`,
          }}
          data-testid="code-viewer"
        />
      )}
    </Highlight>
  );
}

function resolveProjectBackendId(projectRoot: string): string | null {
  const projects = useProjectStore.getState().projects;
  const matchingProject = projects.find((project) => project.rootPath === projectRoot);
  if (!matchingProject) return null;
  return useOwnershipStore.getState().getProjectBackendId(matchingProject.id);
}

async function openFileInNewWindow(filePath: string, projectRoot: string) {
  const fileName = filePath.split('/').pop() || filePath;
  const projectName = projectRoot.split('/').pop() || projectRoot;
  const backendId = resolveProjectBackendId(projectRoot);
  const conn = getConnectionParams({ backendId });
  await openPopoutWindow({
    type: 'file-viewer',
    params: { fileViewer: filePath, projectRoot },
    title: buildWindowTitle(fileName, conn.serverName, projectName),
    width: 800,
    height: 600,
    dragDropEnabled: true,
    connectionTarget: { backendId },
  });
}

/** File viewer toolbar actions (search, copy, open in new window / fullscreen) rendered in the shared BottomPanel header */
export function FileViewerActions() {
  const isMobile = useIsMobile();
  const {
    searchOpen,
    setSearchOpen,
    content,
    filePath,
    projectRoot,
    setFullscreen,
    showTree,
    toggleTree,
  } = useFileViewerStore();
  const showFileTree = isMobile ? !filePath : showTree;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpand = () => {
    if (!filePath) return;
    if (isDesktopTauri() && projectRoot) {
      openFileInNewWindow(filePath, projectRoot);
    } else {
      setFullscreen(true);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {filePath && !isMobile && (
        <button
          type="button"
          onClick={toggleTree}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            showFileTree ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          title={showFileTree ? 'Hide file tree' : 'Show file tree'}
          aria-label={showFileTree ? 'Hide file tree' : 'Show file tree'}
        >
          {showFileTree ? <PanelLeftClose className="w-3.5 h-3.5" aria-hidden="true" /> : <PanelLeftOpen className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      )}
      <button
        onClick={() => setSearchOpen(!searchOpen)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
          searchOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
        } hover:bg-secondary`}
        title="Search files (Cmd+P)"
        aria-label="Search files"
      >
        <Search className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {content && (
        <button
          onClick={handleCopy}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            copied ? 'text-green-500' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          title={copied ? 'Copied!' : 'Copy file content'}
          aria-label={copied ? 'Copied file content' : 'Copy file content'}
        >
          {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      )}
      {filePath && !isMobile && (
        <button
          onClick={handleExpand}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground flex-shrink-0"
          title={isDesktopTauri() ? 'Open in new window' : 'Fullscreen'}
          aria-label={isDesktopTauri() ? 'Open in new window' : 'Fullscreen'}
        >
          {isDesktopTauri() ? <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

/** File viewer content (renders inside the shared BottomPanel) */
export function FileViewerPanel({ projectRoot }: FileViewerPanelProps) {
  const isMobile = useIsMobile();
  const store = useFileViewerStore();
  const {
    loading, searchOpen,
    targetLine, targetEndLine, targetNonce,
    openFile, setContent, setError, setSearchOpen, showTree, treeWidthPx, setTreeWidthPx,
  } = store;
  const treeResizeCleanupRef = useRef<(() => void) | null>(null);
  // Guard: when the store still holds state pointing at a different project
  // (e.g. user just switched session/project), treat the viewer as if no file
  // is selected. SessionChatLayout's effect will close()/reset the store
  // shortly; this prevents rendering stale content during the transition.
  // `error` is gated the same way: close() does not clear it, so an unrelated
  // error must not leak into the new project's panel and force read mode.
  const projectMatches = !store.projectRoot || store.projectRoot === projectRoot;
  const filePath = projectMatches ? store.filePath : null;
  const content = projectMatches ? store.content : null;
  const error = projectMatches ? store.error : null;
  const fileBackendId = resolveProjectBackendId(projectRoot);
  const listRef = useListRef(null);

  const { resolvedTheme } = useTheme();

  // Fetch file content when filePath changes (skip if already cached)
  useEffect(() => {
    if (!filePath || !projectRoot) return;
    // openFile() already populated content from cache — skip fetch
    if (useFileViewerStore.getState().content) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await api.getFileContent({ projectRoot, relativePath: filePath, backendId: fileBackendId });
        if (!cancelled) setContent(result.content);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      }
    })();

    return () => { cancelled = true; };
  }, [fileBackendId, filePath, projectRoot, setContent, setError]);

  const handleSearchSelect = (relativePath: string) => {
    openFile(projectRoot, relativePath);
  };

  const lang = filePath ? detectLanguage(filePath) : 'text';
  const codeTheme = isDarkTheme(resolvedTheme) ? prismThemes.oneDark : prismThemes.oneLight;
  const isMarkdown = lang === 'markdown';
  const headerIcon = filePath ? (
    <FileTypeIcon
      name={filePath.split('/').pop() ?? filePath}
      className="flex w-3.5 h-3.5 flex-shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5"
    />
  ) : (
    <FileText className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/70" aria-hidden="true" />
  );
  const highlightStart = targetLine ?? null;
  const highlightEnd = targetEndLine ?? targetLine ?? null;
  const showFileTree = isMobile ? !filePath : showTree;
  const contentLayoutClass = isMobile
    ? (showFileTree ? 'flex flex-col' : 'block')
    : 'flex';

  useEffect(() => () => treeResizeCleanupRef.current?.(), []);

  const beginTreeResize = useCallback((event: ReactMouseEvent | ReactTouchEvent) => {
    if (isMobile) return;
    const startX = 'touches' in event ? event.touches[0]?.clientX : event.clientX;
    if (typeof startX !== 'number') return;
    event.preventDefault();
    treeResizeCleanupRef.current?.();

    const startWidth = treeWidthPx;
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in moveEvent ? moveEvent.touches[0]?.clientX : moveEvent.clientX;
      if (typeof clientX !== 'number') return;
      moveEvent.preventDefault();
      setTreeWidthPx(startWidth + clientX - startX);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
      treeResizeCleanupRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', cleanup);
    window.addEventListener('touchcancel', cleanup);
    treeResizeCleanupRef.current = cleanup;
  }, [isMobile, setTreeWidthPx, treeWidthPx]);

  // Scroll the virtualized list to the target line when one is set / changed.
  useEffect(() => {
    if (!highlightStart || isMarkdown) return;
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
  }, [highlightStart, content, loading, isMarkdown, targetNonce, listRef]);

  const isBrowseMode = !filePath && !loading && !error;

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
            {headerIcon}
            {filePath && (() => {
              const { dirs, file } = breadcrumbSegments(filePath);
              return (
                <span
                  className="flex min-w-0 items-center gap-1 text-xs font-mono truncate"
                  title={filePath}
                >
                  {dirs.map((dir, i) => (
                    <span key={i} className="flex items-center gap-1 text-muted-foreground/80">
                      <span className="truncate">{dir}</span>
                      <span aria-hidden="true" className="text-muted-foreground/40">/</span>
                    </span>
                  ))}
                  <span className="truncate text-foreground">{file}</span>
                </span>
              );
            })()}
          </div>

          {searchOpen && (
            <FileSearchInput
              projectRoot={projectRoot}
              backendId={fileBackendId}
              onSelect={handleSearchSelect}
              onClose={() => setSearchOpen(false)}
            />
          )}

          <div className={`flex-1 min-h-0 overflow-hidden ${contentLayoutClass}`}>
            {showFileTree && (
              <>
                <div
                  data-testid="file-tree-pane"
                  className={isMobile ? 'h-2/5 min-h-[180px] flex-shrink-0 border-b border-border' : 'flex-shrink-0 border-r border-border'}
                  style={isMobile ? undefined : { width: `${treeWidthPx}px` }}
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
                    aria-valuenow={treeWidthPx}
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
              {content && !loading && (
                isMarkdown ? (
                  <div className="h-full overflow-auto">
                    <MarkdownFileContent content={content} />
                  </div>
                ) : (
                  <VirtualizedCodeView
                    content={content}
                    language={lang}
                    theme={codeTheme}
                    highlightStart={highlightStart}
                    highlightEnd={highlightEnd}
                    listRef={listRef}
                  />
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
