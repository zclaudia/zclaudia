import { describe, expect, it } from 'vitest';

import type { McpToolRef } from '@zclaudia/shared/core/tools';
import type { ExternalToolRuntimeState } from '../external-tools.js';
import { buildPiRunToolBundle } from '../run-tools.js';

function externalState(): ExternalToolRuntimeState {
  const pinned: McpToolRef = { source: 'mcp', server: 'fs', tool: 'write_file' };
  return {
    discoverableProviders: [],
    pinnedExternalTools: [pinned],
    loadedExternalTools: [pinned],
  };
}

function buildBundle(isPlanMode: boolean) {
  return buildPiRunToolBundle({
    options: {
      cwd: '/tmp',
      externalToolState: externalState(),
    } as never,
    effectiveTools: [],
    supportsVision: false,
    isPlanMode,
    permissionCallback: async () => ({ behavior: 'deny' as const }),
  });
}

describe('buildPiRunToolBundle plan mode external tool gating (P0-6)', () => {
  it('excludes concrete MCP tools and LoadExternalTool in plan mode', () => {
    const bundle = buildBundle(true);
    const names = bundle.visibleToolNames;

    expect(names.some(name => name.startsWith('mcp__'))).toBe(false);
    expect(names).not.toContain('LoadExternalTool');
    expect(bundle.tools.some(tool => tool.name === 'LoadExternalTool')).toBe(false);
  });

  it('keeps read-only external discovery meta tools in plan mode', () => {
    const bundle = buildBundle(true);
    const names = bundle.visibleToolNames;

    expect(names).toContain('ListExternalToolProviders');
    expect(names).toContain('SearchExternalTools');
    expect(names).toContain('InspectExternalTool');
    expect(names).toContain('ReadExternalResource');
  });

  it('includes pinned MCP tools and LoadExternalTool outside plan mode', () => {
    const bundle = buildBundle(false);
    const names = bundle.visibleToolNames;

    expect(names).toContain('mcp__fs__write_file');
    expect(names).toContain('LoadExternalTool');
  });
});
