import type { LlmProfileConfig } from '@zclaudia/shared';
import {
  resolveToolSelection,
  defaultToolSelection,
  defaultSkillSelection,
} from '@zclaudia/shared';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import type { AgentProfileWriteInput } from '../../services/api/agent-profiles';

export type BuildDefaultProfileResult =
  | { ok: true; payload: AgentProfileWriteInput }
  | { ok: false; reason: 'no-llm-profile' | 'no-model' };

/**
 * Assemble a create payload for a brand-new agent profile from the minimum the
 * pre-flight modal collects (name + runtime type). Everything else is defaulted:
 * the default (or first) LLM profile, that profile's first declared model, empty
 * prompt, and the default tool/skill selections. Returns a typed failure when the
 * runtime needs an LLM profile but none (or none with a model) is available.
 */
export function buildDefaultProfilePayload(params: {
  name: string;
  runtimeType: string;
  descriptor: ProfileConfigDescriptor;
  llmProfiles: LlmProfileConfig[];
}): BuildDefaultProfileResult {
  const { name, runtimeType, descriptor, llmProfiles } = params;
  const requiresLlm = descriptor.model.kind === 'llm-profile';

  let llmProfileId = '';
  let model = '';
  if (requiresLlm) {
    const defaultLlm = llmProfiles.find(p => p.isDefault) ?? llmProfiles[0] ?? null;
    if (!defaultLlm) return { ok: false, reason: 'no-llm-profile' };
    const firstModel = defaultLlm.models?.[0]?.modelId;
    if (!firstModel) return { ok: false, reason: 'no-model' };
    llmProfileId = defaultLlm.id;
    model = firstModel;
  }

  const payload: AgentProfileWriteInput = {
    name: name.trim(),
    description: undefined,
    runtimeType,
    llmProfileId,
    model,
    systemPrompt: '',
    enabledTools: resolveToolSelection(defaultToolSelection).builtinTools,
    toolSelection: defaultToolSelection,
    skillSelection: defaultSkillSelection,
    skillExecution: { overrides: [] },
    thinkingLevel: undefined,
    isDefault: false,
  };
  return { ok: true, payload };
}
