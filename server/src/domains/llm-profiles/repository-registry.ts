import type { LlmProfileRepository } from './repository.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { OAuthCredentialsWriter } from './codex-oauth-service.js';

let registered: LlmProfileRepository | null = null;

export function registerLlmProfileRepository(repo: LlmProfileRepository): void {
  registered = repo;
}

export function getLlmProfileWriter(): OAuthCredentialsWriter {
  if (!registered) {
    throw new Error(
      'LlmProfileRepository not registered (forgot to call registerLlmProfileRepository on boot?)'
    );
  }
  const repo = registered;
  return {
    updateOAuthCredentials(profileId, creds) {
      repo.update(profileId, { oauthCredentials: creds } as Partial<LlmProfileConfig>);
    },
  };
}
