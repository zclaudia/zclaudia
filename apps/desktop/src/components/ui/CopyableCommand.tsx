import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from './Button';

/**
 * A shell command the user runs themselves, with a copy button. The command
 * text stays selectable so copying by hand works where the clipboard API does
 * not.
 */
export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-background pl-2">
      <code
        className="min-w-0 flex-1 select-all break-all py-1 font-mono text-2xs leading-snug text-foreground"
        title={command}
      >
        {command}
      </code>
      <IconButton
        size="sm"
        aria-label={copied ? 'Copied' : `Copy command: ${command}`}
        onClick={async e => {
          // Inside a popover: copying must not toggle it.
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </IconButton>
    </div>
  );
}
