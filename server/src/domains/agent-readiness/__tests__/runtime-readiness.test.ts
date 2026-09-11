import { describe, expect, it, vi } from 'vitest';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ManagedRuntimeResolution } from '@zclaudia/shared/plugins/managed-runtimes';
import { configureRuntimeReadinessInspector, resolveAgentExecutionReadiness } from '../check.js';
import { registerClaudeTestRuntime } from '../../../test/claude-runtime-fixture.js';

registerClaudeTestRuntime({ adapter: true });
const agent = {
  id: 'agent',
  runtimeType: 'claude',
  cliPath: '/test/cli',
  llmProfileId: '',
  model: '',
} as AgentProfileConfig;

describe('runtime execution readiness', () => {
  it.each([
    ['resolved', 'compatible', 'unknown', undefined],
    ['resolved', 'untested-newer', 'unknown', undefined],
    ['auth-required', 'compatible', 'auth-required', 'runtime_auth_required'],
    ['blocked', 'too-old', 'unknown', 'runtime_incompatible'],
    ['blocked', 'known-incompatible', 'unknown', 'runtime_incompatible'],
    ['managed-artifact-unavailable', 'missing', 'unknown', 'runtime_missing'],
  ])(
    '%s / %s / %s produces actionable readiness',
    async (status, compatibilityState, authState, reason) => {
      const inspect = vi.fn(
        async () => ({ status, compatibilityState, authState }) as ManagedRuntimeResolution
      );
      configureRuntimeReadinessInspector(inspect);
      expect(await resolveAgentExecutionReadiness(agent, undefined)).toEqual(
        reason ? { usable: false, reason } : { usable: true }
      );
      expect(inspect).toHaveBeenCalledWith(agent);
    }
  );

  it('reports an inspection failure without throwing or claiming readiness', async () => {
    configureRuntimeReadinessInspector(async () => {
      throw new Error('probe failed');
    });
    expect(await resolveAgentExecutionReadiness(agent, undefined)).toEqual({
      usable: false,
      reason: 'runtime_check_failed',
    });
  });
});
