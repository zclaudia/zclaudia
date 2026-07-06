import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentAdapter } from '../claude-agent/adapter.js';
import { buildClaudeCanUseTool } from '../claude-agent/permissions.js';
import { transformClaudeSdkMessage } from '../claude-agent/runner.js';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

async function* claudeStream(messages: unknown[]) {
  for (const message of messages) {
    yield message;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ClaudeAgentAdapter', () => {
  it('exposes claude runtime metadata', () => {
    const adapter = new ClaudeAgentAdapter();

    expect(adapter.type).toBe('claude');
    expect(adapter.manifest?.providerType).toBe('claude');
    expect(adapter.policy?.modeSwitchSessionPolicy).toBe('preserve');
  });

  it('aborts an active run by provider session id', async () => {
    const adapter = new ClaudeAgentAdapter();
    const controller = new AbortController();
    adapter.trackAbortControllerForTest('sdk-1', controller);

    await adapter.abort('sdk-1', '/tmp/project');

    expect(controller.signal.aborted).toBe(true);
  });

  it('uses the shared run abort controller and exposes provider run state', async () => {
    const adapter = new ClaudeAgentAdapter();
    const abortController = new AbortController();
    const options = {
      cwd: '/tmp/project',
      claudiaSessionId: 'z-session-1',
      abortController,
    } as any;
    queryMock.mockReturnValueOnce(
      claudeStream([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-1',
          cwd: '/tmp/project',
        },
      ])
    );

    const events = [];
    for await (const event of adapter.run('hello', options, vi.fn())) {
      events.push(event);
    }

    expect(events[0]).toEqual(expect.objectContaining({ type: 'init', sessionId: 'sdk-1' }));
    expect(adapter.getRunState(options)).toEqual({
      providerSessionId: 'sdk-1',
      providerCwd: '/tmp/project',
    });

    adapter.trackAbortControllerForTest('sdk-1', abortController);
    await adapter.abort('sdk-1', '/tmp/project');
    expect(abortController.signal.aborted).toBe(true);
  });

  it('transforms Claude SDK task and progress events without empty assistant text', () => {
    expect(
      transformClaudeSdkMessage({
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-1',
        description: 'review files',
      })
    ).toEqual({
      type: 'task_notification',
      taskId: 'task-1',
      taskStatus: 'started',
      taskMessage: 'review files',
    });

    expect(
      transformClaudeSdkMessage({
        type: 'tool_progress',
        tool_use_id: 'tool-1',
        tool_name: 'Bash',
        elapsed_time_seconds: 2,
      })
    ).toEqual({
      type: 'tool_activity',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      taskId: undefined,
      content: 'running Bash (2s)',
    });

    expect(transformClaudeSdkMessage({ type: 'system', subtype: 'unknown' })).toEqual([]);
  });

  it('transforms assistant text and tool use blocks', () => {
    expect(
      transformClaudeSdkMessage({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } },
          ],
        },
      })
    ).toEqual([
      { type: 'assistant', content: 'hello' },
      {
        type: 'tool_use',
        toolUseId: 'tool-1',
        toolName: 'Read',
        toolInput: { file_path: 'README.md' },
      },
    ]);
  });

  it('transforms user tool result blocks', () => {
    expect(
      transformClaudeSdkMessage({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'file contents',
              is_error: false,
            },
          ],
        },
      })
    ).toEqual({
      type: 'tool_result',
      toolUseId: 'tool-1',
      toolResult: 'file contents',
      isToolError: false,
    });
  });

  it('transforms result success and execution errors', () => {
    expect(transformClaudeSdkMessage({ type: 'result', result: 'done' })).toEqual({
      type: 'result',
      content: 'done',
      isComplete: true,
    });

    expect(
      transformClaudeSdkMessage({
        type: 'result',
        subtype: 'error_during_execution',
        error: 'boom',
      })
    ).toEqual({
      type: 'error',
      error: 'boom',
    });
  });

  it('ignores malformed assistant and user messages without emitting empty content', () => {
    expect(transformClaudeSdkMessage({ type: 'assistant', message: {} })).toEqual([]);
    expect(transformClaudeSdkMessage({ type: 'user', message: {} })).toEqual([]);
  });

  it('bridges Claude canUseTool allow decisions to the SDK permission result', async () => {
    const onPermission = vi.fn(async () => ({ behavior: 'allow' as const }));
    const canUseTool = buildClaudeCanUseTool(onPermission);

    const result = await canUseTool?.(
      'Bash',
      { command: 'npm test' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-1',
        title: 'Claude wants to run Bash',
        displayName: 'Run command',
        description: 'npm test',
      }
    );

    expect(onPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'tool-1',
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        detail: 'Claude wants to run Bash\n\nnpm test',
        timeoutSeconds: 60,
        timeoutBehavior: 'deny',
      })
    );
    expect(result).toEqual({ behavior: 'allow' });
  });

  it('bridges Claude canUseTool deny decisions to the SDK permission result', async () => {
    const onPermission = vi.fn(async () => ({ behavior: 'deny' as const, message: 'Nope' }));
    const canUseTool = buildClaudeCanUseTool(onPermission);

    const result = await canUseTool?.(
      'Write',
      { file_path: 'src/app.ts' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-2',
        title: 'Claude wants to write a file',
      }
    );

    expect(result).toEqual({ behavior: 'deny', message: 'Nope' });
  });

  it('denies Claude tool use when the permission callback rejects', async () => {
    const onPermission = vi.fn(async () => {
      throw new Error('approval service unavailable');
    });
    const canUseTool = buildClaudeCanUseTool(onPermission);

    const result = await canUseTool?.(
      'Bash',
      { command: 'npm test' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-3',
        title: 'Claude wants to run Bash',
      }
    );

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Permission request failed.',
    });
  });

  it('denies Claude tool use when the SDK aborts while permission is pending', async () => {
    const pending = deferred<{ behavior: 'allow' }>();
    const onPermission = vi.fn(() => pending.promise);
    const controller = new AbortController();
    const canUseTool = buildClaudeCanUseTool(onPermission);

    const resultPromise = canUseTool?.(
      'Bash',
      { command: 'npm test' },
      {
        signal: controller.signal,
        toolUseID: 'tool-4',
        title: 'Claude wants to run Bash',
      }
    );
    controller.abort();
    pending.resolve({ behavior: 'allow' });

    await expect(resultPromise).resolves.toEqual({
      behavior: 'deny',
      interrupt: true,
      message: 'Permission request was aborted.',
    });
  });

  it('passes canUseTool to the Claude SDK query options', async () => {
    const adapter = new ClaudeAgentAdapter();
    queryMock.mockReturnValueOnce(claudeStream([]));

    for await (const _event of adapter.run(
      'hello',
      { cwd: '/tmp/project', claudiaSessionId: 'session-1' } as any,
      vi.fn(async () => ({ behavior: 'allow' }))
    )) {
      // drain
    }

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          canUseTool: expect.any(Function),
        }),
      })
    );
  });

  it('does not pass invalid permission modes to the Claude SDK', async () => {
    const adapter = new ClaudeAgentAdapter();
    queryMock.mockReturnValueOnce(claudeStream([]));

    for await (const _event of adapter.run(
      'hello',
      { cwd: '/tmp/project', claudiaSessionId: 'session-1', mode: 'unexpected-mode' } as any,
      vi.fn()
    )) {
      // drain
    }

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({
          permissionMode: expect.anything(),
        }),
      })
    );
  });

  it('appends the ZClaudia system prompt to the Claude Code preset', async () => {
    const adapter = new ClaudeAgentAdapter();
    queryMock.mockReturnValueOnce(claudeStream([]));

    for await (const _event of adapter.run(
      'hello',
      {
        cwd: '/tmp/project',
        claudiaSessionId: 'session-1',
        systemPrompt: 'Use project instructions.',
      } as any,
      vi.fn()
    )) {
      // drain
    }

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: 'Use project instructions.',
          },
        }),
      })
    );
  });
});
