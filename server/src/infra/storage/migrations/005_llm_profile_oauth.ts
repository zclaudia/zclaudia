import type { Migration } from './types.js';

/**
 * Migration 005 — add oauth_credentials column for openai-codex profiles.
 *
 * Stores JSON of pi-ai OAuthCredentials shape:
 *   { access, refresh, expires, accountId }
 * Null for non-codex profiles.
 */
export const migration: Migration = {
  name: '005_llm_profile_oauth',
  sql: `
ALTER TABLE llm_profiles ADD COLUMN oauth_credentials TEXT;
  `,
};
