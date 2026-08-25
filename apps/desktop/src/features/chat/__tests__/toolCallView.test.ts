import { describe, it, expect } from 'vitest';
import { toToolCallView, toolCallEffect } from '../tool-call/toolCallView';
import type { ToolCallState } from '../../../stores/runStore';

function state(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    id: 't1',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    status: 'running',
    ...overrides,
  };
}

describe('toToolCallView', () => {
  it('renames fields to the kit vocabulary', () => {
    expect(toToolCallView(state({ activity: 'Reading…', semantic: 'plan_proposal' }))).toEqual({
      id: 't1',
      name: 'Bash',
      input: { command: 'ls' },
      status: 'running',
      result: undefined,
      semantic: 'plan_proposal',
      summary: 'Reading…',
    });
  });

  it('maps completed to the kit success status', () => {
    expect(toToolCallView(state({ status: 'completed', result: 'ok' })).status).toBe('success');
  });

  it('lets isError outrank a completed status', () => {
    // Persisted history can carry `completed` alongside `isError`; the live
    // store keeps them in step, but the renderer must show an error for both.
    expect(toToolCallView(state({ status: 'completed', isError: true })).status).toBe('error');
    expect(toToolCallView(state({ status: 'error', isError: true })).status).toBe('error');
  });

  it('carries the host-only ToolEffect through the kit ext slot', () => {
    const effect = { kind: 'shell' as const, command: 'ls' };
    const view = toToolCallView(state({ effect }));
    expect(toolCallEffect(view)).toEqual(effect);
    expect(toolCallEffect(toToolCallView(state()))).toBeUndefined();
  });
});
