/**
 * Unit tests for context.agentRuntimes (plugin-context.ts)
 *
 * plugin-context.ts gates `agentRuntimes` on
 * `permissionManager.hasPermission(pluginId, 'provider.register')`. The real
 * PermissionManager singleton persists grants to disk via `fs.writeFileSync`
 * (see permissions.ts `saveStore`), and the only existing test that grants
 * permissions on the real singleton (loader.test.ts) mocks the whole `fs`
 * module to avoid touching the real filesystem. worker-host.test.ts instead
 * mocks the `permissions.js` module outright and stubs `hasPermission`
 * per-test — a lighter-weight pattern with no disk-IO risk, which this file
 * follows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPluginContext } from '../plugin-context.js';
import { permissionManager } from '../permissions.js';
import { providerRegistry } from '../../../infra/providers/registry.js';
import { runtimeDescriptorRegistry } from '../../../infra/providers/runtime-descriptor-registry.js';
import type { AgentRuntimeDescriptor, ExternalAgentAdapter } from '@zclaudia/shared/providers';

vi.mock('../permissions.js', () => ({
  permissionManager: {
    hasPermission: vi.fn(() => false),
    hasAllPermissions: vi.fn(() => false),
    getGrantedPermissions: vi.fn(() => []),
  },
}));

const PLUGIN = 'com.test.rt-ctx';

const descriptor: AgentRuntimeDescriptor = {
  type: 'test-ctx-rt',
  label: 'Test',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'off' },
  hasCliPath: false,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'test-ctx-rt',
    name: 'Test',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'test-ctx-rt',
    runtime: 'cli',
    capabilities: [],
  },
};

const ext: ExternalAgentAdapter = {
  type: 'test-ctx-rt',
  async *run() {},
};

function descriptorFor(type: string): AgentRuntimeDescriptor {
  return {
    ...descriptor,
    type,
    manifest: { ...descriptor.manifest, id: type, providerType: type },
  };
}

function extFor(type: string): ExternalAgentAdapter {
  return { type, async *run() {} };
}

function makeContext(broadcast: ((msg: unknown) => void) | null = null) {
  return createPluginContext({
    pluginId: PLUGIN,
    instance: { manifest: { id: PLUGIN } as any, path: '/x', isActive: true },
    db: null,
    broadcast: broadcast as any,
    pluginAPIs: new Map(),
  }) as any;
}

describe('context.agentRuntimes', () => {
  beforeEach(() => {
    providerRegistry.removePluginAdapters(PLUGIN);
    runtimeDescriptorRegistry.removeForPlugin(PLUGIN);
    vi.mocked(permissionManager.hasPermission).mockReset();
  });

  it('is undefined when provider.register is not granted', () => {
    vi.mocked(permissionManager.hasPermission).mockReturnValue(false);
    runtimeDescriptorRegistry.registerForPlugin(PLUGIN, descriptor);

    const ctx = makeContext();

    expect(ctx.agentRuntimes).toBeUndefined();
  });

  it('registers the adapter into providerRegistry when permission granted and descriptor present', () => {
    vi.mocked(permissionManager.hasPermission).mockImplementation(
      (_pluginId: string, permission: string) => permission === 'provider.register'
    );
    runtimeDescriptorRegistry.registerForPlugin(PLUGIN, descriptor);

    const ctx = makeContext();

    expect(ctx.agentRuntimes).toBeDefined();
    ctx.agentRuntimes.register(ext);
    expect(providerRegistry.hasType('test-ctx-rt')).toBe(true);
  });

  it('broadcasts agent_runtimes_changed on register', () => {
    vi.mocked(permissionManager.hasPermission).mockImplementation(
      (_pluginId: string, permission: string) => permission === 'provider.register'
    );
    runtimeDescriptorRegistry.registerForPlugin(PLUGIN, descriptor);
    const broadcast = vi.fn();

    const ctx = makeContext(broadcast);
    ctx.agentRuntimes.register(ext);

    expect(broadcast).toHaveBeenCalledWith({ type: 'agent_runtimes_changed' });
  });

  it('throws when no agentRuntimes contribution declares the adapter type', () => {
    vi.mocked(permissionManager.hasPermission).mockImplementation(
      (_pluginId: string, permission: string) => permission === 'provider.register'
    );
    // No runtimeDescriptorRegistry.registerForPlugin call for this plugin/type.

    const ctx = makeContext();

    expect(() => ctx.agentRuntimes.register(ext)).toThrow(/No agentRuntimes contribution/);
  });

  it('removes the plugin adapters and broadcasts on unregister', () => {
    vi.mocked(permissionManager.hasPermission).mockImplementation(
      (_pluginId: string, permission: string) => permission === 'provider.register'
    );
    runtimeDescriptorRegistry.registerForPlugin(PLUGIN, descriptor);
    const broadcast = vi.fn();
    const ctx = makeContext(broadcast);
    ctx.agentRuntimes.register(ext);
    expect(providerRegistry.hasType('test-ctx-rt')).toBe(true);

    ctx.agentRuntimes.unregister('test-ctx-rt');

    expect(providerRegistry.hasType('test-ctx-rt')).toBe(false);
    expect(broadcast).toHaveBeenLastCalledWith({ type: 'agent_runtimes_changed' });
  });

  it("unregister(type) removes only that runtime, leaving the plugin's other runtimes", () => {
    vi.mocked(permissionManager.hasPermission).mockImplementation(
      (_pluginId: string, permission: string) => permission === 'provider.register'
    );
    const descA = descriptorFor('rt-a');
    const descB = descriptorFor('rt-b');
    runtimeDescriptorRegistry.registerForPlugin(PLUGIN, descA);
    runtimeDescriptorRegistry.registerForPlugin(PLUGIN, descB);

    const ctx = makeContext();
    ctx.agentRuntimes.register(extFor('rt-a'));
    ctx.agentRuntimes.register(extFor('rt-b'));
    expect(providerRegistry.hasType('rt-a')).toBe(true);
    expect(providerRegistry.hasType('rt-b')).toBe(true);

    ctx.agentRuntimes.unregister('rt-a');

    expect(providerRegistry.hasType('rt-a')).toBe(false);
    expect(providerRegistry.hasType('rt-b')).toBe(true);

    // Clean up the extra plugin adapters registered in this test.
    providerRegistry.removePluginAdapters(PLUGIN);
  });

  it('createToolBridge resolves to null when no serverPort is supplied', async () => {
    vi.mocked(permissionManager.hasPermission).mockImplementation(
      (_pluginId: string, permission: string) => permission === 'provider.register'
    );

    const ctx = makeContext();

    const result = await ctx.agentRuntimes.createToolBridge({});

    expect(result).toBeNull();
  });
});
