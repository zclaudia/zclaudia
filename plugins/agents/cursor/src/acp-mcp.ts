import type { ProviderToolBridgeEntry } from '@zclaudia/plugin-sdk/providers';
import type { McpServer } from '@agentclientprotocol/sdk';
import path from 'node:path';
import { CursorAcpError } from './errors.js';

/**
 * Map ZClaudia tool-bridge entries to ACP inline stdio MCP servers
 * (design doc §11.1 — end-to-end verified by the P0 probe).
 *
 * `ProviderToolBridgeEntry.config` is statically `unknown` (the external-agent
 * SDK owns its shape), so every field goes through a runtime guard; a malformed
 * entry fails the run with `CURSOR_MCP_BRIDGE_UNAVAILABLE` instead of throwing
 * an unguarded TypeError deep in the SDK.
 *
 * Env values pass as plain `{ name, value }` pairs — inline MCP never touches
 * the project's `.cursor/mcp.json`, so the `${VAR}` indirection the legacy
 * file-injection path needs does not apply here. Values stay inside the
 * subprocess boundary: they are not logged and not attached to events.
 */
export function mapBridgeToAcpMcpServers(
  bridge: ProviderToolBridgeEntry | null | undefined
): McpServer[] {
  if (!bridge) return [];
  const server = bridgeEntryToStdioServer(bridge);
  return server ? [server] : [];
}

function bridgeEntryToStdioServer(entry: ProviderToolBridgeEntry): McpServer | null {
  const config = entry.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new CursorAcpError(
      'CURSOR_MCP_BRIDGE_UNAVAILABLE',
      `Tool bridge "${entry.name}" has an unsupported config shape; the ZClaudia bridge cannot be attached to this ACP session.`
    );
  }
  const record = config as {
    command?: unknown;
    args?: unknown;
    env?: unknown;
  };
  if (typeof record.command !== 'string' || !path.isAbsolute(record.command)) {
    throw new CursorAcpError(
      'CURSOR_MCP_BRIDGE_UNAVAILABLE',
      `Tool bridge "${entry.name}" must use an absolute command path; the ZClaudia bridge cannot be attached to this ACP session.`
    );
  }
  if (
    record.args !== undefined &&
    (!Array.isArray(record.args) || !record.args.every(value => typeof value === 'string'))
  ) {
    throw new CursorAcpError(
      'CURSOR_MCP_BRIDGE_UNAVAILABLE',
      `Tool bridge "${entry.name}" has invalid arguments; the ZClaudia bridge cannot be attached to this ACP session.`
    );
  }
  const args = (record.args ?? []) as string[];
  const env: Array<{ name: string; value: string }> = [];
  if (record.env !== undefined && record.env !== null) {
    if (typeof record.env !== 'object' || Array.isArray(record.env)) {
      throw new CursorAcpError(
        'CURSOR_MCP_BRIDGE_UNAVAILABLE',
        `Tool bridge "${entry.name}" has an invalid env block; the ZClaudia bridge cannot be attached to this ACP session.`
      );
    }
    for (const [name, value] of Object.entries(record.env as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new CursorAcpError(
          'CURSOR_MCP_BRIDGE_UNAVAILABLE',
          `Tool bridge "${entry.name}" has a non-string environment value; the ZClaudia bridge cannot be attached to this ACP session.`
        );
      }
      env.push({ name, value });
    }
  }
  return {
    // stdio is the ACP baseline transport: no `type` discriminator (§2.1).
    name: entry.name,
    command: record.command,
    args,
    env,
  };
}
