import { describe, expect, it, vi } from 'vitest';
import {
  AgentToolBridgeHostManager,
  resolveBundledAgentToolBridgeStdioLaunch,
} from '../agent-tool-bridge-host.js';

const catalog = {
  listTools: () => [
    {
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
    },
  ],
  callTool: async () => '',
};

describe('AgentToolBridgeHostManager', () => {
  it('resolves the stdio proxy copied beside the bundled server', () => {
    expect(
      resolveBundledAgentToolBridgeStdioLaunch(
        'file:///opt/zclaudia/server.mjs',
        candidate => candidate === '/opt/zclaudia/application/plugins/agent-tool-bridge-stdio.js'
      )
    ).toEqual({
      command: process.execPath,
      args: ['/opt/zclaudia/application/plugins/agent-tool-bridge-stdio.js'],
    });
  });

  it('does not start a bridge when no tools are available for the session', async () => {
    const loadModule = vi.fn();
    const createLegacyEntry = vi.fn();
    const manager = new AgentToolBridgeHostManager({
      catalog: {
        listTools: () => [],
        callTool: async () => '',
      },
      loadModule,
      createLegacyEntry,
    });

    await expect(manager.createEntry({ serverPort: 3100 })).resolves.toBeNull();
    expect(loadModule).not.toHaveBeenCalled();
    expect(createLegacyEntry).not.toHaveBeenCalled();
  });

  it('uses the installed portable bridge by default', async () => {
    const manager = new AgentToolBridgeHostManager({ catalog });

    try {
      const entry = await manager.createEntry({ sessionId: 'session-1' });
      expect(entry?.name).toBe('claudia-plugins');
      expect(entry?.config).toMatchObject({
        command: process.execPath,
        env: {
          AGENT_TOOL_BRIDGE_SESSION_ID: 'session-1',
        },
      });
      expect((entry?.config as { args?: string[] }).args?.[0]).toMatch(
        /[/\\]@zclaudia[/\\]agent-tool-bridge[/\\]dist[/\\]stdio-bridge\.js$/
      );
    } finally {
      await manager.close();
    }
  });

  it('reuses one portable host for session-specific entries and closes it', async () => {
    const close = vi.fn(async () => {});
    const createEntry = vi.fn(options => ({
      name: options.name,
      config: { sessionId: options.sessionId },
    }));
    const createPortableToolBridgeHost = vi.fn(async () => ({
      createEntry,
      close,
    }));
    const manager = new AgentToolBridgeHostManager({
      catalog,
      loadModule: async () => ({ createPortableToolBridgeHost }),
      createLegacyEntry: vi.fn(),
    });

    await expect(
      manager.createEntry({ serverPort: 3100, sessionId: 'session-1' })
    ).resolves.toEqual({
      name: 'claudia-plugins',
      config: { sessionId: 'session-1' },
    });
    await manager.createEntry({ serverPort: 3100, sessionId: 'session-2' });
    await manager.close();

    expect(createPortableToolBridgeHost).toHaveBeenCalledTimes(1);
    expect(createPortableToolBridgeHost).toHaveBeenCalledWith({
      catalog,
      requestTimeoutMs: 30_000,
    });
    expect(createEntry).toHaveBeenNthCalledWith(2, {
      name: 'claudia-plugins',
      sessionId: 'session-2',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('falls back once when the public bridge package is unavailable', async () => {
    const missingPackage = Object.assign(
      new Error("Cannot find package '@zclaudia/agent-tool-bridge'"),
      { code: 'ERR_MODULE_NOT_FOUND' }
    );
    const loadModule = vi.fn(async () => {
      throw missingPackage;
    });
    const createLegacyEntry = vi.fn(async ({ zclaudiaSessionId }) => ({
      command: 'node',
      args: ['legacy.js'],
      env: { CLAUDIA_SESSION_ID: zclaudiaSessionId || '' },
    }));
    const warn = vi.fn();
    const manager = new AgentToolBridgeHostManager({
      catalog,
      loadModule,
      createLegacyEntry,
      log: { warn },
    });

    await expect(
      manager.createEntry({ serverPort: 3100, sessionId: 'session-1' })
    ).resolves.toMatchObject({
      name: 'claudia-plugins',
      config: { command: 'node' },
    });
    await manager.createEntry({ serverPort: 3100, sessionId: 'session-2' });

    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(createLegacyEntry).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not hide failures from an installed portable bridge', async () => {
    const manager = new AgentToolBridgeHostManager({
      catalog,
      loadModule: async () => ({
        createPortableToolBridgeHost: async () => {
          throw new Error('bridge bind failed');
        },
      }),
      createLegacyEntry: vi.fn(),
    });

    await expect(manager.createEntry({ serverPort: 3100 })).rejects.toThrow('bridge bind failed');
  });
});
