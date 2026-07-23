import { describe, expect, it, vi, afterEach } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { mcpClientManager } from '../../../../utils/mcp-client-manager.js';
import { mcpInventoryCache } from '../../../../utils/mcp-inventory-cache.js';
import {
  buildExternalMetaTools,
  buildExternalProviderCatalog,
  persistMcpOutput,
  type ExternalToolRuntimeState,
} from '../external-tools.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(
    `
    INSERT INTO mcp_servers (name, command, args, env, enabled, provider_scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `
  ).run('github', 'node', '[]', NULL_JSON, '["zclaudia"]', Date.now(), Date.now());
  return db;
}

const NULL_JSON = null;

describe('external progressive tools', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    mcpInventoryCache.invalidate();
    delete process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS;
    delete process.env.ZCLAUDIA_MCP_OUTPUT_DIR;
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('loads a concrete MCP tool with the inspected description and input schema', async () => {
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'search_repositories',
        description: 'Search GitHub repositories',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);

    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const toolsArray: AgentTool<any>[] = [];
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray });
    const loadTool = metaTools.find(tool => tool.name === 'LoadExternalTool');

    await loadTool!.execute('load-1', {
      ref: { source: 'mcp', server: 'github', tool: 'search_repositories' },
    });

    const loadedTool = toolsArray.find(tool => tool.name === 'mcp__github__search_repositories');
    expect(loadedTool?.description).toBe('Search GitHub repositories');
    expect(loadedTool?.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });

  it('uses MCP inventory cache for repeated search and inspect calls', async () => {
    const listTools = vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'search_repositories',
        description: 'Search GitHub repositories',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);

    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray: [] });
    const searchTool = metaTools.find(tool => tool.name === 'SearchExternalTools')!;
    const inspectTool = metaTools.find(tool => tool.name === 'InspectExternalTool')!;

    await searchTool.execute('search-1', { query: 'search' });
    await searchTool.execute('search-2', { query: 'github' });
    await inspectTool.execute('inspect-1', {
      ref: { source: 'mcp', server: 'github', tool: 'search_repositories' },
    });

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('discovers, inspects, and reads MCP resources progressively', async () => {
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([
      {
        uri: 'file://readme',
        name: 'README',
        description: 'Project readme',
        mimeType: 'text/markdown',
      },
    ]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'readResource').mockResolvedValue({
      contents: [{ uri: 'file://readme', mimeType: 'text/markdown', text: '# Hello' }],
    });

    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray: [] });
    const search = metaTools.find(tool => tool.name === 'SearchExternalResources')!;
    const inspect = metaTools.find(tool => tool.name === 'InspectExternalResource')!;
    const read = metaTools.find(tool => tool.name === 'ReadExternalResource')!;

    const searchResult = await search.execute('resource-search', { query: 'readme' });
    const inspectResult = await inspect.execute('resource-inspect', {
      ref: { source: 'mcp-resource', server: 'github', uri: 'file://readme' },
    });
    const readResult = await read.execute('resource-read', {
      ref: { source: 'mcp-resource', server: 'github', uri: 'file://readme' },
    });

    expect(JSON.stringify(searchResult.details)).toContain('"total":1');
    expect(searchResult.content[0].text).toContain('file://readme');
    expect(inspectResult.content[0].text).toContain('Project readme');
    expect(readResult.content[0].text).toContain('# Hello');
  });

  it('surfaces MCP risk metadata as advisory permission summary', async () => {
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'read_issue',
        description: 'Read an issue',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      } as any,
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray: [] });
    const search = metaTools.find(tool => tool.name === 'SearchExternalTools')!;
    const inspect = metaTools.find(tool => tool.name === 'InspectExternalTool')!;

    const searchResult = await search.execute('search-risk', { query: 'issue' });
    const inspectResult = await inspect.execute('inspect-risk', {
      ref: { source: 'mcp', server: 'github', tool: 'read_issue' },
    });

    expect(searchResult.content[0].text).toContain('"declaredReadOnly": true');
    expect(searchResult.content[0].text).toContain('"trustedReadOnly": false');
    expect(inspectResult.content[0].text).toContain('self-declared');
  });

  it('applies MCP server trust policy to readonly risk summaries', async () => {
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'read_issue',
        description: 'Read an issue',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      } as any,
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    const db = createDb();
    db.prepare('UPDATE mcp_servers SET trust_policy = ? WHERE name = ?').run(
      JSON.stringify({
        trustLevel: 'trusted-readonly',
        trustReadOnlyHint: true,
        defaultRiskAction: 'ask',
        riskActions: {},
      }),
      'github'
    );
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db, state, toolsArray: [] });
    const inspect = metaTools.find(tool => tool.name === 'InspectExternalTool')!;

    const inspectResult = await inspect.execute('inspect-trusted-risk', {
      ref: { source: 'mcp', server: 'github', tool: 'read_issue' },
    });

    expect(inspectResult.content[0].text).toContain('"trustedReadOnly": true');
    expect(inspectResult.content[0].text).toContain('"policyDecision": "approve"');
  });

  it('blocks direct concrete MCP execution when trust policy denies the risk', async () => {
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'delete_issue',
        description: 'Delete an issue',
        inputSchema: { type: 'object' },
        annotations: { destructiveHint: true },
      } as any,
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    const callTool = vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'deleted' }],
      isError: false,
    } as any);
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
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const toolsArray: AgentTool<any>[] = [];
    const metaTools = buildExternalMetaTools({ db, state, toolsArray });
    const load = metaTools.find(tool => tool.name === 'LoadExternalTool')!;

    await load.execute('load-denied-tool', {
      ref: { source: 'mcp', server: 'github', tool: 'delete_issue' },
    });
    const concrete = toolsArray.find(tool => tool.name === 'mcp__github__delete_issue')!;
    const result = await concrete.execute('direct-denied-call', { id: '1' });

    expect(callTool).not.toHaveBeenCalled();
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'mcp_tool_denied_by_policy',
        mcpTrust: expect.objectContaining({
          server: 'github',
          tool: 'delete_issue',
          policyDecision: 'deny',
        }),
      })
    );
    expect(result.content[0].text).toContain('Denied by MCP trust policy');
  });

  it('truncates oversized MCP text tool output before returning it to the model', async () => {
    process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS = '16';
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'dump_logs',
        description: 'Dump logs',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      } as any,
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }],
      isError: false,
    } as any);
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const toolsArray: AgentTool<any>[] = [];
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray });
    const load = metaTools.find(tool => tool.name === 'LoadExternalTool')!;

    await load.execute('load-dump-logs', {
      ref: { source: 'mcp', server: 'github', tool: 'dump_logs' },
    });
    const concrete = toolsArray.find(tool => tool.name === 'mcp__github__dump_logs')!;
    const result = await concrete.execute('call-dump-logs', {});

    expect(result.content[0].text).toContain(
      'abcdefghijklmnop\n\n[OUTPUT TRUNCATED: MCP text result exceeded 16 characters]'
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        outputTruncated: true,
        originalOutputChars: 26,
      })
    );
  });

  it('persists full oversized MCP text output to disk and returns the saved path', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-output-'));
    tempDirs.push(outputDir);
    process.env.ZCLAUDIA_MCP_OUTPUT_DIR = outputDir;
    process.env.ZCLAUDIA_MCP_MAX_OUTPUT_CHARS = '16';
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'dump_logs',
        description: 'Dump logs',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      } as any,
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }],
      isError: false,
    } as any);
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const toolsArray: AgentTool<any>[] = [];
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray });
    const load = metaTools.find(tool => tool.name === 'LoadExternalTool')!;

    await load.execute('load-dump-logs', {
      ref: { source: 'mcp', server: 'github', tool: 'dump_logs' },
    });
    const concrete = toolsArray.find(tool => tool.name === 'mcp__github__dump_logs')!;
    const result = await concrete.execute('call-dump-logs', {});

    expect(result.details).toEqual(
      expect.objectContaining({
        outputPersisted: true,
        outputFiles: [expect.stringMatching(/dump_logs-\d+-0\.txt$/)],
      })
    );
    const savedPath = (result.details.outputFiles as string[])[0];
    expect(savedPath.startsWith(outputDir)).toBe(true);
    expect(await readFile(savedPath, 'utf8')).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(result.content[0].text).toContain(`Full output saved to ${savedPath}`);
  });

  it('persists MCP resource binary blobs to disk instead of returning base64 content', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-output-'));
    tempDirs.push(outputDir);
    process.env.ZCLAUDIA_MCP_OUTPUT_DIR = outputDir;
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([
      { uri: 'file://report.pdf', name: 'report.pdf', mimeType: 'application/pdf' },
    ]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'readResource').mockResolvedValue({
      contents: [
        {
          uri: 'file://report.pdf',
          mimeType: 'application/pdf',
          blob: Buffer.from('%PDF data').toString('base64'),
        },
      ],
    });
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray: [] });
    const read = metaTools.find(tool => tool.name === 'ReadExternalResource')!;

    const result = await read.execute('read-binary-resource', {
      ref: { source: 'mcp-resource', server: 'github', uri: 'file://report.pdf' },
    });

    expect(result.content[0].text).toMatch(
      /^Binary content \(application\/pdf, 9 bytes\) saved to /
    );
    expect(result.content[0].text).not.toContain(Buffer.from('%PDF data').toString('base64'));
    expect(result.details).toEqual(
      expect.objectContaining({
        outputPersisted: true,
        outputFiles: [expect.stringMatching(/report\.pdf-\d+-0\.pdf$/)],
      })
    );
    const savedPath = (result.details.outputFiles as string[])[0];
    expect(savedPath.startsWith(outputDir)).toBe(true);
    expect(await readFile(savedPath, 'utf8')).toBe('%PDF data');
  });

  it('discovers authenticate pseudo-tool for MCP servers that need auth', async () => {
    vi.spyOn(mcpClientManager, 'getStatus').mockReturnValue({
      name: 'github',
      state: 'needs-auth',
      authRequired: true,
      authMessage: 'Authentication required for GitHub MCP.',
    } as any);
    const listTools = vi
      .spyOn(mcpClientManager, 'listTools')
      .mockRejectedValue(new Error('401 Unauthorized'));
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([]);
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray: [] });
    const search = metaTools.find(tool => tool.name === 'SearchExternalTools')!;

    const result = await search.execute('search-auth', { query: 'authenticate' });

    expect(listTools).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('"tool": "authenticate"');
    expect(result.content[0].text).toContain('Authentication required for GitHub MCP.');
  });

  it('loads authenticate pseudo-tool and returns manual auth guidance without calling MCP server', async () => {
    vi.spyOn(mcpClientManager, 'getStatus').mockReturnValue({
      name: 'github',
      state: 'needs-auth',
      authRequired: true,
      authMessage: 'Authentication required for GitHub MCP.',
    } as any);
    const callTool = vi.spyOn(mcpClientManager, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'should not call' }],
    } as any);
    const state: ExternalToolRuntimeState = {
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const toolsArray: AgentTool<any>[] = [];
    const metaTools = buildExternalMetaTools({ db: createDb(), state, toolsArray });
    const load = metaTools.find(tool => tool.name === 'LoadExternalTool')!;

    const loadResult = await load.execute('load-auth-tool', {
      ref: { source: 'mcp', server: 'github', tool: 'authenticate' },
    });
    const concrete = toolsArray.find(tool => tool.name === 'mcp__github__authenticate')!;
    const result = await concrete.execute('auth-call', {});

    expect(loadResult.details).toEqual(expect.objectContaining({ ok: true, loaded: true }));
    expect(callTool).not.toHaveBeenCalled();
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        authRequired: true,
        server: 'github',
        tool: 'authenticate',
      })
    );
    expect(result.content[0].text).toContain('Authentication required for GitHub MCP.');
    expect(result.content[0].text).toContain('Update the MCP server credentials');
  });

  it('builds a stable compact provider catalog with inventory counts', async () => {
    const db = createDb();
    db.prepare(
      `
      INSERT INTO mcp_servers (name, command, args, env, enabled, provider_scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `
    ).run('alpha', 'node', '[]', NULL_JSON, '["zclaudia"]', Date.now(), Date.now());
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      { name: 'tool', description: '', inputSchema: {} },
    ]);
    vi.spyOn(mcpClientManager, 'listResources').mockResolvedValue([{ uri: 'file://a' }]);
    vi.spyOn(mcpClientManager, 'listPrompts').mockResolvedValue([{ name: 'prompt' }]);

    const state: ExternalToolRuntimeState = {
      discoverableProviders: [
        { source: 'mcp', serverId: 'github' },
        { source: 'mcp', serverId: 'alpha' },
      ],
      pinnedExternalTools: [],
      loadedExternalTools: [],
    };
    const metaTools = buildExternalMetaTools({ db, state, toolsArray: [] });
    await metaTools
      .find(tool => tool.name === 'SearchExternalTools')!
      .execute('prime-cache', { query: '' });

    const catalog = buildExternalProviderCatalog(state, db);
    const alphaIndex = catalog.indexOf('mcp/alpha');
    const githubIndex = catalog.indexOf('mcp/github');

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(githubIndex).toBeGreaterThan(alphaIndex);
    expect(catalog).toContain('tools=1, resources=1, prompts=1');
    expect(catalog.length).toBeLessThan(500);
  });
});

describe('persistMcpOutput directory hardening (P2)', () => {
  let dataDir: string;
  let prevDataDir: string | undefined;

  afterEach(async () => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    delete process.env.ZCLAUDIA_MCP_OUTPUT_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('defaults to a 0700 directory under the app data dir, files 0600', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-home-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;

    const saved = await persistMcpOutput('dump', 0, 'payload', 'txt');

    const expectedDir = path.join(dataDir, 'mcp-output');
    expect(path.dirname(saved)).toBe(expectedDir);
    expect(statSync(expectedDir).mode & 0o777).toBe(0o700);
    expect(statSync(saved).mode & 0o777).toBe(0o600);
    expect(await readFile(saved, 'utf8')).toBe('payload');
  });

  it('sweeps expired MCP output lazily on each write', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-home-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
    const outputDir = path.join(dataDir, 'mcp-output');
    await mkdir(outputDir, { recursive: true });
    const stale = path.join(outputDir, 'stale-1-0.txt');
    await writeFile(stale, 'stale');
    const mtime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(stale, mtime, mtime);
    const fresh = path.join(outputDir, 'fresh-1-0.txt');
    await writeFile(fresh, 'fresh');

    await persistMcpOutput('new', 0, 'payload', 'txt');

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('keeps honoring the ZCLAUDIA_MCP_OUTPUT_DIR override', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-mcp-override-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_MCP_OUTPUT_DIR = dataDir;

    const saved = await persistMcpOutput('dump', 0, 'payload', 'txt');

    expect(path.dirname(saved)).toBe(dataDir);
  });
});
