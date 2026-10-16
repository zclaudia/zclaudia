import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runClaudeAgent, type ClaudeAgentRunOptions } from '../runner.js';
import { buildClaudeCanUseTool } from '../permissions.js';

// Only executable inspection is stubbed; query(), stdin and the permission
// control round-trip all use the installed Claude Agent SDK and a child process.
vi.mock('../resolve-cli.js', () => ({
  inspectClaudeCli: () => ({ status: 'supported' }),
}));

const cliPath = fileURLToPath(new URL('./fixtures/permission-cli.mjs', import.meta.url));

function options(mode: 'cli' | 'sdk'): ClaudeAgentRunOptions {
  return {
    cwd: process.cwd(),
    cliPath,
    ...(mode === 'sdk'
      ? {
          engineExecution: {
            engineMode: 'sdk' as const,
            executableSource: 'bundled-sdk' as const,
            configDirectory: '/unused-fixture-config',
          },
          modelConnection: {
            protocol: 'anthropic-messages' as const,
            baseUrl: 'http://127.0.0.1:1',
            apiKey: 'fixture-only',
          },
        }
      : {}),
  };
}

describe.each(['cli', 'sdk'] as const)('Claude %s permission channel', mode => {
  it('answers questions and reviews plans after the first result', async () => {
    const answer = 'Q: Which route?\nA: Embedded web';
    const onPermission = vi.fn(async request => ({
      behavior: 'allow' as const,
      ...(request.toolName === 'AskUserQuestion' ? { message: answer } : {}),
    }));
    const events = [];
    for await (const event of runClaudeAgent('background', {
      ...options(mode),
      canUseTool: buildClaudeCanUseTool(onPermission),
    }))
      events.push(event);

    expect(onPermission.mock.calls.map(([request]) => request.toolName)).toEqual([
      'AskUserQuestion',
      'ExitPlanMode',
    ]);
    expect(events.filter(event => event.type === 'tool_result')).toEqual([
      expect.objectContaining({ toolResult: answer }),
      expect.objectContaining({ toolResult: 'approved' }),
    ]);
    expect(events.filter(event => event.type === 'result')).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task_notification',
        taskId: 'background-1',
        taskStatus: 'completed',
      })
    );
  });

  it('finishes a foreground turn without waiting for stdin EOF', async () => {
    const events = [];
    for await (const event of runClaudeAgent('foreground', options(mode))) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'result' });
  });
});
