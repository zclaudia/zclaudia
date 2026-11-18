import { spawn, type ChildProcess } from 'node:child_process';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** Own only the CLI processes created for one query, including resumed runs. */
export function createClaudeProcessOwner() {
  const children = new Set<ChildProcess>();
  const spawnClaudeCodeProcess: NonNullable<Options['spawnClaudeCodeProcess']> = options => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    children.add(child);
    child.once('exit', () => children.delete(child));
    child.once('close', () => children.delete(child));
    return child;
  };

  return {
    spawnClaudeCodeProcess,
    async stop() {
      await Promise.all(
        [...children].map(
          child =>
            new Promise<void>(resolve => {
              if (child.exitCode !== null || child.signalCode !== null) {
                resolve();
                return;
              }
              // Give the CLI time to clean up subprocesses after the SDK aborts it.
              const escalation = setTimeout(() => child.kill('SIGKILL'), 1500);
              child.once('exit', () => {
                clearTimeout(escalation);
                resolve();
              });
            })
        )
      );
    },
  };
}
