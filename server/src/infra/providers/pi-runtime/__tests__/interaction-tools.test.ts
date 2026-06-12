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

    expect(permissionCallback).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'question-1',
      toolName: 'AskUserQuestion',
      detail: 'Which tool should the agent use next?',
    }));
    expect(result.details).toMatchObject({ ok: true, answered: true });
    expect(result.content[0].text).toContain('Use WebFetch first.');
  });
});
