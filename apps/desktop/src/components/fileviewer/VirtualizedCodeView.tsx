import { useMemo, type CSSProperties } from 'react';
import { Highlight, type PrismTheme, type Token } from 'prism-react-renderer';
import { List, type RowComponentProps, type ListImperativeAPI } from 'react-window';
import { DiagnosticMarker } from './FileDiagnostics';
import { diagnosticLineTint, type LineDiagnostics } from './fileDiagnosticsModel';

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
  activeMatchLine: number | null;
  activeMatchColumn: number;
  matchesByLine: Map<number, { start: number; end: number }[]>;
  diagnosticLines: Map<number, LineDiagnostics>;
  /** Reserve the marker column (a language server covers this file). */
  diagnosticGutter: boolean;
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
  activeMatchLine,
  activeMatchColumn,
  matchesByLine,
  diagnosticLines,
  diagnosticGutter,
}: RowComponentProps<CodeRowExtraProps>) {
  const line = tokens[index];
  if (!line) return null;
  const lineNumber = index + 1;
  const inRange =
    highlightStart != null &&
    highlightEnd != null &&
    lineNumber >= highlightStart &&
    lineNumber <= highlightEnd;
  const isActiveMatchLine = activeMatchLine != null && activeMatchLine === lineNumber;
  const lineProps = getLineProps({ line });
  const themeBg = (lineProps.style?.backgroundColor as string | undefined) ?? undefined;
  const matchRanges = matchesByLine.get(lineNumber) ?? [];
  const lineDiagnostics = diagnosticLines.get(lineNumber);
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        whiteSpace: 'pre',
        backgroundColor: isActiveMatchLine
          ? 'hsl(var(--primary) / 0.16)'
          : inRange
            ? 'hsl(var(--primary) / 0.12)'
            : lineDiagnostics
              ? diagnosticLineTint(lineDiagnostics.severity)
              : themeBg,
      }}
    >
      {diagnosticGutter && (
        <span style={{ display: 'inline-flex', width: '0.75rem', flexShrink: 0 }}>
          {lineDiagnostics && <DiagnosticMarker line={lineNumber} entry={lineDiagnostics} />}
        </span>
      )}
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
        {
          line.reduce<{
            nodes: React.ReactNode[];
            column: number;
          }>(
            (acc, token, key) => {
              const tokenProps = getTokenProps({ token });
              const text = String(tokenProps.children ?? '');
              acc.nodes.push(
                renderTokenWithMatches(tokenProps, matchRanges, key, activeMatchColumn, acc.column)
              );
              acc.column += text.length;
              return acc;
            },
            { nodes: [], column: 0 }
          ).nodes
        }
      </span>
    </div>
  );
}

/** Split a token's text into spans, highlighting matched ranges.
 *  The token starts at `tokenColumn` on the current line. */
function renderTokenWithMatches(
  tokenProps: { style?: CSSProperties; className?: string; children?: React.ReactNode },
  matchRanges: { start: number; end: number }[],
  tokenKey: number,
  activeMatchColumn: number,
  tokenColumn: number
) {
  if (matchRanges.length === 0) {
    return (
      <span key={tokenKey} style={tokenProps.style} className={tokenProps.className}>
        {tokenProps.children}
      </span>
    );
  }

  const text = String(tokenProps.children ?? '');
  const tokenEnd = tokenColumn + text.length;
  const tokenRanges = matchRanges.filter(r => r.end > tokenColumn && r.start < tokenEnd);

  if (tokenRanges.length === 0) {
    return (
      <span key={tokenKey} style={tokenProps.style} className={tokenProps.className}>
        {tokenProps.children}
      </span>
    );
  }

  const spans: React.ReactNode[] = [];
  let cursor = 0;
  let rangeIndex = 0;
  let spanKey = 0;

  while (cursor < text.length && rangeIndex < tokenRanges.length) {
    const range = tokenRanges[rangeIndex];
    const localStart = Math.max(0, range.start - tokenColumn);
    const localEnd = Math.min(text.length, range.end - tokenColumn);

    if (localEnd <= cursor) {
      rangeIndex++;
      continue;
    }
    if (localStart > cursor) {
      spans.push(
        <span
          key={`${tokenKey}-${spanKey}`}
          style={tokenProps.style}
          className={tokenProps.className}
        >
          {text.slice(cursor, localStart)}
        </span>
      );
      spanKey++;
      cursor = localStart;
    }

    const start = Math.max(cursor, localStart);
    const end = Math.min(text.length, localEnd);
    const isActive = activeMatchColumn >= range.start && activeMatchColumn < range.end;
    spans.push(
      <mark
        key={`${tokenKey}-${spanKey}`}
        style={{
          ...tokenProps.style,
          backgroundColor: isActive ? 'hsl(var(--primary) / 0.45)' : 'hsl(var(--primary) / 0.25)',
          color: 'inherit',
        }}
        className={tokenProps.className}
      >
        {text.slice(start, end)}
      </mark>
    );
    spanKey++;
    cursor = end;
    if (cursor >= localEnd) rangeIndex++;
  }

  if (cursor < text.length) {
    spans.push(
      <span
        key={`${tokenKey}-${spanKey}`}
        style={tokenProps.style}
        className={tokenProps.className}
      >
        {text.slice(cursor)}
      </span>
    );
  }

  return spans;
}

interface VirtualizedCodeViewProps {
  content: string;
  language: string;
  theme: PrismTheme;
  highlightStart: number | null;
  highlightEnd: number | null;
  listRef: React.RefObject<ListImperativeAPI | null>;
  matchesByLine: Map<number, { start: number; end: number }[]>;
  activeMatchLine: number | null;
  activeMatchColumn: number;
  diagnosticLines: Map<number, LineDiagnostics>;
  diagnosticGutter: boolean;
}

/**
 * Tokenizes once via Prism and renders only the visible rows via react-window.
 * Bounds main-thread work so even 10k-line files don't block the UI on render
 * (Prism tokenization itself is still synchronous but the DOM cost is constant).
 */
export function VirtualizedCodeView({
  content,
  language,
  theme,
  highlightStart,
  highlightEnd,
  listRef,
  matchesByLine,
  activeMatchLine,
  activeMatchColumn,
  diagnosticLines,
  diagnosticGutter,
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
            activeMatchLine,
            activeMatchColumn,
            matchesByLine,
            diagnosticLines,
            diagnosticGutter,
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
