import { describe, expect, it } from 'vitest';
import { agentPlaygroundReducer, initialAgentPlaygroundState } from './state';

describe('agentPlaygroundReducer', () => {
  it('assembles assistant deltas and tool lifecycle events', () => {
    let state = agentPlaygroundReducer(initialAgentPlaygroundState, {
      type: 'server',
      message: {
        type: 'run_started',
        runId: 'run-1',
        timestamp: 0,
        request: {
          input: 'hello',
          cwd: '/tmp',
        },
      },
    });
    state = agentPlaygroundReducer(state, {
      type: 'server',
      message: {
        type: 'runtime_event',
        runId: 'run-1',
        timestamp: 1,
        event: { type: 'assistant_delta', content: 'hi ' },
      },
    });
    state = agentPlaygroundReducer(state, {
      type: 'server',
      message: {
        type: 'runtime_event',
        runId: 'run-1',
        timestamp: 2,
        event: { type: 'assistant_delta', content: 'there' },
      },
    });
    state = agentPlaygroundReducer(state, {
      type: 'server',
      message: {
        type: 'runtime_event',
        runId: 'run-1',
        timestamp: 3,
        event: {
          type: 'tool_started',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          toolInput: { command: 'pwd' },
        },
      },
    });
    state = agentPlaygroundReducer(state, {
      type: 'server',
      message: {
        type: 'runtime_event',
        runId: 'run-1',
        timestamp: 4,
        event: {
          type: 'tool_finished',
          toolUseId: 'tool-1',
          toolResult: '/tmp',
        },
      },
    });

    expect(state.messages.find(message => message.role === 'assistant')?.content).toBe('hi there');
    expect(state.tools[0]).toMatchObject({
      id: 'tool-1',
      name: 'Bash',
      status: 'completed',
      result: '/tmp',
    });
  });

  it('tracks and retires permission requests', () => {
    let state = agentPlaygroundReducer(initialAgentPlaygroundState, {
      type: 'server',
      message: {
        type: 'permission_request',
        runId: 'run-1',
        timestamp: 1,
        request: {
          requestId: 'permission-1',
          toolName: 'Bash',
          toolInput: {},
          detail: 'Run a command',
          timeoutSeconds: 60,
        },
      },
    });
    expect(state.permissions).toHaveLength(1);
    state = agentPlaygroundReducer(state, {
      type: 'server',
      message: {
        type: 'permission_resolved',
        runId: 'run-1',
        requestId: 'permission-1',
        decision: { behavior: 'deny' },
        timestamp: 2,
      },
    });
    expect(state.permissions).toHaveLength(0);
  });

  it('ignores WebSocket history that was already applied before reconnecting', () => {
    const event = {
      type: 'runtime_event' as const,
      runId: 'run-1',
      timestamp: 1,
      sequence: 12,
      event: { type: 'assistant_delta' as const, content: 'only once' },
    };
    let state = agentPlaygroundReducer(initialAgentPlaygroundState, {
      type: 'server',
      message: event,
    });
    state = agentPlaygroundReducer(state, { type: 'server', message: event });

    expect(state.messages.find(message => message.role === 'assistant')?.content).toBe('only once');
    expect(state.events).toHaveLength(1);
    expect(state.lastSequence).toBe(12);
  });

  it('clears inspector output without discarding the conversation', () => {
    let state = agentPlaygroundReducer(initialAgentPlaygroundState, {
      type: 'server',
      message: {
        type: 'run_started',
        runId: 'run-1',
        timestamp: 0,
        request: {
          input: 'keep me',
          cwd: '/tmp',
        },
      },
    });
    state = agentPlaygroundReducer(state, {
      type: 'server',
      message: {
        type: 'plugin_log',
        level: 'info',
        message: 'log',
        timestamp: 1,
      },
    });
    state = agentPlaygroundReducer(state, { type: 'clear_inspector' });

    expect(state.messages).toHaveLength(2);
    expect(state.events).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });
});
