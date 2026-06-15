import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { autoDetectProviders } from '../initializer.js';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';

const ENV = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const SAVED: Record<string, string | undefined> = {};
let db: Database.Database;
beforeEach(() => {
  for (const k of ENV) { SAVED[k] = process.env[k]; delete process.env[k]; }
  db = new Database(':memory:');
  applyMigrations(db);
});
afterEach(() => {
  db.close();
  for (const k of ENV) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
});

function defaultProfile() {
  return db.prepare("SELECT name, provider_type AS providerType, base_url AS baseUrl, api_key AS apiKey FROM llm_profiles WHERE is_default=1").get() as any;
}

describe('autoDetectProviders — env materialization', () => {
  it('seed: no env → keyless anthropic default profile', () => {
    autoDetectProviders(db);
    const p = defaultProfile();
    expect(p.providerType).toBe('anthropic');
    expect(p.apiKey == null || p.apiKey === '').toBe(true);
  });
  it('seed: OPENAI_BASE_URL+OPENAI_API_KEY → openai profile with baseUrl+apiKey', () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENAI_API_KEY = 'sk-oai';
    autoDetectProviders(db);
    const p = defaultProfile();
    expect(p.providerType).toBe('openai');
    expect(p.baseUrl).toBe('http://127.0.0.1:3000/v1');
    expect(p.apiKey).toBe('sk-oai');
  });
  it('seed: ANTHROPIC_API_KEY → anthropic profile with apiKey', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    autoDetectProviders(db);
    const p = defaultProfile();
    expect(p.providerType).toBe('anthropic');
    expect(p.apiKey).toBe('sk-ant');
  });
  it('backfill: existing keyless default profile + ANTHROPIC_API_KEY → apiKey filled', () => {
    autoDetectProviders(db);
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    autoDetectProviders(db);
    expect(defaultProfile().apiKey).toBe('sk-ant');
  });
  it('backfill: OPENAI_BASE_URL+OPENAI_API_KEY converts a keyless anthropic default to openai+baseUrl+apiKey', () => {
    autoDetectProviders(db);
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENAI_API_KEY = 'sk-oai';
    autoDetectProviders(db);
    const p = defaultProfile();
    expect(p.providerType).toBe('openai');
    expect(p.baseUrl).toBe('http://127.0.0.1:3000/v1');
    expect(p.apiKey).toBe('sk-oai');
  });
  it('backfill no-op: profile that already has an apiKey is never overwritten', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-first';
    autoDetectProviders(db);
    process.env.ANTHROPIC_API_KEY = 'sk-second';
    autoDetectProviders(db);
    expect(defaultProfile().apiKey).toBe('sk-first');
  });
  it('backfill never touches an openai-codex default profile (keyless during OAuth)', () => {
    // seed a codex default profile directly (keyless, mid-OAuth)
    db.prepare(`
      INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, compat, is_default, created_at, updated_at)
      VALUES ('codex1', 'Codex', 'openai-codex', NULL, NULL, NULL, 1, 0, 0)
    `).run();
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    autoDetectProviders(db);
    const p = defaultProfile();
    expect(p.providerType).toBe('openai-codex');
    expect(p.apiKey == null || p.apiKey === '').toBe(true);
  });
});
