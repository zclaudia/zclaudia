import { describe, expect, it, vi } from 'vitest';
import { runClaudeAgent } from '../runner.js';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

describe('Claude SDK project settings and connection binding', () => {
  it.each([false, true])('gates input on connection settings; control failure: %s', async fail => {
    let received: unknown;
    let pendingInput: Promise<IteratorResult<unknown>>;
    const close = vi.fn();
    const applyFlagSettings = vi.fn(async () => {
      await Promise.resolve();
      expect(received).toBeUndefined();
      if (fail) throw new Error('Settings control rejected');
    });
    queryMock.mockImplementationOnce(({ prompt }) => {
      pendingInput = prompt[Symbol.asyncIterator]()
        .next()
        .then((result: IteratorResult<unknown>) => {
          received = result;
          return result;
        });
      return {
        applyFlagSettings,
        close,
        async *[Symbol.asyncIterator]() {
          await pendingInput;
          yield { type: 'result', subtype: 'success', result: 'done' };
        },
      };
    });
    const abortController = new AbortController();
    const run = async () => {
      for await (const _ of runClaudeAgent('Original user input', {
        cwd: '/project',
        cliPath: '/bundled/claude',
        sessionId: 'existing-session',
        model: 'bound-model',
        abortController,
        engineExecution: {
          engineMode: 'sdk',
          executableSource: 'bundled-sdk',
          configDirectory: '/isolated',
        },
        modelConnection: {
          protocol: 'anthropic-messages',
          baseUrl: 'https://bound.example',
          apiKey: 'test-bound-key',
        },
      })) {
        /* drain */
      }
    };
    if (fail) await expect(run()).rejects.toThrow('Settings control rejected');
    else await run();
    expect(await pendingInput!).toMatchObject(
      fail
        ? { done: true }
        : {
            done: false,
            value: {
              message: { role: 'user', content: 'Original user input' },
              session_id: 'existing-session',
            },
          }
    );
    const sdkOptions = queryMock.mock.calls.at(-1)![0].options;
    expect(sdkOptions.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(sdkOptions.settingSources).toEqual(['project', 'local']);
    expect(JSON.stringify(sdkOptions.settings)).not.toContain('test-bound-key');
    expect(applyFlagSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: 'test-bound-key',
          ANTHROPIC_BASE_URL: 'https://bound.example',
          ANTHROPIC_AUTH_TOKEN: '',
        }),
      })
    );
    expect(close).toHaveBeenCalled();
    expect(abortController.signal.aborted).toBe(false);
  });
});
