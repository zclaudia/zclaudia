import { describe, it, expect } from 'vitest';
import { RuntimeDescriptorRegistry } from '../runtime-descriptor-registry.js';
import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';

// NOTE: type is 'other' (not 'claude') because 'claude' is now transitionally
// seeded as a built-in descriptor (Task 2.9) and would collide with these
// plugin-registration fixtures.
const otherDesc: AgentRuntimeDescriptor = {
  type: 'other',
  label: 'Other',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: true },
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'other', name: 'Other', version: '1.0.0', apiVersion: 'pcp/v1',
    providerType: 'other', runtime: 'cli', capabilities: [],
  },
};

describe('RuntimeDescriptorRegistry', () => {
  it('seeds zclaudia and lists it', () => {
    const reg = new RuntimeDescriptorRegistry();
    expect(reg.list().some(d => d.type === 'zclaudia')).toBe(true);
  });

  it('transitionally seeds claude and lists it', () => {
    const reg = new RuntimeDescriptorRegistry();
    const claude = reg.get('claude');
    expect(claude?.label).toBe('Claude');
    expect(claude?.model).toEqual({ kind: 'native', multimodalFallback: false, thinkingLevel: true });
    expect(reg.list().some(d => d.type === 'claude')).toBe(true);
  });

  it('adds and removes plugin descriptors by plugin id', () => {
    const reg = new RuntimeDescriptorRegistry();
    reg.registerForPlugin('com.zclaudia.other', otherDesc);
    expect(reg.get('other')?.label).toBe('Other');
    reg.removeForPlugin('com.zclaudia.other');
    expect(reg.get('other')).toBeUndefined();
  });

  it('throws when a descriptor type collides with the seeded zclaudia', () => {
    const reg = new RuntimeDescriptorRegistry();
    const collide: AgentRuntimeDescriptor = { ...otherDesc, type: 'zclaudia' };
    expect(() => reg.registerForPlugin('com.zclaudia.other', collide)).toThrow(
      /already registered/
    );
  });

  it('throws when a plugin tries to claim the transitionally-seeded claude type', () => {
    const reg = new RuntimeDescriptorRegistry();
    const claimClaude: AgentRuntimeDescriptor = { ...otherDesc, type: 'claude' };
    expect(() => reg.registerForPlugin('com.zclaudia.claude', claimClaude)).toThrow(
      /already registered/
    );
  });

  it('throws when a second plugin claims a type owned by another plugin', () => {
    const reg = new RuntimeDescriptorRegistry();
    reg.registerForPlugin('com.plugin.a', otherDesc);
    expect(() => reg.registerForPlugin('com.plugin.b', otherDesc)).toThrow(/already registered/);
  });

  it('allows the same plugin to re-register its own type', () => {
    const reg = new RuntimeDescriptorRegistry();
    reg.registerForPlugin('com.plugin.a', otherDesc);
    expect(() => reg.registerForPlugin('com.plugin.a', otherDesc)).not.toThrow();
  });
});
