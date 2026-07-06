import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentAdapter } from '../claude-agent/adapter.js';
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
});
