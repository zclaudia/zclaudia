import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { generateSessionTitle } from '../generate-session-title.js';
import { buildModel } from '../../../../infra/providers/pi-runtime/build-model.js';
import { completeSimple } from '@earendil-works/pi-ai';

// Mock the model build + LLM call — this test exercises the wiring from the
// profile config into buildModel, not the title text itself. modelEntryFor
// stays real (pure lookup) so entry resolution matches production.
vi.mock('../../../../infra/providers/pi-runtime/build-model.js', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../../infra/providers/pi-runtime/build-model.js')
  >()),
  buildModel: vi.fn(() => ({
    model: {
      id: 'fake',
      name: 'fake',
      provider: 'anthropic',
      api: 'anthropic-messages',
      reasoning: false,
      maxTokens: 8192,
      contextWindow: 200_000,
    },
  })),
}));
vi.mock('@earendil-works/pi-ai', () => ({
  completeSimple: vi.fn(async () => ({
    content: [{ type: 'text', text: 'Project Overview' }],
  })),
}));
vi.mock('../../../../infra/providers/pi-runtime/session-tree/index.js', () => ({
  readRecentMessages: vi.fn(() => [
    { role: 'user', content: [{ type: 'text', text: 'what is this project' }], timestamp: 1 },
  ]),
}));

const agentProfile: AgentProfileConfig = {
  id: 'ap1',
  name: 'a',
  llmProfileId: 'lp1',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  enabledTools: [],
  createdAt: 0,
  updatedAt: 0,
};

const llmProfile: LlmProfileConfig = {
  id: 'lp1',
  name: 'p',
  providerType: 'anthropic',
  apiKey: 'k',
  createdAt: 0,
  updatedAt: 0,
};

describe('generateSessionTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a title from the mocked completion', async () => {
    const title = await generateSessionTitle({
      db: {} as never,
      sessionId: 's1',
      agentProfile,
      llmProfile,
    });
    expect(title).toBe('Project Overview');
    expect(vi.mocked(completeSimple)).toHaveBeenCalledTimes(1);
  });

  it('passes the per-model entry to buildModel so overrides and dialect apply', async () => {
    const entry = { modelId: agentProfile.model, maxTokens: 1024, dialect: 'deepseek' as const };
    const lp: LlmProfileConfig = { ...llmProfile, models: [entry] };
    await generateSessionTitle({ db: {} as never, sessionId: 's1', agentProfile, llmProfile: lp });
    expect(vi.mocked(buildModel)).toHaveBeenCalledWith(lp, agentProfile.model, entry);
  });

  it('passes undefined entry when the profile declares no matching model', async () => {
    const lp: LlmProfileConfig = {
      ...llmProfile,
      models: [{ modelId: 'some-other-model', maxTokens: 512 }],
    };
    await generateSessionTitle({ db: {} as never, sessionId: 's1', agentProfile, llmProfile: lp });
    expect(vi.mocked(buildModel)).toHaveBeenCalledWith(lp, agentProfile.model, undefined);
  });
});
