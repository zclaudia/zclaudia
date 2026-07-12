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

  it('throws when a descriptor type collides with the seeded zclaudia', () => {
    const reg = new RuntimeDescriptorRegistry();
    const collide: AgentRuntimeDescriptor = { ...claudeDesc, type: 'zclaudia' };
    expect(() => reg.registerForPlugin('com.zclaudia.claude', collide)).toThrow(
      /already registered/
    );
  });

  it('throws when a second plugin claims a type owned by another plugin', () => {
    const reg = new RuntimeDescriptorRegistry();
    reg.registerForPlugin('com.plugin.a', claudeDesc);
    expect(() => reg.registerForPlugin('com.plugin.b', claudeDesc)).toThrow(/already registered/);
  });

  it('allows the same plugin to re-register its own type', () => {
    const reg = new RuntimeDescriptorRegistry();
    reg.registerForPlugin('com.plugin.a', claudeDesc);
    expect(() => reg.registerForPlugin('com.plugin.a', claudeDesc)).not.toThrow();
  });
});
