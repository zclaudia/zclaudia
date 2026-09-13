import { describe, expect, it, vi } from 'vitest';
import { createCursorExtensionHandlers } from '../cursor-acp-extensions-handler.js';
import {
  readCreatePlanPayload,
  readSubagentTaskPayload,
  readUpdateTodosPayload,
} from '../cursor-acp-extensions.js';

const PLAN = {
  toolCallId: 'plan-1',
  name: 'Plan',
  plan: '# Plan',
  todos: [{ id: 'todo-1', content: 'Implement', status: 'pending' }],
};

describe('Cursor ACP extension schemas', () => {
  it('requires plan and todos for cursor/create_plan', () => {
    expect(readCreatePlanPayload(PLAN)).toMatchObject({
      toolCallId: 'plan-1',
      plan: '# Plan',
    });
    expect(readCreatePlanPayload({ ...PLAN, plan: undefined })).toBeUndefined();
    expect(readCreatePlanPayload({ ...PLAN, todos: undefined })).toBeUndefined();
  });

  it('returns the documented nested outcome envelope for blocking methods', async () => {
    const handlers = createCursorExtensionHandlers({
      onPermission: vi.fn().mockResolvedValue({ behavior: 'allow' }),
    });
    await expect(handlers.request('cursor/create_plan', PLAN)).resolves.toEqual({
      outcome: { outcome: 'accepted' },
    });
    await expect(
      handlers.request('cursor/ask_question', {
        toolCallId: 'ask-1',
        questions: [{ id: 'q1', prompt: 'Pick', options: [{ id: 'a', label: 'A' }] }],
      })
    ).resolves.toEqual({
      outcome: {
        outcome: 'skipped',
        reason: 'ZClaudia does not support structured questions for this runtime yet.',
      },
    });
  });

  it('requires the documented todo notification fields', () => {
    expect(readUpdateTodosPayload({ ...PLAN, merge: true })).toMatchObject({
      toolCallId: 'plan-1',
      merge: true,
    });
    expect(readUpdateTodosPayload({ ...PLAN })).toBeUndefined();
  });

  it('accepts documented custom subagent types and rejects incomplete tasks', () => {
    expect(
      readSubagentTaskPayload({
        toolCallId: 'task-1',
        description: 'Inspect',
        prompt: 'Inspect the codebase',
        subagentType: { custom: 'security-review' },
      })
    ).toMatchObject({ subagentType: { custom: 'security-review' } });
    expect(
      readSubagentTaskPayload({
        toolCallId: 'task-1',
        description: 'Inspect',
        subagentType: 'explore',
      })
    ).toBeUndefined();
  });
});
