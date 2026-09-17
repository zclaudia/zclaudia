import type Database from 'better-sqlite3';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';
import { NoAgentAvailableError, resolveAgentForSession, type ResolveOptions } from './agent-resolver.js';
import {
  readinessForResolvedAgent,
  resolveAgentExecutionReadiness,
} from '../agent-profiles/readiness.js';

export async function resolveAgentReadinessForSessionWithRuntimeCheck(
  db: Database.Database,
  opts: ResolveOptions
): Promise<AgentReadiness> {
  try {
    const { agent, llm } = resolveAgentForSession(db, opts);
    return await resolveAgentExecutionReadiness(agent, llm);
  } catch (err) {
    if (err instanceof NoAgentAvailableError) return { usable: false, reason: 'no_agent' };
    throw err;
  }
}

/**
 * Readiness for the exact agent that SessionRepository will assign:
 * explicit > project default > global default.
 */
export function resolveAgentReadinessForSession(
  db: Database.Database,
  opts: ResolveOptions
): AgentReadiness {
  try {
    const { agent, llm } = resolveAgentForSession(db, opts);
    return readinessForResolvedAgent(agent, llm);
  } catch (err) {
    if (err instanceof NoAgentAvailableError) return { usable: false, reason: 'no_agent' };
    throw err;
  }
}
