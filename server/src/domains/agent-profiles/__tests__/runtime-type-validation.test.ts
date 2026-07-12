import { describe, it, expect } from 'vitest';
import { isValidRuntimeType } from '../runtime-type-guard.js';
import { providerRegistry } from '../../../infra/providers/registry.js';
import { runtimeDescriptorRegistry } from '../../../infra/providers/runtime-descriptor-registry.js';
import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';

describe('isValidRuntimeType', () => {
  it('accepts the built-in zclaudia', () => {
    expect(isValidRuntimeType('zclaudia')).toBe(true);
  });
  it('rejects an unknown/unregistered runtime', () => {
    expect(isValidRuntimeType('totally-unknown')).toBe(false);
  });
  it('accepts a runtime once its adapter is registered, rejects after removal', () => {
    providerRegistry.registerPluginAdapter('com.test.rt', {
      type: 'test-rt',
      async *run() {},
    });
    expect(isValidRuntimeType('test-rt')).toBe(true);
    providerRegistry.removePluginAdapters('com.test.rt');
    expect(isValidRuntimeType('test-rt')).toBe(false);
  });
  it('accepts a runtime that only has a registered descriptor (no live adapter yet), rejects after removal', () => {
    const descriptor: AgentRuntimeDescriptor = {
      type: 'test-descriptor-only-rt',
      label: 'Descriptor Only',
      model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'off' },
      hasCliPath: false,
      capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
      manifest: {
        id: 'test-descriptor-only-rt',
        name: 'Descriptor Only',
        version: '1.0.0',
        apiVersion: 'pcp/v1',
        providerType: 'test-descriptor-only-rt',
        runtime: 'cli',
        capabilities: [],
      },
    };
    runtimeDescriptorRegistry.registerForPlugin('com.test.descriptor-rt', descriptor);
    expect(isValidRuntimeType('test-descriptor-only-rt')).toBe(true);
    runtimeDescriptorRegistry.removeForPlugin('com.test.descriptor-rt');
    expect(isValidRuntimeType('test-descriptor-only-rt')).toBe(false);
  });
});
