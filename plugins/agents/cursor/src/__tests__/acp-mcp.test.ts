import { describe, expect, it } from 'vitest';
import { mapBridgeToAcpMcpServers } from '../acp-mcp.js';
import { CursorAcpError } from '../errors.js';

describe('mapBridgeToAcpMcpServers', () => {
  it('maps a stdio bridge entry to an inline ACP MCP server (§11.1)', () => {
    const servers = mapBridgeToAcpMcpServers({
      name: 'zclaudia-bridge',
      config: {
        command: '/abs/path/node',
        args: ['bridge.js'],
        env: { TOKEN: 'secret-value', URL: 'http://127.0.0.1:1' },
      },
    });
    expect(servers).toEqual([
      {
        name: 'zclaudia-bridge',
        command: '/abs/path/node',
        args: ['bridge.js'],
        env: [
          { name: 'TOKEN', value: 'secret-value' },
          { name: 'URL', value: 'http://127.0.0.1:1' },
        ],
      },
    ]);
  });

  it('returns no servers for a null bridge', () => {
    expect(mapBridgeToAcpMcpServers(null)).toEqual([]);
    expect(mapBridgeToAcpMcpServers(undefined)).toEqual([]);
  });

  it('fails with CURSOR_MCP_BRIDGE_UNAVAILABLE for a non-object config (§11.1)', () => {
    expect(() => mapBridgeToAcpMcpServers({ name: 'b', config: 'not-an-object' })).toThrowError(
      CursorAcpError
    );
    try {
      mapBridgeToAcpMcpServers({ name: 'b', config: null });
    } catch (error) {
      expect((error as CursorAcpError).code).toBe('CURSOR_MCP_BRIDGE_UNAVAILABLE');
    }
  });

  it('fails when the config has no absolute command', () => {
    try {
      mapBridgeToAcpMcpServers({ name: 'b', config: { env: {} } });
      expect.unreachable();
    } catch (error) {
      expect((error as CursorAcpError).code).toBe('CURSOR_MCP_BRIDGE_UNAVAILABLE');
    }
    expect(() =>
      mapBridgeToAcpMcpServers({ name: 'b', config: { command: 'node' } })
    ).toThrowError(CursorAcpError);
  });

  it('rejects malformed args and env instead of silently changing the launch config', () => {
    expect(() =>
      mapBridgeToAcpMcpServers({
        name: 'b',
        config: { command: '/abs/node', args: ['bridge.js', 42] },
      })
    ).toThrowError(CursorAcpError);
    expect(() =>
      mapBridgeToAcpMcpServers({
        name: 'b',
        config: { command: '/abs/node', env: { OK: '1', BAD: 42 } },
      })
    ).toThrowError(CursorAcpError);
  });
});
