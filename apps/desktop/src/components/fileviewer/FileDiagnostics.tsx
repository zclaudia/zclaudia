import { useState } from 'react';
import type { LineDiagnostics } from './fileDiagnosticsModel';
import { Button } from '../ui/Button';
import { HoverPopover } from '../ui/HoverPopover';
import { TONE_DOT } from '../ui/tone';
import type { FileDiagnosticsResult } from './useFileDiagnostics';

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Gutter dot for one line; hover or tap shows the messages. */
export function DiagnosticMarker({ line, entry }: { line: number; entry: LineDiagnostics }) {
  return (
    <HoverPopover
      panelTestId="diagnostic-popover"
      content={
        <ul className="space-y-1.5 px-3 py-2.5 text-xs">
          {entry.items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span
                className={`mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${TONE_DOT[item.severity === 'error' ? 'destructive' : 'warning']}`}
              />
              <span className="min-w-0 whitespace-pre-wrap break-words font-sans text-foreground">
                {item.message}
                {item.code !== undefined && (
                  <span className="text-muted-foreground"> [{item.code}]</span>
                )}
                <span className="block text-2xs text-muted-foreground">
                  Line {line}, column {item.character}
                  {item.source ? ` · ${item.source}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      }
    >
      <button
        type="button"
        data-testid="diagnostic-marker"
        data-severity={entry.severity}
        aria-label={`${count(entry.items.length, entry.severity === 'error' ? 'problem' : 'warning')} on line ${line}`}
        className="flex h-5 w-3 items-center justify-center"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[entry.severity === 'error' ? 'destructive' : 'warning']}`}
        />
      </button>
    </HoverPopover>
  );
}

/**
 * Viewer header status: problem counts (click to jump to the next), a
 * "Check types" button when the workspace's server is not running, or
 * nothing when no language server covers the file.
 */
export function FileDiagnosticsSummary({
  result,
  onJump,
}: {
  result: FileDiagnosticsResult;
  onJump: (line: number) => void;
}) {
  const [cursor, setCursor] = useState(-1);
  const { state, diagnostics, serverName } = result;

  if (state === 'not_running') {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="flex-shrink-0"
        title={serverName ? `Start ${serverName} for this workspace` : undefined}
        onClick={result.startChecking}
        data-testid="check-types"
      >
        Check types
      </Button>
    );
  }
  if (state === 'starting') {
    return (
      <span
        className="flex-shrink-0 text-2xs text-muted-foreground"
        data-testid="diagnostics-status"
      >
        {serverName ? `Starting ${serverName}…` : 'Starting…'}
      </span>
    );
  }
  if (state !== 'ready') return null;

  if (diagnostics.length === 0) {
    return (
      <span
        className="flex-shrink-0 text-2xs text-muted-foreground"
        data-testid="diagnostics-status"
      >
        No problems
      </span>
    );
  }
  const errors = diagnostics.filter(item => item.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const lines = [...new Set(diagnostics.map(item => item.line))].sort((a, b) => a - b);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="flex-shrink-0 gap-1.5"
      title="Go to the next problem"
      data-testid="diagnostics-status"
      onClick={() => {
        const next = (cursor + 1) % lines.length;
        setCursor(next);
        onJump(lines[next]);
      }}
    >
      {errors > 0 && (
        <span className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT.destructive}`} />
          {count(errors, 'error')}
        </span>
      )}
      {warnings > 0 && (
        <span className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT.warning}`} />
          {count(warnings, 'warning')}
        </span>
      )}
    </Button>
  );
}
