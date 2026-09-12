import { describe, it, expect } from 'vitest';
import { RuntimeDescriptorRegistry } from '../runtime-descriptor-registry.js';
import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';

const otherDesc: AgentRuntimeDescriptor = {
  type: 'other',
  label: 'Other',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'auto' },
  hasCliPath: false,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'other',
    name: 'Other',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'other',
    runtime: 'cli',
    capabilities: [],
  },
};

describe('RuntimeDescriptorRegistry', () => {
  it('seeds Pi and lists it', () => {
    const reg = new RuntimeDescriptorRegistry();
    expect(reg.list().some(d => d.type === 'pi')).toBe(true);
  });

  it('does not seed claude; a plugin can register it', () => {
    const reg = new RuntimeDescriptorRegistry();
    expect(reg.get('claude')).toBeUndefined();
    const claudeDesc: AgentRuntimeDescriptor = { ...otherDesc, type: 'claude', label: 'Claude' };
    expect(() => reg.registerForPlugin('com.zclaudia.claude', claudeDesc)).not.toThrow();
    expect(reg.get('claude')?.label).toBe('Claude');
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
    const collide: AgentRuntimeDescriptor = { ...otherDesc, type: 'pi' };
    expect(() => reg.registerForPlugin('com.zclaudia.other', collide)).toThrow(
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


it('resolves the legacy descriptor without exposing or allowing a duplicate runtime', () => {
  const registry = new RuntimeDescriptorRegistry();
  expect(registry.get('zclaudia')).toBe(registry.get('pi'));
  expect(registry.hasType('zclaudia')).toBe(true);
  expect(registry.list().map(d => d.type)).toEqual(['pi']);
  expect(() => registry.registerForPlugin('plugin', { ...otherDesc, type: 'zclaudia' })).toThrow(/already registered/);
});
