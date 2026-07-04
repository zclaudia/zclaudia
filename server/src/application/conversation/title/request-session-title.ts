import type Database from 'better-sqlite3';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { resolveAgentForSession } from '../../../domains/agent-profiles/agent-resolver.js';
import { maybeGenerateSessionTitle, type TitleGenerateInput } from './session-title-service.js';

export interface RequestSessionTitleDeps {
  db: Database.Database;
  sessionId: string;
  broadcast: (msg: ServerMessage) => void;
  /** Injectable for tests; default resolves the session's agent + LLM profile. */
  resolve?: typeof resolveAgentForSession;
  /** Injectable for tests; forwarded to the title service's generator seam. */
  generate?: (input: TitleGenerateInput) => Promise<string | null>;
}

/**
 * Idle-session entry point for auto-titling. The run-completion path
 * (run-terminal-coordinator) already carries the agent + LLM profile on the
 * active run; when a session is titled outside a run — e.g. the home view asking
 * for a title on a session that never completed one — we resolve those profiles
 * from the session record and hand off to the same fire-and-forget title
 * service. That service re-checks shouldRegenerateTitle and holds the per-session
 * in-flight lock, so this is safe to call repeatedly and cheap when there is
 * nothing to do.
 */
export function requestSessionTitleGeneration(deps: RequestSessionTitleDeps): void {
  const { db, sessionId, broadcast } = deps;
  const session = new SessionRepository(db).findById(sessionId);
  if (!session || session.type === 'background') return;

  let resolved;
  try {
    resolved = (deps.resolve ?? resolveAgentForSession)(db, {
      explicitAgentId: session.agentProfileId ?? undefined,
      projectId: session.projectId ?? undefined,
    });
  } catch {
    // NoAgentAvailableError (or any resolution failure) — nothing to title with.
    return;
  }
  if (!resolved.llm) return;

  maybeGenerateSessionTitle({
    db,
    sessionId,
    agentProfile: resolved.agent,
    llmProfile: resolved.llm,
    broadcast,
    ...(deps.generate ? { generate: deps.generate } : {}),
  });
}
