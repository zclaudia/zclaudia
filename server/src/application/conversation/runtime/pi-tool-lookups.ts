/**
 * Adapts domain repositories and application state to the infra-owned
 * PiToolLookupPort, so the built-in Pi tools (TodoRead, RespondToCoordinator
 * gating, ReadSessionContext, the Agent subagent_type roster) read them
 * without infra importing domains/application.
 */
import type Database from 'better-sqlite3';
import type { PiToolLookupPort } from '../../../infra/providers/types.js';
import { AgentProfileRepository } from '../../../domains/agent-profiles/repository.js';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';
import { getLatestTodos } from '../interactions/todo-state-tracker.js';

export function createPiToolLookups(db: Database.Database): PiToolLookupPort {
  return {
    getLatestTodos,
    isSubagentSession: sessionId =>
      new TaskRepository(db).findLatestAgentTaskForSession(sessionId) !== null,
    findSession: sessionId => new SessionRepository(db).findById(sessionId) ?? undefined,
    listSubagentTypes: () =>
      new AgentProfileRepository(db)
        .findAllOrdered()
        .filter(profile => (profile.status ?? 'active') === 'active')
        .map(profile => ({
          id: profile.id,
          name: profile.name,
          description: profile.description?.trim() || undefined,
        })),
  };
}
