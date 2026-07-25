import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ManagedRuntimeResolution } from '@zclaudia/shared/plugins/managed-runtimes';
import {
  ManagedRuntimeResolutionError,
  managedRuntimeService,
} from '../../../application/managed-runtimes/service.js';

interface ManagedRuntimeResolver {
  resolveForRuntime(
    runtime: string,
    options: {
      explicitPath?: string;
      headless?: boolean;
      allowAutoInstall?: boolean;
    }
  ): Promise<ManagedRuntimeResolution | undefined>;
}

export async function resolveAgentProfileRuntime(
  providerType: string,
  agentProfile: AgentProfileConfig,
  resolver: ManagedRuntimeResolver = managedRuntimeService
): Promise<{
  agentProfile: AgentProfileConfig;
  resolution?: ManagedRuntimeResolution;
}> {
  const resolution = await resolver.resolveForRuntime(providerType, {
    explicitPath: agentProfile.cliPath,
    headless: true,
    allowAutoInstall: true,
  });
  if (!resolution) return { agentProfile };
  if (resolution.status !== 'resolved' || !resolution.executablePath) {
    throw new ManagedRuntimeResolutionError(resolution);
  }
  return {
    agentProfile: { ...agentProfile, cliPath: resolution.executablePath },
    resolution,
  };
}
