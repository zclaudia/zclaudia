import { describe, expect, it, vi } from 'vitest';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ManagedRuntimeResolution } from '@zclaudia/shared/plugins/managed-runtimes';
import { toExternalAgentRunContext } from '../../../../infra/providers/external-agent-shim.js';
import { resolveAgentProfileRuntime } from '../run-managed-runtime.js';

function profile(cliPath?: string): AgentProfileConfig {
  return {
    id: 'agent-1',
    name: 'Fixture',
    runtimeType: 'fixture',
    llmProfileId: '',
    model: '',
    cliPath,
    systemPrompt: '',
    enabledTools: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function resolution(patch: Partial<ManagedRuntimeResolution> = {}): ManagedRuntimeResolution {
  return {
    status: 'resolved',
    runtime: 'fixture',
    executablePath: '/runtime-store/fixture/1.2.3/linux-x64/bin/fixture',
    version: '1.2.3',
    source: 'managed',
    compatibilityState: 'compatible',
    authState: 'authenticated',
    verification: { checksumVerified: true },
    ...patch,
  };
}

describe('run managed runtime resolution', () => {
  it('passes only the host-resolved managed executable path to the adapter', async () => {
    const resolver = {
      resolveForRuntime: vi.fn(async () => resolution()),
    };
    const resolved = await resolveAgentProfileRuntime('fixture', profile(), resolver);
    const adapterContext = toExternalAgentRunContext({
      cwd: '/workspace',
      agentProfile: resolved.agentProfile,
    });
    expect(adapterContext.cliPath).toBe('/runtime-store/fixture/1.2.3/linux-x64/bin/fixture');
    expect(resolver.resolveForRuntime).toHaveBeenCalledWith('fixture', {
      explicitPath: undefined,
      headless: true,
      allowAutoInstall: true,
    });
  });

  it('leaves legacy plugins unchanged when no descriptor is registered', async () => {
    const original = profile('/legacy/custom-cli');
    const resolved = await resolveAgentProfileRuntime('legacy', original, {
      resolveForRuntime: vi.fn(async () => undefined),
    });
    expect(resolved.agentProfile).toBe(original);
  });

  it.each([
    ['needs-approval' as const, 'needs approval'],
    ['auth-required' as const, 'official login required'],
  ])('blocks launch for %s', async (status, message) => {
    await expect(
      resolveAgentProfileRuntime('fixture', profile(), {
        resolveForRuntime: vi.fn(async () =>
          resolution({
            status,
            authState: status === 'auth-required' ? 'auth-required' : 'unknown',
            message,
          })
        ),
      })
    ).rejects.toThrow(message);
  });
});
