import { expect, it, vi } from 'vitest';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { LlmProfileRepository } from '../repository.js';
import { registerLlmProfileRepository } from '../repository-registry.js';
import { refreshIfNeeded } from '../codex-oauth-service.js';
import { buildModel } from '../../../infra/providers/pi-runtime/build-model.js';

vi.mock('../codex-oauth-service.js', () => ({ refreshIfNeeded: vi.fn() }));

it('wires provider credential lookup to the host refresh policy and registered writer', async () => {
  const credentials = { access: 'fresh', refresh: 'refresh', accountId: 'account', expires: 100 };
  const profile: LlmProfileConfig = {
    id: 'codex-profile',
    name: 'Codex',
    providerType: 'openai-codex',
    oauthCredentials: credentials,
    createdAt: 1,
    updatedAt: 1,
  };
  const update = vi.fn();
  registerLlmProfileRepository({ update } as unknown as LlmProfileRepository);
  vi.mocked(refreshIfNeeded).mockImplementation(async (input, writer) => {
    expect(input).toBe(profile);
    await writer.updateOAuthCredentials(input.id, credentials);
    return credentials;
  });

  const { getApiKey } = buildModel(profile, 'gpt-5-codex');
  await expect(getApiKey!('openai-codex')).resolves.toBe('fresh');
  expect(update).toHaveBeenCalledExactlyOnceWith(profile.id, { oauthCredentials: credentials });
});
