import type Database from 'better-sqlite3';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';
import { AgentProfileRepository } from '../agent-profiles/repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { hasLlmCredential } from './credential.js';

/**
 * Structural readiness: usable iff at least one agent profile resolves to an LLM
 * profile with a non-empty credential. When unusable, reports the most
 * actionable reason derived from the default (or first) agent.
 */
export function resolveAgentReadiness(db: Database.Database): AgentReadiness {
  const agentRepo = new AgentProfileRepository(db);
  const agents = agentRepo.findAllOrdered();
  if (agents.length === 0) return { usable: false, reason: 'no_agent' };

  const llmRepo = new LlmProfileRepository(db);
  for (const agent of agents) {
    const llm = llmRepo.findById(agent.llmProfileId);
    if (llm && hasLlmCredential(llm)) return { usable: true };
  }

  const primary = agentRepo.findDefault() ?? agents[0];
  const llm = llmRepo.findById(primary.llmProfileId);
  if (!llm) return { usable: false, reason: 'no_llm_profile' };
  return { usable: false, reason: 'no_credential' };
}
