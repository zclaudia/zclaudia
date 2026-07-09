import type Database from 'better-sqlite3';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { AgentProfileRepository } from '../agent-profiles/repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { hasLlmCredential } from './credential.js';
import { runtimeRequiresLlmProfile } from '@zclaudia/shared/core/profile-config-descriptor';
import {
  findInRegistryCrossProvider,
  tryGetRegistryModel,
} from '../../infra/providers/pi-runtime/registry-search.js';
import {
  NoAgentAvailableError,
  resolveAgentForSession,
  type ResolveOptions,
} from '../agent-profiles/agent-resolver.js';

/**
 * Whether the agent's chosen model is usable for its resolved profile.
 *
 * Structural-only: usable iff the model is non-blank AND either the profile
 * explicitly declares it in models[] or pi-ai's registry knows the id. This
 * rejects typo/nonexistent model ids before creating sessions.
 */
function hasUsableModel(agentModel: string | undefined, llm: LlmProfileConfig): boolean {
  const model = agentModel?.trim();
  if (!model) return false;
  const declared = llm.models;
  if (declared && declared.length > 0) {
    return declared.some(m => m.modelId === model);
  }
  return Boolean(
    tryGetRegistryModel(llm.providerType, model) ?? findInRegistryCrossProvider(model)
  );
}

function readinessForResolvedAgent(
  agent: AgentProfileConfig | undefined,
  llm: LlmProfileConfig | null | undefined
): AgentReadiness {
  if (!agent) return { usable: false, reason: 'no_agent' };
  // Native runtimes (e.g. Claude) don't bind an LLM profile. A blank model means
  // the native CLI/SDK resolves its configured default model.
  if (!runtimeRequiresLlmProfile(agent.runtimeType)) {
    return { usable: true };
  }
  if (!llm) return { usable: false, reason: 'no_llm_profile' };
  if (!hasLlmCredential(llm)) return { usable: false, reason: 'no_credential' };
  if (!hasUsableModel(agent.model, llm)) return { usable: false, reason: 'no_model' };
  return { usable: true };
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
    if (readinessForResolvedAgent(agent, llm).usable) return { usable: true };
  }

  const primary = agentRepo.findDefault() ?? agents[0];
  const llm = llmRepo.findById(primary.llmProfileId);
  return readinessForResolvedAgent(primary, llm);
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
