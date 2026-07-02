import { describe, expect, it } from 'vitest';

import {
  createListMcpResourcesTool,
  createMcpTool,
  createReadMcpResourceTool,
  createToolSearchTool,
} from '../mcp-bridge-tools.js';

describe('MCP bridge tools', () => {
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
});
