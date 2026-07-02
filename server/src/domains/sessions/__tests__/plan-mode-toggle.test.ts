import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { SessionRepository } from '../repository.js';
import { enterPlanMode, exitPlanMode } from '../plan-mode-toggle.js';

describe('plan mode toggle', () => {
  let db: Database.Database;
  let repo: SessionRepository;
  const id = 's1';

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    db.pragma('foreign_keys = OFF');
    db.prepare(
      'INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, 'p', 'a', Date.now(), Date.now());
    repo = new SessionRepository(db);
  });

  afterEach(() => db.close());

  function planStatus(): string | null {
    return (
      db.prepare('SELECT plan_status FROM sessions WHERE id = ?').get(id) as {
        plan_status: string | null;
      }
    ).plan_status;
  }

  it('enterPlanMode sets planning status', () => {
    const res = enterPlanMode(repo, id);
    expect(res.ok).toBe(true);
    expect(planStatus()).toBe('planning');
  });

  it('enterPlanMode is idempotent when already planning', () => {
    enterPlanMode(repo, id);
    const res = enterPlanMode(repo, id);
    expect(res.ok).toBe(true);
    expect(res.alreadyActive).toBe(true);
    expect(planStatus()).toBe('planning');
  });

  it('exitPlanMode clears planning status', () => {
    enterPlanMode(repo, id);
    const res = exitPlanMode(repo, id);
    expect(res.ok).toBe(true);
    expect(planStatus()).toBe(null);
  });

  it('exitPlanMode is a no-op when not planning', () => {
    const res = exitPlanMode(repo, id);
    expect(res.ok).toBe(true);
    expect(res.wasActive).toBe(false);
    expect(planStatus()).toBe(null);
  });

  it('returns not-found for an unknown session', () => {
    expect(enterPlanMode(repo, 'missing').ok).toBe(false);
    expect(exitPlanMode(repo, 'missing').ok).toBe(false);
  });

  it('refuses to enter from a supervision-owned non-planning state', () => {
    repo.update(id, { planStatus: 'executing', projectRole: 'task' });
    const res = enterPlanMode(repo, id);
    // executing -> planning is not a valid transition; tool must not force it
    expect(res.ok).toBe(false);
    expect(planStatus()).toBe('executing');
  });
});
