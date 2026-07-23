/**
 * Process-global registry of foreground Bash commands currently executing.
 *
 * Lets the UI convert a synchronous command the agent is waiting on into a
 * background task ("free the session"): the WebSocket handler looks up the
 * session's in-flight command and fires its requestBackground trigger, which
 * resolves the tool call through the same handoff/adopt path as the
 * auto-background timer.
 */

export interface InflightForegroundCommand {
  sessionId: string;
  toolUseId: string;
  command: string;
  startedAt: number;
  requestBackground: () => void;
}

const commandsBySession = new Map<string, Map<string, InflightForegroundCommand>>();

/**
 * Entries leak if a run never settles (the unregister callback lives in the
 * tool call's finally; a wedged run never reaches it). A foreground command
 * is bounded by the Bash tool's 600s max timeout, so anything older than 2x
 * that is certainly dead — sweep it lazily on access rather than leaking the
 * stale entry (and its requestBackground closure) forever.
 */
const STALE_ENTRY_MS = 2 * 600_000;

function sweepStaleEntries(now: number): void {
  for (const [sessionId, sessionCommands] of commandsBySession) {
    for (const [toolUseId, entry] of sessionCommands) {
      if (now - entry.startedAt > STALE_ENTRY_MS) sessionCommands.delete(toolUseId);
    }
    if (sessionCommands.size === 0) commandsBySession.delete(sessionId);
  }
}

export function registerInflightForegroundCommand(entry: InflightForegroundCommand): () => void {
  sweepStaleEntries(Date.now());
  const sessionCommands =
    commandsBySession.get(entry.sessionId) ?? new Map<string, InflightForegroundCommand>();
  sessionCommands.set(entry.toolUseId, entry);
  commandsBySession.set(entry.sessionId, sessionCommands);
  return () => {
    const current = commandsBySession.get(entry.sessionId);
    current?.delete(entry.toolUseId);
    if (current && current.size === 0) commandsBySession.delete(entry.sessionId);
  };
}

export function listInflightForegroundCommands(sessionId: string): InflightForegroundCommand[] {
  sweepStaleEntries(Date.now());
  return [...(commandsBySession.get(sessionId)?.values() ?? [])];
}

export function requestBackgroundForCommand(
  sessionId: string,
  toolUseId?: string
): { ok: true; command: string } | { ok: false; reason: string } {
  sweepStaleEntries(Date.now());
  const sessionCommands = commandsBySession.get(sessionId);
  if (!sessionCommands || sessionCommands.size === 0) {
    return { ok: false, reason: 'No foreground command is currently running for this session.' };
  }
  let target: InflightForegroundCommand | undefined;
  if (toolUseId) {
    target = sessionCommands.get(toolUseId);
    if (!target)
      return { ok: false, reason: `No running foreground command with toolUseId ${toolUseId}.` };
  } else {
    target = [...sessionCommands.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
  }
  try {
    target.requestBackground();
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, command: target.command };
}

export function __resetInflightForegroundCommandsForTests(): void {
  commandsBySession.clear();
}
