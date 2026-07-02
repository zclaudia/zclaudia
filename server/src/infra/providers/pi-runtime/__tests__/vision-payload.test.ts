import { describe, it, expect } from 'vitest';
import { streamSimple } from '@earendil-works/pi-ai';
import { buildModel } from '../build-model.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

/**
 * Capture the provider payload via onPayload, then throw a sentinel to stop
 * the request BEFORE any network I/O (pi-ai awaits onPayload pre-send in both
 * the anthropic and openai-completions providers).
 */
const SENTINEL = new Error('payload captured — abort before network');

type StreamContext = {
  systemPrompt: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    timestamp: number;
  }>;
};

async function capturePayload(
  model: any,
  context: StreamContext
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  try {
    const stream = streamSimple(model, context as never, {
      apiKey: 'test-key',
      onPayload: (payload: unknown) => {
        captured = payload as Record<string, unknown>;
        throw SENTINEL;
      },
    });

    for await (const _event of stream) {
      /* drain until error */
    }
  } catch {
    /* sentinel (possibly provider-wrapped) expected */
  }
  if (!captured) throw new Error('onPayload was never invoked');
  return captured;
}

function profile(extra: Partial<LlmProfileConfig>): LlmProfileConfig {
  return {
    id: 'p',
    name: 'p',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    providerType: 'anthropic',
    ...extra,
  } as LlmProfileConfig;
}

describe('vision payload serialization (real pi-ai)', () => {
  it('serializes image content blocks for a vision model', async () => {
    const { model } = buildModel(
      profile({ providerType: 'anthropic', apiKey: 'k' }),
      'claude-sonnet-4-6'
    );
    expect((model as { input?: string[] }).input).toContain('image'); // registry model declares vision
    const context: StreamContext = {
      systemPrompt: 'test',
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'what is this' },
            { type: 'image' as const, data: 'QkFTRTY0', mimeType: 'image/png' },
          ],
          timestamp: 0,
        },
      ],
    };
    const payload = await capturePayload(model, context);
    expect(JSON.stringify(payload)).toContain('"type":"image"');
    expect(JSON.stringify(payload)).toContain('QkFTRTY0');
  });
});
