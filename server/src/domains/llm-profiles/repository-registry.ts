/**
 * Compatibility shim — the registry/writer implementation lives in
 * utils/llm-profile-registry.ts (neutral layer) so infra provider code
 * (build-model, models-registry) can persist OAuth credentials without
 * importing this domain.
 */
import type { LlmProfileRepository } from './repository.js';
import { registerLlmProfileWriter } from '../../utils/llm-profile-registry.js';

export type {
  LlmProfileWriterRepo,
  OAuthCredentialsWriter,
} from '../../utils/llm-profile-registry.js';
export { getLlmProfileWriter } from '../../utils/llm-profile-registry.js';

export function registerLlmProfileRepository(repo: LlmProfileRepository): void {
  registerLlmProfileWriter(repo);
}
