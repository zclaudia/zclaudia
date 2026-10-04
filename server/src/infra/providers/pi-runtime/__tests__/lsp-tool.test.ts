import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import {
  LanguageServerError,
  type LanguageServerPort,
  type LspQueryRequest,
} from '../../language-server-port.js';
import { createLspTool, describeLanguageServers, locateSymbol } from '../lsp-tool.js';

function fakePort(overrides: Partial<LanguageServerPort> = {}): LanguageServerPort & {
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (request: LspQueryRequest) => {
    switch (request.action) {
      case 'definition':
      case 'references':
        return {
          action: request.action,
          locations: [{ file: 'src/a.ts', line: 3, character: 5, preview: 'export const a' }],
        };
      case 'hover':
        return { action: 'hover' as const, contents: 'const a: number' };
      case 'documentSymbols':
      case 'workspaceSymbols':
        return {
          action: request.action,
          symbols: [
            { name: 'a', kind: 'variable', location: { file: 'src/a.ts', line: 3, character: 1 } },
          ],
        };
      case 'diagnostics':
        return {
          action: 'diagnostics' as const,
          state: 'ready' as const,
          diagnostics: [],
          truncated: false,
        };
      case 'incomingCalls':
        return { action: 'incomingCalls' as const, calls: [] };
    }
  });
  return {
    serversFor: () => [{ id: 'tsserver', name: 'TypeScript', languages: ['typescript'] }],
    query,
    ...overrides,
  } as LanguageServerPort & { query: ReturnType<typeof vi.fn> };
}

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'zclaudia-lsp-tool-'));
  writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
  return root;
}

describe('describeLanguageServers', () => {
  it('lists servers with their ids and languages', () => {
    expect(
      describeLanguageServers([
        { id: 'tsserver', name: 'TypeScript', languages: ['typescript', 'javascript'] },
        { id: 'pyright', name: 'Python', languages: [] },
      ])
    ).toBe(
      'Language servers available for this workspace: TypeScript (tsserver: typescript, javascript); Python (pyright: any).'
    );
  });
});

describe('locateSymbol', () => {
  it('finds the identifier as a whole word, by occurrence', () => {
    const line = 'const total = subtotal + total;';
    expect(locateSymbol(line, 'total')).toBe(7);
    expect(locateSymbol(line, 'total', 2)).toBe(26);
    expect(locateSymbol(line, 'total', 3)).toMatchObject({
      error: expect.stringContaining('2 time(s)'),
    });
  });

  it('lands on the last segment of a dotted name', () => {
    expect(locateSymbol('  return config.port;', 'config.port')).toBe(17);
  });

  it('counts columns in UTF-16 code units', () => {
    // '😀' is two UTF-16 code units, so `x` starts at index 6 (column 7).
    expect(locateSymbol("'😀', x", 'x')).toBe(7);
  });

  it('matches non-identifier text literally and reports misses with the line', () => {
    expect(locateSymbol('a => b', '=>')).toBe(3);
    expect(locateSymbol('const a = 1;', 'b')).toEqual({
      error: '"b" does not appear on that line: const a = 1;',
    });
  });
});

describe('LSPTool', () => {
  it('returns lsp_unavailable without a port', async () => {
    const tool = createLspTool({ cwd: workspace() }) as any;
    const result = await tool.execute('c1', {
      action: 'hover',
      file: 'a.ts',
      line: 1,
      character: 1,
    });
    expect(result.details).toMatchObject({ ok: false, error: 'lsp_unavailable' });
  });

  it('rejects unknown actions and missing targets before touching the port', async () => {
    const port = fakePort();
    const tool = createLspTool({ cwd: workspace(), port }) as any;
    expect((await tool.execute('c1', { action: 'rename' })).details).toMatchObject({
      ok: false,
      error: 'invalid_action',
    });
    expect((await tool.execute('c2', { action: 'definition' })).details).toMatchObject({
      ok: false,
      error: 'missing_file',
    });
    expect((await tool.execute('c3', { action: 'symbols' })).details).toMatchObject({
      ok: false,
      error: 'missing_target',
    });
    expect(
      (await tool.execute('c4', { action: 'hover', file: 'a.ts', line: 0, character: 1 })).details
    ).toMatchObject({ ok: false, error: 'invalid_position' });
    expect(port.query).not.toHaveBeenCalled();
  });

  it('refuses files outside the workspace', async () => {
    const port = fakePort();
    const tool = createLspTool({ cwd: workspace(), port }) as any;
    const result = await tool.execute('c1', {
      action: 'diagnostics',
      file: '../../etc/passwd',
    });
    expect(result.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
    expect(port.query).not.toHaveBeenCalled();
  });

  it('delegates positional queries with an absolute file and 1-based position', async () => {
    const cwd = workspace();
    const port = fakePort();
    const tool = createLspTool({ cwd, port }) as any;
    const result = await tool.execute('c1', {
      action: 'references',
      file: 'a.ts',
      line: 1,
      character: 14,
      max_results: 5,
    });
    expect(port.query).toHaveBeenCalledWith(
      {
        cwd,
        action: 'references',
        file: path.join(cwd, 'a.ts'),
        line: 1,
        character: 14,
        maxResults: 5,
      },
      undefined
    );
    expect(result.details).toMatchObject({ ok: true, action: 'references', total: 1 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.file).toBe('a.ts');
    expect(payload.locations[0]).toMatchObject({ file: 'src/a.ts', line: 3 });
  });

  it('turns line + symbol into the column of that identifier', async () => {
    const cwd = workspace();
    const port = fakePort();
    const tool = createLspTool({ cwd, port }) as any;
    await tool.execute('c1', { action: 'hover', file: 'a.ts', line: 1, symbol: 'a' });
    expect(port.query).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hover', line: 1, character: 14 }),
      undefined
    );
    await tool.execute('c2', { action: 'incomingCalls', file: 'a.ts', line: 1, symbol: 'a' });
    expect(port.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'incomingCalls', character: 14 }),
      undefined
    );
  });

  it('reports a symbol missing from the line without querying', async () => {
    const cwd = workspace();
    const port = fakePort();
    const tool = createLspTool({ cwd, port }) as any;
    const missing = await tool.execute('c1', {
      action: 'definition',
      file: 'a.ts',
      line: 1,
      symbol: 'b',
    });
    expect(missing.details).toMatchObject({ ok: false, error: 'symbol_not_found' });
    const pastEnd = await tool.execute('c2', {
      action: 'definition',
      file: 'a.ts',
      line: 9,
      symbol: 'a',
    });
    expect(pastEnd.details.message).toContain('past the end');
    const noTarget = await tool.execute('c3', { action: 'definition', file: 'a.ts', line: 1 });
    expect(noTarget.details).toMatchObject({ error: 'invalid_position' });
    expect(port.query).not.toHaveBeenCalled();
  });

  it('maps symbols to documentSymbols with a file and workspaceSymbols with a query', async () => {
    const cwd = workspace();
    const port = fakePort();
    const tool = createLspTool({ cwd, port }) as any;
    await tool.execute('c1', { action: 'symbols', file: 'a.ts' });
    await tool.execute('c2', { action: 'symbols', query: 'a' });
    expect(port.query.mock.calls[0][0]).toMatchObject({
      action: 'documentSymbols',
      file: path.join(cwd, 'a.ts'),
    });
    expect(port.query.mock.calls[0][0].query).toBeUndefined();
    expect(port.query.mock.calls[1][0]).toMatchObject({ action: 'workspaceSymbols', query: 'a' });
    expect(port.query.mock.calls[1][0].file).toBeUndefined();
  });

  it('clamps max_results and forwards the abort signal', async () => {
    const cwd = workspace();
    const port = fakePort();
    const tool = createLspTool({ cwd, port }) as any;
    const controller = new AbortController();
    await tool.execute(
      'c1',
      { action: 'diagnostics', file: 'a.ts', max_results: 9999 },
      controller.signal
    );
    expect(port.query.mock.calls[0][0].maxResults).toBe(200);
    expect(port.query.mock.calls[0][1]).toBe(controller.signal);
  });

  it('surfaces LanguageServerError codes and wraps other failures', async () => {
    const cwd = workspace();
    const failing = fakePort({
      query: vi.fn(async () => {
        throw new LanguageServerError('timeout', 'tsserver did not answer in 30s');
      }) as never,
    });
    const tool = createLspTool({ cwd, port: failing }) as any;
    const result = await tool.execute('c1', { action: 'diagnostics', file: 'a.ts' });
    expect(result.details).toMatchObject({ ok: false, error: 'timeout' });
    expect(result.content[0].text).toContain('did not answer');

    const crashing = fakePort({
      query: vi.fn(async () => {
        throw new Error('EPIPE');
      }) as never,
    });
    const tool2 = createLspTool({ cwd, port: crashing }) as any;
    const result2 = await tool2.execute('c2', { action: 'diagnostics', file: 'a.ts' });
    expect(result2.details).toMatchObject({
      ok: false,
      error: 'lsp_query_failed',
      message: 'EPIPE',
    });
  });
});
