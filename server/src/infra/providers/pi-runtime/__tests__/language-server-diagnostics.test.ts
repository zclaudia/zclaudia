import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsCheck, LanguageServerService } from '../../../lsp/index.js';
import type { LspDiagnostic } from '../../language-server-port.js';
import {
  createLanguageServerDiagnosticsProvider,
  reportFromCheck,
} from '../language-server-diagnostics.js';
import type { WriteLifecycleInput } from '../write-lifecycle.js';

const server = { id: 'typescript', name: 'TypeScript', languages: ['typescript'] };

function diag(message: string, severity: LspDiagnostic['severity'] = 'error'): LspDiagnostic {
  return { file: 'src/a.ts', line: 2, character: 5, severity, message, code: 2322 };
}

describe('reportFromCheck', () => {
  it('reports only errors the change introduced', () => {
    const report = reportFromCheck({
      state: 'ready',
      server,
      baseline: [diag('old'), diag('old hint', 'hint')],
      diagnostics: [diag('old'), diag('new'), diag('unused', 'hint'), diag('warn', 'warning')],
    });
    expect(report).toEqual({
      checker: 'TypeScript',
      state: 'checked',
      baseline: 'known',
      errors: [
        {
          path: 'src/a.ts',
          line: 2,
          column: 5,
          severity: 'error',
          message: 'new',
          code: 2322,
        },
      ],
    });
  });

  it('reports every error, flagged, when there is no baseline', () => {
    const report = reportFromCheck({ state: 'ready', server, diagnostics: [diag('a')] });
    expect(report).toMatchObject({ baseline: 'unknown', errors: [{ message: 'a' }] });
  });

  it('reports errors the change introduced in other open files', () => {
    const caller = (message: string): LspDiagnostic => ({ ...diag(message), file: 'src/use.ts' });
    const report = reportFromCheck({
      state: 'ready',
      server,
      baseline: [],
      diagnostics: [],
      others: [
        { before: [caller('old')], after: [caller('old'), caller('broken')] },
        { before: [], after: [] },
      ],
    });
    expect(report?.otherFiles).toEqual({
      checked: 2,
      errors: [expect.objectContaining({ path: 'src/use.ts', message: 'broken' })],
    });
  });

  it('turns pending into a "not checked" report and unavailable into none', () => {
    expect(reportFromCheck({ state: 'pending', server, reason: 'timeout' })).toMatchObject({
      state: 'pending',
      pendingReason: 'timeout',
      errors: [],
    });
    expect(reportFromCheck({ state: 'unavailable', reason: 'no server' })).toBeUndefined();
  });
});

describe('createLanguageServerDiagnosticsProvider', () => {
  it('asks for the written file with the pre-write content as baseline', async () => {
    const check: DiagnosticsCheck = { state: 'ready', server, diagnostics: [] };
    const service = {
      diagnosticsFor: vi.fn(async () => check),
    } as unknown as LanguageServerService;
    const provider = createLanguageServerDiagnosticsProvider(service, '/work', 1234);
    const input = {
      operation: 'edit',
      type: 'update',
      path: 'src/a.ts',
      absolutePath: '/work/src/a.ts',
      originalContent: 'before',
      updatedContent: 'after',
      diff: '',
    } satisfies WriteLifecycleInput;

    expect(await provider(input)).toMatchObject({ state: 'checked', errors: [] });
    expect(service.diagnosticsFor).toHaveBeenCalledWith('/work', '/work/src/a.ts', {
      budgetMs: 1234,
      baselineContent: 'before',
      otherOpenFiles: { exclude: undefined },
    });
  });
});
