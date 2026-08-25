import { useState, memo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Terminal, Copy, Check } from 'lucide-react';
import { useTranscriptCapabilities } from './TranscriptCapabilities';

const SHELL_LANGUAGES = new Set(['bash', 'shell', 'sh', 'zsh']);

/**
 * Fenced code block with copy and (when the host offers a terminal) a
 * run-in-terminal affordance.
 *
 * Pure transcript renderer: no store or app-context access. Host capabilities
 * arrive through TranscriptCapabilities, which is declared next to the
 * renderers and travels with them into the shared component layer — a code
 * block sits deep inside the markdown component map, so context rather than
 * props is the only way to reach it.
 *
 * Memoized so completed code blocks in a streaming message don't re-run Prism
 * tokenization on every token — only the block whose code string changed does.
 */
export const CodeBlock = memo(function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);
  const { runInTerminal, isDarkCode } = useTranscriptCapabilities();
  const isShell = SHELL_LANGUAGES.has(language.toLowerCase());
  const canRunInTerminal = isShell && Boolean(runInTerminal);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeStyle = isDarkCode ? oneDark : oneLight;

  return (
    <div className="not-prose rounded-lg overflow-hidden border border-border max-w-full">
      {/* Header bar - like GPT style */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">{language}</span>
        <div className="flex items-center gap-3">
          {canRunInTerminal && (
            <button
              onClick={() => runInTerminal?.(children)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Terminal size={16} strokeWidth={1.75} />
              Run in terminal
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`
              flex items-center gap-1.5 text-xs transition-colors
              ${copied ? 'text-success' : 'text-muted-foreground hover:text-foreground'}
            `}
          >
            {copied ? (
              <>
                <Check size={16} strokeWidth={1.75} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} strokeWidth={1.75} />
                Copy code
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code content */}
      <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
        <SyntaxHighlighter
          style={codeStyle}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            padding: '0.75rem',
            fontSize: 'var(--chat-font-code, 0.75rem)',
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

export { SHELL_LANGUAGES };
