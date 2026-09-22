import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import type { McpToolRef } from '@zclaudia/shared/core/tools';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
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

describe('buildPiRunToolBundle abortSignal wiring (P1-10)', () => {
  function buildWithAbort(abortController?: AbortController) {
    return buildPiRunToolBundle({
      options: {
        cwd: '/tmp',
        abortController,
      } as never,
      effectiveTools: [],
      supportsVision: false,
      isPlanMode: false,
      permissionCallback: async () => ({ behavior: 'allow' as const }),
    });
  }

  it('shouldStopAfterTurn returns false when no abortController is provided', async () => {
    const bundle = buildWithAbort();
    await expect(bundle.hooks.shouldStopAfterTurn!({} as never)).resolves.toBe(false);
  });

  it('shouldStopAfterTurn returns false while the controller is not aborted', async () => {
    const bundle = buildWithAbort(new AbortController());
    await expect(bundle.hooks.shouldStopAfterTurn!({} as never)).resolves.toBe(false);
  });

  it('shouldStopAfterTurn returns true once the run abort controller fires', async () => {
    const abortController = new AbortController();
    const bundle = buildWithAbort(abortController);
    abortController.abort();
    await expect(bundle.hooks.shouldStopAfterTurn!({} as never)).resolves.toBe(true);
  });
});

describe('buildPiRunToolBundle backgroundable tool announcement', () => {
  function buildWith(input: {
    db?: Database.Database;
    sessionId?: string;
    isPlanMode: boolean;
    tools: string[];
  }) {
    return buildPiRunToolBundle({
      options: {
        cwd: '/tmp',
        db: input.db,
        claudiaSessionId: input.sessionId,
      } as never,
      effectiveTools: input.tools as never,
      supportsVision: false,
      isPlanMode: input.isPlanMode,
      permissionCallback: async () => ({ behavior: 'allow' as const }),
    });
  }

  function memoryDb(): Database.Database {
    const db = new Database(':memory:');
    applyMigrations(db);
    return db;
  }

  it('announces Bash when a task store and session exist outside plan mode', () => {
    const db = memoryDb();
    try {
      const bundle = buildWith({ db, sessionId: 's1', isPlanMode: false, tools: ['Bash', 'Read'] });
      expect(bundle.backgroundableToolNames).toEqual(['Bash']);
    } finally {
      db.close();
    }
  });

  it('announces nothing in plan mode (read-only sandbox cannot adopt a task)', () => {
    const db = memoryDb();
    try {
      const bundle = buildWith({ db, sessionId: 's1', isPlanMode: true, tools: ['Bash'] });
      expect(bundle.backgroundableToolNames).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('announces nothing without a task store or when Bash is not enabled', () => {
    expect(
      buildWith({ sessionId: 's1', isPlanMode: false, tools: ['Bash'] }).backgroundableToolNames
    ).toEqual([]);
    const db = memoryDb();
    try {
      expect(
        buildWith({ db, sessionId: 's1', isPlanMode: false, tools: ['Read'] })
          .backgroundableToolNames
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
});
