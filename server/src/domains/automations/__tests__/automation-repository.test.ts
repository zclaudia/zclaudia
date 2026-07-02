import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AutomationRepository } from '../repository.js';

describe('AutomationRepository', () => {
  let db: Database.Database;
  let repo: AutomationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    repo = new AutomationRepository(db);
  });

  it('round-trips an automation with trigger + action JSON', () => {
    const a = repo.create({
      name: 'Auto commit',
      enabled: true,
      trigger: { type: 'interval', intervalMinutes: 30 },
      action: { kind: 'activity', ref: 'git_commit', input: { messageMode: 'ai' } },
    });
    const found = repo.findById(a.id)!;
    expect(found.name).toBe('Auto commit');
    expect(found.trigger.type).toBe('interval');
    expect(found.action.kind).toBe('activity');
    expect(found.action.input).toEqual({ messageMode: 'ai' });
  });

  it('filters enabled and by system key', () => {
    repo.create({
      name: 'on',
      enabled: true,
      trigger: { type: 'manual' },
      action: { kind: 'activity', ref: 'shell' },
    });
    repo.create({
      name: 'off',
      enabled: false,
      trigger: { type: 'manual' },
      action: { kind: 'activity', ref: 'shell' },
    });
    expect(repo.findAllEnabled()).toHaveLength(1);
    const sys = repo.create({
      name: 'sys',
      enabled: true,
      trigger: { type: 'event', event: 'x' },
      action: { kind: 'workflow', ref: 'w1' },
      isSystem: true,
      systemKey: 'k1',
    });
    expect(repo.findBySystemKey('k1')!.id).toBe(sys.id);
  });
});
