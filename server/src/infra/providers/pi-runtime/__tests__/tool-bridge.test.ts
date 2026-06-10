import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import path from 'path';
import Database from 'better-sqlite3';
import { buildTools, ALL_TOOL_NAMES, type ToolName } from '../tool-bridge.js';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { mcpClientManager } from '../../../../utils/mcp-client-manager.js';

const { activateConditionalSkillsForToolNamesMock } = vi.hoisted(() => ({
  activateConditionalSkillsForToolNamesMock: vi.fn(),
}));

vi.mock('../../../../application/plugins/skill-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../application/plugins/skill-tools.js')>();
  return {
    ...actual,
    activateConditionalSkillsForToolNames: activateConditionalSkillsForToolNamesMock,
  };
});

describe('buildTools', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    activateConditionalSkillsForToolNamesMock.mockReset();
    return Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('activates hook-triggered skills after matching tool execution', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-hook-tool-'));
    tempDirs.push(root);
    const bash = buildTools(root, { enabled: ['Bash'] })[0] as any;

    await bash.execute('bash-1', { command: 'printf ok' });

    expect(activateConditionalSkillsForToolNamesMock).toHaveBeenCalledWith(['Bash']);
  });

  it('returns core coding tools and first-batch agent tools by default', () => {
    const tools = buildTools('/tmp');
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'Agent',
      'AskUserQuestion',
      'Bash',
      'Edit',
      'Glob',
      'Grep',
      'LS',
      'LSPTool',
      'ListMcpResources',
      'MCPTool',
      'Monitor',
      'Read',
      'ReadMcpResource',
      'TaskOutput',
      'TodoWrite',
      'ToolSearch',
      'WebFetch',
      'WebSearch',
      'Write',
    ]);
  });

  it('filters by `enabled` and normalizes legacy lowercase aliases', () => {
    const tools = buildTools('/tmp', { enabled: ['read', 'bash', 'WebFetch'] });
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name).sort()).toEqual(['Bash', 'Read', 'WebFetch']);
  });

  it('applies `overrides` to replace specific implementations', () => {
    const mockRead = {
      name: 'read',
      label: 'My Read',
      description: 'override',
      parameters: { type: 'object', properties: {}, required: [] } as any,
      execute: async () => ({ content: [{ type: 'text' as const, text: 'overridden' }] }),
    };
    const tools = buildTools('/tmp', { overrides: { read: mockRead as any } });
    const read = tools.find(t => t.name === 'Read');
    expect((read as any)?.label).toBe('My Read');
  });

  it('warns and skips unknown tool names in `enabled`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = buildTools('/tmp', { enabled: ['read', 'nonexistent' as ToolName] });
    expect(tools.map(t => t.name)).toEqual(['Read']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    warn.mockRestore();
  });

  it('exports ALL_TOOL_NAMES as the canonical built-in tool list', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual([
      'Agent',
      'AskUserQuestion',
      'Bash',
      'Edit',
      'Glob',
      'Grep',
      'LS',
      'LSPTool',
      'ListMcpResources',
      'MCPTool',
      'Monitor',
      'Read',
      'ReadMcpResource',
      'TaskOutput',
      'TodoWrite',
      'ToolSearch',
      'WebFetch',
      'WebSearch',
      'Write',
    ]);
  });

  it('TodoWrite returns a structured success result', async () => {
    const todo = buildTools('/tmp', { enabled: ['TodoWrite'] })[0] as any;
    const result = await todo.execute({
      todos: [{ content: 'Ship tools', status: 'in_progress' }],
    });
    expect(result.content[0].text).toContain('"success": true');
    expect(result.content[0].text).toContain('Ship tools');
  });

  it('read supports line offset and limit with structured details', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-'));
    tempDirs.push(root);
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three', 'four'].join('\n'));
    const read = buildTools(root, { enabled: ['read'] })[0] as any;

    const result = await read.execute('read-1', { path: 'sample.ts', offset: 2, limit: 2 });

    expect(result.details).toMatchObject({
      ok: true,
      path: 'sample.ts',
      offset: 2,
      limit: 2,
      totalLines: 4,
      returnedLines: 2,
    });
    expect(result.content[0].text).toContain('2|two');
    expect(result.content[0].text).toContain('3|three');
    expect(result.content[0].text).not.toContain('1|one');
  });

  it('read rejects binary files with a structured error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-bin-'));
    tempDirs.push(root);
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const read = buildTools(root, { enabled: ['read'] })[0] as any;

    const result = await read.execute('read-1', { path: 'blob.bin' });

    expect(result.details).toMatchObject({ ok: false, error: 'binary_file' });
    expect(result.content[0].text).toContain('Refusing to read binary file');
  });

  it('TodoWrite accepts cancelled todos and reports the normalized count', async () => {
    const todo = buildTools('/tmp', { enabled: ['TodoWrite'] })[0] as any;

    const result = await todo.execute('todo-1', {
      todos: [
        { content: 'Ship tools', status: 'completed' },
        { content: 'Defer polish', status: 'cancelled' },
      ],
    });

    expect(todo.parameters.properties.todos.items.properties.status.enum).toContain('cancelled');
    expect(result.content[0].text).toContain('"count": 2');
    expect(result.content[0].text).toContain('"status": "cancelled"');
  });

  it('AskUserQuestion waits through the interaction callback and returns the answer as a normal tool result', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({
      behavior: 'allow',
      message: 'Use WebFetch first.',
    });
    const ask = buildTools('/tmp', {
      enabled: ['AskUserQuestion'],
      permissionCallback,
    } as any)[0] as any;

    const result = await ask.execute('question-1', {
      questions: [
        {
          header: 'Choose the next tool',
          question: 'Which tool should the agent use next?',
          options: [{ label: 'WebFetch', description: 'Fetch a URL' }],
        },
      ],
    });

    expect(permissionCallback).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'question-1',
      toolName: 'AskUserQuestion',
      detail: 'Which tool should the agent use next?',
    }));
    expect(result.details).toMatchObject({ ok: true, answered: true });
    expect(result.content[0].text).toContain('Use WebFetch first.');
  });

  it('WebFetch fetches a URL and strips HTML by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      text: async () => '<html><body><h1>Hello</h1><script>bad()</script><p>World &amp; Friends</p></body></html>',
    })));
    const webFetch = buildTools('/tmp', { enabled: ['WebFetch'] })[0] as any;

    const result = await webFetch.execute({ url: 'https://example.com' });

    expect(result.content[0].text).toContain('Status: 200 OK');
    expect(result.content[0].text).toContain('Hello');
    expect(result.content[0].text).toContain('World & Friends');
    expect(result.content[0].text).not.toContain('bad()');
  });

  it('WebFetch rejects localhost and private network URLs before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = buildTools('/tmp', { enabled: ['WebFetch'] })[0] as any;

    const result = await webFetch.execute('fetch-1', { url: 'http://127.0.0.1:3000/admin' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('blocked_private_network');
  });

  it('WebFetch includes non-2xx status details without throwing away the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html><body><h1>Missing</h1></body></html>',
    })));
    const webFetch = buildTools('/tmp', { enabled: ['WebFetch'] })[0] as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/missing' });

    expect(result.details).toMatchObject({ ok: false, status: 404, contentType: 'text/html' });
    expect(result.content[0].text).toContain('Status: 404 Not Found');
    expect(result.content[0].text).toContain('Missing');
  });

  it('WebSearch returns snippets, decodes DuckDuckGo redirects, and applies domain filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://docs.example.com/api?x=1&y=2')}">API &amp; Docs</a>
          <a class="result__snippet">Current docs for the API.</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://blog.example.net/post">Blog Post</a>
          <a class="result__snippet">Should be filtered out.</a>
        </div>
      `,
    })));
    const webSearch = buildTools('/tmp', { enabled: ['WebSearch'] })[0] as any;

    const result = await webSearch.execute('search-1', {
      query: 'api docs',
      allowed_domains: ['docs.example.com'],
      max_results: 5,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({ ok: true, provider: 'duckduckgo-html', total: 1 });
    expect(parsed.results).toEqual([
      {
        title: 'API & Docs',
        url: 'https://docs.example.com/api?x=1&y=2',
        domain: 'docs.example.com',
        snippet: 'Current docs for the API.',
      },
    ]);
  });

  it('WebSearch reports provider failures as structured errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'search is down',
    })));
    const webSearch = buildTools('/tmp', { enabled: ['WebSearch'] })[0] as any;

    const result = await webSearch.execute('search-1', { query: 'api docs' });

    expect(result.details).toMatchObject({ ok: false, error: 'provider_error', status: 503 });
    expect(result.content[0].text).toContain('WebSearch provider failed');
  });

  it('WebSearch falls back from configured SearXNG to DuckDuckGo and records the failure reason', async () => {
    vi.stubEnv('ZCLAUDIA_SEARXNG_BASE_URL', 'https://search.example.com');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://search.example.com')) {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: async () => 'searxng down',
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `
          <div class="result">
            <a class="result__a" href="https://fallback.example.com/doc">Fallback Result</a>
            <a class="result__snippet">Served by DuckDuckGo fallback.</a>
          </div>
        `,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const webSearch = buildTools('/tmp', { enabled: ['WebSearch'] })[0] as any;

    const result = await webSearch.execute('search-1', { query: 'fallback docs' });
    const parsed = JSON.parse(result.content[0].text);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.details).toMatchObject({
      ok: true,
      provider: 'duckduckgo-html',
      fallbacks: [expect.objectContaining({ provider: 'searxng', status: 502 })],
    });
    expect(parsed.results[0]).toMatchObject({
      title: 'Fallback Result',
      url: 'https://fallback.example.com/doc',
      snippet: 'Served by DuckDuckGo fallback.',
    });
  });

  it('Agent reports missing direct executor context instead of launching blindly', async () => {
    const agent = buildTools('/tmp', { enabled: ['Agent'] })[0] as any;
    const result = await agent.execute({ prompt: 'Explore this repo' });
    expect(result.content[0].text).toContain('requires a task executor');
  });

  it('Agent creates and runs a first-class agent task through the direct task executor', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const taskRepo = new TaskRepository(db);
    const agentTaskExecutor = {
      start: vi.fn(async (task: any) => ({
        status: 'running',
        executorRef: { providerType: 'zclaudia-agent-runner', taskId: task.id },
      })),
      wait: vi.fn(async () => ({
        status: 'completed',
        result: { text: 'direct child agent result' },
      })),
      stop: vi.fn(),
    };
    try {
      const agent = buildTools('/tmp', {
        enabled: ['Agent'],
        sessionId: 'session-parent',
        runId: 'run-parent',
        permissionOverride: {
          profile: {
            fileWrite: 'ask',
            networkOps: 'block',
          },
        },
        db,
        agentTaskExecutor: agentTaskExecutor as any,
      })[0] as any;

      const result = await agent.execute('tool-agent-1', {
        prompt: 'Explore this repo',
        description: 'Find auth flow',
        wait: true,
      });
      const parsed = JSON.parse(result.content[0].text);
      const task = taskRepo.findById(parsed.taskId);

      expect(agentTaskExecutor.start).toHaveBeenCalledWith(expect.objectContaining({
        id: parsed.taskId,
        type: 'agent',
        metadata: expect.objectContaining({
          prompt: 'Explore this repo',
          wait: true,
          permissionOverride: {
            profile: {
              fileWrite: 'ask',
              networkOps: 'block',
            },
          },
        }),
      }));
      expect(agentTaskExecutor.wait).toHaveBeenCalledWith(parsed.taskId);
      expect(parsed).toMatchObject({
        ok: true,
        taskId: expect.any(String),
        status: 'completed',
        result: { text: 'direct child agent result' },
      });
      expect(task).toMatchObject({
        id: parsed.taskId,
        type: 'agent',
        status: 'completed',
        parentSessionId: 'session-parent',
        parentRunId: 'run-parent',
        parentToolUseId: 'tool-agent-1',
        title: 'Find auth flow',
        result: { text: 'direct child agent result' },
        metadata: expect.objectContaining({ prompt: 'Explore this repo', wait: true }),
      });
      expect(taskRepo.listEvents(parsed.taskId).map(event => event.type)).toEqual(['created', 'started', 'completed']);
    } finally {
      db.close();
    }
  });

  it('TaskOutput returns task state, result, and events by task id', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const taskRepo = new TaskRepository(db);
    const task = taskRepo.create({
      type: 'agent',
      status: 'completed',
      title: 'Finished child',
      result: { text: 'Child agent summary' },
    });
    taskRepo.addEvent({ taskId: task.id, type: 'created', status: 'queued' });
    taskRepo.addEvent({ taskId: task.id, type: 'completed', status: 'completed', payload: { text: 'Child agent summary' } });
    const taskOutput = buildTools('/tmp', {
      enabled: ['TaskOutput'],
      db,
    })[0] as any;

    const result = await taskOutput.execute('task-output-1', { task_id: task.id });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({ ok: true, taskId: task.id, status: 'completed' });
    expect(parsed.task).toMatchObject({
      id: task.id,
      type: 'agent',
      status: 'completed',
      result: { text: 'Child agent summary' },
    });
    expect(parsed.events.map((event: { type: string }) => event.type)).toEqual(['created', 'completed']);
    db.close();
  });

  it('Monitor starts and stops monitor tasks through the shared task lifecycle', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const taskRepo = new TaskRepository(db);
    const monitor = buildTools('/tmp', {
      enabled: ['Monitor'],
      sessionId: 'session-parent',
      runId: 'run-parent',
      db,
    })[0] as any;

    const startedResult = await monitor.execute('monitor-1', {
      action: 'start',
      title: 'Watch tests',
      target_task_id: 'task-agent-1',
      interval_ms: 30_000,
    });
    const started = JSON.parse(startedResult.content[0].text);
    const stoppedResult = await monitor.execute('monitor-2', {
      action: 'stop',
      task_id: started.taskId,
      reason: 'No longer needed',
    });
    const stopped = JSON.parse(stoppedResult.content[0].text);
    const task = taskRepo.findById(started.taskId);

    expect(started).toMatchObject({ ok: true, taskId: expect.any(String), status: 'running' });
    expect(stopped).toMatchObject({ ok: true, taskId: started.taskId, status: 'stopped' });
    expect(task).toMatchObject({
      type: 'monitor',
      status: 'stopped',
      parentSessionId: 'session-parent',
      parentRunId: 'run-parent',
      parentToolUseId: 'monitor-1',
      title: 'Watch tests',
      metadata: {
        targetTaskId: 'task-agent-1',
        intervalMs: 30_000,
      },
    });
    expect(taskRepo.listEvents(started.taskId).map(event => event.type)).toEqual(['created', 'started', 'stopped']);
    db.close();
  });

  it('MCPTool reports missing db context as a structured error', async () => {
    const mcpTool = buildTools('/tmp', { enabled: ['MCPTool'] })[0] as any;

    const result = await mcpTool.execute('mcp-1', { server: 'github', tool: 'create_issue', arguments: {} });

    expect(result.details).toMatchObject({ ok: false, error: 'missing_db_context' });
    expect(result.content[0].text).toContain('MCP tools require a database-backed run context');
  });

  it('ToolSearch lists matching MCP tools across enabled servers', async () => {
    const db = {
      prepare: () => ({
        all: () => [
          {
            name: 'github',
            command: 'node',
            args: '[]',
            env: null,
            provider_scope: '["zclaudia"]',
          },
        ],
      }),
    };
    vi.spyOn(mcpClientManager, 'listTools').mockResolvedValue([
      {
        name: 'create_issue',
        description: 'Create a GitHub issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
      {
        name: 'list_prs',
        description: 'List pull requests',
        inputSchema: { type: 'object' },
      },
    ]);
    const toolSearch = buildTools('/tmp', { enabled: ['ToolSearch'], db: db as any })[0] as any;

    const result = await toolSearch.execute('search-1', { query: 'issue', max_results: 5 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.query).toBe('issue');
    expect(parsed.results).toEqual([
      expect.objectContaining({
        server: 'github',
        tool: 'create_issue',
        description: 'Create a GitHub issue',
      }),
    ]);
    expect(parsed.results[0].inputSchema).toBeUndefined();
  });

  it('Glob returns structured relative file matches under the requested path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-glob-'));
    tempDirs.push(root);
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const index = 1;\n');
    await writeFile(path.join(root, 'src', 'nested', 'helper.ts'), 'export const helper = 1;\n');
    await writeFile(path.join(root, 'dist', 'bundle.js'), 'ignored\n');
    const glob = buildTools(root, { enabled: ['Glob'] })[0] as any;

    const result = await glob.execute('glob-1', { pattern: '**/*.ts', path: 'src', max_results: 10 });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({ ok: true, pattern: '**/*.ts', total: 2 });
    expect(parsed.results).toEqual(['src/index.ts', 'src/nested/helper.ts']);
  });

  it('grep returns structured matches with context and glob filtering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-'));
    tempDirs.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'feature.ts'), [
      'before',
      'const target = true;',
      'after',
      '',
    ].join('\n'));
    await writeFile(path.join(root, 'src', 'feature.md'), 'target in docs\n');
    const grep = buildTools(root, { enabled: ['grep'] })[0] as any;

    const result = await grep.execute('grep-1', {
      pattern: 'target',
      path: 'src',
      include: '*.ts',
      context: 1,
      max_results: 10,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({ ok: true, pattern: 'target', total: 3 });
    expect(parsed.results).toEqual([
      expect.objectContaining({ file: 'src/feature.ts', line: 1, preview: 'before', isMatch: false }),
      expect.objectContaining({ file: 'src/feature.ts', line: 2, preview: 'const target = true;', isMatch: true }),
      expect.objectContaining({ file: 'src/feature.ts', line: 3, preview: 'after', isMatch: false }),
    ]);
  });

  it('LSPTool returns structured symbol search results with glob filtering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-'));
    tempDirs.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'feature.ts'), [
      'export function targetSymbol() {',
      '  return 1;',
      '}',
      '',
    ].join('\n'));
    await writeFile(path.join(root, 'src', 'feature.md'), 'targetSymbol in docs\n');
    const lsp = buildTools(root, { enabled: ['LSPTool'] })[0] as any;

    const result = await lsp.execute('lsp-1', {
      action: 'symbols',
      query: 'targetSymbol',
      include: '*.ts',
      max_results: 5,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({ ok: true, action: 'symbols', fallback: 'ripgrep', total: 1 });
    expect(parsed.results).toEqual([
      expect.objectContaining({
        file: 'src/feature.ts',
        line: 1,
        preview: 'export function targetSymbol() {',
      }),
    ]);
  });
});

describe('LS bridge tool', () => {
  it('lists entries alphabetically with a trailing slash on directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-ls-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'b.txt'), 'b');
    writeFileSync(join(dir, 'a.txt'), 'a');
    const ls = buildTools(dir, { enabled: ['LS'] })[0] as any;
    const res = await ls.execute('call-1', {});
    const text = res.content[0].text as string;
    rmSync(dir, { recursive: true, force: true });
    expect(text.split('\n')).toEqual(['a.txt', 'b.txt', 'src/']);
  });

  it('rejects a path outside the workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-ls-'));
    const ls = buildTools(dir, { enabled: ['LS'] })[0] as any;
    const res = await ls.execute('call-2', { path: '../../etc' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).not.toBe(true);
    expect(res.details.error).toBe('path_outside_workspace');
  });
});
