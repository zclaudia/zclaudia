import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WriteDiagnosticsProvider, WriteLifecycleDiagnostic } from './write-lifecycle.js';

const execFileAsync = promisify(execFile);

export interface CommandDiagnosticsOptions {
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export function parseCommandDiagnostics(output: string): WriteLifecycleDiagnostic[] {
  return output.split(/\r?\n/).flatMap(line => {
    const match = /^(.*?):(\d+):(\d+)\s+-\s+(error|warning|info)\s+([^:]+):\s+(.*)$/.exec(
      line.trim()
    );
    if (!match) return [];
    return [
      {
        path: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4] as WriteLifecycleDiagnostic['severity'],
        source: match[5],
        message: match[6],
      },
    ];
  });
}

export function createCommandDiagnosticsProvider(
  cwd: string,
  options: CommandDiagnosticsOptions
): WriteDiagnosticsProvider {
  return async () => {
    try {
      const result = await execFileAsync(options.command, options.args ?? [], {
        cwd,
        timeout: options.timeoutMs ?? 10_000,
        maxBuffer: 1024 * 1024,
      });
      return parseCommandDiagnostics(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    } catch (err) {
      const maybeOutput = err as { stdout?: string; stderr?: string };
      const diagnostics = parseCommandDiagnostics(
        `${maybeOutput.stdout ?? ''}\n${maybeOutput.stderr ?? ''}`
      );
      if (diagnostics.length > 0) return diagnostics;
      throw err;
    }
  };
}
