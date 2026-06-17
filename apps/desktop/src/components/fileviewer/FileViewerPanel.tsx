import { createElement, useState, useEffect, useMemo, type CSSProperties } from 'react';
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
import { iconForFile } from './fileIcons';
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

interface FileViewerPanelProps {
  projectRoot: string;
}

/** Row height (px) — must match lineHeight below so virtualization aligns rows. */
const ROW_HEIGHT_PX = 20;

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
        backgroundColor: inRange ? 'rgba(250, 204, 21, 0.2)' : themeBg,
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
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
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
  } = useFileViewerStore();
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
      <button
        onClick={() => setSearchOpen(!searchOpen)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
          searchOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
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
    loading, error, searchOpen,
    targetLine, targetEndLine, targetNonce,
    openFile, setContent, setError, setSearchOpen, showTree, toggleTree,
  } = store;
  // Guard: when the store still holds state pointing at a different project
  // (e.g. user just switched session/project), treat the viewer as if no file
  // is selected. SessionChatLayout's effect will close()/reset the store
  // shortly; this prevents rendering stale content during the transition.
  const projectMatches = !store.projectRoot || store.projectRoot === projectRoot;
  const filePath = projectMatches ? store.filePath : null;
  const content = projectMatches ? store.content : null;
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
  const headerIcon = createElement(filePath ? iconForFile(filePath) : FileText, {
    className: `w-3.5 h-3.5 flex-shrink-0 ${filePath ? 'text-muted-foreground' : 'text-muted-foreground/70'}`,
    'aria-hidden': true,
  });
  const highlightStart = targetLine ?? null;
  const highlightEnd = targetEndLine ?? targetLine ?? null;
  const showFileTree = isMobile ? !filePath : showTree;
  const contentLayoutClass = isMobile
    ? (showFileTree ? 'flex flex-col' : 'block')
    : 'flex';

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* File path indicator */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background/95 flex-shrink-0 min-w-0">
        {headerIcon}
        <span className={`text-xs font-mono truncate ${filePath ? 'text-foreground' : 'text-muted-foreground'}`} title={filePath || ''}>
          {filePath || 'No file selected'}
        </span>
        {filePath && (
          <span className="hidden sm:inline text-[11px] text-muted-foreground truncate">
            {projectRoot}
          </span>
        )}
        {!isMobile && (
          <button
            type="button"
            onClick={toggleTree}
            className={`ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0 transition-colors ${
              showFileTree ? 'text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
            title={showFileTree ? 'Hide file tree' : 'Show file tree'}
            aria-label={showFileTree ? 'Hide file tree' : 'Show file tree'}
          >
            {showFileTree ? <PanelLeftClose className="w-3.5 h-3.5" aria-hidden="true" /> : <PanelLeftOpen className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        )}
      </div>

      {/* Search input */}
      {searchOpen && (
        <FileSearchInput
          projectRoot={projectRoot}
          backendId={fileBackendId}
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Content area */}
      <div className={`flex-1 min-h-0 overflow-hidden ${contentLayoutClass}`}>
        {showFileTree && (
          <div className={isMobile ? 'h-2/5 min-h-[180px] flex-shrink-0' : 'w-64 flex-shrink-0'}>
            <FileTree
              projectRoot={projectRoot}
              backendId={fileBackendId}
              selectedPath={filePath}
              onOpenFile={handleSearchSelect}
            />
          </div>
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
          {!filePath && !loading && !searchOpen && (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div className="flex max-w-sm flex-col items-center gap-3 text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
                  <FileText className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">Select a file to preview</div>
                  <div className="text-xs leading-5">
                    Click a <span className="font-mono text-primary">@file</span> reference, browse the file tree, or press <span className="font-mono text-foreground">Cmd P</span> to search.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
