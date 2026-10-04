/**
 * Write diagnostics from the LanguageServerManager: after Edit/Write, ask the
 * file's language server and report the *errors this change introduced*.
 *
 * Noise control (docs/plans/2026-10-04-lsp-manager-plan.md): errors only, and
 * only those the pre-change diagnostics do not account for. Files no server
 * covers produce no report at all; a server that has not answered yet produces
 * an explicit "not checked" report rather than an empty one.
 */
import {
  introducedDiagnostics,
  type DiagnosticsCheck,
  type LanguageServerService,
} from '../../lsp/index.js';
import type { LspDiagnostic } from '../language-server-port.js';
import type {
  WriteDiagnosticsProvider,
  WriteDiagnosticsReport,
  WriteLifecycleDiagnostic,
} from './write-lifecycle.js';

/** Wait for a warm server; a starting one never blocks the write. */
export const WRITE_DIAGNOSTICS_BUDGET_MS = 3_000;

function errorsOnly(diagnostics: LspDiagnostic[]): LspDiagnostic[] {
  return diagnostics.filter(diagnostic => diagnostic.severity === 'error');
}

function toLifecycle(diagnostic: LspDiagnostic): WriteLifecycleDiagnostic {
  return {
    path: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.character,
    severity: 'error',
    message: diagnostic.message,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
  };
}

export function reportFromCheck(check: DiagnosticsCheck): WriteDiagnosticsReport | undefined {
  if (check.state === 'unavailable') return undefined;
  if (check.state === 'pending') {
    return {
      checker: check.server.name,
      state: 'pending',
      pendingReason: check.reason,
      baseline: 'unknown',
      errors: [],
    };
  }
  const after = errorsOnly(check.diagnostics);
  const errors = check.baseline ? introducedDiagnostics(errorsOnly(check.baseline), after) : after;
  const otherErrors = (check.others ?? []).flatMap(other =>
    introducedDiagnostics(errorsOnly(other.before), errorsOnly(other.after))
  );
  return {
    checker: check.server.name,
    state: 'checked',
    baseline: check.baseline ? 'known' : 'unknown',
    errors: errors.map(toLifecycle),
    ...(check.others
      ? { otherFiles: { checked: check.others.length, errors: otherErrors.map(toLifecycle) } }
      : {}),
  };
}

export function createLanguageServerDiagnosticsProvider(
  service: LanguageServerService,
  cwd: string,
  budgetMs = WRITE_DIAGNOSTICS_BUDGET_MS
): WriteDiagnosticsProvider {
  return async input =>
    reportFromCheck(
      await service.diagnosticsFor(cwd, input.absolutePath, {
        budgetMs,
        baselineContent: input.originalContent,
        changedWith: input.otherChangedPaths,
        otherOpenFiles: {},
      })
    );
}
