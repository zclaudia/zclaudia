import { describe, expect, it } from 'vitest';

import { extractBashOutputInsights, formatBashResultText } from '../bash-output.js';

describe('Bash output insights', () => {
  it('extracts TypeScript colon diagnostics', () => {
    const insights = extractBashOutputInsights(
      "src/app.ts:2:7 - error TS2322: Type 'number' is not assignable to type 'string'.\n",
    );

    expect(insights.diagnostics).toEqual([
      {
        path: 'src/app.ts',
        line: 2,
        column: 7,
        severity: 'error',
        source: 'TS2322',
        message: "Type 'number' is not assignable to type 'string'.",
      },
    ]);
  });

  it('extracts TypeScript paren diagnostics', () => {
    const insights = extractBashOutputInsights(
      "src/app.ts(3,5): warning TS6133: 'unused' is declared but its value is never read.\n",
    );

    expect(insights.diagnostics).toEqual([
      {
        path: 'src/app.ts',
        line: 3,
        column: 5,
        severity: 'warning',
        source: 'TS6133',
        message: "'unused' is declared but its value is never read.",
      },
    ]);
  });

  it('extracts ESLint stylish diagnostics', () => {
    const insights = extractBashOutputInsights([
      '/repo/src/app.ts',
      '  4:9  error  Unexpected any. Specify a different type.  @typescript-eslint/no-explicit-any',
      '',
    ].join('\n'));

    expect(insights.diagnostics).toEqual([
      {
        path: '/repo/src/app.ts',
        line: 4,
        column: 9,
        severity: 'error',
        source: '@typescript-eslint/no-explicit-any',
        message: 'Unexpected any. Specify a different type.',
      },
    ]);
  });

  it('extracts failed test names from Vitest and Jest-style output', () => {
    const insights = extractBashOutputInsights([
      ' × renders markdown 12ms',
      ' ● MarkdownPreview › escapes html',
      '',
    ].join('\n'));

    expect(insights.failedTests).toEqual([
      'renders markdown',
      'MarkdownPreview › escapes html',
    ]);
  });

  it('formats command metadata, diagnostics, and output together', () => {
    const text = formatBashResultText({
      command: 'pnpm test',
      cwd: '.',
      output: 'src/app.ts:2:7 - error TS2322: Type mismatch\n',
      fullOutput: 'src/app.ts:2:7 - error TS2322: Type mismatch\n',
      exitCode: 2,
      durationMs: 123,
      truncated: false,
      timedOut: false,
      sandboxed: false,
    });

    expect(text).toContain('Command: pnpm test');
    expect(text).toContain('Status: failed (Exit code: 2)');
    expect(text).toContain('Diagnostics:');
    expect(text).toContain('- src/app.ts:2:7 error TS2322: Type mismatch');
    expect(text).toContain('Output:');
  });
});
