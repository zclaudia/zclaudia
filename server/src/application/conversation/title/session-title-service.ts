import type Database from 'better-sqlite3';
import type { ServerMessage, SessionsUpdatedMessage } from '@zclaudia/shared/wire/messages';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { SessionMessageRepository } from '../../../domains/sessions/message-repository.js';
import { shouldRegenerateTitle } from './session-title-helpers.js';
import { generateSessionTitle } from './generate-session-title.js';

export interface TitleGenerateInput {
  db: Database.Database;
  sessionId: string;
  agentProfile: AgentProfileConfig;
  llmProfile: LlmProfileConfig;
}

export interface MaybeGenerateSessionTitleDeps extends TitleGenerateInput {
  broadcast: (msg: ServerMessage) => void;
  /** Injectable for tests; defaults to the real model-backed generator. */
  generate?: (input: TitleGenerateInput) => Promise<string | null>;
}

// One title generation per session at a time.
const inFlight = new Set<string>();

/** Fire-and-forget: never throws into the caller, never blocks run completion. */
export function maybeGenerateSessionTitle(deps: MaybeGenerateSessionTitleDeps): void {
  void runTitleGeneration(deps).catch(() => { /* silent by design */ });
}

async function runTitleGeneration(deps: MaybeGenerateSessionTitleDeps): Promise<void> {
  const { db, sessionId } = deps;
  if (inFlight.has(sessionId)) return;

  const repo = new SessionRepository(db);
  const session = repo.findById(sessionId);
  if (!session || session.type === 'background') return;

  const userMsgCount = new SessionMessageRepository(db).countUserMessagesBySession(sessionId);
  if (!shouldRegenerateTitle({
    autoTitle: session.autoTitle,
    autoTitleMsgCount: session.autoTitleMsgCount,
    userMsgCount,
  })) return;

  inFlight.add(sessionId);
  try {
    const generate = deps.generate ?? generateSessionTitle;
    const title = await generate({
      db,
      sessionId,
      agentProfile: deps.agentProfile,
      llmProfile: deps.llmProfile,
    });
    if (!title) return;
    repo.updateAutoTitle(sessionId, title, userMsgCount);
    const msg: SessionsUpdatedMessage = {
      type: 'sessions_updated',
      session: { ...session, autoTitle: title, autoTitleMsgCount: userMsgCount },
    };
    deps.broadcast(msg);
  } finally {
    inFlight.delete(sessionId);
  }
}
