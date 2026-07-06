import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildMcpBridgeEntryMock = vi.fn();

vi.mock('../../../../utils/mcp-bridge-launch.js', () => ({
  buildMcpBridgeEntry: buildMcpBridgeEntryMock,
}));

describe('agent plugin tool bridge', () => {
  beforeEach(() => {
    buildMcpBridgeEntryMock.mockReset();
  });

  it('creates a zclaudia tool bridge MCP entry from standard run context', async () => {
    buildMcpBridgeEntryMock.mockReturnValueOnce({
      command: 'node',
      args: ['mcp-bridge.js'],
      env: {
        CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100',
        CLAUDIA_SESSION_ID: 'session-1',
      },
    });

    const { createAgentPluginToolBridgeMcpEntry } = await import('../tool-bridge.js');
    const entry = await createAgentPluginToolBridgeMcpEntry({
      serverPort: 3100,
      zclaudiaSessionId: 'session-1',
    });

    expect(buildMcpBridgeEntryMock).toHaveBeenCalledWith(3100, 'session-1');
    expect(entry).toEqual({
      command: 'node',
      args: ['mcp-bridge.js'],
      env: {
        CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100',
        CLAUDIA_SESSION_ID: 'session-1',
      },
    });
  });

  it('does not create a bridge entry without a server port', async () => {
    const { createAgentPluginToolBridgeMcpEntry } = await import('../tool-bridge.js');

    expect(
      await createAgentPluginToolBridgeMcpEntry({
        serverPort: undefined,
        zclaudiaSessionId: 'session-1',
      })
    ).toBeNull();
    expect(buildMcpBridgeEntryMock).not.toHaveBeenCalled();
  });

  it('returns null when no bridge tools are registered', async () => {
    buildMcpBridgeEntryMock.mockReturnValueOnce(null);

    const { createAgentPluginToolBridgeMcpEntry } = await import('../tool-bridge.js');

    expect(
      await createAgentPluginToolBridgeMcpEntry({
        serverPort: 3100,
        zclaudiaSessionId: 'session-1',
      })
    ).toBeNull();
  });
});
