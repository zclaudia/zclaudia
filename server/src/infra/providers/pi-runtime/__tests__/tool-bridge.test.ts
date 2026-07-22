import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
  symlinkSync,
  utimesSync,
  truncateSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { buildTools, ALL_TOOL_NAMES, type ToolName } from '../tool-bridge.js';
import { getDeferredDiagnosticsResult } from '../write-lifecycle.js';
import { filePathToUri, type LspTransport } from '../lsp-diagnostics-adapter.js';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import {
  CommandTaskExecutor,
  pidAlive,
} from '../../../../domains/tasks/executors/command-executor.js';
import { mcpClientManager } from '../../../../utils/mcp-client-manager.js';
import * as sandbox from '../sandbox.js';

// Keep WebFetch validation hermetic: example.com resolves to a public IP,
// IP literals echo like libuv, everything else fails like a DNS miss.
// (Real resolvers — e.g. fake-IP proxy DNS answering from 198.18.0.0/15 —
// would otherwise make these tests environment-dependent.)
vi.mock('dns/promises', async () => {
  const { isIP } = await import('net');
  return {
    lookup: vi.fn(async (hostname: string, options?: { all?: boolean }) => {
      const bare = hostname.replace(/^\[|\]$/g, '');
      const family = isIP(bare);
      if (family !== 0) {
        const entry = { address: bare, family };
        return options?.all ? [entry] : entry;
      }
      if (hostname === 'example.com') {
        const entry = { address: '93.184.216.34', family: 4 };
        return options?.all ? [entry] : entry;
      }
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      throw error;
    }),
  };
});

describe('buildTools', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    return Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('notifies the tool execution observer after successful tool execution', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-hook-tool-'));
    tempDirs.push(root);
    const afterToolExecute = vi.fn();
    const bash = buildTools(root, {
      enabled: ['Bash'],
      toolExecutionObserver: { afterToolExecute },
    })[0] as any;

    await bash.execute('bash-1', { command: 'printf ok' });

    expect(afterToolExecute).toHaveBeenCalledWith({
      toolName: 'Bash',
      cwd: root,
      params: { command: 'printf ok' },
      touchedPaths: [],
    });
  });

  it('includes touched paths in tool execution observer events', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-hook-path-'));
    tempDirs.push(root);
    await writeFile(path.join(root, 'sample.ts'), 'const value = 1;\n');
    const afterToolExecute = vi.fn();
    const read = buildTools(root, {
      enabled: ['Read'],
      toolExecutionObserver: { afterToolExecute },
    })[0] as any;

    await read.execute('read-1', { path: 'sample.ts' });

    expect(afterToolExecute).toHaveBeenCalledWith({
      toolName: 'Read',
      cwd: root,
      params: { path: 'sample.ts' },
      touchedPaths: ['sample.ts'],
    });
  });

  it('returns core coding tools and first-batch agent tools by default', () => {
    const tools = buildTools('/tmp');
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'Agent',
      'AskUserQuestion',
      'AstEdit',
      'AstGrep',
      'Bash',
      'Edit',
      'EditSymbol',
      'EnterPlanMode',
      'EnterWorktree',
      'Eval',
      'ExitPlanMode',
      'ExitWorktree',
      'Glob',
      'Grep',
      'LS',
      'LSPTool',
      'ListMcpResources',
      'MCPTool',
      'Monitor',
      'MultiEdit',
      'Read',
      'ReadMcpResource',
      'ReadSymbol',
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
      'AstEdit',
      'AstGrep',
      'Bash',
      'Edit',
      'EditSymbol',
      'EnterPlanMode',
      'EnterWorktree',
      'Eval',
      'ExitPlanMode',
      'ExitWorktree',
      'Glob',
      'Grep',
      'LS',
      'LSPTool',
      'ListMcpResources',
      'MCPTool',
      'Memory',
      'Monitor',
      'MultiEdit',
      'Read',
      'ReadMcpResource',
      'ReadSymbol',
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

  it('read can return hashline anchors for content-addressed edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-hashline-'));
    tempDirs.push(root);
    await writeFile(path.join(root, 'sample.ts'), 'const a = 1;\nconst b = 2;\n');
    const read = buildTools(root, { enabled: ['Read'] })[0] as any;

    const result = await read.execute('read-hashline', { path: 'sample.ts', hashline: true });

    expect(result.details.hashline).toMatchObject({ path: 'sample.ts' });
    expect(result.details.hashline.snapshotId).toEqual(expect.any(String));
    expect(result.details.hashline.lines[0]).toMatchObject({ line: 1, text: 'const a = 1;' });
    expect(result.content[0].text).toContain('[sample.ts#');
    expect(result.content[0].text).toMatch(/[a-f0-9]{12}\|const a = 1;/);
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

    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'question-1',
        toolName: 'AskUserQuestion',
        detail: 'Which tool should the agent use next?',
      })
    );
    expect(result.details).toMatchObject({ ok: true, answered: true });
    expect(result.content[0].text).toContain('Use WebFetch first.');
  });

  it('WebFetch converts HTML to markdown by default and drops scripts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        statusText: 'OK',
        text: async () =>
          '<html><body><h1>Hello</h1><script>bad()</script><p>World &amp; Friends</p></body></html>',
      }))
    );
    const webFetch = buildTools('/tmp', { enabled: ['WebFetch'] })[0] as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com' });

    expect(result.content[0].text).toContain('Status: 200 OK');
    expect(result.content[0].text).toContain('Hello');
    expect(result.content[0].text).toContain('World & Friends');
    expect(result.content[0].text).not.toContain('bad()');
  });

  it('WebFetch returns non-HTML content (JSON) verbatim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"name":"widget","version":"1.0"}',
      }))
    );
    const webFetch = buildTools('/tmp', { enabled: ['WebFetch'] })[0] as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/pkg.json' });

    expect(result.content[0].text).toContain('{"name":"widget","version":"1.0"}');
    expect(result.details.extractMode).toBe('passthrough');
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body><h1>Missing</h1></body></html>',
      }))
    );
    const webFetch = buildTools('/tmp', { enabled: ['WebFetch'] })[0] as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/missing' });

    expect(result.details).toMatchObject({ ok: false, status: 404, contentType: 'text/html' });
    expect(result.content[0].text).toContain('Status: 404 Not Found');
    expect(result.content[0].text).toContain('Missing');
  });

  it('WebSearch returns snippets, decodes DuckDuckGo redirects, and applies domain filters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
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
      }))
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'search is down',
      }))
    );
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

      expect(agentTaskExecutor.start).toHaveBeenCalledWith(
        expect.objectContaining({
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
        })
      );
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
      expect(taskRepo.listEvents(parsed.taskId).map(event => event.type)).toEqual([
        'created',
        'started',
        'completed',
      ]);
    } finally {
      db.close();
    }
  });

  it('Agent fills projectId from the current session context instead of model input', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const now = Date.now();
    db.prepare(
      `INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
       VALUES ('llm-1', 'Default LLM', 'zclaudia', 1, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
       VALUES ('agent-1', 'Default Agent', 'llm-1', 1, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
       VALUES ('project-parent', 'Parent Project', 'code', '/tmp/project-parent', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO sessions (id, project_id, name, agent_profile_id, type, created_at, updated_at)
       VALUES ('session-parent', 'project-parent', 'Parent Session', 'agent-1', 'regular', ?, ?)`
    ).run(now, now);

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
      const agent = buildTools('/tmp/project-parent', {
        enabled: ['Agent'],
        sessionId: 'session-parent',
        runId: 'run-parent',
        db,
        agentTaskExecutor: agentTaskExecutor as any,
      })[0] as any;

      const result = await agent.execute('tool-agent-context', {
        prompt: 'Explore this repo',
        wait: true,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toMatchObject({ ok: true, status: 'completed' });
      expect(agentTaskExecutor.start).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            projectId: 'project-parent',
            prompt: 'Explore this repo',
            cwd: '/tmp/project-parent',
          }),
        })
      );
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
    taskRepo.addEvent({
      taskId: task.id,
      type: 'completed',
      status: 'completed',
      payload: { text: 'Child agent summary' },
    });
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
    expect(parsed.events.map((event: { type: string }) => event.type)).toEqual([
      'created',
      'completed',
    ]);
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
    expect(taskRepo.listEvents(started.taskId).map(event => event.type)).toEqual([
      'created',
      'started',
      'stopped',
    ]);
    db.close();
  });

  it('MCPTool reports missing db context as a structured error', async () => {
    const mcpTool = buildTools('/tmp', { enabled: ['MCPTool'] })[0] as any;

    const result = await mcpTool.execute('mcp-1', {
      server: 'github',
      tool: 'create_issue',
      arguments: {},
    });

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

    const result = await glob.execute('glob-1', {
      pattern: '**/*.ts',
      path: 'src',
      max_results: 10,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({ ok: true, pattern: '**/*.ts', total: 2 });
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results).toContain('src/index.ts');
    expect(parsed.results).toContain('src/nested/helper.ts');
  });

  it('grep returns structured matches with context and glob filtering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-'));
    tempDirs.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'src', 'feature.ts'),
      ['before', 'const target = true;', 'after', ''].join('\n')
    );
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
      expect.objectContaining({
        file: 'src/feature.ts',
        line: 1,
        preview: 'before',
        isMatch: false,
      }),
      expect.objectContaining({
        file: 'src/feature.ts',
        line: 2,
        preview: 'const target = true;',
        isMatch: true,
      }),
      expect.objectContaining({
        file: 'src/feature.ts',
        line: 3,
        preview: 'after',
        isMatch: false,
      }),
    ]);
  });

  it('LSPTool returns structured symbol search results with glob filtering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-'));
    tempDirs.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'src', 'feature.ts'),
      ['export function targetSymbol() {', '  return 1;', '}', ''].join('\n')
    );
    await writeFile(path.join(root, 'src', 'feature.md'), 'targetSymbol in docs\n');
    const lsp = buildTools(root, { enabled: ['LSPTool'] })[0] as any;

    const result = await lsp.execute('lsp-1', {
      action: 'symbols',
      query: 'targetSymbol',
      include: '*.ts',
      max_results: 5,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(result.details).toMatchObject({
      ok: true,
      action: 'symbols',
      fallback: 'ripgrep',
      total: 1,
    });
    expect(parsed.results).toEqual([
      expect.objectContaining({
        file: 'src/feature.ts',
        line: 1,
        preview: 'export function targetSymbol() {',
      }),
    ]);
  });
});

describe('Glob bridge tool', () => {
  it('returns most-recently-modified files first and a truncated flag', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-glob-'));
    writeFileSync(path.join(dir, 'old.ts'), 'a');
    writeFileSync(path.join(dir, 'new.ts'), 'b');
    const fs = await import('fs');
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(dir, 'new.ts'), future, future);
    const glob = buildTools(dir, { enabled: ['Glob'] })[0] as any;
    const res = await glob.execute('call-1', { pattern: '*.ts' });
    const parsed = JSON.parse(res.content[0].text);
    rmSync(dir, { recursive: true, force: true });
    expect(parsed.results[0]).toBe('new.ts');
    expect(res.details).toHaveProperty('truncated');
  });
});

describe('Grep bridge tool', () => {
  async function fixture() {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-grep-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const FOO = 1;\nconst bar = 2;\n');
    writeFileSync(path.join(dir, 'b.ts'), 'const foo = 3;\n');
    return dir;
  }

  it('files_with_matches mode returns matching file paths only', async () => {
    const dir = await fixture();
    const grep = buildTools(dir, { enabled: ['Grep'] })[0] as any;
    const res = await grep.execute('c1', { pattern: 'FOO', output_mode: 'files_with_matches' });
    const parsed = JSON.parse(res.content[0].text);
    rmSync(dir, { recursive: true, force: true });
    expect(parsed.files).toEqual(['a.ts']);
  });

  it('count mode returns total match count', async () => {
    const dir = await fixture();
    const grep = buildTools(dir, { enabled: ['Grep'] })[0] as any;
    const res = await grep.execute('c2', { pattern: 'const', output_mode: 'count' });
    const parsed = JSON.parse(res.content[0].text);
    rmSync(dir, { recursive: true, force: true });
    expect(parsed.total).toBe(3);
  });

  it('case_insensitive matches both FOO and foo', async () => {
    const dir = await fixture();
    const grep = buildTools(dir, { enabled: ['Grep'] })[0] as any;
    const res = await grep.execute('c3', {
      pattern: 'foo',
      case_insensitive: true,
      output_mode: 'files_with_matches',
    });
    const parsed = JSON.parse(res.content[0].text);
    rmSync(dir, { recursive: true, force: true });
    expect(parsed.files.sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('content mode (default) still returns structured line results', async () => {
    const dir = await fixture();
    const grep = buildTools(dir, { enabled: ['Grep'] })[0] as any;
    const res = await grep.execute('c4', { pattern: 'bar' });
    const parsed = JSON.parse(res.content[0].text);
    rmSync(dir, { recursive: true, force: true });
    expect(parsed.results.length).toBe(1);
    expect(parsed.results[0].line).toBe(2);
  });

  it('count mode surfaces truncated=true when results exceed max_results', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-grep-trunc-'));
    // 3 files each containing the pattern "NEEDLE" once → rg --count yields 3 lines
    writeFileSync(path.join(dir, 'f1.ts'), 'const NEEDLE = 1;\n');
    writeFileSync(path.join(dir, 'f2.ts'), 'const NEEDLE = 2;\n');
    writeFileSync(path.join(dir, 'f3.ts'), 'const NEEDLE = 3;\n');
    const grep = buildTools(dir, { enabled: ['Grep'] })[0] as any;
    const res = await grep.execute('c5', {
      pattern: 'NEEDLE',
      output_mode: 'count',
      max_results: 2,
    });
    const parsed = JSON.parse(res.content[0].text);
    rmSync(dir, { recursive: true, force: true });
    expect(parsed.truncated).toBe(true);
    expect(parsed.counts.length).toBe(2);
  });
});

describe('Write bridge tool', () => {
  it('creates a new file and reports type "create"', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;
    const res = await write.execute('w1', { file_path: 'sub/new.txt', content: 'hello' });
    const onDisk = readFileSync(path.join(dir, 'sub/new.txt'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.type).toBe('create');
    expect(onDisk).toBe('hello');
  });

  it('rejects writing content larger than the mutation cap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-large-content-'));
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-large-content', {
      file_path: 'large.txt',
      content: 'x'.repeat(2 * 1024 * 1024 + 1),
    });
    const exists = existsSync(path.join(dir, 'large.txt'));

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'content_too_large',
      maxBytes: 2 * 1024 * 1024,
    });
    expect(exists).toBe(false);
  });

  it('caps large write diff details and structured patch output', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-diff-cap-'));
    const original =
      Array.from({ length: 1_000 }, (_, i) => `old-${i}`.padEnd(45, 'a')).join('\n') + '\n';
    const updated =
      Array.from({ length: 1_000 }, (_, i) => `new-${i}`.padEnd(45, 'b')).join('\n') + '\n';
    writeFileSync(path.join(dir, 'large-diff.ts'), original);
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-diff-cap', { path: 'large-diff.ts' });
    const res = await write.execute('w-diff-cap', { file_path: 'large-diff.ts', content: updated });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.diff.length).toBeLessThan(90_000);
    expect(res.details.diffTruncated).toBe(true);
    expect(res.details.structuredPatchTruncated).toBe(true);
    expect(res.details.structuredPatch[0].lines.length).toBeLessThanOrEqual(400);
  });

  it('rejects writing outside the workspace', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;
    const res = await write.execute('w2', { file_path: '../escape.txt', content: 'x' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('path_outside_workspace');
  });

  it('rejects writing through a symlinked parent outside the workspace', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'zc-write-outside-'));
    symlinkSync(outside, path.join(dir, 'outside-link'), 'dir');
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-symlink-parent', {
      file_path: 'outside-link/escape.txt',
      content: 'x',
    });
    const outsideChanged = existsSync(path.join(outside, 'escape.txt'));

    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    expect(res.details.error).toBe('path_outside_workspace');
    expect(outsideChanged).toBe(false);
  });

  it('writes through an in-workspace symlink to its target without replacing the link', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-symlink-'));
    writeFileSync(path.join(dir, 'target.txt'), 'old\n');
    symlinkSync(path.join(dir, 'target.txt'), path.join(dir, 'link.txt'));
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-link', { path: 'link.txt' });
    const res = await write.execute('w-link', { file_path: 'link.txt', content: 'new\n' });
    const linkStillSymlink = lstatSync(path.join(dir, 'link.txt')).isSymbolicLink();
    const targetContent = readFileSync(path.join(dir, 'target.txt'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(linkStillSymlink).toBe(true);
    expect(targetContent).toBe('new\n');
  });

  it('rejects writing obvious private key material', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-secret', {
      file_path: 'key.pem',
      content: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('secret_detected');
  });

  it('rejects writing obvious API token material', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-token-secret', {
      file_path: '.env',
      content:
        'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('secret_detected');
  });

  it('rejects dangerous permission changes in agent settings files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-settings-unsafe', {
      file_path: '.claude/settings.json',
      content: '{\n  "permissionMode": "bypassPermissions"\n}\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('unsafe_settings_change');
  });

  it('requires an existing file to be read before overwriting it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const write = buildTools(dir, { enabled: ['Write'] }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w3', { file_path: 'f.ts', content: 'const a = 2;\n' });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_not_read');
  });

  it('overwrites an existing file after a full read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write', { path: 'f.ts' });
    const res = await write.execute('w4', { file_path: 'f.ts', content: 'const a = 2;\n' });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.type).toBe('update');
    expect(onDisk).toBe('const a = 2;\n');
  });

  it('returns a diff when overwriting an existing file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-diff', { path: 'f.ts' });
    const res = await write.execute('w-diff', {
      file_path: 'f.ts',
      content: 'const a = 1;\nconst b = 3;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      type: 'update',
      firstChangedLine: 2,
    });
    expect(res.details.diff).toContain('--- f.ts');
    expect(res.details.diff).toContain('+++ f.ts');
    expect(res.details.diff).toContain('-const b = 2;');
    expect(res.details.diff).toContain('+const b = 3;');
    expect(res.content[0].text).toContain('Wrote f.ts (update)');
    expect(res.content[0].text).toContain('Snapshot: internal file state updated');
    expect(res.content[0].text).toContain('-const b = 2;');
    expect(res.content[0].text).toContain('+const b = 3;');
    expect(res.details.structuredPatch).toEqual([
      expect.objectContaining({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: expect.arrayContaining(['-const b = 2;', '+const b = 3;']),
      }),
    ]);
    expect(res.details.lineChanges).toEqual({ additions: 1, deletions: 1, changes: 2 });
  });

  it('does not embed full before/after file bodies in write result details', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const original = `${'a'.repeat(90_000)}\n`;
    const updated = `${'b'.repeat(90_000)}\n`;
    writeFileSync(path.join(dir, 'large.ts'), original);
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-large-result', { path: 'large.ts' });
    const res = await write.execute('w-large-result', { file_path: 'large.ts', content: updated });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.originalContent).toBeUndefined();
    expect(res.details.updatedContent).toBeUndefined();
    // The diff itself stays budgeted so a giant rewrite cannot bloat the record.
    expect(String(res.details.diff).length).toBeLessThan(81_000);
  });

  it('runs the write lifecycle after updating an existing file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const afterWrite = vi.fn().mockResolvedValue({
      notifications: ['indexed f.ts'],
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          severity: 'warning',
          message: 'check import order',
          source: 'fake-lsp',
        },
      ],
    });
    const tools = buildTools(dir, { enabled: ['Read', 'Write'], writeLifecycle: { afterWrite } });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-lifecycle-update', { path: 'f.ts' });
    const res = await write.execute('w-lifecycle-update', {
      file_path: 'f.ts',
      content: 'const a = 2;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(afterWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'write',
        type: 'update',
        path: 'f.ts',
        absolutePath: filePath,
        originalContent: 'const a = 1;\n',
        updatedContent: 'const a = 2;\n',
        firstChangedLine: 1,
      })
    );
    expect(afterWrite.mock.calls[0][0].diff).toContain('-const a = 1;');
    expect(afterWrite.mock.calls[0][0].diff).toContain('+const a = 2;');
    expect(res.details.lifecycle).toMatchObject({
      notifications: ['indexed f.ts'],
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          severity: 'warning',
          message: 'check import order',
          source: 'fake-lsp',
        },
      ],
    });
  });

  it('notifies a file change adapter after writing a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const notifyFileChanged = vi.fn();
    const write = buildTools(dir, {
      enabled: ['Write'],
      fileChangeNotifier: { notifyFileChanged },
    } as any).find((t: any) => t.name === 'Write') as any;

    const res = await write.execute('w-file-change-notify', {
      file_path: 'f.ts',
      content: 'const a = 1;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(notifyFileChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'f.ts',
        absolutePath: path.join(dir, 'f.ts'),
        changeKind: 'create',
        operation: 'write',
      })
    );
    expect(res.details.lifecycle).toMatchObject({
      notifications: ['file_change_notified:f.ts'],
    });
  });

  it('returns diagnostics from a diagnostics provider adapter after writing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const diagnosticsProvider = vi.fn().mockResolvedValue([
      {
        path: 'f.ts',
        line: 1,
        column: 7,
        severity: 'error',
        message: 'Type mismatch',
        source: 'fake-ts',
      },
    ]);
    const write = buildTools(dir, { enabled: ['Write'], diagnosticsProvider }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-diagnostics-provider', {
      file_path: 'f.ts',
      content: 'const a: string = 1;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(diagnosticsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'write',
        type: 'create',
        path: 'f.ts',
        updatedContent: 'const a: string = 1;\n',
      })
    );
    expect(res.details.lifecycle).toMatchObject({
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          column: 7,
          severity: 'error',
          message: 'Type mismatch',
          source: 'fake-ts',
        },
      ],
    });
  });

  it('returns diagnostics from a configured diagnostics command after writing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const write = buildTools(dir, {
      enabled: ['Write'],
      diagnosticsCommand: {
        command: process.execPath,
        args: ['-e', 'console.log("f.ts:1:7 - error TS2322: Type mismatch")'],
      },
    } as any).find((t: any) => t.name === 'Write') as any;

    const res = await write.execute('w-command-diagnostics', {
      file_path: 'f.ts',
      content: 'const a: string = 1;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.lifecycle).toMatchObject({
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          column: 7,
          severity: 'error',
          message: 'Type mismatch',
          source: 'TS2322',
        },
      ],
    });
  });

  it('wires an LSP diagnostics adapter into write diagnostics and file notifications', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'f.ts');
    const handlers = new Map<string, (params: unknown) => void>();
    const transport: LspTransport = {
      notify: vi.fn(async method => {
        if (method === 'textDocument/didSave') {
          handlers.get('textDocument/publishDiagnostics')?.({
            uri: filePathToUri(filePath),
            diagnostics: [
              {
                range: { start: { line: 0, character: 6 } },
                severity: 1,
                message: 'Type mismatch',
                source: 'tsserver',
              },
            ],
          });
        }
      }),
      onNotification: (method, handler) => {
        handlers.set(method, handler);
        return () => handlers.delete(method);
      },
    };
    const write = buildTools(dir, {
      enabled: ['Write'],
      lspDiagnosticsAdapter: { transport, diagnosticsTimeoutMs: 100 },
    } as any).find((t: any) => t.name === 'Write') as any;

    const res = await write.execute('w-lsp-diagnostics', {
      file_path: 'f.ts',
      content: 'const a: string = 1;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(transport.notify).toHaveBeenCalledWith('textDocument/didOpen', expect.any(Object));
    expect(transport.notify).toHaveBeenCalledWith('textDocument/didSave', expect.any(Object));
    expect(res.details.lifecycle).toMatchObject({
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          column: 7,
          severity: 'error',
          message: 'Type mismatch',
          source: 'tsserver',
        },
      ],
      notifications: ['file_change_notified:f.ts'],
    });
  });

  it('defers slow diagnostics provider results without blocking write completion', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    let releaseDiagnostics!: () => void;
    const diagnosticsReady = new Promise<void>(resolve => {
      releaseDiagnostics = resolve;
    });
    const diagnosticsProvider = vi.fn(async () => {
      await diagnosticsReady;
      return [
        { path: 'f.ts', line: 1, severity: 'warning', message: 'late warning', source: 'fake-ts' },
      ];
    });
    const write = buildTools(dir, {
      enabled: ['Write'],
      diagnosticsProvider,
      diagnosticsMode: 'deferred',
    }).find((t: any) => t.name === 'Write') as any;

    const res = await write.execute('w-deferred-diagnostics', {
      file_path: 'f.ts',
      content: 'const a = 1;\n',
    });
    expect(res.details.lifecycle).toMatchObject({
      deferredDiagnostics: { status: 'pending' },
    });
    const id = String(res.details.lifecycle.deferredDiagnostics.id);
    expect(getDeferredDiagnosticsResult(id)?.status).toBe('pending');

    releaseDiagnostics();
    await vi.waitFor(() => {
      expect(getDeferredDiagnosticsResult(id)).toMatchObject({
        status: 'completed',
        diagnostics: [
          {
            path: 'f.ts',
            line: 1,
            severity: 'warning',
            message: 'late warning',
            source: 'fake-ts',
          },
        ],
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the write lifecycle after creating a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'new.ts');
    const afterWrite = vi.fn().mockResolvedValue({ notifications: ['created new.ts'] });
    const write = buildTools(dir, { enabled: ['Write'], writeLifecycle: { afterWrite } }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-lifecycle-create', {
      file_path: 'new.ts',
      content: 'export const a = 1;\n',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(afterWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'write',
        type: 'create',
        path: 'new.ts',
        absolutePath: filePath,
        originalContent: null,
        updatedContent: 'export const a = 1;\n',
        firstChangedLine: 1,
      })
    );
    expect(res.details.lifecycle).toMatchObject({ notifications: ['created new.ts'] });
  });

  it('keeps the write successful when the lifecycle hook fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const afterWrite = vi.fn().mockRejectedValue(new Error('diagnostics unavailable'));
    const write = buildTools(dir, { enabled: ['Write'], writeLifecycle: { afterWrite } }).find(
      (t: any) => t.name === 'Write'
    ) as any;

    const res = await write.execute('w-lifecycle-failure', {
      file_path: 'new.ts',
      content: 'export const a = 1;\n',
    });
    const onDisk = readFileSync(path.join(dir, 'new.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('export const a = 1;\n');
    expect(res.details.lifecycle).toMatchObject({
      warnings: ['write_lifecycle_failed: diagnostics unavailable'],
      errors: [{ code: 'write_lifecycle_failed', message: 'diagnostics unavailable' }],
    });
  });

  it('keeps the write successful when the lifecycle hook times out', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const afterWrite = vi.fn().mockReturnValue(new Promise(() => {}));
    const write = buildTools(dir, {
      enabled: ['Write'],
      writeLifecycle: { afterWrite, timeoutMs: 5 },
    }).find((t: any) => t.name === 'Write') as any;

    const res = await write.execute('w-lifecycle-timeout', {
      file_path: 'new.ts',
      content: 'export const a = 1;\n',
    });
    const onDisk = readFileSync(path.join(dir, 'new.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('export const a = 1;\n');
    expect(res.details.lifecycle).toMatchObject({
      warnings: ['write_lifecycle_timeout: afterWrite exceeded 5ms'],
      errors: [{ code: 'write_lifecycle_timeout', message: 'afterWrite exceeded 5ms' }],
    });
  });

  it('records a lightweight backup before overwriting an existing file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-backup', { path: 'f.ts' });
    const res = await write.execute('w-backup', { file_path: 'f.ts', content: 'const a = 2;\n' });
    const backupContent = readFileSync(String(res.details.backup?.path), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.backup).toMatchObject({ originalPath: 'f.ts' });
    expect(backupContent).toBe('const a = 1;\n');
  });

  it('serializes concurrent writes to the same file through lifecycle completion', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const afterWrite = vi.fn((input: any) =>
      input.updatedContent.includes('one') ? firstBlocked : undefined
    );
    const write = buildTools(dir, {
      enabled: ['Write'],
      writeLifecycle: { afterWrite, timeoutMs: 1000 },
    }).find((t: any) => t.name === 'Write') as any;

    const first = write.execute('w-serial-1', { file_path: 'f.ts', content: 'one\n' });
    const second = write.execute('w-serial-2', { file_path: 'f.ts', content: 'two\n' });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(afterWrite).toHaveBeenCalledTimes(1);

    releaseFirst();
    const results = await Promise.all([first, second]);
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(results[0].details.ok).toBe(true);
    expect(results[1].details.ok).toBe(true);
    expect(afterWrite).toHaveBeenCalledTimes(2);
    expect(onDisk).toBe('two\n');
  });

  it('rejects overwriting when the file changed after it was read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-stale', { path: 'f.ts' });
    writeFileSync(filePath, 'const external = true;\n');
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);
    const res = await write.execute('w-stale', { file_path: 'f.ts', content: 'const a = 2;\n' });
    const onDisk = readFileSync(filePath, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_modified_since_read');
    expect(onDisk).toBe('const external = true;\n');
  });

  it('rejects overwriting when content changed even if mtime did not advance', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-stale-mtime', { path: 'f.ts' });
    writeFileSync(filePath, 'const external = true;\n');
    const past = new Date(Date.now() - 5000);
    utimesSync(filePath, past, past);
    const res = await write.execute('w-stale-mtime', {
      file_path: 'f.ts',
      content: 'const a = 2;\n',
    });
    const onDisk = readFileSync(filePath, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_modified_since_read');
    expect(onDisk).toBe('const external = true;\n');
  });

  it('allows overwriting when only mtime changed after a full read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-mtime-only', { path: 'f.ts' });
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);
    const res = await write.execute('w-mtime-only', {
      file_path: 'f.ts',
      content: 'const a = 2;\n',
    });
    const onDisk = readFileSync(filePath, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('const a = 2;\n');
  });

  it('preserves CRLF line endings when overwriting an existing CRLF file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\r\nconst b = 2;\r\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-crlf', { path: 'f.ts' });
    const res = await write.execute('w-crlf', {
      file_path: 'f.ts',
      content: 'const a = 1;\nconst b = 3;\n',
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('const a = 1;\r\nconst b = 3;\r\n');
  });

  it('preserves file mode when overwriting an existing file atomically', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-mode-'));
    const filePath = path.join(dir, 'script.sh');
    writeFileSync(filePath, '#!/bin/sh\necho old\n');
    chmodSync(filePath, 0o755);
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-mode', { path: 'script.sh' });
    const res = await write.execute('w-mode', {
      file_path: 'script.sh',
      content: '#!/bin/sh\necho new\n',
    });
    const mode = statSync(filePath).mode & 0o777;

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(mode).toBe(0o755);
  });

  it('preserves UTF-16LE encoding when overwriting an existing UTF-16LE file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-write-'));
    const filePath = path.join(dir, 'utf16.ts');
    writeFileSync(filePath, Buffer.from('\ufeffconst a = 1;\n', 'utf16le'));
    const tools = buildTools(dir, { enabled: ['Read', 'Write'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const write = tools.find((t: any) => t.name === 'Write') as any;

    await read.execute('r-write-utf16', { path: 'utf16.ts' });
    const res = await write.execute('w-utf16', {
      file_path: 'utf16.ts',
      content: 'const a = 2;\n',
    });
    const onDisk = readFileSync(filePath);

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk[0]).toBe(0xff);
    expect(onDisk[1]).toBe(0xfe);
    expect(onDisk.toString('utf16le')).toBe('\ufeffconst a = 2;\n');
  });
});

describe('Edit bridge tool', () => {
  it('applies a multi-file patch with update and add operations', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-patch-a', { path: 'a.ts' });
    const res = await edit.execute('e-apply-patch', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Add File: b.ts',
        '+export const b = 1;',
        '*** End Patch',
      ].join('\n'),
    });
    const a = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    const b = readFileSync(path.join(dir, 'b.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.perFileResults).toEqual([
      expect.objectContaining({ path: 'a.ts', type: 'update', ok: true }),
      expect.objectContaining({ path: 'b.ts', type: 'create', ok: true }),
    ]);
    expect(res.content[0].text).toContain('Applied patch');
    expect(res.content[0].text).toContain('Files changed: 2');
    expect(res.content[0].text).toContain('- update a.ts');
    expect(res.content[0].text).toContain('- create b.ts');
    expect(res.content[0].text).toContain('+const a = 2;');
    expect(a).toBe('const a = 2;\n');
    expect(b).toBe('export const b = 1;\n');
  });

  it('applies patch delete and rename operations', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'delete.ts'), 'export const deleted = true;\n');
    writeFileSync(path.join(dir, 'old.ts'), 'export const renamed = true;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-patch-delete', { path: 'delete.ts' });
    await read.execute('r-patch-rename', { path: 'old.ts' });
    const res = await edit.execute('e-apply-patch-delete-rename', {
      patch: [
        '*** Begin Patch',
        '*** Delete File: delete.ts',
        '*** Rename File: old.ts -> new.ts',
        '*** End Patch',
      ].join('\n'),
    });
    const deletedExists = existsSync(path.join(dir, 'delete.ts'));
    const oldExists = existsSync(path.join(dir, 'old.ts'));
    const renamed = readFileSync(path.join(dir, 'new.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.perFileResults).toEqual([
      expect.objectContaining({ path: 'delete.ts', type: 'delete', ok: true }),
      expect.objectContaining({ path: 'new.ts', originalPath: 'old.ts', type: 'rename', ok: true }),
    ]);
    expect(deletedExists).toBe(false);
    expect(oldExists).toBe(false);
    expect(renamed).toBe('export const renamed = true;\n');
  });

  it('previews a patch without writing any files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-patch-preview', { path: 'a.ts' });
    const res = await edit.execute('e-apply-patch-preview', {
      preview_only: true,
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Add File: b.ts',
        '+export const b = 1;',
        '*** End Patch',
      ].join('\n'),
    });
    const a = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    const bExists = existsSync(path.join(dir, 'b.ts'));

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({ ok: true, preview: true });
    expect(res.details.perFileResults).toEqual([
      expect.objectContaining({ path: 'a.ts', type: 'update', preview: true, ok: true }),
      expect.objectContaining({ path: 'b.ts', type: 'create', preview: true, ok: true }),
    ]);
    expect(a).toBe('const a = 1;\n');
    expect(bExists).toBe(false);
  });

  it('returns per-file patch failure summaries instead of discarding context', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-patch-summary', { path: 'a.ts' });
    const res = await edit.execute('e-apply-patch-summary', {
      preview_only: true,
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Update File: missing.ts',
        '@@',
        '-missing',
        '+still missing',
        '*** End Patch',
      ].join('\n'),
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({ ok: false, error: 'patch_partial_failure' });
    expect(res.details.perFileResults).toEqual([
      expect.objectContaining({ path: 'a.ts', ok: true, preview: true }),
      expect.objectContaining({ path: 'missing.ts', ok: false }),
    ]);
  });

  it('preflights patch updates before writing so later failures do not leave partial changes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-patch-atomic-a', { path: 'a.ts' });
    const res = await edit.execute('e-apply-patch-atomic', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Update File: missing.ts',
        '@@',
        '-missing',
        '+still missing',
        '*** End Patch',
      ].join('\n'),
    });
    const a = readFileSync(path.join(dir, 'a.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({ ok: false, error: 'patch_partial_failure' });
    expect(a).toBe('const a = 1;\n');
  });

  it('preflights workspace-escaping symlink failures before writing earlier updates', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-patch-symlink-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'zc-edit-patch-outside-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    writeFileSync(path.join(outside, 'target.ts'), 'target\n');
    // A symlink whose target escapes the workspace must still be refused — that's
    // what protects the earlier a.ts update from landing.
    symlinkSync(path.join(outside, 'target.ts'), path.join(dir, 'link.ts'));
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-patch-symlink-a', { path: 'a.ts' });
    const res = await edit.execute('e-apply-patch-symlink', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Add File: link.ts',
        '+replacement',
        '*** End Patch',
      ].join('\n'),
    });
    const a = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    const linkStillSymlink = lstatSync(path.join(dir, 'link.ts')).isSymbolicLink();
    const target = readFileSync(path.join(outside, 'target.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    expect(res.details).toMatchObject({ ok: false, error: 'patch_partial_failure' });
    expect(res.details.perFileResults).toEqual([
      expect.objectContaining({ path: 'a.ts', ok: true, preview: true }),
      expect.objectContaining({
        path: 'link.ts',
        ok: false,
        error: expect.stringMatching(/symlink_escape|path_outside_workspace/),
      }),
    ]);
    expect(a).toBe('const a = 1;\n');
    expect(linkStillSymlink).toBe(true);
    expect(target).toBe('target\n');
  });

  it('rejects patch updates when the target file was not read first', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    const edit = buildTools(dir, { enabled: ['Edit'] }).find((t: any) => t.name === 'Edit') as any;

    const res = await edit.execute('e-patch-unread', {
      patch: [
        '*** Begin Patch',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** End Patch',
      ].join('\n'),
    });
    const a = readFileSync(path.join(dir, 'a.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_not_read');
    expect(a).toBe('const a = 1;\n');
  });

  it('replaces a unique occurrence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;
    await read.execute('r-edit', { path: 'f.ts' });
    const res = await edit.execute('e1', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('const a = 2;\n');
  });

  it('returns a diff when editing a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-diff', { path: 'f.ts' });
    const res = await edit.execute('e-diff', {
      file_path: 'f.ts',
      old_string: 'const b = 2;',
      new_string: 'const b = 3;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      firstChangedLine: 2,
      state: {
        previousSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
        newSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
        snapshotUpdated: true,
        changedRanges: [expect.objectContaining({ start: 2, end: 2 })],
      },
    });
    expect(res.details.diff).toContain('--- f.ts');
    expect(res.details.diff).toContain('+++ f.ts');
    expect(res.details.diff).toContain('-const b = 2;');
    expect(res.details.diff).toContain('+const b = 3;');
    expect(res.content[0].text).toContain('Edited f.ts');
    expect(res.content[0].text).toContain('Snapshot: internal file state updated');
    expect(res.content[0].text).toContain('State: previousSnapshotId=f.ts#');
    expect(res.content[0].text).toContain('-const b = 2;');
    expect(res.content[0].text).toContain('+const b = 3;');
    expect(res.details.structuredPatch).toEqual([
      expect.objectContaining({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: expect.arrayContaining(['-const b = 2;', '+const b = 3;']),
      }),
    ]);
    expect(res.details.lineChanges).toEqual({ additions: 1, deletions: 1, changes: 2 });
  });

  it('caps large edit diff details and structured patch output', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-diff-cap-'));
    const original =
      Array.from({ length: 1_000 }, (_, i) => `old-${i}`.padEnd(45, 'a')).join('\n') + '\n';
    const updated =
      Array.from({ length: 1_000 }, (_, i) => `new-${i}`.padEnd(45, 'b')).join('\n') + '\n';
    writeFileSync(path.join(dir, 'large-diff.ts'), original);
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-diff-cap', { path: 'large-diff.ts' });
    const res = await edit.execute('e-diff-cap', {
      file_path: 'large-diff.ts',
      old_string: original,
      new_string: updated,
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.diff.length).toBeLessThan(90_000);
    expect(res.details.diffTruncated).toBe(true);
    expect(res.details.structuredPatchTruncated).toBe(true);
    expect(res.details.structuredPatch[0].lines.length).toBeLessThanOrEqual(400);
  });

  it('applies same-file batch edits in one Edit call and keeps the snapshot current', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(
      path.join(dir, 'f.ts'),
      ['const a = 1;', 'const b = 2;', 'const c = 3;', ''].join('\n')
    );
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-batch-edit', { path: 'f.ts' });
    const res = await edit.execute('e-batch', {
      file_path: 'f.ts',
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const b = 2;', new_string: 'const b = 20;' },
      ],
    });
    const followup = await edit.execute('e-batch-followup-no-read', {
      file_path: 'f.ts',
      old_string: 'const c = 3;',
      new_string: 'const c = 30;',
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({ ok: true, editCount: 2, replaced: 2 });
    expect(res.details.state).toMatchObject({
      previousSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
      newSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
      snapshotUpdated: true,
    });
    expect(res.content[0].text).toContain('Edits applied: 2');
    expect(res.content[0].text).toContain('Snapshot: internal file state updated');
    expect(res.content[0].text).toContain('-const a = 1;');
    expect(res.content[0].text).toContain('+const a = 10;');
    expect(followup.details.ok).toBe(true);
    expect(onDisk).toBe('const a = 10;\nconst b = 20;\nconst c = 30;\n');
  });

  it('exposes MultiEdit as the explicit same-file batch edit tool', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-multiedit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'MultiEdit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const multiEdit = tools.find((t: any) => t.name === 'MultiEdit') as any;

    await read.execute('r-multi-edit', { path: 'f.ts' });
    const res = await multiEdit.execute('me1', {
      file_path: 'f.ts',
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const b = 2;', new_string: 'const b = 20;' },
      ],
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(multiEdit.parameters.required).toEqual(['file_path', 'edits']);
    expect(multiEdit.parameters.properties.edits.minItems).toBe(2);
    expect(res.details).toMatchObject({ ok: true, editCount: 2, replaced: 2 });
    expect(res.content[0].text).toContain('Edited f.ts');
    expect(onDisk).toBe('const a = 10;\nconst b = 20;\n');
  });

  it('rejects invalid MultiEdit edit arrays with MultiEdit-specific guidance', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-multiedit-invalid-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['MultiEdit'] });
    const multiEdit = tools.find((t: any) => t.name === 'MultiEdit') as any;

    const single = await multiEdit.execute('me-single', {
      file_path: 'f.ts',
      edits: [{ old_string: 'const a = 1;', new_string: 'const a = 10;' }],
    });
    const malformed = await multiEdit.execute('me-malformed', {
      file_path: 'f.ts',
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const b = 2;' },
      ],
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(single.details).toMatchObject({
      ok: false,
      error: 'invalid_edits',
      editCount: 1,
      minEdits: 2,
    });
    expect(single.content[0].text).toContain(
      'MultiEdit requires at least 2 replacements; use Edit for one exact replacement'
    );
    expect(malformed.details).toMatchObject({ ok: false, error: 'missing_strings', editIndex: 1 });
    expect(malformed.content[0].text).toContain(
      'MultiEdit edits[1] requires old_string and new_string'
    );
    expect(malformed.content[0].text).not.toContain('Edit edits must');
    expect(onDisk).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('does not partially write batch edits when a later replacement fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-batch-fail', { path: 'f.ts' });
    const res = await edit.execute('e-batch-fail', {
      file_path: 'f.ts',
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const missing = true;', new_string: 'const missing = false;' },
      ],
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({ ok: false, error: 'not_found', editIndex: 1 });
    expect(onDisk).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('rejects batch edits whose final content exceeds the mutation cap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-final-cap-'));
    const original = 'prefix\n';
    writeFileSync(path.join(dir, 'f.txt'), original);
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-final-cap', { path: 'f.txt' });
    const res = await edit.execute('e-final-cap', {
      file_path: 'f.txt',
      edits: [
        { old_string: 'prefix', new_string: 'x'.repeat(1_100_000) },
        { old_string: '\n', new_string: `${'y'.repeat(1_100_000)}\n` },
      ],
    });
    const onDisk = readFileSync(path.join(dir, 'f.txt'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'content_too_large',
      maxBytes: 2 * 1024 * 1024,
    });
    expect(onDisk).toBe(original);
  });

  it('previews an edit without writing to disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-preview-edit', { path: 'f.ts' });
    const res = await edit.execute('e-preview', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
      preview_only: true,
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      preview: true,
      path: 'f.ts',
    });
    expect(res.details.diff).toContain('-const a = 1;');
    expect(res.details.diff).toContain('+const a = 2;');
    expect(onDisk).toBe('const a = 1;\n');
  });

  it('notifies a file change adapter after editing a file but not for preview', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const notifyFileChanged = vi.fn();
    const tools = buildTools(dir, {
      enabled: ['Read', 'Edit'],
      fileChangeNotifier: { notifyFileChanged },
    } as any);
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;
    await read.execute('r-file-change-edit', { path: 'f.ts' });

    const preview = await edit.execute('e-file-change-preview', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
      preview_only: true,
    });
    const res = await edit.execute('e-file-change-edit', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(preview.details.preview).toBe(true);
    expect(res.details.ok).toBe(true);
    expect(notifyFileChanged).toHaveBeenCalledTimes(1);
    expect(notifyFileChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'f.ts',
        absolutePath: filePath,
        changeKind: 'modify',
        operation: 'edit',
      })
    );
  });

  it('edits a line by hashline anchor', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    const readRes = await read.execute('r-hashline-edit', { path: 'f.ts', hashline: true });
    const lineHash = readRes.details.hashline.lines[1].hash;
    const res = await edit.execute('e-hashline', {
      file_path: 'f.ts',
      hashline_line: lineHash,
      new_string: 'const b = 3;',
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('const a = 1;\nconst b = 3;\n');
  });

  it('edits through an in-workspace symlink to its target without replacing it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-symlink-'));
    writeFileSync(path.join(dir, 'target.txt'), 'old\n');
    symlinkSync(path.join(dir, 'target.txt'), path.join(dir, 'link.txt'));
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-link', { path: 'link.txt' });
    const res = await edit.execute('e-edit-link', {
      file_path: 'link.txt',
      old_string: 'old',
      new_string: 'new',
    });
    const linkStillSymlink = lstatSync(path.join(dir, 'link.txt')).isSymbolicLink();
    const targetContent = readFileSync(path.join(dir, 'target.txt'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(linkStillSymlink).toBe(true);
    expect(targetContent).toBe('new\n');
  });

  it('previews a hashline edit using operation grammar without writing to disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    const readRes = await read.execute('r-hashline-preview', { path: 'f.ts', hashline: true });
    const lineHash = readRes.details.hashline.lines[1].hash;
    const res = await edit.execute('e-hashline-preview', {
      file_path: 'f.ts',
      hashline_operation: `replace:${lineHash}`,
      hashline_tag: readRes.details.hashline.tag,
      new_string: 'const b = 3;',
      preview_only: true,
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      preview: true,
      hashline: { tag: readRes.details.hashline.tag },
    });
    expect(res.details.diff).toContain('+const b = 3;');
    expect(onDisk).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('rejects hashline edits whose anchored line changed out-of-band (tag drift alone is tolerated)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    const readRes = await read.execute('r-hashline-stale-tag', { path: 'f.ts', hashline: true });
    // The anchored line itself was rewritten out-of-band, so the anchor is gone.
    writeFileSync(filePath, 'const a = 1;\nconst b = 22;\n');
    const res = await edit.execute('e-hashline-stale-tag', {
      file_path: 'f.ts',
      hashline_line: readRes.details.hashline.lines[1].hash,
      hashline_tag: readRes.details.hashline.tag,
      new_string: 'const b = 3;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'hashline_mismatch',
      suggestion: 'Read the file again with hashline:true before editing.',
    });
    expect(res.content[0].text).toContain('changed since it was read');
  });

  it('rejects hashline edits when the anchor cannot be found', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-hashline-missing', { path: 'f.ts', hashline: true });
    const res = await edit.execute('e-hashline-missing', {
      file_path: 'f.ts',
      hashline_line: 'ffffffffffff',
      new_string: 'const missing = true;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('hashline_mismatch');
  });

  it('returns a focused structured patch hunk around the changed lines', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    const content = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    writeFileSync(path.join(dir, 'f.ts'), content);
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-focused-patch', { path: 'f.ts' });
    const res = await edit.execute('e-focused-patch', {
      file_path: 'f.ts',
      old_string: 'line 6',
      new_string: 'line six',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.structuredPatch).toEqual([
      expect.objectContaining({
        oldStart: 3,
        oldLines: 7,
        newStart: 3,
        newLines: 7,
      }),
    ]);
    expect(res.details.structuredPatch[0].lines).not.toContain(' line 1');
    expect(res.details.structuredPatch[0].lines).toContain('-line 6');
    expect(res.details.structuredPatch[0].lines).toContain('+line six');
  });

  it('records a lightweight backup before editing an existing file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-backup', { path: 'f.ts' });
    const res = await edit.execute('e-backup', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    const backupContent = readFileSync(String(res.details.backup?.path), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.backup).toMatchObject({ originalPath: 'f.ts' });
    expect(backupContent).toBe('const a = 1;\n');
  });

  it('runs the write lifecycle after editing a file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const afterWrite = vi.fn().mockResolvedValue({
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          column: 7,
          severity: 'error',
          message: 'fake diagnostic',
          source: 'fake-lsp',
        },
      ],
    });
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'], writeLifecycle: { afterWrite } });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-lifecycle', { path: 'f.ts' });
    const res = await edit.execute('e-lifecycle', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(afterWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'edit',
        type: 'update',
        path: 'f.ts',
        absolutePath: filePath,
        originalContent: 'const a = 1;\n',
        updatedContent: 'const a = 2;\n',
        firstChangedLine: 1,
      })
    );
    expect(res.details.replaced).toBe(1);
    expect(res.details.lifecycle).toMatchObject({
      diagnostics: [
        {
          path: 'f.ts',
          line: 1,
          column: 7,
          severity: 'error',
          message: 'fake diagnostic',
          source: 'fake-lsp',
        },
      ],
    });
  });

  it('requires the file to be read before editing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\n');
    const edit = buildTools(dir, { enabled: ['Edit'] }).find((t: any) => t.name === 'Edit') as any;

    const res = await edit.execute('e-unread', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_not_read');
  });

  it('rejects editing notebooks with the plain Edit tool', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'n.ipynb'), '{}\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-ipynb', { path: 'n.ipynb' });
    const res = await edit.execute('e-ipynb', {
      file_path: 'n.ipynb',
      old_string: '{}',
      new_string: '{"cells":[]}',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('unsupported_notebook_edit');
  });

  it('rejects editing files that are too large for safe string replacement', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    const filePath = path.join(dir, 'large.ts');
    writeFileSync(filePath, '');
    truncateSync(filePath, 1024 * 1024 * 1024 + 1);
    const edit = buildTools(dir, { enabled: ['Edit'] }).find((t: any) => t.name === 'Edit') as any;

    const res = await edit.execute('e-large', {
      file_path: 'large.ts',
      old_string: 'a',
      new_string: 'b',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_too_large');
  });

  it('rejects edits that would insert obvious private key material', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const key = "";\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-secret-edit', { path: 'f.ts' });
    const res = await edit.execute('e-secret', {
      file_path: 'f.ts',
      old_string: 'const key = "";',
      new_string: 'const key = "-----BEGIN PRIVATE KEY-----";',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('secret_detected');
  });

  it('rejects edits that would insert obvious API token material', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const token = "";\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-token-secret-edit', { path: 'f.ts' });
    const res = await edit.execute('e-token-secret', {
      file_path: 'f.ts',
      old_string: 'const token = "";',
      new_string: 'const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('secret_detected');
  });

  it('returns size details when replacement content exceeds the mutation cap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-oversize-details-'));
    writeFileSync(path.join(dir, 'f.txt'), 'small\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-oversize-details', { path: 'f.txt' });
    const res = await edit.execute('e-oversize-details', {
      file_path: 'f.txt',
      old_string: 'small',
      new_string: 'x'.repeat(2 * 1024 * 1024 + 1),
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'content_too_large',
      size: 2 * 1024 * 1024 + 1,
      maxBytes: 2 * 1024 * 1024,
    });
  });

  it('rejects dangerous permission changes when editing agent settings files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    writeFileSync(path.join(dir, '.claude/settings.json'), '{\n  "permissionMode": "ask"\n}\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-settings-unsafe-edit', { path: '.claude/settings.json' });
    const res = await edit.execute('e-settings-unsafe', {
      file_path: '.claude/settings.json',
      old_string: '"permissionMode": "ask"',
      new_string: '"permissionMode": "bypassPermissions"',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('unsafe_settings_change');
  });

  it('requires the file to have been read before editing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    const res = await edit.execute('e-unread', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 3;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_not_read');
  });

  // Option B: a fast-path ranged read captures the whole file (only the displayed
  // window is partial), so a targeted Edit is allowed without a redundant full re-read.
  it('allows editing after a ranged read (full content captured on the fast path)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-partial', { path: 'f.ts', offset: 1, limit: 1 });
    const res = await edit.execute('e-partial', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 3;',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
  });

  it('preserves CRLF line endings when editing a CRLF file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\r\nconst b = 2;\r\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-crlf', { path: 'f.ts' });
    const res = await edit.execute('e-crlf', {
      file_path: 'f.ts',
      old_string: 'const b = 2;',
      new_string: 'const b = 3;',
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(onDisk).toBe('const a = 1;\r\nconst b = 3;\r\n');
  });

  it('rejects editing when the file changed after it was read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-stale', { path: 'f.ts' });
    writeFileSync(filePath, 'const external = true;\n');
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);
    const res = await edit.execute('e-stale', {
      file_path: 'f.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    const onDisk = readFileSync(filePath, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('file_modified_since_read');
    expect(res.details).toMatchObject({
      retryable: true,
      suggestedAction: 'refresh_snapshot',
      state: {
        currentSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
        readSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
      },
      rebaseFailed: true,
      rebaseError: 'not_found',
    });
    expect(onDisk).toBe('const external = true;\n');
  });

  it('rebases an edit when the file changed but old_string still matches uniquely', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-rebase-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;

    await read.execute('r-edit-rebase', { path: 'f.ts' });
    writeFileSync(filePath, '// external change\nconst a = 1;\nconst b = 2;\n');
    const res = await edit.execute('e-rebase', {
      file_path: 'f.ts',
      old_string: 'const b = 2;',
      new_string: 'const b = 3;',
    });
    const onDisk = readFileSync(filePath, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      rebased: true,
      state: {
        rebased: true,
        readSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
        newSnapshotId: expect.stringMatching(/^f\.ts#[a-f0-9]{12}$/),
      },
    });
    expect(res.content[0].text).toContain('Rebased: file changed since the last Read');
    expect(onDisk).toBe('// external change\nconst a = 1;\nconst b = 3;\n');
  });

  it('errors when old_string is not unique and replace_all is false', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'x\nx\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;
    await read.execute('r-not-unique', { path: 'f.ts' });
    const res = await edit.execute('e2', { file_path: 'f.ts', old_string: 'x', new_string: 'y' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('not_unique');
  });

  it('replaces every occurrence with replace_all', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'x\nx\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;
    await read.execute('r-replace-all', { path: 'f.ts' });
    const res = await edit.execute('e3', {
      file_path: 'f.ts',
      old_string: 'x',
      new_string: 'y',
      replace_all: true,
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.replaced).toBe(2);
    expect(onDisk).toBe('y\ny\n');
  });

  it('errors when old_string is absent', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    writeFileSync(path.join(dir, 'f.ts'), 'abc\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;
    await read.execute('r-absent', { path: 'f.ts' });
    const res = await edit.execute('e4', { file_path: 'f.ts', old_string: 'zzz', new_string: 'q' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('not_found');
  });

  it('matches a straight-quote old_string against curly quotes in the file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-edit-'));
    // file contains a curly double-quoted string
    writeFileSync(path.join(dir, 'f.ts'), 'const msg = “hello”;\n');
    const tools = buildTools(dir, { enabled: ['Read', 'Edit'] });
    const read = tools.find((t: any) => t.name === 'Read') as any;
    const edit = tools.find((t: any) => t.name === 'Edit') as any;
    await read.execute('r-curly', { path: 'f.ts' });
    const res = await edit.execute('e5', {
      file_path: 'f.ts',
      old_string: 'const msg = "hello";',
      new_string: 'const msg = "world";',
    });
    const onDisk = readFileSync(path.join(dir, 'f.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    // the curly-quoted region was replaced with the straight-quoted new_string
    expect(onDisk).toBe('const msg = "world";\n');
  });
});

describe('Bash bridge tool', () => {
  function bashTool(dir: string) {
    return buildTools(dir, { enabled: ['Bash'] }).find((t: any) => t.name === 'Bash') as any;
  }

  it('returns a structured success result with exit code 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashtool-'));
    const res = await bashTool(dir).execute('b1', { command: 'echo hello' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.exitCode).toBe(0);
    expect(res.content[0].text).toContain('hello');
  });

  it('non-zero exit returns a normal result (not thrown) with ok:false and the exit code', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashtool-'));
    const res = await bashTool(dir).execute('b2', { command: 'echo boom; exit 7' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(false);
    expect(res.details.exitCode).toBe(7);
    expect(res.content[0].text).toContain('boom');
    expect(res.content[0].text).toContain('Exit code: 7');
  });

  it('runs in a workspace-relative subdir via the cwd param', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashtool-'));
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'marker.txt'), 'x');
    const res = await bashTool(dir).execute('b3', {
      command: 'test -f marker.txt && printf marker.txt',
      cwd: 'sub',
    });
    rmSync(dir, { recursive: true, force: true });
    expect(res.content[0].text).toContain('marker.txt');
  });

  it('rejects a cwd outside the workspace', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashtool-'));
    const res = await bashTool(dir).execute('b4', { command: 'ls', cwd: '../..' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('path_outside_workspace');
  });

  it('errors when the command is empty', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashtool-'));
    const res = await bashTool(dir).execute('b5', { command: '   ' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('missing_command');
  });

  it('writes full output to a temp file and reports the path when truncated', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashtool-'));
    const res = await bashTool(dir).execute('b6', { command: 'seq 1 5000' });
    const fullPath = res.details.fullOutputPath as string;
    const onDisk = readFileSync(fullPath, 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.truncated).toBe(true);
    expect(typeof fullPath).toBe('string');
    expect(onDisk).toContain('1\n');
    expect(onDisk.trim().endsWith('5000')).toBe(true);
  });

  it('exposes sandbox_mode and privilege_reason parameters', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bash-priv-schema-'));
    const bash = bashTool(dir);
    rmSync(dir, { recursive: true, force: true });

    expect(bash.parameters.properties.sandbox_mode.enum).toEqual([
      'auto',
      'sandbox',
      'unsandboxed',
    ]);
    expect(bash.parameters.properties.privilege_reason.type).toBe('string');
  });

  it('requires privilege_reason for unsandboxed Bash', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bash-priv-reason-'));
    const permissionCallback = vi.fn();
    const bash = buildTools(dir, { enabled: ['Bash'], permissionCallback }).find(
      (t: any) => t.name === 'Bash'
    ) as any;

    const res = await bash.execute('bash-unsandboxed-no-reason', {
      command: 'echo host',
      sandbox_mode: 'unsandboxed',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(permissionCallback).not.toHaveBeenCalled();
    expect(res.details.ok).toBe(false);
    expect(res.content[0].text).toContain('privilege_reason');
  });

  it('requests unsandboxed permission before host Bash execution', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bash-priv-host-'));
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' }));
    const bash = buildTools(dir, { enabled: ['Bash'], permissionCallback }).find(
      (t: any) => t.name === 'Bash'
    ) as any;

    const res = await bash.execute('bash-unsandboxed-yes', {
      command: 'echo HOST_OK',
      sandbox_mode: 'unsandboxed',
      privilege_reason: 'Need to verify host execution path.',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxUnsandboxedAccess' })
    );
    expect(res.content[0].text).toContain('HOST_OK');
    expect(res.details.privilegeMode).toBe('unsandboxed');
    expect(res.details.unsandboxedApproved).toBe(true);
  });
});

describe('Read image files', () => {
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('returns an image content block for image files when vision is supported', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-read-img-'));
    writeFileSync(path.join(dir, 'pic.png'), Buffer.from(PNG_BASE64, 'base64'));
    const read = buildTools(dir, { enabled: ['Read'], supportsVision: true } as any)[0] as any;

    const result = await read.execute('read-img-1', { path: 'pic.png' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.content).toEqual([{ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }]);
    expect(result.details).toMatchObject({ ok: true, mimeType: 'image/png' });
  });

  it('returns a text notice when the model lacks vision', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-read-img-'));
    writeFileSync(path.join(dir, 'pic.png'), Buffer.from(PNG_BASE64, 'base64'));
    const read = buildTools(dir, { enabled: ['Read'] })[0] as any;

    const result = await read.execute('read-img-2', { path: 'pic.png' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.content[0].type).toBe('text');
    expect((result.content[0] as { text: string }).text).toContain('does not support vision');
  });

  it('returns a size notice for oversize images', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-read-img-'));
    writeFileSync(path.join(dir, 'huge.png'), Buffer.alloc(5 * 1024 * 1024 + 1));
    const read = buildTools(dir, { enabled: ['Read'], supportsVision: true } as any)[0] as any;

    const result = await read.execute('read-img-3', { path: 'huge.png' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.content[0].type).toBe('text');
    expect((result.content[0] as { text: string }).text).toContain('exceeds');
  });

  it('binary non-image files keep the existing binary_file protection', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-read-img-'));
    writeFileSync(path.join(dir, 'data.bin'), Buffer.from([0, 1, 2, 0, 255]));
    const read = buildTools(dir, { enabled: ['Read'], supportsVision: true } as any)[0] as any;

    const result = await read.execute('read-img-4', { path: 'data.bin' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({ ok: false, error: 'binary_file' });
    expect(result.content[0].text).toContain('Refusing to read binary file');
  });

  it('mid-size images bypass text read size limit when vision is supported', async () => {
    // Images between DEFAULT_READ_MAX_BYTES (512KB) and 5MB vision cap bypass the text-read size limit
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-read-img-mid-'));
    writeFileSync(
      path.join(dir, 'mid.png'),
      Buffer.concat([Buffer.from(PNG_BASE64, 'base64'), Buffer.alloc(1024 * 1024)])
    );
    const read = buildTools(dir, { enabled: ['Read'], supportsVision: true } as any)[0] as any;

    const result = await read.execute('read-img-mid', { path: 'mid.png' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.content[0].type).toBe('image');
  });
});

describe('LS bridge tool', () => {
  it('lists entries alphabetically with a trailing slash on directories', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-ls-'));
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'b.txt'), 'b');
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const ls = buildTools(dir, { enabled: ['LS'] })[0] as any;
    const res = await ls.execute('call-1', {});
    const text = res.content[0].text as string;
    rmSync(dir, { recursive: true, force: true });
    expect(text.split('\n')).toEqual(['a.txt', 'b.txt', 'src/']);
  });

  it('rejects a path outside the workspace', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-ls-'));
    const ls = buildTools(dir, { enabled: ['LS'] })[0] as any;
    const res = await ls.execute('call-2', { path: '../../etc' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).not.toBe(true);
    expect(res.details.error).toBe('path_outside_workspace');
  });

  it('errors when the path is a file, not a directory', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-ls-'));
    writeFileSync(path.join(dir, 'f.txt'), 'x');
    const ls = buildTools(dir, { enabled: ['LS'] })[0] as any;
    const res = await ls.execute('call-3', { path: 'f.txt' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).not.toBe(true);
    expect(res.details.error).toBe('not_a_directory');
  });
});

describe('Bash background execution', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-bashbg-data-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevDataDir === undefined) {
      delete process.env.ZCLAUDIA_DATA_DIR;
    } else {
      process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('returns immediately with a taskId and the process runs detached', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashbg-'));
    const bash = buildTools(dir, { enabled: ['Bash'], db }).find(
      (t: any) => t.name === 'Bash'
    ) as any;
    const start = Date.now();
    const res = await bash.execute('bg1', { command: 'sleep 5', run_in_background: true });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
    expect(res.details.ok).toBe(true);
    expect(res.details.background).toBe(true);
    expect(typeof res.details.taskId).toBe('string');
    expect(typeof res.details.pid).toBe('number');
    // cleanup: kill it so the suite doesn't leak a sleep process
    await new CommandTaskExecutor(new TaskRepository(db)).stop(res.details.taskId);
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors with missing_db_context when no db is available', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashbg-'));
    const bash = buildTools(dir, { enabled: ['Bash'] }).find((t: any) => t.name === 'Bash') as any;
    const res = await bash.execute('bg2', { command: 'sleep 5', run_in_background: true });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('missing_db_context');
  });

  it('plan/read-only mode refuses run_in_background (no workspace write)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bgplan-'));
    const target = path.join(dir, 'pwned.txt');
    const bash = buildTools(dir, { enabled: ['Bash'], sandboxReadOnly: true, db }).find(
      (t: any) => t.name === 'Bash'
    ) as any;
    const res = await bash.execute('bgp1', {
      command: `echo PWNED > "${target}"`,
      run_in_background: true,
    });
    await new Promise(r => setTimeout(r, 300));
    const existed = existsSync(target);
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('background_not_allowed_plan_mode');
    expect(existed).toBe(false);
  });

  it('passes the session workspace root and granted domains into background sandbox wrapping', async () => {
    const wrap = vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({
      sandboxed: true,
      argv: ['sh', '-c', 'echo bg-wrapped'],
      env: process.env,
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bashbg-'));
    mkdirSync(path.join(dir, 'sub'));
    const bash = buildTools(dir, {
      enabled: ['Bash'],
      db,
      sandboxAllowedDomains: ['example.test'],
    }).find((t: any) => t.name === 'Bash') as any;

    const res = await bash.execute('bg-sandbox-meta', {
      command: 'echo bg-original',
      cwd: 'sub',
      run_in_background: true,
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.sandboxed).toBe(true);
    expect(new TaskRepository(db).findById(res.details.taskId)?.metadata).toMatchObject({
      sandboxed: true,
    });
    expect(wrap).toHaveBeenCalledWith(
      'echo bg-original',
      expect.objectContaining({
        workspaceRoot: dir,
        extraAllowedDomains: ['example.test'],
      })
    );
  });
});

describe('TaskOutput for command tasks', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-tobg-data-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) {
      delete process.env.ZCLAUDIA_DATA_DIR;
    } else {
      process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('reads the log incrementally with output_offset/nextOffset', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-tobg-'));
    const tools = buildTools(dir, { enabled: ['Bash', 'TaskOutput'], db });
    const bash = tools.find((t: any) => t.name === 'Bash') as any;
    const taskOutput = tools.find((t: any) => t.name === 'TaskOutput') as any;
    const started = await bash.execute('to1', {
      command: 'echo first-line; sleep 30',
      run_in_background: true,
    });
    const taskId = started.details.taskId as string;
    await new Promise(r => setTimeout(r, 500));

    const r1 = await taskOutput.execute('to2', { task_id: taskId });
    expect(r1.details.ok).toBe(true);
    expect(r1.content[0].text).toContain('first-line');
    expect(r1.content[0].text).toContain('Status: running');
    expect(r1.details.rawOutput).toContain('first-line');
    expect(r1.details.nextOffset).toBeGreaterThan(0);
    expect(r1.details.status).toBe('running');
    expect(r1.details.eof).toBe(true);

    const r2 = await taskOutput.execute('to3', {
      task_id: taskId,
      output_offset: r1.details.nextOffset,
    });
    expect(r2.details.rawOutput).toBe('');
    expect(r2.content[0].text).toContain('Output:\n(no output)');
    expect(r2.details.eof).toBe(true);

    await new CommandTaskExecutor(new TaskRepository(db)).stop(taskId); // no leaked sleep
    rmSync(dir, { recursive: true, force: true });
  });

  it('wait_ms blocks until new output arrives instead of returning empty', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-tobg-'));
    const tools = buildTools(dir, { enabled: ['Bash', 'TaskOutput'], db });
    const bash = tools.find((t: any) => t.name === 'Bash') as any;
    const taskOutput = tools.find((t: any) => t.name === 'TaskOutput') as any;
    const started = await bash.execute('tw1', {
      command: 'sleep 1; echo late-line; sleep 30',
      run_in_background: true,
    });
    const taskId = started.details.taskId as string;
    await new Promise(r => setTimeout(r, 200));

    const t0 = Date.now();
    const res = await taskOutput.execute('tw2', { task_id: taskId, wait_ms: 8000 });
    const waited = Date.now() - t0;

    await new CommandTaskExecutor(new TaskRepository(db)).stop(taskId);
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.rawOutput).toContain('late-line');
    expect(waited).toBeGreaterThan(300);
    expect(waited).toBeLessThan(8000);
  });

  it('wait_ms returns when the task completes without new output', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-tobg-'));
    const tools = buildTools(dir, { enabled: ['Bash', 'TaskOutput'], db });
    const bash = tools.find((t: any) => t.name === 'Bash') as any;
    const taskOutput = tools.find((t: any) => t.name === 'TaskOutput') as any;
    const started = await bash.execute('tw3', {
      command: 'sleep 1',
      run_in_background: true,
    });
    const taskId = started.details.taskId as string;
    await new Promise(r => setTimeout(r, 200));

    const t0 = Date.now();
    const res = await taskOutput.execute('tw4', { task_id: taskId, wait_ms: 10_000 });
    const waited = Date.now() - t0;

    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.status).not.toBe('running');
    expect(waited).toBeLessThan(9000);
  });

  it('tail_lines returns the last N lines', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-tobg-'));
    const tools = buildTools(dir, { enabled: ['Bash', 'TaskOutput'], db });
    const bash = tools.find((t: any) => t.name === 'Bash') as any;
    const taskOutput = tools.find((t: any) => t.name === 'TaskOutput') as any;
    const started = await bash.execute('to4', {
      command: "printf 'l1\\nl2\\nl3\\n'",
      run_in_background: true,
    });
    const taskId = started.details.taskId as string;
    await new Promise(r => setTimeout(r, 700));

    const res = await taskOutput.execute('to5', { task_id: taskId, tail_lines: 2 });
    expect(res.details.rawOutput.trim().split('\n')).toEqual(['l2', 'l3']);
    expect(res.content[0].text).toContain('Output:\nl2\nl3');
    expect(['completed', 'running']).toContain(res.details.status);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns structured diagnostics for failed command task output', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-tobg-'));
    const tools = buildTools(dir, { enabled: ['Bash', 'TaskOutput'], db });
    const bash = tools.find((t: any) => t.name === 'Bash') as any;
    const taskOutput = tools.find((t: any) => t.name === 'TaskOutput') as any;
    const started = await bash.execute('to-diagnostics-start', {
      command: "printf 'src/app.ts:2:7 - error TS2322: Type mismatch\\n' >&2; exit 1",
      run_in_background: true,
    });
    const taskId = started.details.taskId as string;
    const repo = new TaskRepository(db);
    for (let i = 0; i < 20; i++) {
      const task = repo.findById(taskId);
      if (task?.status === 'failed') break;
      await new Promise(r => setTimeout(r, 100));
    }

    const res = await taskOutput.execute('to-diagnostics-read', { task_id: taskId });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      status: 'failed',
      exitCode: 1,
      diagnostics: [
        {
          path: 'src/app.ts',
          line: 2,
          column: 7,
          severity: 'error',
          source: 'TS2322',
          message: 'Type mismatch',
        },
      ],
    });
    expect(res.content[0].text).toContain('Command: printf');
    expect(res.content[0].text).toContain('Status: failed (Exit code: 1)');
    expect(res.content[0].text).toContain('Diagnostics:');
  });
});

describe('Monitor stops command tasks', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-monbg-data-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) {
      delete process.env.ZCLAUDIA_DATA_DIR;
    } else {
      process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('kills the process tree, not just the DB record', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-monbg-'));
    const tools = buildTools(dir, { enabled: ['Bash', 'Monitor'], db });
    const bash = tools.find((t: any) => t.name === 'Bash') as any;
    const monitor = tools.find((t: any) => t.name === 'Monitor') as any;
    const started = await bash.execute('mb1', { command: 'sleep 30', run_in_background: true });
    const { taskId, pid } = started.details;
    expect(pidAlive(pid)).toBe(true);

    const res = await monitor.execute('mb2', { action: 'stop', task_id: taskId });
    await new Promise(r => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe('stopped');
    expect(pidAlive(pid)).toBe(false);
  });
});

describe('Bash sandbox wiring (foreground)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('regular mode + sandbox unavailable → fail-open, command still runs', async () => {
    vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({ sandboxed: false });
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bsbx-'));
    const bash = buildTools(dir, { enabled: ['Bash'] }).find((t: any) => t.name === 'Bash') as any;
    const res = await bash.execute('s1', { command: 'echo openok' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.content[0].text).toContain('openok');
  });

  it('plan/read-only mode + sandbox unavailable → fail-closed (errorResult, no run)', async () => {
    vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({ sandboxed: false });
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bsbx-'));
    const bash = buildTools(dir, { enabled: ['Bash'], sandboxReadOnly: true }).find(
      (t: any) => t.name === 'Bash'
    ) as any;
    const res = await bash.execute('s2', { command: 'echo shouldnotrun' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('sandbox_unavailable_plan_mode');
    expect(res.content[0].text).not.toContain('shouldnotrun');
  });

  it('critical approved commands still fail closed when the sandbox is unavailable', async () => {
    vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({ sandboxed: false });
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bsbx-'));
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const bash = buildTools(dir, { enabled: ['Bash'], permissionCallback }).find(
      (t: any) => t.name === 'Bash'
    ) as any;

    const res = await bash.execute('s-critical-no-sandbox', { command: 'sudo rm package.json' });

    rmSync(dir, { recursive: true, force: true });
    expect(permissionCallback).toHaveBeenCalled();
    expect(res.details.error).toBe('sandbox_required_for_critical_command');
  });

  it('sandboxed → runs via the wrapped argv', async () => {
    vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({
      sandboxed: true,
      argv: ['sh', '-c', 'echo VIAARGV'],
      env: process.env,
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-bsbx-'));
    const bash = buildTools(dir, { enabled: ['Bash'] }).find((t: any) => t.name === 'Bash') as any;
    const res = await bash.execute('s3', { command: 'echo original' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.content[0].text).toContain('VIAARGV');
    expect(res.content[0].text.split('Output:\n')[1]).not.toContain('original');
  });
});
