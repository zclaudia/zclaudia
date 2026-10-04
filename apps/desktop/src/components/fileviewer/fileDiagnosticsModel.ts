import type { FileDiagnosticEntry } from '@zclaudia/shared/core/language-servers';

export interface LineDiagnostics {
  severity: 'error' | 'warning';
  items: FileDiagnosticEntry[];
}

/** Diagnostics grouped by 1-based line; a line with any error counts as an error line. */
export function diagnosticsByLine(
  diagnostics: FileDiagnosticEntry[]
): Map<number, LineDiagnostics> {
  const byLine = new Map<number, LineDiagnostics>();
  for (const diagnostic of diagnostics) {
    const severity = diagnostic.severity === 'error' ? 'error' : 'warning';
    const entry = byLine.get(diagnostic.line);
    if (entry) {
      entry.items.push(diagnostic);
      if (severity === 'error') entry.severity = 'error';
    } else {
      byLine.set(diagnostic.line, { severity, items: [diagnostic] });
    }
  }
  return byLine;
}

/** Faint row tint for a line with diagnostics. */
export function diagnosticLineTint(severity: LineDiagnostics['severity']): string {
  return severity === 'error' ? 'hsl(var(--destructive) / 0.08)' : 'hsl(var(--warning) / 0.08)';
}
