import type { CodexOAuthCredentials, LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

/**
 * Process-wide LlmProfile repository slot. Lives in utils (neutral layer) so
 * infra provider code (build-model, models-registry) can persist OAuth
 * credentials without importing the llm-profiles domain; the domain module
 * re-exports the register/write helpers for existing import sites.
 */
export interface OAuthCredentialsWriter {
  updateOAuthCredentials(
    profileId: string,
    creds: CodexOAuthCredentials | null
  ): Promise<void> | void;
}

/** Structural slice of LlmProfileRepository used by the OAuth writer. */
export interface LlmProfileWriterRepo {
  update(profileId: string, config: Partial<LlmProfileConfig>): unknown;
}

let registered: LlmProfileWriterRepo | null = null;

export function registerLlmProfileWriter(repo: LlmProfileWriterRepo): void {
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
