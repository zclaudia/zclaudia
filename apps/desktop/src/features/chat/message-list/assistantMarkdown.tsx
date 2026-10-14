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
        <h1>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h1>
      );
    },
    h2({ children }) {
      return (
        <h2>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h2>
      );
    },
    h3({ children }) {
      return (
        <h3>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h3>
      );
    },
    h4({ children }) {
      return (
        <h4>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h4>
      );
    },
    h5({ children }) {
      return (
        <h5>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h5>
      );
    },
    h6({ children }) {
      return (
        <h6>
          <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
        </h6>
      );
    },
    p({ children }) {
      return (
        <p>
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
