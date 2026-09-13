import { describe, expect, it } from 'vitest';
import { transformClaudeSdkMessage } from '../runner.js';

describe('transformClaudeSdkMessage result usage', () => {
  it('forwards the SDK result usage as provider-neutral usage', () => {
    const event = transformClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'done',
      total_cost_usd: 0.042,
      usage: {
        input_tokens: 500,
        output_tokens: 80,
        cache_read_input_tokens: 4500,
        cache_creation_input_tokens: 120,
      },
    });

    expect(event).toMatchObject({
      type: 'result',
      isComplete: true,
      usage: {
        input: 500,
        output: 80,
        cacheRead: 4500,
        cacheWrite: 120,
        totalTokens: 5200,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.042 },
      },
    });
  });

  it('omits usage when the result message carries none', () => {
    const event = transformClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'done',
    });
    expect(event).toMatchObject({ type: 'result', isComplete: true });
    expect((event as { usage?: unknown }).usage).toBeUndefined();
  });

  it('still maps execution errors without usage', () => {
    const event = transformClaudeSdkMessage({
      type: 'result',
      subtype: 'error_during_execution',
      error: 'boom',
    });
    expect(event).toMatchObject({ type: 'error', error: 'boom' });
  });
});
