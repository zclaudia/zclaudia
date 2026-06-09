import { describe, expect, it } from 'vitest';

import {
  builtinToolRef,
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
      'Find',
      'Glob',
      'LS',
    ]);
    expect(resolved.refs.map(toolRefKey)).toEqual([
      'builtin:Read',
      'builtin:Write',
      'builtin:Edit',
      'builtin:Bash',
      'builtin:Grep',
      'builtin:Find',
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
      include: [builtinToolRef('Read'), builtinToolRef('Glob'), builtinToolRef('Bash')],
      exclude: [],
    });
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
});
