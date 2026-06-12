import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommandHandler } from './useCommandHandler';
import type { SlashCommand } from '@zclaudia/shared';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionContextUsage: vi.fn(),
}));

import * as api from '../../services/api';

const COMMANDS: SlashCommand[] = [
  { command: '/context', description: 'Show context window usage', source: 'local' },
];

function setup() {
  const addMessage = vi.fn();
  const { result } = renderHook(() =>
    useCommandHandler({
      sessionId: 'sess-1',
      commands: COMMANDS,
      currentSession: undefined,
      currentProject: null,
      isForcedPlanSession: false,
      mode: 'default',
      addMessage,
      clearMessages: vi.fn(),
      scrollToBottom: vi.fn(),
      startRun: vi.fn(),
      llmProfileId: undefined,
      commandsCacheKey: 'k',
      setDrawerOpen: vi.fn(),
    }),
  );
  return { result, addMessage };
}

describe('useCommandHandler /context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a system message with metadata.contextUsage on success', async () => {
    vi.mocked(api.getSessionContextUsage).mockResolvedValue({
      available: true,
      model: 'claude-sonnet-4-6',
      contextWindow: 200_000,
      contextWindowSource: 'pi_ai_registry',
      usedTokens: 5_000,
      usedTokensFromUsage: true,
      breakdown: {
        systemPrompt: { tokens: 100, estimated: true },
        tools: { tokens: 10, estimated: true, count: 1 },
        skills: { tokens: 0, estimated: true },
        messages: { tokens: 4_890, estimated: true, clamped: false },
        freeSpace: { tokens: 195_000, percent: 97.5 },
      },
      capturedAt: 1,
    });

    const { result, addMessage } = setup();
    await result.current.handleCommand('/context', '');

    expect(api.getSessionContextUsage).toHaveBeenCalledWith('sess-1');
    expect(addMessage).toHaveBeenCalledTimes(1);
    const [, message] = addMessage.mock.calls[0];
    expect(message.role).toBe('system');
    expect(message.metadata?.contextUsage).toMatchObject({
      usedTokens: 5_000,
      contextWindow: 200_000,
    });
    // `available` is transport-level, not part of the card payload
    expect(message.metadata?.contextUsage).not.toHaveProperty('available');
  });

  it('adds a hint message when no context data is available', async () => {
    vi.mocked(api.getSessionContextUsage).mockResolvedValue({ available: false });

    const { result, addMessage } = setup();
    await result.current.handleCommand('/context', '');

    const [, message] = addMessage.mock.calls[0];
    expect(message.role).toBe('system');
    expect(message.metadata?.contextUsage).toBeUndefined();
    expect(message.content).toMatch(/no context data yet/i);
  });

  it('adds an error message when the API call fails', async () => {
    vi.mocked(api.getSessionContextUsage).mockRejectedValue(new Error('boom'));

    const { result, addMessage } = setup();
    await result.current.handleCommand('/context', '');

    const [, message] = addMessage.mock.calls[0];
    expect(message.content).toMatch(/failed to get context usage: boom/i);
  });
});
