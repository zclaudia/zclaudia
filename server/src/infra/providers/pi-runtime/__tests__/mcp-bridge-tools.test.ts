import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { mcpClientManager } from '../../../../utils/mcp-client-manager.js';
import { mcpInventoryCache } from '../../../../utils/mcp-inventory-cache.js';
import {
  createListMcpResourcesTool,
  createMcpTool,
  createReadMcpResourceTool,
  createToolSearchTool,
} from '../mcp-bridge-tools.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(
    `
    INSERT INTO mcp_servers (name, command, args, env, enabled, provider_scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `
  ).run('github', 'node', '[]', null, '["zclaudia"]', Date.now(), Date.now());
  return db;
}

function mockInventory(
  tools: Array<Record<string, unknown>>,
  resources: Array<Record<string, unknown>> = []
) {
  vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue(tools as never);
  vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue(resources as never);
  vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
}

describe('MCP bridge tools', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    mcpInventoryCache.invalidate();
    delete process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS;
    delete process.env.ZCLAUDIA_MCP_OUTPUT_DIR;
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('MCPTool reports missing db context as a structured error', async () => {
    const tool = createMcpTool() as any;

    const result = await tool.execute('mcp-1', { server: 'github', tool: 'list_issues' });

    expect(result.details).toMatchObject({
      ok: false,
      error: 'missing_db_context',
      server: 'github',
      tool: 'list_issues',
    });
  });

  it('ToolSearch reports missing db context as a structured error', async () => {
    const tool = createToolSearchTool() as any;

    const result = await tool.execute('search-1', { query: 'issue' });

    expect(result.details).toMatchObject({ ok: false, error: 'missing_db_context' });
  });

  it('resource tools report missing db context as structured errors', async () => {
    const list = createListMcpResourcesTool() as any;
    const read = createReadMcpResourceTool() as any;

    const listResult = await list.execute('list-1', {});
    const readResult = await read.execute('read-1', { server: 'docs', uri: 'file://doc' });

    expect(listResult.details).toMatchObject({ ok: false, error: 'missing_db_context' });
    expect(readResult.details).toMatchObject({
      ok: false,
      error: 'missing_db_context',
      server: 'docs',
    });
  });

  it('blocks a trust-policy-denied tool through the generic MCPTool bridge (P1-15)', async () => {
    mockInventory([
      {
        name: 'delete_issue',
        description: 'Delete an issue',
        inputSchema: { type: 'object' },
        annotations: { destructiveHint: true },
      },
    ]);
    const callTool = vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'deleted' }],
      isError: false,
    } as never);
    const db = createDb();
    db.prepare('UPDATE mcp_servers SET trust_policy = ? WHERE name = ?').run(
      JSON.stringify({
        trustLevel: 'untrusted',
        trustReadOnlyHint: false,
        defaultRiskAction: 'ask',
        riskActions: { high: 'deny' },
      }),
      'github'
    );

    const tool = createMcpTool(db) as any;
    const result = await tool.execute('bridge-denied-call', {
      server: 'github',
      tool: 'delete_issue',
      arguments: { id: '1' },
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Denied by MCP trust policy');
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'mcp_tool_denied_by_policy',
        server: 'github',
        tool: 'delete_issue',
        mcpTrust: expect.objectContaining({
          server: 'github',
          tool: 'delete_issue',
          riskLevel: 'high',
          policyDecision: 'deny',
        }),
      })
    );
  });

  it('truncates and persists oversized MCPTool output like concrete tools (P1-15)', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-bridge-output-'));
    tempDirs.push(outputDir);
    process.env.ZCLAUDIA_MCP_OUTPUT_DIR = outputDir;
    process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS = '16';
    mockInventory([
      {
        name: 'dump_logs',
        description: 'Dump logs',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    ]);
    vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }],
      isError: false,
    } as never);

    const tool = createMcpTool(createDb()) as any;
    const result = await tool.execute('bridge-dump-logs', { server: 'github', tool: 'dump_logs' });

    expect(result.content[0].text).toContain(
      'abcdefghijklmnop\n\n[OUTPUT TRUNCATED: MCP text result exceeded 16 characters]'
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        outputTruncated: true,
        originalOutputChars: 26,
        outputPersisted: true,
        outputFiles: [expect.stringMatching(/dump_logs-\d+-0\.txt$/)],
      })
    );
    const savedPath = (result.details.outputFiles as string[])[0];
    expect(savedPath.startsWith(outputDir)).toBe(true);
    expect(await readFile(savedPath, 'utf8')).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('keeps the MCPTool happy path unchanged for small results', async () => {
    mockInventory([
      {
        name: 'get_issue',
        description: 'Get an issue',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
    ]);
    vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'issue body' }],
      isError: false,
    } as never);

    const tool = createMcpTool(createDb()) as any;
    const result = await tool.execute('bridge-get-issue', {
      server: 'github',
      tool: 'get_issue',
      arguments: { id: '1' },
    });

    expect(result.content).toEqual([{ type: 'text', text: 'issue body' }]);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        server: 'github',
        tool: 'get_issue',
        isError: false,
      })
    );
    expect(result.details.outputTruncated).toBeUndefined();
  });

  it('persists ReadMcpResource binary blobs to disk instead of inlining base64 (P1-15)', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-bridge-output-'));
    tempDirs.push(outputDir);
    process.env.ZCLAUDIA_MCP_OUTPUT_DIR = outputDir;
    const pdfBytes = Buffer.from('%PDF fake data');
    vi.spyOn(mcpClientManager, 'readResource').mockResolvedValue({
      contents: [
        {
          uri: 'file://report.pdf',
          mimeType: 'application/pdf',
          blob: pdfBytes.toString('base64'),
        },
      ],
    } as never);

    const tool = createReadMcpResourceTool(createDb()) as any;
    const result = await tool.execute('bridge-read-resource', {
      server: 'github',
      uri: 'file://report.pdf',
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        server: 'github',
        uri: 'file://report.pdf',
        count: 1,
        outputPersisted: true,
        outputFiles: [expect.stringMatching(/report\.pdf-\d+-0\.pdf$/)],
      })
    );
    const savedPath = (result.details.outputFiles as string[])[0];
    expect(await readFile(savedPath)).toEqual(pdfBytes);
    // The base64 blob itself must not reach the model context.
    expect(result.content[0].text).not.toContain(pdfBytes.toString('base64'));
    expect(result.content[0].text).toContain(savedPath);
  });

  it('truncates oversized ReadMcpResource text payloads (P1-15)', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-bridge-output-'));
    tempDirs.push(outputDir);
    process.env.ZCLAUDIA_MCP_OUTPUT_DIR = outputDir;
    process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS = '64';
    vi.spyOn(mcpClientManager, 'readResource').mockResolvedValue({
      contents: [
        {
          uri: 'file://big.txt',
          mimeType: 'text/plain',
          text: 'z'.repeat(500),
        },
      ],
    } as never);

    const tool = createReadMcpResourceTool(createDb()) as any;
    const result = await tool.execute('bridge-read-big', {
      server: 'github',
      uri: 'file://big.txt',
    });

    expect(result.content[0].text).toContain(
      '[OUTPUT TRUNCATED: MCP text result exceeded 64 characters]'
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        outputTruncated: true,
        outputPersisted: true,
        outputFiles: [expect.stringMatching(/big\.txt-\d+-0\.txt$/)],
      })
    );
  });
});
