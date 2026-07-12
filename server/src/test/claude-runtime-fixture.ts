import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';
import { providerRegistry } from '../infra/providers/registry.js';
import { runtimeDescriptorRegistry } from '../infra/providers/runtime-descriptor-registry.js';

/**
 * The claude runtime now ships as the `com.zclaudia.claude` plugin rather than a
 * server built-in. Tests that exercise claude-runtime behaviour (persistence,
 * adapter selection, native readiness) must simulate the plugin being active by
 * registering its descriptor (and, when the run path is exercised, an adapter).
 */
const CLAUDE_TEST_DESCRIPTOR: AgentRuntimeDescriptor = {
  type: 'claude',
  label: 'Claude',
  model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'auto' },
  hasCliPath: true,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'claude',
    name: 'Claude',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'claude',
    runtime: 'cli',
    capabilities: [],
  },
};

const CLAUDE_TEST_PLUGIN_ID = 'com.zclaudia.claude';

/** Simulate the com.zclaudia.claude plugin being active for the current test file. */
export function registerClaudeTestRuntime(opts: { adapter?: boolean } = {}): void {
  if (!runtimeDescriptorRegistry.hasType('claude')) {
    runtimeDescriptorRegistry.registerForPlugin(CLAUDE_TEST_PLUGIN_ID, CLAUDE_TEST_DESCRIPTOR);
  }
  if (opts.adapter && !providerRegistry.hasType('claude')) {
    providerRegistry.registerPluginAdapter(CLAUDE_TEST_PLUGIN_ID, {
      type: 'claude',
      async *run() {
        /* no-op */
      },
    });
  }
}
