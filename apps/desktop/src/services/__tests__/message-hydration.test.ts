import { describe, it, expect } from 'vitest';
import { hydrateMessagesForDisplay } from '../message-hydration';
import type { Message } from '@zclaudia/shared/core/message';

describe('hydrateMessagesForDisplay', () => {
  it('carries sub-agent lineage from persisted metadata into ToolCallState', () => {
    const messages = [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        createdAt: 1,
        metadata: {
          toolCalls: [
            { toolUseId: 'task-1', name: 'Task', input: { description: 'd' }, output: 'report' },
            {
              toolUseId: 'inner-1',
              parentToolUseId: 'task-1',
              name: 'Read',
              input: { file_path: '/x.ts' },
              output: 'body',
            },
          ],
        },
      },
    ] as unknown as Message[];

    const [hydrated] = hydrateMessagesForDisplay(messages);
    expect(hydrated.toolCalls).toHaveLength(2);
    expect(hydrated.toolCalls?.[1]).toMatchObject({
      id: 'inner-1',
      parentToolUseId: 'task-1',
      toolName: 'Read',
    });
    expect(hydrated.toolCalls?.[0].parentToolUseId).toBeUndefined();
  });
});
