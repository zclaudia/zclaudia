import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { RecordStatus } from '@zclaudia/shared/core/record-status';
import { resolveAgentProfileStatus } from '@zclaudia/shared/core/record-status-resolvers';
import { runtimeRequiresLlmProfile } from '../agent-profiles/runtime-type-guard.js';
import { hasLlmCredential } from './credential.js';
import { hasUsableModel } from './check.js';

/** Per-record status for one agent profile given its (already looked-up) bound LLM. */
export function resolveAgentProfileRecordStatus(
  agent: AgentProfileConfig,
  llm: LlmProfileConfig | null | undefined
): RecordStatus {
  const requiresLlm = runtimeRequiresLlmProfile(agent.runtimeType);
  const hasLlmBinding = Boolean(llm);
  const hasModel = Boolean(agent.model && agent.model.trim());
  const llmUsable = Boolean(llm && hasLlmCredential(llm) && hasUsableModel(agent.model, llm));
  return resolveAgentProfileStatus({ requiresLlm, hasLlmBinding, hasModel, llmUsable });
}
