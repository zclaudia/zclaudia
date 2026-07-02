import type { Database } from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { AgentProfileRepository } from './repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { ProjectRepository } from '../projects/repository.js';

export class NoAgentAvailableError extends Error {
  constructor() {
    super('No agent profile available — create one in Settings first');
    this.name = 'NoAgentAvailableError';
  }
}

export interface ResolveOptions {
  /** Explicit agent_profile_id from request body / session record (takes precedence). */
  explicitAgentId?: string;
  /** Project id; used to look up project.defaultAgentProfileId as second-tier fallback. */
  projectId?: string;
}

export interface ResolvedAgent {
  agent: AgentProfileConfig;
  llm: LlmProfileConfig | undefined;
}

/**
 * Resolves an agent + its underlying LLM profile for a session run or session create.
 *
 * Precedence: `explicitAgentId` > `project.defaultAgentProfileId` > `agentRepo.findDefault()`.
 * Stale ids at either level fall through to the next with a console.warn.
 *
 * Throws NoAgentAvailableError if nothing resolves.
 */
export function resolveAgentForSession(db: Database, opts: ResolveOptions): ResolvedAgent {
  const agentRepo = new AgentProfileRepository(db);
  const llmRepo = new LlmProfileRepository(db);
  const projectRepo = new ProjectRepository(db);

  let agent: AgentProfileConfig | undefined;

  if (opts.explicitAgentId) {
    agent = agentRepo.findById(opts.explicitAgentId) ?? undefined;
    if (!agent) {
      console.warn(
        `[agent-resolver] explicit agent_profile_id ${opts.explicitAgentId} not found, falling back`
      );
    }
  }

  if (!agent && opts.projectId) {
    const project = projectRepo.findById(opts.projectId);
    const projectDefaultId = project?.defaultAgentProfileId;
    if (projectDefaultId) {
      agent = agentRepo.findById(projectDefaultId) ?? undefined;
      if (!agent) {
        console.warn(
          `[agent-resolver] project default agent_profile_id ${projectDefaultId} not found, falling back to global default`
        );
      }
    }
  }

  if (!agent) {
    agent = agentRepo.findDefault();
  }

  if (!agent) {
    throw new NoAgentAvailableError();
  }

  let llm: LlmProfileConfig | undefined;
  if (agent.llmProfileId) {
    llm = llmRepo.findById(agent.llmProfileId) ?? undefined;
    if (!llm) {
      console.warn(
        `[agent-resolver] agent.llm_profile_id ${agent.llmProfileId} not found, falling back to default LLM profile`
      );
      llm = llmRepo.findDefault() ?? undefined;
    }
  } else {
    // Agent has no llm_profile_id (legacy seed or test fixture); fall through to default.
    llm = llmRepo.findDefault() ?? undefined;
  }

  return { agent, llm };
}
