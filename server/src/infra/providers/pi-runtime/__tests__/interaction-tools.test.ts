import { describe, expect, it, vi } from 'vitest';

import { createAskUserQuestionTool, createTodoWriteTool } from '../interaction-tools.js';

describe('interaction tools', () => {
  it('normalizes TodoWrite items and returns a structured success result', async () => {
    const todo = createTodoWriteTool() as any;

    const result = await todo.execute('todo-1', {
      todos: [
        { content: 'Ship tools', status: 'completed' },
        { content: 'Defer polish', status: 'cancelled' },
      ],
    });

    expect(todo.parameters.properties.todos.items.properties.status.enum).toContain('cancelled');
    expect(result.content[0].text).toContain('"success": true');
    expect(result.content[0].text).toContain('"count": 2');
    expect(result.content[0].text).toContain('"status": "cancelled"');
  });

  it('rejects invalid or empty TodoWrite payloads', async () => {
    const todo = createTodoWriteTool() as any;

    const invalid = await todo.execute('todo-invalid', { unexpected: 'shape' });
    const empty = await todo.execute('todo-empty', { todos: [] });

    expect(invalid.details).toMatchObject({ ok: false, error: 'invalid_todos' });
    expect(empty.details).toMatchObject({ ok: false, error: 'invalid_todos' });
  });

  it('rejects TodoWrite payloads that exceed count or content budgets', async () => {
    const todo = createTodoWriteTool() as any;

    const tooMany = await todo.execute('todo-many', {
      todos: Array.from({ length: 101 }, (_, i) => ({ content: `Task ${i}`, status: 'pending' })),
    });
    const tooLong = await todo.execute('todo-long', {
      todos: [{ content: 'x'.repeat(1001), status: 'pending' }],
    });

    expect(tooMany.details).toMatchObject({ ok: false, error: 'too_many_todos', max: 100 });
    expect(tooLong.details).toMatchObject({
      ok: false,
      error: 'todo_content_too_large',
      maxChars: 1000,
    });
  });

  it('AskUserQuestion waits through the interaction callback and returns the answer', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({
      behavior: 'allow',
      message: 'Use WebFetch first.',
    });
    const ask = createAskUserQuestionTool(permissionCallback as any) as any;

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
});
