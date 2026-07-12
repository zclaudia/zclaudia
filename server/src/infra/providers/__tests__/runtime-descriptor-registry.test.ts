import { describe, it, expect } from 'vitest';
import { RuntimeDescriptorRegistry } from '../runtime-descriptor-registry.js';
import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';

const claudeDesc: AgentRuntimeDescriptor = {
  type: 'claude',
  label: 'Claude',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: true },
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'claude', name: 'Claude', version: '1.0.0', apiVersion: 'pcp/v1',
    providerType: 'claude', runtime: 'cli', capabilities: [],
  },
};

describe('RuntimeDescriptorRegistry', () => {
  it('seeds zclaudia and lists it', () => {
    const reg = new RuntimeDescriptorRegistry();
    expect(reg.list().some(d => d.type === 'zclaudia')).toBe(true);
  });

  it('adds and removes plugin descriptors by plugin id', () => {
    const reg = new RuntimeDescriptorRegistry();
    reg.registerForPlugin('com.zclaudia.claude', claudeDesc);
    expect(reg.get('claude')?.label).toBe('Claude');
    reg.removeForPlugin('com.zclaudia.claude');
    expect(reg.get('claude')).toBeUndefined();
  });
});
