import {
  buildMcpBridgeEntry,
  type McpBridgeServerEntry,
} from '../../../utils/mcp-bridge-launch.js';

export const DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME = 'claudia-plugins';

export interface AgentPluginToolBridgeContext {
  serverPort?: number;
  zclaudiaSessionId?: string;
}

export type AgentPluginMcpBridgeEntry = McpBridgeServerEntry;

export function createAgentPluginToolBridgeMcpEntry(
  context: AgentPluginToolBridgeContext
): AgentPluginMcpBridgeEntry | null {
  if (!context.serverPort) return null;
  return buildMcpBridgeEntry(context.serverPort, context.zclaudiaSessionId);
}
