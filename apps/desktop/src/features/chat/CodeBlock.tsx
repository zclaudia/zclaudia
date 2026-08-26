import { Fragment, type ReactNode } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

/**
 * This app's syntax highlighter, injected into the kit's renderers through
 * TranscriptCapabilities.
 *
 * `useInlineStyles={false}` makes Prism emit token classes instead of a
 * bundled color scheme, which is what lets the kit stylesheet color them from
 * the active theme. PreTag/CodeTag are Fragments because the kit's CodeBlock
 * owns the <pre><code> wrapper — the contract is that this returns inline
 * content only.
 */
export function highlightCode(code: string, language: string): ReactNode {
  return (
    <SyntaxHighlighter
      useInlineStyles={false}
      language={language}
      PreTag={Fragment}
      CodeTag={Fragment}
    >
      {code}
    </SyntaxHighlighter>
  );
}

export { CodeBlock } from '@zclaudia/agent-transcript-kit/react';
