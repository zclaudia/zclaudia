import type { Migration } from './types.js';

/**
 * Migration 004 — merge legacy provider_type "openai-custom" into "openai".
 *
 * `openai-custom` and `openai` were functionally identical at the wire level:
 * both used `openai-completions` API + Bearer auth + a /v1/models endpoint.
 * The only "difference" was that the editor required a baseUrl when picking
 * `openai-custom`; the unified `openai` row now treats baseUrl as optional
 * (defaults to `https://api.openai.com/v1`).
 *
 * No data loss: every `openai-custom` row already carried a baseUrl (it was
 * required by the editor), so flipping the type preserves the explicit
 * upstream endpoint exactly as the user configured it.
 */
export const migration: Migration = {
  name: '004_merge_openai_custom',
  sql: `
UPDATE llm_profiles SET provider_type = 'openai' WHERE provider_type = 'openai-custom';
  `,
};
