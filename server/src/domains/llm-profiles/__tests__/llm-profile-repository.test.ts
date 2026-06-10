import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { LlmProfileRepository } from '../repository.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

describe('LlmProfileRepository — models field', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('round-trips a models list with overrides', () => {
    const repo = new LlmProfileRepository(db);
    const created = repo.create({
      name: 'with-models',
      providerType: 'anthropic',
      models: [
        { modelId: 'claude-opus-4-7', displayName: 'Opus 1M', contextWindow: 1_000_000, maxTokens: 32_768 },
        { modelId: 'claude-sonnet-4-6' },
      ],
    });
    const read = repo.findById(created.id);
    expect(read?.models).toEqual([
      { modelId: 'claude-opus-4-7', displayName: 'Opus 1M', contextWindow: 1_000_000, maxTokens: 32_768 },
      { modelId: 'claude-sonnet-4-6' },
    ]);
  });

  it('stores models = undefined as DB NULL and reads back undefined', () => {
    const repo = new LlmProfileRepository(db);
    const created = repo.create({ name: 'no-models', providerType: 'anthropic' });
    const read = repo.findById(created.id);
    expect(read?.models).toBeUndefined();
  });

  it('stores models = [] as JSON "[]" and reads back []', () => {
    const repo = new LlmProfileRepository(db);
    const created = repo.create({ name: 'empty-models', providerType: 'anthropic', models: [] });
    const read = repo.findById(created.id);
    expect(read?.models).toEqual([]);
  });

  it('update preserves models when not in patch', () => {
    const repo = new LlmProfileRepository(db);
    const created = repo.create({
      name: 'p', providerType: 'anthropic',
      models: [{ modelId: 'a', contextWindow: 100 }],
    });
    repo.update(created.id, { name: 'renamed' });
    const read = repo.findById(created.id);
    expect(read?.name).toBe('renamed');
    expect(read?.models).toEqual([{ modelId: 'a', contextWindow: 100 }]);
  });
});

describe('cacheRetention', () => {
  let db: Database.Database;
  let repo: LlmProfileRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new LlmProfileRepository(db);
  });

  it('round-trips cacheRetention through create and findById', () => {
    const created = repo.create({ name: 'p', providerType: 'anthropic', cacheRetention: 'long', isDefault: false });
    expect(repo.findById(created.id)?.cacheRetention).toBe('long');
  });

  it('updates and clears cacheRetention', () => {
    const created = repo.create({ name: 'p', providerType: 'anthropic', cacheRetention: 'short', isDefault: false });
    repo.update(created.id, { cacheRetention: 'none' });
    expect(repo.findById(created.id)?.cacheRetention).toBe('none');
    repo.update(created.id, { cacheRetention: null as never });
    expect(repo.findById(created.id)?.cacheRetention).toBeUndefined();
  });

  it('maps unknown stored values to undefined (forward-compat)', () => {
    const created = repo.create({ name: 'p', providerType: 'anthropic', isDefault: false });
    db.prepare('UPDATE llm_profiles SET cache_retention = ? WHERE id = ?').run('weekly', created.id);
    expect(repo.findById(created.id)?.cacheRetention).toBeUndefined();
  });
});
