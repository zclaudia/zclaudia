import type { McpBridgeServerEntry } from '../../../utils/mcp-bridge-launch.js';

export const DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME = 'claudia-plugins';

export interface AgentPluginToolBridgeContext {
  serverPort?: number;
  zclaudiaSessionId?: string;
}

export type AgentPluginMcpBridgeEntry = McpBridgeServerEntry;

export async function createAgentPluginToolBridgeMcpEntry(
  context: AgentPluginToolBridgeContext
): Promise<AgentPluginMcpBridgeEntry | null> {
  if (!context.serverPort) return null;
  const { buildMcpBridgeEntry } = await import('../../../utils/mcp-bridge-launch.js');
  return buildMcpBridgeEntry(context.serverPort, context.zclaudiaSessionId);
}
