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

  it('reuses a host within one session and closes every session host', async () => {
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
    await manager.createEntry({ serverPort: 3100, sessionId: 'session-2' });
    await manager.close();

    expect(createPortableToolBridgeHost).toHaveBeenCalledTimes(2);
    expect(createPortableToolBridgeHost).toHaveBeenCalledWith({
      catalog: expect.objectContaining({
        listTools: expect.any(Function),
        callTool: expect.any(Function),
      }),
      requestTimeoutMs: 30_000,
    });
    expect(createEntry).toHaveBeenNthCalledWith(2, {
      name: 'claudia-plugins',
      sessionId: 'session-2',
    });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('rejects another session credential and forged session IDs at the real HTTP boundary', async () => {
    const callTool = vi.fn(async (_name, _args, context) => context.sessionId);
    const manager = new AgentToolBridgeHostManager({ catalog: { ...catalog, callTool } });
    try {
      const a = await manager.createEntry({ sessionId: 'session-a' });
      const b = await manager.createEntry({ sessionId: 'session-b' });
      const envA = (a!.config as { env: Record<string, string> }).env;
      const envB = (b!.config as { env: Record<string, string> }).env;
      const call = (url: string, token: string, sessionId?: string) =>
        fetch(`${url}/v1/tools/echo/call`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ arguments: {}, sessionId }),
        });
      expect(
        (await call(envB.AGENT_TOOL_BRIDGE_URL, envA.AGENT_TOOL_BRIDGE_TOKEN, 'session-b')).status
      ).toBe(401);
      expect(
        (await call(envA.AGENT_TOOL_BRIDGE_URL, envA.AGENT_TOOL_BRIDGE_TOKEN, 'session-b')).ok
      ).toBe(false);
      expect(callTool).not.toHaveBeenCalled();
      expect((await call(envA.AGENT_TOOL_BRIDGE_URL, envA.AGENT_TOOL_BRIDGE_TOKEN)).ok).toBe(true);
      expect(callTool).toHaveBeenCalledWith(
        'echo',
        {},
        expect.objectContaining({ sessionId: 'session-a' })
      );
    } finally {
      await manager.close();
    }
  });

  it('expires idle HTTP endpoints, retains overlapping runs, and recreates fresh credentials', async () => {
    const manager = new AgentToolBridgeHostManager({ catalog, idleTimeoutMs: 100 });
    const first = manager.retainSession('active');
    const second = manager.retainSession('active');
    const peer = manager.retainSession('peer');
    const env = (entry: any) => entry.config.env as Record<string, string>;
    const call = (entry: any) =>
      fetch(`${env(entry).AGENT_TOOL_BRIDGE_URL}/v1/tools/echo/call`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env(entry).AGENT_TOOL_BRIDGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ arguments: {} }),
      });
    try {
      const a = await manager.createEntry({ sessionId: 'active' });
      const b = await manager.createEntry({ sessionId: 'peer' });
      const idle = await manager.createEntry({ sessionId: 'idle' });
      first();
      first(); // A second release must not consume the other run's retention.
      await expect
        .poll(async () => {
          try {
            await call(idle);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
      expect((await call(a)).ok).toBe(true);
      expect((await call(b)).ok).toBe(true);
      second();
      await expect
        .poll(async () => {
          try {
            await call(a);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
      expect((await call(b)).ok).toBe(true);
      const resumed = manager.retainSession('active');
      try {
        const fresh = await manager.createEntry({ sessionId: 'active' });
        expect(env(fresh).AGENT_TOOL_BRIDGE_TOKEN).not.toBe(env(a).AGENT_TOOL_BRIDGE_TOKEN);
        expect((await call(fresh)).ok).toBe(true);
      } finally {
        resumed();
      }
    } finally {
      second();
      peer();
      await manager.close();
    }
  });

  it('waits for in-flight host creation during shutdown and rejects new entries', async () => {
    let resolveHost!: (host: any) => void;
    const close = vi.fn(async () => {});
    const manager = new AgentToolBridgeHostManager({
      catalog,
      loadModule: async () => ({
        createPortableToolBridgeHost: () =>
          new Promise(resolve => {
            resolveHost = resolve;
          }),
      }),
    });
    const creating = manager.createEntry({ sessionId: 'pending' });
    const rejected = expect(creating).rejects.toThrow('manager is closed');
    await vi.waitFor(() => expect(resolveHost).toBeTypeOf('function'));
    const closing = manager.close();
    resolveHost({ createEntry: vi.fn(), close });
    await rejected;
    await closing;
    await manager.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => manager.retainSession('late')).toThrow('manager is closed');
    await expect(manager.createEntry({ sessionId: 'late' })).rejects.toThrow('manager is closed');
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
