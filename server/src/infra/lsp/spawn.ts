/**
 * Default process launcher: through the ProcessSupervisor when one is running
 * (Debug → Managed processes visibility, leak cleanup), plain spawn otherwise
 * (tests, scripts).
 */
import { spawn } from 'child_process';
import { getGlobalProcessSupervisor } from '../services/process-supervisor.js';
import type { LanguageServerTransport, SpawnLanguageServer } from './types.js';

const STDERR_TAIL_BYTES = 4096;

function stderrCollector(stream: NodeJS.ReadableStream | null): () => string {
  let tail = '';
  // Must be drained: a full stderr pipe blocks the server process.
  stream?.on('data', (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
  });
  return () => tail;
}

export const spawnLanguageServer: SpawnLanguageServer = async (launch, meta) => {
  const supervisor = getGlobalProcessSupervisor();
  if (supervisor) {
    const { handle, pid, processId } = await supervisor.spawn({
      source: 'language_server',
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      tags: ['lsp', meta.presetId],
    });
    if (!handle.stdout || !handle.stdin) {
      handle.kill();
      throw new Error('language server spawned without stdio pipes');
    }
    return {
      reader: handle.stdout,
      writer: handle.stdin,
      exited: handle.exitPromise,
      kill: () => handle.kill(),
      pid,
      processId,
      stderrTail: stderrCollector(handle.stderr),
    } satisfies LanguageServerTransport;
  }

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  return {
    reader: child.stdout,
    writer: child.stdin,
    exited,
    kill: () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
    pid: child.pid ?? null,
    stderrTail: stderrCollector(child.stderr),
  } satisfies LanguageServerTransport;
};
