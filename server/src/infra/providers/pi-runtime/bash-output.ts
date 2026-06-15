export type BashDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface BashOutputDiagnostic {
  path: string;
  line?: number;
  column?: number;
  severity: BashDiagnosticSeverity;
  message: string;
  source?: string;
}

export interface BashOutputInsights {
  diagnostics: BashOutputDiagnostic[];
  failedTests: string[];
}

export interface FormatBashResultInput {
  command: string;
  cwd: string;
  output: string;
  fullOutput: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
  sandboxed: boolean;
  status?: 'queued' | 'running' | 'success' | 'failed' | 'stopped' | 'aborted' | 'timed out';
  fullOutputPath?: string;
  aborted?: boolean;
}

const MAX_DIAGNOSTICS = 20;
const MAX_FAILED_TESTS = 20;
const MAX_MESSAGE_CHARS = 500;

const DIAGNOSTIC_PATH_EXTENSIONS = String.raw`(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|css|scss|html|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql)`;

function trimMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > MAX_MESSAGE_CHARS
    ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}...`
    : trimmed;
}

function toSeverity(value: string | undefined): BashDiagnosticSeverity {
  const normalized = value?.toLowerCase();
  if (normalized === 'warning' || normalized === 'warn') return 'warning';
  if (normalized === 'info') return 'info';
  return 'error';
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function pushDiagnostic(
  diagnostics: BashOutputDiagnostic[],
  diagnostic: BashOutputDiagnostic,
): void {
  if (diagnostics.length >= MAX_DIAGNOSTICS) return;
  const duplicate = diagnostics.some(existing =>
    existing.path === diagnostic.path
    && existing.line === diagnostic.line
    && existing.column === diagnostic.column
    && existing.message === diagnostic.message);
  if (!duplicate) diagnostics.push(diagnostic);
}

function pushFailedTest(failedTests: string[], name: string): void {
  if (failedTests.length >= MAX_FAILED_TESTS) return;
  const trimmed = name.trim().replace(/\s+\d+ms$/, '');
  if (!trimmed || /^(tests?|test files?|snapshots?|duration)\b/i.test(trimmed)) return;
  if (!failedTests.includes(trimmed)) failedTests.push(trimmed);
}

export function extractBashOutputInsights(output: string): BashOutputInsights {
  const diagnostics: BashOutputDiagnostic[] = [];
  const failedTests: string[] = [];
  let eslintCurrentFile: string | undefined;

  const colonDiagnostic = new RegExp(
    String.raw`^(.+?\.${DIAGNOSTIC_PATH_EXTENSIONS}):(\d+):(\d+)\s*(?:-|:)?\s*(error|warning|warn|info)?\s*([A-Z]+[A-Z0-9_-]*\d*)?\s*:?\s*(.+)$`,
    'i',
  );
  const parenDiagnostic = new RegExp(
    String.raw`^(.+?\.${DIAGNOSTIC_PATH_EXTENSIONS})\((\d+),(\d+)\):\s*(error|warning|warn|info)\s*([A-Z]+[A-Z0-9_-]*\d*)?\s*:?\s*(.+)$`,
    'i',
  );
  const eslintFileHeader = new RegExp(String.raw`^\s*(.+?\.${DIAGNOSTIC_PATH_EXTENSIONS})\s*$`, 'i');
  const eslintStylishLine = /^\s*(\d+):(\d+)\s+(error|warning|warn)\s+(.+?)(?:\s{2,}([@\w/-]+(?:\/[\w.-]+)?))?\s*$/i;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const paren = parenDiagnostic.exec(line);
    if (paren) {
      pushDiagnostic(diagnostics, {
        path: paren[1],
        line: parseInteger(paren[2]),
        column: parseInteger(paren[3]),
        severity: toSeverity(paren[4]),
        message: trimMessage(paren[6]),
        ...(paren[5] ? { source: paren[5] } : {}),
      });
      eslintCurrentFile = undefined;
      continue;
    }

    const colon = colonDiagnostic.exec(line);
    if (colon) {
      pushDiagnostic(diagnostics, {
        path: colon[1],
        line: parseInteger(colon[2]),
        column: parseInteger(colon[3]),
        severity: toSeverity(colon[4]),
        message: trimMessage(colon[6]),
        ...(colon[5] ? { source: colon[5] } : {}),
      });
      eslintCurrentFile = undefined;
      continue;
    }

    const fileHeader = eslintFileHeader.exec(line);
    if (fileHeader && !line.includes(':')) {
      eslintCurrentFile = fileHeader[1];
      continue;
    }
    const eslint = eslintCurrentFile ? eslintStylishLine.exec(line) : undefined;
    if (eslint && eslintCurrentFile) {
      pushDiagnostic(diagnostics, {
        path: eslintCurrentFile,
        line: parseInteger(eslint[1]),
        column: parseInteger(eslint[2]),
        severity: toSeverity(eslint[3]),
        message: trimMessage(eslint[4]),
        ...(eslint[5] ? { source: eslint[5] } : {}),
      });
      continue;
    }

    const vitestBullet = /^\s*[×✕✖]\s+(.+)$/.exec(line);
    if (vitestBullet) pushFailedTest(failedTests, vitestBullet[1]);

    const jestBullet = /^\s*●\s+(.+)$/.exec(line);
    if (jestBullet) pushFailedTest(failedTests, jestBullet[1]);
  }

  return { diagnostics, failedTests };
}

function formatDiagnostic(diagnostic: BashOutputDiagnostic): string {
  const location = [
    diagnostic.path,
    diagnostic.line !== undefined ? diagnostic.line : undefined,
    diagnostic.column !== undefined ? diagnostic.column : undefined,
  ].filter(value => value !== undefined).join(':');
  const source = diagnostic.source ? ` ${diagnostic.source}` : '';
  return `- ${location} ${diagnostic.severity}${source}: ${diagnostic.message}`;
}

export function formatBashResultText(input: FormatBashResultInput, insights = extractBashOutputInsights(input.fullOutput)): string {
  const statusBase = input.status
    ?? (input.aborted
    ? 'aborted'
    : input.timedOut
      ? 'timed out'
      : input.exitCode === 0
        ? 'success'
        : 'failed');
  const status = (statusBase === 'failed' && input.exitCode !== null)
    ? `failed (Exit code: ${input.exitCode})`
    : statusBase;
  const lines = [
    `Command: ${input.command}`,
    `Cwd: ${input.cwd}`,
    `Status: ${status}`,
    `Duration: ${input.durationMs}ms`,
    `Sandbox: ${input.sandboxed ? 'enabled' : 'disabled'}`,
  ];

  if (input.truncated && input.fullOutputPath) {
    lines.push(`Output truncated (showing tail). Full output: ${input.fullOutputPath}`);
  }
  if (input.timedOut) lines.push('Timed out: true');

  if (insights.diagnostics.length > 0) {
    lines.push('', 'Diagnostics:', ...insights.diagnostics.map(formatDiagnostic));
  }
  if (insights.failedTests.length > 0) {
    lines.push('', 'Failed tests:', ...insights.failedTests.map(test => `- ${test}`));
  }

  lines.push('', 'Output:', input.output || '(no output)');
  return lines.join('\n');
}
