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

export function registerInflightForegroundCommand(entry: InflightForegroundCommand): () => void {
  const sessionCommands = commandsBySession.get(entry.sessionId) ?? new Map<string, InflightForegroundCommand>();
  sessionCommands.set(entry.toolUseId, entry);
  commandsBySession.set(entry.sessionId, sessionCommands);
  return () => {
    const current = commandsBySession.get(entry.sessionId);
    current?.delete(entry.toolUseId);
    if (current && current.size === 0) commandsBySession.delete(entry.sessionId);
  };
}

export function listInflightForegroundCommands(sessionId: string): InflightForegroundCommand[] {
  return [...(commandsBySession.get(sessionId)?.values() ?? [])];
}

export function requestBackgroundForCommand(
  sessionId: string,
  toolUseId?: string,
): { ok: true; command: string } | { ok: false; reason: string } {
  const sessionCommands = commandsBySession.get(sessionId);
  if (!sessionCommands || sessionCommands.size === 0) {
    return { ok: false, reason: 'No foreground command is currently running for this session.' };
  }
  let target: InflightForegroundCommand | undefined;
  if (toolUseId) {
    target = sessionCommands.get(toolUseId);
    if (!target) return { ok: false, reason: `No running foreground command with toolUseId ${toolUseId}.` };
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
