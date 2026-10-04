import { describe, expect, it } from 'vitest';
import { normalizeFromAskUser, normalizeFromToolUse } from '../interaction-normalizer.js';

describe('normalizeFromToolUse', () => {
  it('returns normalized todo interaction for valid TodoWrite input', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      runId: 'run-1',
      providerType: 'claude',
      toolUseId: 'tool-1',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { content: 'Fix bug', status: 'completed' },
          { content: 'Ship patch', status: 'in_progress' },
        ],
      },
    });

    expect(result).toMatchObject({
      type: 'interaction_todo_update',
      interactionId: 'tool-1',
      sessionId: 'session-1',
      runId: 'run-1',
      provider: 'claude',
      todos: [
        { content: 'Fix bug', status: 'completed' },
        { content: 'Ship patch', status: 'in_progress' },
      ],
    });
  });

  it('returns normalized todo interaction for Cursor updateTodos input', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      runId: 'run-1',
      providerType: 'cursor',
      toolUseId: 'tool-2',
      toolName: 'updateTodos',
      toolInput: {
        todos: [
          { content: 'Scan the orchestration code', status: 'completed' },
          { content: 'Run the review', status: 'in_progress' },
        ],
      },
    });

    expect(result).toMatchObject({
      type: 'interaction_todo_update',
      interactionId: 'tool-2',
      sessionId: 'session-1',
      runId: 'run-1',
      provider: 'cursor',
      todos: [
        { content: 'Scan the orchestration code', status: 'completed' },
        { content: 'Run the review', status: 'in_progress' },
      ],
    });
  });

  it('uses provider-normalized interaction kind without matching native tool names', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      runId: 'run-1',
      providerType: 'claude',
      toolUseId: 'tool-3',
      toolName: 'provider_native_todo',
      interactionKind: 'todo_update',
      toolInput: {
        todos: [{ content: 'Keep runtime provider-agnostic', status: 'pending' }],
      },
    });

    expect(result).toMatchObject({
      type: 'interaction_todo_update',
      interactionId: 'tool-3',
      todos: [{ content: 'Keep runtime provider-agnostic', status: 'pending' }],
    });
  });

  it('returns null when TodoWrite payload cannot be normalized', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      toolName: 'TodoWrite',
      toolInput: { unexpected: 'shape' },
    });

    expect(result).toBeNull();
  });

  it('returns null when TodoWrite payload exceeds normalization budgets', () => {
    const tooMany = normalizeFromToolUse({
      sessionId: 'session-1',
      toolUseId: 'tool-many',
      toolName: 'TodoWrite',
      toolInput: {
        todos: Array.from({ length: 101 }, (_, i) => ({ content: `Task ${i}`, status: 'pending' })),
      },
    });
    const tooLong = normalizeFromToolUse({
      sessionId: 'session-1',
      toolUseId: 'tool-long',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [{ content: 'x'.repeat(1001), status: 'pending' }],
      },
    });

    expect(tooMany).toBeNull();
    expect(tooLong).toBeNull();
  });

  it('returns null when toolUseId is missing', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      toolUseId: '',
      toolName: 'TodoWrite',
      toolInput: { todos: [{ content: 'Task', status: 'pending' }] },
    });

    expect(result).toBeNull();
  });
});

describe('normalizeFromAskUser', () => {
  it('carries an option preview through to the prompt field', () => {
    const result = normalizeFromAskUser({
      requestId: 'req-1',
      sessionId: 'session-1',
      questions: [
        {
          question: 'Which layout?',
          header: 'Layout',
          options: [
            { label: 'Grid', description: 'Two columns', preview: '| a | b |\n| c | d |' },
            { label: 'List', description: 'One column' },
          ],
        },
      ],
    });

    expect(result.fields[0].options).toEqual([
      { value: 'Grid', label: 'Grid', description: 'Two columns', preview: '| a | b |\n| c | d |' },
      { value: 'List', label: 'List', description: 'One column' },
    ]);
  });

  it('drops blank or non-string previews', () => {
    const result = normalizeFromAskUser({
      requestId: 'req-1',
      sessionId: 'session-1',
      questions: [
        {
          question: 'Pick one',
          header: 'Pick',
          options: [
            { label: 'A', description: 'a', preview: '   ' },
            { label: 'B', description: 'b', preview: 42 as unknown as string },
          ],
        },
      ],
    });

    expect(result.fields[0].options?.map(option => 'preview' in option)).toEqual([false, false]);
  });
});
