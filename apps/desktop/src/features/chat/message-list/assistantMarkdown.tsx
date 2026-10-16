import type { Components } from 'react-markdown';
import { ChatLink } from '../../browser';
import { CodeBlock } from '../CodeBlock';
import { FileLineReference, INLINE_FILE_REF_REGEX } from '../FileLineReference';
import { MarkdownChildrenWithFileRefs } from '../FileReference';
import {
  hasInlineMarkdownIcon,
  TextWithInlineMarkdownIcons,
} from '../../../components/markdown/InlineMarkdownIcons';
import type { FileRefContextValue } from './fileRefContext';

// Heading typography rides the generated UI type scale (--font-ui-*, see
// scripts/tokens/config.mjs): h1/h2 step up the scale, h3–h6 hold the base
// size and separate by weight. `not-prose` opts each heading out of the
// .prose.prose-sm :where(h*) fallbacks in styles/index.css so these classes
// are the source of truth; the em margins keep the prose spacing rhythm.
const headingClasses = {
  h1: 'not-prose mt-[1.15em] mb-[0.45em] text-[length:var(--font-ui-xl)] font-semibold leading-snug',
  h2: 'not-prose mt-[1.15em] mb-[0.45em] text-[length:var(--font-ui-lg)] font-semibold leading-snug',
  h3: 'not-prose mt-[1.15em] mb-[0.45em] text-[length:var(--font-ui-base)] font-semibold leading-snug',
  h4: 'not-prose mt-[1.15em] mb-[0.45em] text-[length:var(--font-ui-base)] font-semibold leading-snug',
  h5: 'not-prose mt-[1.15em] mb-[0.45em] text-[length:var(--font-ui-base)] font-medium leading-snug',
  h6: 'not-prose mt-[1.15em] mb-[0.45em] text-[length:var(--font-ui-base)] font-normal leading-snug',
} as const;

/**
 * ReactMarkdown `components` mapping for assistant messages. `fileRef` is the
 * FileRefContext value read by AssistantContent — it closes over the mapping's
 * file-reference renderer (inline `filename.ext:line` code spans).
 */
export function createAssistantMarkdownComponents(fileRef: FileRefContextValue): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const codeText = String(children);
      const isInline = !match && !codeText.includes('\n');

      if (isInline) {
        const trimmed = codeText.trim();
        if (INLINE_FILE_REF_REGEX.test(trimmed)) {
          return (
            <FileLineReference
              text={trimmed}
              projectRoot={fileRef.projectRoot}
              backendId={fileRef.backendId}
            />
          );
        }
        return (
          <code
            className="bg-secondary px-1.5 py-0.5 rounded-[var(--radius-inline-token)] text-primary break-all"
            {...props}
          >
            {hasInlineMarkdownIcon(codeText) ? (
              <TextWithInlineMarkdownIcons text={codeText} />
            ) : (
              children
            )}
          </code>
        );
      }

      const language = match ? match[1] : 'text';
      const codeString = String(children).replace(/\n$/, '');

      return <CodeBlock language={language}>{codeString}</CodeBlock>;
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children }) {
      return <ChatLink href={href}>{children}</ChatLink>;
    },
    table({ children }) {
      return (
        <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch]">
          <table className="w-max min-w-full border-collapse border border-border">
            {children}
          </table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="border border-border px-3 py-2 bg-secondary text-left align-top whitespace-pre-wrap break-words">
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </th>
      );
    },
    td({ children }) {
      return (
        <td className="border border-border px-3 py-2 align-top whitespace-pre-wrap break-words">
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </td>
      );
    },
    h1({ children }) {
      return (
        <h1 className={headingClasses.h1}>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h1>
      );
    },
    h2({ children }) {
      return (
        <h2 className={headingClasses.h2}>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h2>
      );
    },
    h3({ children }) {
      return (
        <h3 className={headingClasses.h3}>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h3>
      );
    },
    h4({ children }) {
      return (
        <h4 className={headingClasses.h4}>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h4>
      );
    },
    h5({ children }) {
      return (
        <h5 className={headingClasses.h5}>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h5>
      );
    },
    h6({ children }) {
      return (
        <h6 className={headingClasses.h6}>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h6>
      );
    },
    p({ children }) {
      return (
        <p className="leading-relaxed">
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </p>
      );
    },
    li({ children }) {
      return (
        <li>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </li>
      );
    },
  };
}
