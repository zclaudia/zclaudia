import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import {
  LanguageServerError,
  type LanguageServerPort,
  type LspQueryRequest,
} from '../../language-server-port.js';
import { createLspTool, describeLanguageServers } from '../lsp-tool.js';

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
        return { action: 'diagnostics' as const, diagnostics: [], truncated: false };
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
