import type Database from 'better-sqlite3';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { AgentProfileRepository } from '../agent-profiles/repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { hasLlmCredential } from './credential.js';

/**
 * Whether the agent's chosen model is usable for its resolved profile.
 *
 * Structural-only: usable iff the model is non-blank AND — when the profile
 * explicitly declares the models it serves — the model is one of them. An empty
 * `models` list means the endpoint's catalog is unknown (openai-compat proxies
 * serve arbitrary ids), so we cannot statically invalidate the model and trust
 * it rather than raise a false "unusable" that would block the user entirely.
 */
function hasUsableModel(agentModel: string | undefined, llm: LlmProfileConfig): boolean {
  const model = agentModel?.trim();
  if (!model) return false;
  const declared = llm.models;
  if (declared && declared.length > 0) {
    return declared.some((m) => m.modelId === model);
  }
  return true;
}

/**
 * Structural readiness: usable iff at least one agent profile resolves to an LLM
 * profile with a non-empty credential AND a usable model. When unusable, reports
 * the most actionable reason derived from the default (or first) agent.
 */
export function resolveAgentReadiness(db: Database.Database): AgentReadiness {
  const agentRepo = new AgentProfileRepository(db);
  const agents = agentRepo.findAllOrdered();
  if (agents.length === 0) return { usable: false, reason: 'no_agent' };

  const llmRepo = new LlmProfileRepository(db);
  for (const agent of agents) {
    const llm = llmRepo.findById(agent.llmProfileId);
    if (llm && hasLlmCredential(llm) && hasUsableModel(agent.model, llm)) return { usable: true };
  }

  const primary = agentRepo.findDefault() ?? agents[0];
  const llm = llmRepo.findById(primary.llmProfileId);
  if (!llm) return { usable: false, reason: 'no_llm_profile' };
  if (!hasLlmCredential(llm)) return { usable: false, reason: 'no_credential' };
  return { usable: false, reason: 'no_model' };
}
