import type {
  ExternalAgentAdapter,
  ProviderToolBridgeRequest,
} from '@zclaudia/plugin-sdk/providers';
import type { PluginContext } from '@zclaudia/plugin-sdk/runtime';
import type { ProviderToolBridgeEntry } from '@zclaudia/plugin-sdk/providers';

export type ToolBridgeFactory = (
  request: ProviderToolBridgeRequest
) => Promise<ProviderToolBridgeEntry | null>;

/** Register an adapter while keeping the permission check and bridge wiring consistent. */
export function registerAgentRuntime<T extends ExternalAgentAdapter>(
  context: PluginContext,
  runtimeName: string,
  createAdapter: (createToolBridge: ToolBridgeFactory) => T
): T {
  const runtimes = context.agentRuntimes;
  if (!runtimes) {
    throw new Error(`provider.register permission missing; cannot register ${runtimeName} runtime`);
  }

  const adapter = createAdapter(request => runtimes.createToolBridge(request));
  runtimes.register(adapter);
  return adapter;
}
