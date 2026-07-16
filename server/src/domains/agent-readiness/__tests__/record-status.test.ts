import { describe, it, expect } from 'vitest';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { resolveAgentProfileRecordStatus } from '../record-status.js';

const agent = (over: Partial<AgentProfileConfig> = {}): AgentProfileConfig =>
  ({ id: 'a', name: 'A', runtimeType: 'zclaudia', llmProfileId: 'l1', model: 'claude-x',
     systemPrompt: '', enabledTools: [], createdAt: 1, updatedAt: 1, ...over }) as AgentProfileConfig;
const llm = (over: Partial<LlmProfileConfig> = {}): LlmProfileConfig =>
  ({ id: 'l1', name: 'L', providerType: 'anthropic', apiKey: 'sk', models: [{ modelId: 'claude-x' }],
     createdAt: 1, updatedAt: 1, ...over }) as LlmProfileConfig;

describe('resolveAgentProfileRecordStatus', () => {
  it('ready + usable with a credentialed LLM serving the chosen model', () => {
    expect(resolveAgentProfileRecordStatus(agent(), llm())).toEqual({
      completeness: 'ready', availability: { usable: true },
    });
  });

  it('draft + no_llm_profile when the binding does not resolve', () => {
    const s = resolveAgentProfileRecordStatus(agent(), null);
    expect(s.completeness).toBe('draft');
    expect(s.availability).toEqual({ usable: false, reason: 'no_llm_profile' });
  });

  it('unavailable(llm_unavailable) when the bound LLM lacks a credential', () => {
    const s = resolveAgentProfileRecordStatus(agent(), llm({ apiKey: undefined }));
    expect(s).toEqual({ completeness: 'ready', availability: { usable: false, reason: 'llm_unavailable' } });
  });
});
