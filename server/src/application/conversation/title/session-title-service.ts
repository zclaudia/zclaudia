import type Database from 'better-sqlite3';
import type { ServerMessage, SessionsUpdatedMessage } from '@zclaudia/shared/wire/messages';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { SessionMessageRepository } from '../../../domains/sessions/message-repository.js';
import { getSessionEventPublisher } from '../../../domains/sessions/session-event-port.js';
import { getAutoTitleConfig } from '../../../utils/auto-title-config.js';
import { shouldRegenerateTitle } from './session-title-helpers.js';
import { generateSessionTitle } from './generate-session-title.js';

export interface TitleGenerateInput {
  db: Database.Database;
  sessionId: string;
  agentProfile: AgentProfileConfig;
  llmProfile: LlmProfileConfig;
  /** Model id from auto_title_config; null/undefined = the session's own model. */
  modelOverride?: string | null;
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
  void runTitleGeneration(deps).catch(() => {
    /* silent by design */
  });
}

async function runTitleGeneration(deps: MaybeGenerateSessionTitleDeps): Promise<void> {
  const { db, sessionId } = deps;
  if (inFlight.has(sessionId)) return;

  const { enabled, model: modelOverride } = getAutoTitleConfig(db);
  if (!enabled) return;

  const repo = new SessionRepository(db);
  const session = repo.findById(sessionId);
  if (!session || session.type === 'background') return;

  const userMsgCount = new SessionMessageRepository(db).countUserMessagesBySession(sessionId);
  if (
    !shouldRegenerateTitle({
      name: session.name,
      autoTitle: session.autoTitle,
      autoTitleMsgCount: session.autoTitleMsgCount,
      userMsgCount,
    })
  )
    return;

  // Broadcast the latest persisted row (never the pre-generation snapshot) so
  // concurrent metadata changes such as a rename aren't clobbered.
  // autoTitlePending/autoTitleError are transient wire state, not persisted.
  const broadcastTitleState = (autoTitlePending: boolean, autoTitleError?: string): void => {
    const current = repo.findById(sessionId);
    if (!current) return;
    const msg: SessionsUpdatedMessage = {
      type: 'sessions_updated',
      session: autoTitleError
        ? { ...current, autoTitlePending, autoTitleError }
        : { ...current, autoTitlePending },
    };
    deps.broadcast(msg);
  };

  inFlight.add(sessionId);
  broadcastTitleState(true);
  let failureReason: string | undefined;
  try {
    const generate = deps.generate ?? generateSessionTitle;
    const title = await generate({
      db,
      sessionId,
      agentProfile: deps.agentProfile,
      llmProfile: deps.llmProfile,
      modelOverride,
    });
    if (title) {
      repo.updateAutoTitle(sessionId, title, userMsgCount);
      // The run WS broadcast reaches direct + gateway-channel clients, but
      // resource-only peers (remote session lists) need the resource event.
      // Published from the persisted row; publishSessionEvent never bumps
      // updated_at, so sidebar recency ordering is unaffected.
      const landed = repo.findById(sessionId);
      if (landed) getSessionEventPublisher()?.publishSessionEvent('updated', landed);
    } else {
      failureReason = 'title generation returned no result';
    }
  } catch (error) {
    failureReason = error instanceof Error ? error.message : 'title generation failed';
  } finally {
    inFlight.delete(sessionId);
    broadcastTitleState(false, failureReason);
  }
}
