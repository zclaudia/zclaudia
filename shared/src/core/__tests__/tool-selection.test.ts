import { describe, expect, it } from 'vitest';

import {
  builtinToolRef,
  defaultToolSelection,
  getEffectiveReadOnly,
  legacyEnabledToolsToSelection,
  resolveToolSelection,
  toolRefKey,
  type ToolMetadata,
} from '../tools.js';

describe('tool selection resolver', () => {
  it('expands the core-coding built-in set including Glob', () => {
    const resolved = resolveToolSelection({
      sets: [{ source: 'builtin', id: 'core-coding' }],
      include: [],
      exclude: [],
    });

    expect(resolved.builtinTools).toEqual([
      'Read',
      'Write',
      'Edit',
      'Bash',
      'Grep',
      'Glob',
      'LS',
    ]);
    expect(resolved.refs.map(toolRefKey)).toEqual([
      'builtin:Read',
      'builtin:Write',
      'builtin:Edit',
      'builtin:Bash',
      'builtin:Grep',
      'builtin:Glob',
      'builtin:LS',
    ]);
  });

  it('applies include and exclude after expanding sets', () => {
    const resolved = resolveToolSelection({
      sets: [{ source: 'builtin', id: 'web' }],
      include: [
        builtinToolRef('Read'),
        { source: 'plugin', pluginId: 'jira', toolId: 'search' },
      ],
      exclude: [builtinToolRef('WebSearch')],
    });

    expect(resolved.refs.map(toolRefKey)).toEqual([
      'builtin:WebFetch',
      'builtin:Read',
      'plugin:jira/search',
    ]);
    expect(resolved.builtinTools).toEqual(['WebFetch', 'Read']);
  });

  it('converts legacy enabledTools strings to explicit built-in includes', () => {
    const selection = legacyEnabledToolsToSelection(['read', 'Glob', 'missing', 'bash', 'read']);

    expect(selection).toEqual({
      sets: [],
      providers: [],
      include: [builtinToolRef('Read'), builtinToolRef('Glob'), builtinToolRef('Bash')],
      exclude: [],
    });
  });

  it('initializes default selection with an empty external provider list', () => {
    expect(defaultToolSelection.providers).toEqual([]);
  });

  it('requires plugin trust before declared read-only becomes effective', () => {
    const metadata: ToolMetadata = {
      ref: { source: 'plugin', pluginId: 'jira', toolId: 'search' },
      label: 'Jira Search',
      declaredReadOnly: true,
      mutatesWorkspace: false,
      requiresNetwork: true,
      requiresUserInteraction: false,
      riskLevel: 'low',
    };

    expect(getEffectiveReadOnly(metadata, { pluginTrust: 'untrusted' })).toBe(false);
    expect(getEffectiveReadOnly(metadata, { pluginTrust: 'trusted' })).toBe(true);
  });

  it('preserves discoverable external providers without projecting them to built-in tools', () => {
    const selection = {
      sets: [{ source: 'builtin' as const, id: 'core-coding' as const }],
      providers: [
        { source: 'mcp' as const, serverId: 'github' },
        { source: 'plugin' as const, pluginId: 'jira', providerId: 'issues' },
      ],
      include: [],
      exclude: [],
    };

    const resolved = resolveToolSelection(selection);

    expect(resolved.builtinTools).toContain('Read');
    expect(resolved.refs.map(toolRefKey)).not.toContain('mcp-provider:github');
    expect(selection.providers).toEqual([
      { source: 'mcp', serverId: 'github' },
      { source: 'plugin', pluginId: 'jira', providerId: 'issues' },
    ]);
  });

  it('creates stable external tool keys for concrete MCP and plugin tools', () => {
    expect(toolRefKey({ source: 'mcp', server: 'github', tool: 'create_issue' })).toBe('mcp:github/create_issue');
    expect(toolRefKey({ source: 'plugin', pluginId: 'jira', toolId: 'search_issues' })).toBe('plugin:jira/search_issues');
  });

  it('lets exclude block a pinned external tool by stable key', () => {
    const ref = { source: 'mcp' as const, server: 'github', tool: 'create_issue' };
    const resolved = resolveToolSelection({
      sets: [],
      providers: [{ source: 'mcp', serverId: 'github' }],
      include: [ref],
      exclude: [ref],
    });

    expect(resolved.refs.map(toolRefKey)).not.toContain('mcp:github/create_issue');
    expect(resolved.builtinTools).toEqual([]);
  });
});
