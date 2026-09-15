import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentAdapter } from '../adapter.js';
import { runAdapterConformanceSuite } from '../../../../../scripts/plugins/runtime-conformance.mjs';

const { queryMock, loadClaudeAgentConfigMock, inspectClaudeCliMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  loadClaudeAgentConfigMock: vi.fn(() => ({ mcpServers: {}, plugins: [] })),
  inspectClaudeCliMock: vi.fn(() => ({ status: 'supported', version: '2.1.141' })),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => Object.assign(queryMock(...args), { close: vi.fn() }),
}));

vi.mock('../config.js', () => ({
  loadClaudeAgentConfig: loadClaudeAgentConfigMock,
}));

vi.mock('../resolve-cli.js', () => ({
  inspectClaudeCli: inspectClaudeCliMock,
  resolveClaudeCliFromPath: vi.fn(() => '/fixture/claude'),
}));

async function* emptyStream() {
  /* no events */
}

async function drain(adapter: ClaudeAgentAdapter): Promise<void> {
  for await (const _event of adapter.run(
    'hello',
    { cwd: '/tmp/project', claudiaSessionId: 'session-1', serverPort: 3100 },
    vi.fn()
  )) {
    // drain
  }
}

describe('ClaudeAgentAdapter MCP bridge merge', () => {
  it('satisfies the shared normalized event-stream contract', async () => {
    async function* conformanceStream() {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session' };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello from Claude' }] },
      };
      yield { type: 'result', result: 'done' };
    }
    queryMock.mockReturnValueOnce(conformanceStream());
    const suite = await runAdapterConformanceSuite({
      adapter: new ClaudeAgentAdapter(async () => null),
      input: 'hello',
      context: { cwd: '/tmp/project', claudiaSessionId: 'session-1', serverPort: 3100 },
      onPermission: vi.fn(),
    });
    expect(suite.passed).toBe(true);
  });

  it('emits shared plan tool semantics and mode transitions', async () => {
    queryMock.mockReturnValueOnce(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'enter-1', name: 'EnterPlanMode', input: {} }],
          },
        };
        yield {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'enter-1', content: 'Entered' }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'exit-1',
                name: 'ExitPlanMode',
                input: { plan: '# Plan' },
              },
            ],
          },
        };
        yield {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'exit-1',
                content: { plan: '# Plan', isAgent: true },
              },
            ],
          },
        };
      })()
    );
    const adapter = new ClaudeAgentAdapter(async () => null);
    const events = [];
    for await (const event of adapter.run('plan it', { cwd: '/tmp/project' }, vi.fn())) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_use',
        toolUseId: 'enter-1',
        toolSemantic: 'plan_enter',
      })
    );
    expect(events).toContainEqual({
      type: 'mode_transition',
      modeTransition: {
        mode: 'plan',
        reason: 'enter',
        sourceToolUseId: 'enter-1',
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_use',
        toolUseId: 'exit-1',
        toolSemantic: 'plan_proposal',
      })
    );
    expect(events).toContainEqual({
      type: 'mode_transition',
      modeTransition: {
        mode: 'default',
        reason: 'exit',
        sourceToolUseId: 'exit-1',
        plan: '# Plan',
      },
    });
  });

  it('adds the tool-bridge entry when no MCP server uses its name', async () => {
    loadClaudeAgentConfigMock.mockReturnValueOnce({
      mcpServers: { docs: { command: 'node', args: ['docs.js'] } },
      plugins: [],
    });
    queryMock.mockReturnValueOnce(emptyStream());

    const bridge = { name: 'claudia-plugins', config: { command: 'node', args: ['bridge.js'] } };
    const adapter = new ClaudeAgentAdapter(async () => bridge);

    await drain(adapter);

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          mcpServers: {
            docs: { command: 'node', args: ['docs.js'] },
            'claudia-plugins': { command: 'node', args: ['bridge.js'] },
          },
        }),
      })
    );
  });

  it('preserves a user-configured MCP server registered under the bridge name', async () => {
    loadClaudeAgentConfigMock.mockReturnValueOnce({
      mcpServers: { 'claudia-plugins': { command: 'custom-bridge', args: ['user.js'] } },
      plugins: [],
    });
    queryMock.mockReturnValueOnce(emptyStream());

    const bridge = { name: 'claudia-plugins', config: { command: 'node', args: ['bridge.js'] } };
    const adapter = new ClaudeAgentAdapter(async () => bridge);

    await drain(adapter);

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mcpServers: {
            'claudia-plugins': { command: 'custom-bridge', args: ['user.js'] },
          },
        }),
      })
    );
  });

  it('uses the config MCP servers unchanged when there is no bridge', async () => {
    loadClaudeAgentConfigMock.mockReturnValueOnce({
      mcpServers: { docs: { command: 'node', args: ['docs.js'] } },
      plugins: [],
    });
    queryMock.mockReturnValueOnce(emptyStream());

    const adapter = new ClaudeAgentAdapter(async () => null);

    await drain(adapter);

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mcpServers: { docs: { command: 'node', args: ['docs.js'] } },
        }),
      })
    );
  });
});

describe('Claude model controls', () => {
  it('discovers supported effort from initialization without submitting a prompt', async () => {
    const stream = Object.assign(emptyStream(), {
      supportedModels: vi.fn(async () => [
        {
          value: 'supported',
          displayName: 'Supported',
          supportsEffort: true,
          supportsAdaptiveThinking: true,
          supportedEffortLevels: ['low', 'high'],
        },
        { value: 'unknown', displayName: 'Unknown' },
      ]),
    });
    queryMock.mockReturnValueOnce(stream);
    const adapter = new ClaudeAgentAdapter(async () => null);
    const result = await adapter.discoverModels({ cwd: '/tmp' }, new AbortController().signal);
    expect(result.models).toEqual([
      { id: 'supported', label: 'Supported', thinkingLevels: ['low', 'high'] },
      { id: 'unknown', label: 'Unknown', thinkingLevels: [] },
    ]);
    const args = queryMock.mock.calls.at(-1)![0];
    expect(typeof args.prompt).not.toBe('string');
    expect(await args.prompt.next()).toEqual({ done: true, value: undefined });
    expect(args.options.persistSession).toBe(false);
  });
  it('forwards the selected model and thinking level to the SDK', async () => {
    queryMock.mockReturnValueOnce(emptyStream());
    const adapter = new ClaudeAgentAdapter(async () => null);
    for await (const _event of adapter.run('hello', {
      cwd: '/tmp',
      model: 'chosen',
      thinkingLevel: 'high',
    })) {
      /* drain */
    }
    expect(queryMock.mock.calls.at(-1)![0].options).toMatchObject({
      model: 'chosen',
      thinking: { type: 'adaptive' },
      effort: 'high',
    });
  });
});
