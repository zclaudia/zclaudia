import type Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { SessionModelSelection } from '@zclaudia/shared/core/runtime-capabilities';

export function readSessionModelSelection(
  db: Database.Database,
  sessionId: string
): SessionModelSelection {
  // Older schema fixtures and rolling upgrades have no overrides.
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_model_settings'")
      .get()
  ) {
    return { model: null, thinkingLevel: null, revision: 0 };
  }
  return (
    (db
      .prepare(
        `SELECT model, thinking_level AS thinkingLevel, revision
    FROM session_model_settings WHERE session_id = ?`
      )
      .get(sessionId) as SessionModelSelection | undefined) ?? {
      model: null,
      thinkingLevel: null,
      revision: 0,
    }
  );
}

export function applySessionModelSelection(
  agent: AgentProfileConfig,
  selection: SessionModelSelection
): AgentProfileConfig {
  if (selection.model === null && selection.thinkingLevel === null) return agent;
  return {
    ...agent,
    model: selection.model ?? agent.model,
    // A different model must not inherit effort intended for the profile model.
    thinkingLevel:
      selection.thinkingLevel ?? (selection.model === null ? agent.thinkingLevel : undefined),
  };
}

export function writeSessionModelSelection(
  db: Database.Database,
  sessionId: string,
  selection: SessionModelSelection
): void {
  db.prepare(
    `INSERT INTO session_model_settings (session_id, model, thinking_level, revision)
    VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET
    model=excluded.model, thinking_level=excluded.thinking_level, revision=excluded.revision`
  ).run(sessionId, selection.model, selection.thinkingLevel, selection.revision);
}
