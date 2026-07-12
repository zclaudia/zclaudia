import { runtimeDescriptorRegistry } from '../../infra/providers/runtime-descriptor-registry.js';
import type { AgentRuntimeContribution } from '@zclaudia/shared/providers';

export function registerAgentRuntimeContributions(
  pluginId: string,
  list: AgentRuntimeContribution[] | undefined
): number {
  if (!list?.length) return 0;
  for (const descriptor of list) {
    runtimeDescriptorRegistry.registerForPlugin(pluginId, descriptor);
  }
  return list.length;
}

export function unregisterAgentRuntimeContributions(pluginId: string): void {
  runtimeDescriptorRegistry.removeForPlugin(pluginId);
}
