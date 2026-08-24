import { useState, useMemo } from 'react';
import { ansiToHtml } from './toolFormatters';

// Max lines to show before collapsing terminal output
const TERMINAL_PREVIEW_LINES = 10;

// Button to run a command in the remote terminal. Pure: the host decides
// whether the capability exists and how to route the command (see
// useRunInTerminal) — render this only when a handler is available.
function RunInTerminalButton({
  command,
  onRun,
}: {
  command: string;
  onRun: (command: string) => void;
}) {
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        onRun(command);
      }}
      className="absolute top-1 right-1 p-1 rounded-md opacity-100 md:opacity-0 md:group-hover/cmd:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity"
      title="Paste to terminal"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    </button>
  );
}

// Terminal-style output for Bash commands
function TerminalOutput({ content, isError }: { content: string; isError?: boolean }) {
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const lines = content.split('\n');
  const needsCollapse = lines.length > TERMINAL_PREVIEW_LINES;
  const displayContent =
    needsCollapse && !isFullyExpanded ? lines.slice(0, TERMINAL_PREVIEW_LINES).join('\n') : content;

  const html = useMemo(() => ansiToHtml(displayContent), [displayContent]);

  return (
    <div className="rounded-lg overflow-hidden border border-zinc-700">
      <pre
        data-testid="tool-result"
        className={`text-xs font-mono p-3 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${
          isError ? 'bg-red-950 text-red-300' : 'bg-zinc-900 text-zinc-200'
        }`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {needsCollapse && (
        <button
          onClick={() => setIsFullyExpanded(!isFullyExpanded)}
          className="w-full px-3 py-1.5 text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 transition-colors text-center"
        >
          {isFullyExpanded ? 'Collapse' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

export { TerminalOutput, RunInTerminalButton, TERMINAL_PREVIEW_LINES };
