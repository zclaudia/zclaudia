import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useRef } from 'react';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import {
  hasInlineMarkdownIcon,
  MarkdownChildrenWithInlineIcons,
  TextWithInlineMarkdownIcons,
} from '../markdown/InlineMarkdownIcons';
import { useTextHighlight } from './useTextHighlight';

function normalizeMarkdownForRender(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const fenceCount = (normalized.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    return `${normalized}\n\`\`\``;
  }
  return normalized;
}

interface MarkdownFileContentProps {
  content: string;
  /** When provided, in-file search highlights & scrolls to matches in the rendered DOM. */
  highlightQuery?: string;
  highlightCaseSensitive?: boolean;
  /** 0-based index of the active match (for highlighting + scroll). */
  highlightActiveIndex?: number;
}

export function MarkdownFileContent({
  content,
  highlightQuery,
  highlightCaseSensitive,
  highlightActiveIndex,
}: MarkdownFileContentProps) {
  const { resolvedTheme } = useTheme();
  const dark = isDarkTheme(resolvedTheme);
  const normalizedContent = useMemo(() => normalizeMarkdownForRender(content), [content]);
  const containerRef = useRef<HTMLDivElement>(null);
  // Highlight & scroll within the rendered markdown. Markdown can't reuse the
  // code view's line/column approach (raw offsets don't map to rendered HTML),
  // so we match the literal query string in the DOM instead. contentSignature
  // forces a re-run after React paints new content.
  useTextHighlight(
    containerRef,
    highlightQuery ?? '',
    highlightCaseSensitive ?? false,
    highlightActiveIndex ?? 0,
    normalizedContent
  );

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto p-4 md:p-6">
      <div className={`prose prose-sm max-w-none min-w-0 ${dark ? 'dark:prose-invert' : ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const isBlock = (className ?? '').includes('language-');
              const codeText = String(children);
              if (isBlock || codeText.includes('\n')) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code className={className} {...props}>
                  {hasInlineMarkdownIcon(codeText) ? (
                    <TextWithInlineMarkdownIcons text={codeText} />
                  ) : (
                    children
                  )}
                </code>
              );
            },
            pre({ children }) {
              return (
                <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                  <pre>{children}</pre>
                </div>
              );
            },
            table({ children }) {
              return (
                <div className="w-full overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                  <table className="w-max min-w-full border-collapse border border-border">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="border border-border px-3 py-2 bg-secondary text-left align-top whitespace-pre-wrap break-words">
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </th>
              );
            },
            td({ children }) {
              return (
                <td className="border border-border px-3 py-2 align-top whitespace-pre-wrap break-words">
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </td>
              );
            },
            h1({ children }) {
              return (
                <h1>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </h1>
              );
            },
            h2({ children }) {
              return (
                <h2>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </h2>
              );
            },
            h3({ children }) {
              return (
                <h3>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </h3>
              );
            },
            h4({ children }) {
              return (
                <h4>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </h4>
              );
            },
            h5({ children }) {
              return (
                <h5>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </h5>
              );
            },
            h6({ children }) {
              return (
                <h6>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </h6>
              );
            },
            p({ children }) {
              return (
                <p>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </p>
              );
            },
            li({ children }) {
              return (
                <li>
                  <MarkdownChildrenWithInlineIcons>{children}</MarkdownChildrenWithInlineIcons>
                </li>
              );
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
