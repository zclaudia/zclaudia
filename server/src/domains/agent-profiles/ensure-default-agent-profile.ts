import type Database from 'better-sqlite3';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { AgentProfileRepository } from './repository.js';
import { resolveEnvModel } from '../../infra/providers/pi-runtime/env-model.js';
import { defaultToolSelection, resolveToolSelection } from '@zclaudia/shared/core/tools';

const DEFAULT_AGENT_SYSTEM_PROMPT = `You are ZClaudia, a coding agent. Help users with software engineering tasks: understanding code, writing code, fixing bugs, refactoring, and explaining behavior. Use the provided tools to read files, run commands, and edit code as needed.`;

export function ensureDefaultAgentProfile(db: Database.Database): void {
  const agentRepo = new AgentProfileRepository(db);
  if (agentRepo.findAllOrdered().length > 0) return;

  const llmRepo = new LlmProfileRepository(db);
  const llmProfile = llmRepo.findDefault() ?? llmRepo.findAllOrdered()[0];
  if (!llmProfile) {
    console.warn(
      '[ensureDefaultAgentProfile] no LlmProfile exists; deferring agent seed until user creates an LlmProfile.'
    );
    return;
  }

  agentRepo.create({
    name: 'Default Coding Agent',
    description: 'Auto-seeded by server. Edit to customize.',
    llmProfileId: llmProfile.id,
    // Mirror the runtime model resolution (PI_MODEL / OPENAI_MODEL / default) so
    // the seeded agent runs the model the configured endpoint actually serves,
    // not a hardcoded Anthropic id that an openai-compat proxy would reject.
    model: resolveEnvModel(),
    systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
    enabledTools: resolveToolSelection(defaultToolSelection).builtinTools,
    toolSelection: defaultToolSelection,
    isDefault: true,
  });

  console.log('[ensureDefaultAgentProfile] seeded default coding agent.');
}
