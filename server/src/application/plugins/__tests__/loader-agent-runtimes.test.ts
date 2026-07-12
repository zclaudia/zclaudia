import { describe, it, expect, afterEach } from 'vitest';
import {
  registerAgentRuntimeContributions,
  unregisterAgentRuntimeContributions,
} from '../agent-runtime-contributions.js';
import { runtimeDescriptorRegistry } from '../../../infra/providers/runtime-descriptor-registry.js';
import type { AgentRuntimeContribution } from '@zclaudia/shared/providers';

const PLUGIN = 'com.test.loader-rt';
const contribution: AgentRuntimeContribution = {
  type: 'loader-rt',
  label: 'LoaderRT',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'off' },
  hasCliPath: false,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'loader-rt',
    name: 'LoaderRT',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'loader-rt',
    runtime: 'cli',
    capabilities: [],
  },
};

afterEach(() => unregisterAgentRuntimeContributions(PLUGIN));

describe('agent-runtime contributions', () => {
  it('registers descriptors then removes them', () => {
    expect(registerAgentRuntimeContributions(PLUGIN, [contribution])).toBe(1);
    expect(runtimeDescriptorRegistry.get('loader-rt')?.label).toBe('LoaderRT');
    unregisterAgentRuntimeContributions(PLUGIN);
    expect(runtimeDescriptorRegistry.get('loader-rt')).toBeUndefined();
  });

  it('returns 0 and registers nothing when the list is empty or undefined', () => {
    expect(registerAgentRuntimeContributions(PLUGIN, undefined)).toBe(0);
    expect(registerAgentRuntimeContributions(PLUGIN, [])).toBe(0);
  });
});
