import { describe, it, expect } from 'vitest';
import { translateToolEvent, type TranslateToolContext } from '../tool-event-translator.js';

const ctx: TranslateToolContext = { sessionId: 'sess', model: 'm1', cwd: '/tmp' };

describe('translateToolEvent', () => {
  it('emits tool_use messages for each toolCall in message_end (assistant)', () => {
    const out = translateToolEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/x' } },
          { type: 'toolCall', id: 't2', name: 'bash', arguments: { cmd: 'ls' } },
        ],
      },
    } as any, ctx);

    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([
      { type: 'tool_use', toolUseId: 't1', toolName: 'read', toolInput: { path: '/x' } },
      { type: 'tool_use', toolUseId: 't2', toolName: 'bash', toolInput: { cmd: 'ls' } },
    ]);
  });

  it('marks TodoWrite tool_use events as todo updates for the interaction tracker', () => {
    const out = translateToolEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'todo-1',
            name: 'TodoWrite',
            arguments: { todos: [{ content: 'Ship Phase 1', status: 'in_progress' }] },
          },
        ],
      },
    } as any, ctx);

    expect(out).toEqual([
      {
        type: 'tool_use',
        toolUseId: 'todo-1',
        toolName: 'TodoWrite',
        toolInput: { todos: [{ content: 'Ship Phase 1', status: 'in_progress' }] },
        toolInteractionKind: 'todo_update',
      },
    ]);
  });

  it('returns undefined for message_end with text only (no toolCalls)', () => {
    const out = translateToolEvent({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'just text' }] },
    } as any, ctx);
    expect(out).toBeUndefined();
  });

  it('returns undefined for message_end with toolResult role', () => {
    const out = translateToolEvent({
      type: 'message_end',
      message: { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [], isError: false },
    } as any, ctx);
    expect(out).toBeUndefined();
  });

  it('emits tool_activity from tool_execution_update', () => {
    const out = translateToolEvent({
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'bash',
      args: {},
      partialResult: { content: [{ type: 'text', text: 'partial stdout\n' }] },
    } as any, ctx);
    expect(out).toEqual({
      type: 'tool_activity',
      toolUseId: 't1',
      toolName: 'bash',
      content: 'partial stdout\n',
    });
  });

  it('emits tool_result from tool_execution_end (success)', () => {
    const out = translateToolEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'file body' }] },
      isError: false,
    } as any, ctx);
    expect(out).toEqual({
      type: 'tool_result',
      toolUseId: 't1',
      toolName: 'read',
      toolResult: { content: [{ type: 'text', text: 'file body' }] },
      isToolError: false,
    });
  });

  it('emits tool_result from tool_execution_end (error)', () => {
    const out = translateToolEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'permission denied' }] },
      isError: true,
    } as any, ctx);
    expect(out).toEqual({
      type: 'tool_result',
      toolUseId: 't1',
      toolName: 'read',
      toolResult: { content: [{ type: 'text', text: 'permission denied' }] },
      isToolError: true,
    });
  });

  it('emits a mode_transition (enter) alongside the tool_result for a successful EnterPlanMode', () => {
    const out = translateToolEvent({
      type: 'tool_execution_end',
      toolCallId: 'pm1',
      toolName: 'EnterPlanMode',
      result: { content: [{ type: 'text', text: 'Entered plan mode.' }], details: { ok: true } },
      isError: false,
    } as any, ctx);
    expect(out).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'pm1',
        toolName: 'EnterPlanMode',
        toolResult: { content: [{ type: 'text', text: 'Entered plan mode.' }], details: { ok: true } },
        isToolError: false,
      },
      {
        type: 'mode_transition',
        modeTransition: { mode: 'plan', reason: 'enter', sourceToolUseId: 'pm1' },
      },
    ]);
  });

  it('emits a mode_transition (exit) alongside the tool_result for a successful ExitPlanMode', () => {
    const out = translateToolEvent({
      type: 'tool_execution_end',
      toolCallId: 'pm2',
      toolName: 'ExitPlanMode',
      result: { content: [{ type: 'text', text: 'Plan approved.' }], details: { ok: true, wasActive: true } },
      isError: false,
    } as any, ctx);
    expect(Array.isArray(out)).toBe(true);
    expect((out as any[])[1]).toEqual({
      type: 'mode_transition',
      modeTransition: { mode: 'default', reason: 'exit', sourceToolUseId: 'pm2' },
    });
  });

  it('does NOT emit a mode_transition when the plan-mode toggle failed (details.ok === false)', () => {
    const out = translateToolEvent({
      type: 'tool_execution_end',
      toolCallId: 'pm3',
      toolName: 'ExitPlanMode',
      result: { content: [{ type: 'text', text: 'Plan rejected by the user.' }], details: { ok: false } },
      isError: false,
    } as any, ctx);
    // Just the tool_result, no transition (rejection must not flip the UI mode).
    expect(out).toEqual({
      type: 'tool_result',
      toolUseId: 'pm3',
      toolName: 'ExitPlanMode',
      toolResult: { content: [{ type: 'text', text: 'Plan rejected by the user.' }], details: { ok: false } },
      isToolError: false,
    });
  });

  it('returns undefined for tool_execution_start (covered by tool_use)', () => {
    expect(translateToolEvent({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: {} } as any, ctx)).toBeUndefined();
  });

  it('returns undefined for turn_start / turn_end / message_start', () => {
    expect(translateToolEvent({ type: 'turn_start' } as any, ctx)).toBeUndefined();
    expect(translateToolEvent({ type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] } as any, ctx)).toBeUndefined();
    expect(translateToolEvent({ type: 'message_start', message: { role: 'assistant', content: [], timestamp: 0 } } as any, ctx)).toBeUndefined();
  });

  it('returns undefined for unknown event types', () => {
    expect(translateToolEvent({ type: '_future_' } as any, ctx)).toBeUndefined();
  });

  it('handles tool_execution_update with no partial text gracefully', () => {
    const out = translateToolEvent({
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'bash',
      args: {},
      partialResult: { content: [] },
    } as any, ctx);
    expect(out).toEqual({ type: 'tool_activity', toolUseId: 't1', toolName: 'bash', content: '' });
  });
});
