import { useState, useEffect, useRef } from 'react';
import { Code } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { WindowContextBar } from '../window/WindowContextBar';
import * as api from '../../services/api';
import { MarkdownFileContent } from './MarkdownFileContent';

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  m: 'objectivec',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  dockerfile: 'docker',
  makefile: 'makefile',
};

function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  if (fileName === 'dockerfile') return 'docker';
  if (fileName === 'makefile') return 'makefile';
  const ext = fileName.split('.').pop() || '';
  return EXT_TO_LANG[ext] || 'text';
}

/** Poll interval for detecting external file changes in the standalone window. */
const FILE_POLL_INTERVAL_MS = 5000;

interface FileViewerWindowProps {
  filePath: string;
  projectRoot: string;
  onClose?: () => void; // When provided, shows a back/close button (e.g. mobile fullscreen overlay)
  /** When rendered in a standalone window, pass the server URL to fetch directly */
  serverUrl?: string;
  authToken?: string;
  serverName?: string;
}

/** Standalone file viewer rendered in a separate Tauri window or fullscreen overlay */
export function FileViewerWindow({
  filePath,
  projectRoot,
  onClose,
  serverUrl,
  authToken,
  serverName,
}: FileViewerWindowProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Markdown only: show raw source instead of the rendered preview.
  const [markdownSourceView, setMarkdownSourceView] = useState(false);
  const { resolvedTheme } = useTheme();

  // Mirror `content` into a ref so the polling closure can read the latest
  // value without re-subscribing on every content change.
  const contentRef = useRef<string | null>(null);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  // mtime of the currently displayed content; null until the first successful load.
  const knownMtimeRef = useRef<number | null>(null);
  // Prevents overlapping poll ticks from issuing duplicate requests.
  const pollInFlightRef = useRef(false);

  // Build request headers/query helpers for the active transport (direct
  // serverUrl fetch vs. the api layer backed by ConnectionProvider).
  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = authToken;
    return headers;
  };
  const fileQuery = () => new URLSearchParams({ projectRoot, relativePath: filePath });

  const fetchStat = async (): Promise<number> => {
    if (serverUrl) {
      const resp = await fetch(`${serverUrl}/api/files/stat?${fileQuery()}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to stat file');
      return json.data.mtimeMs as number;
    }
    const stat = await api.getFileStat({ projectRoot, relativePath: filePath });
    return stat.mtimeMs;
  };

  const fetchContent = async (): Promise<string> => {
    if (serverUrl) {
      const resp = await fetch(`${serverUrl}/api/files/content?${fileQuery()}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to load file');
      return json.data.content as string;
    }
    const result = await api.getFileContent({ projectRoot, relativePath: filePath });
    return result.content;
  };

  // Initial load + freshness poll. Stat first; only re-fetch content when the
  // mtime advanced. Picks up external edits (editor, git, agent) while the
  // window is open.
  useEffect(() => {
    let cancelled = false;

    const checkOnce = async () => {
      if (cancelled || pollInFlightRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      pollInFlightRef.current = true;
      try {
        const hasContent = contentRef.current != null;

        let mtime: number;
        try {
          mtime = await fetchStat();
        } catch (e) {
          if (!hasContent && !cancelled) {
            setError(e instanceof Error ? e.message : 'Failed to load file');
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        if (hasContent && knownMtimeRef.current != null && mtime <= knownMtimeRef.current) return;

        const fileContent = await fetchContent();
        if (cancelled) return;
        knownMtimeRef.current = mtime;
        setContent(fileContent);
        setLoading(false);
        setError(null);
      } catch (e) {
        if (!cancelled && contentRef.current == null) {
          setError(e instanceof Error ? e.message : 'Failed to load file');
          setLoading(false);
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    // Reset transient state for a new target file, then load + poll. The
    // synchronous resets are intentional: when filePath/projectRoot change we
    // must flip back to "loading" before the (async) first fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    knownMtimeRef.current = null;
    void checkOnce();
    const intervalId = window.setInterval(() => void checkOnce(), FILE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, projectRoot, serverUrl, authToken]);

  const lang = detectLanguage(filePath);
  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;
  const isMarkdown = lang === 'markdown';

  const projectName = projectRoot.split('/').pop() || projectRoot;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {serverName && <WindowContextBar serverName={serverName} projectId={projectName} />}
      {/* File path header */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border flex-shrink-0 bg-card"
        data-tauri-drag-region
      >
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 -ml-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        )}
        <svg
          className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span className="text-xs font-mono text-muted-foreground truncate" title={filePath}>
          {filePath}
        </span>
        {isMarkdown && content && (
          <button
            onClick={() => setMarkdownSourceView(v => !v)}
            className={`ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
              markdownSourceView
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            } hover:bg-secondary`}
            title={markdownSourceView ? 'Show rendered preview' : 'Show markdown source'}
            aria-label={markdownSourceView ? 'Show rendered preview' : 'Show markdown source'}
            aria-pressed={markdownSourceView}
          >
            <Code className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
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
          (isMarkdown && !markdownSourceView ? (
            <MarkdownFileContent content={content} />
          ) : (
            <SyntaxHighlighter
              style={codeStyle}
              language={lang}
              showLineNumbers
              PreTag="div"
              customStyle={{
                margin: 0,
                borderRadius: 0,
                padding: '0.5rem 0',
                fontSize: '0.8rem',
                lineHeight: '1.4rem',
              }}
              lineNumberStyle={{
                minWidth: '3.5em',
                paddingRight: '1em',
                textAlign: 'right',
                userSelect: 'none',
                opacity: 0.5,
              }}
            >
              {content}
            </SyntaxHighlighter>
          ))}
      </div>
    </div>
  );
}
