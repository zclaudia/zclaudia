import { describe, expect, it } from 'vitest';
import type { PCPEffectiveProfile } from '@zclaudia/shared/core/pcp';
import {
  createZClaudiaToolCatalog,
  resolveAgentToolScope,
} from '../tool-catalog.js';
import { ToolRegistry, type ToolMeta } from '../tool-registry.js';

function makeTool(overrides: Partial<ToolMeta> & { id: string }): ToolMeta {
  return {
    definition: {
      type: 'function',
      function: {
        name: overrides.id,
        description: `${overrides.id} description`,
        parameters: { type: 'object', properties: {} },
      },
    },
    handler: () => `${overrides.id} result`,
    source: 'plugin',
    ...overrides,
  } as ToolMeta;
}

function makeCatalog(registry: ToolRegistry, deps: Parameters<typeof createZClaudiaToolCatalog>[0] = {}) {
  return createZClaudiaToolCatalog({ registry, ...deps });
}

describe('resolveAgentToolScope', () => {
  it('maps (sessionId, sessionType) pairs to scopes', () => {
    expect(resolveAgentToolScope(undefined, undefined)).toBe('plugin-panel');
    expect(resolveAgentToolScope('s1', 'agent')).toBe('agent-assistant');
    expect(resolveAgentToolScope('s1', 'main')).toBe('main-session');
  });
});

describe('createZClaudiaToolCatalog', () => {
  it('listTools surfaces only bridge-source tools allowed in the caller scope', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ id: 'plugin_tool', source: 'plugin' }));
    registry.register(makeTool({ id: 'skill_tool', source: 'skill' }));
    registry.register(makeTool({ id: 'builtin_tool', source: 'builtin' }));
    registry.register(makeTool({ id: 'scoped_out', source: 'plugin', scope: ['command-palette'] }));

    const catalog = makeCatalog(registry);
    const names = catalog
      .listTools({ sessionId: 's1' })
      .map(tool => tool.name)
      .sort();
    expect(names).toEqual(['plugin_tool', 'skill_tool']);
  });

  it('callTool executes a bridge tool allowed in scope', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ id: 'plugin_tool', source: 'plugin' }));
    const catalog = makeCatalog(registry);

    await expect(
      catalog.callTool('plugin_tool', {}, { sessionId: 's1', signal: new AbortController().signal })
    ).resolves.toBe('plugin_tool result');
  });

  it('callTool rejects a scope-allowed but non-bridge-source tool as unknown', async () => {
    const registry = new ToolRegistry();
    let called = false;
    registry.register(
      makeTool({
        id: 'builtin_tool',
        source: 'builtin',
        handler: () => {
          called = true;
          return 'should never run';
        },
      })
    );
    const catalog = makeCatalog(registry);

    const result = await catalog.callTool('builtin_tool', {}, {
      sessionId: 's1',
      signal: new AbortController().signal,
    });
    expect(JSON.parse(result)).toEqual({ error: 'Unknown tool: builtin_tool' });
    expect(called).toBe(false);
  });

  it('callTool still lets the registry enforce scope for bridge tools', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ id: 'scoped_out', source: 'plugin', scope: ['command-palette'] }));
    const catalog = makeCatalog(registry);

    const result = await catalog.callTool('scoped_out', {}, {
      sessionId: 's1',
      signal: new AbortController().signal,
    });
    expect(JSON.parse(result).error).toContain('not available in scope');
  });

  it('callTool reports a pre-aborted signal without executing', async () => {
    const registry = new ToolRegistry();
    let called = false;
    registry.register(
      makeTool({
        id: 'plugin_tool',
        source: 'plugin',
        handler: () => {
          called = true;
          return 'x';
        },
      })
    );
    const catalog = makeCatalog(registry);
    const controller = new AbortController();
    controller.abort();

    const result = await catalog.callTool('plugin_tool', {}, {
      sessionId: 's1',
      signal: controller.signal,
    });
    expect(JSON.parse(result).error).toContain('aborted');
    expect(called).toBe(false);
  });

  it('hides interaction tools the active profile lacks capability for', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ id: 'ask_user_form', source: 'interaction' }));
    const profile = { capabilities: [] } as unknown as PCPEffectiveProfile;
    const catalog = makeCatalog(registry, {
      getActiveProfile: () => profile,
      getSessionType: () => 'main',
    });

    expect(catalog.listTools({ sessionId: 's1' })).toEqual([]);
    const result = await catalog.callTool('ask_user_form', {}, {
      sessionId: 's1',
      signal: new AbortController().signal,
    });
    expect(JSON.parse(result).error).toContain('not available for this provider');
  });
});
