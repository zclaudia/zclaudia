import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { buildTools } from '../tool-bridge.js';
import { interactionDispatcher } from '../../../../application/conversation/interactions/interaction-dispatcher.js';

describe('EnterPlanMode / ExitPlanMode builtins', () => {
  let db: Database.Database;
  const sessionId = 's-plan';

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    db.pragma('foreign_keys = OFF');
    db.prepare(
      'INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, 'p', 'a', Date.now(), Date.now());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function tools(): Record<string, any> {
    const built = buildTools('/tmp', { enabled: ['EnterPlanMode', 'ExitPlanMode'], db, sessionId });
    return Object.fromEntries(built.map(t => [t.name, t]));
  }

  function planStatus(): string | null {
    return (
      db.prepare('SELECT plan_status FROM sessions WHERE id = ?').get(sessionId) as {
        plan_status: string | null;
      }
    ).plan_status;
  }

  it('EnterPlanMode sets planning status and explains next-turn read-only', async () => {
    const res = await tools().EnterPlanMode.execute('p1', {});
    expect(res.details.ok).toBe(true);
    expect(planStatus()).toBe('planning');
    expect(res.content[0].text).toMatch(/next turn|read-only/i);
  });

  it('ExitPlanMode (bare) is rejected and keeps planning status', async () => {
    await tools().EnterPlanMode.execute('p1', {});
    const spy = vi.spyOn(interactionDispatcher, 'dispatchAndWait');
    const res = await tools().ExitPlanMode.execute('p2', {});
    expect(res.details.ok).toBe(false);
    expect(res.details.error).toBe('plan_required');
    expect(planStatus()).toBe('planning');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ExitPlanMode rejects whitespace-only plans', async () => {
    await tools().EnterPlanMode.execute('p1', {});
    const spy = vi.spyOn(interactionDispatcher, 'dispatchAndWait');
    const res = await tools().ExitPlanMode.execute('p2', { plan: '   \n\t  ' });
    expect(res.details.ok).toBe(false);
    expect(res.details.error).toBe('plan_required');
    expect(planStatus()).toBe('planning');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ExitPlanMode (bare) is a no-op when plan mode is not active', async () => {
    const res = await tools().ExitPlanMode.execute('p1', {});
    expect(res.details.ok).toBe(true);
    expect(res.details.wasActive).toBe(false);
    expect(planStatus()).toBe(null);
  });

  it('ExitPlanMode with a plan runs the approval interaction, then clears on approval', async () => {
    await tools().EnterPlanMode.execute('p1', {});
    const spy = vi
      .spyOn(interactionDispatcher, 'dispatchAndWait')
      .mockResolvedValue({ approved: true } as never);
    const res = await tools().ExitPlanMode.execute('p2', {
      plan: '1. do the thing',
      allowedPrompts: [{ tool: 'Bash', prompt: 'run build' }],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0][2] as { type: string; plan: string; source: string };
    expect(event.type).toBe('interaction_plan_review');
    expect(event.plan).toBe('1. do the thing');
    expect(res.details.ok).toBe(true);
    expect(res.details.approved).toBe(true);
    expect(planStatus()).toBe(null);
  });

  it('ExitPlanMode with a plan that is rejected keeps planning and returns the feedback', async () => {
    await tools().EnterPlanMode.execute('p1', {});
    vi.spyOn(interactionDispatcher, 'dispatchAndWait').mockResolvedValue({
      approved: false,
      feedback: 'narrow the scope',
    } as never);
    const res = await tools().ExitPlanMode.execute('p2', { plan: 'big plan' });
    expect(res.details.ok).toBe(false);
    expect(res.details.error).toBe('plan_rejected');
    expect(res.content[0].text).toContain('narrow the scope');
    expect(planStatus()).toBe('planning');
  });

  it('requires session context', async () => {
    const built = buildTools('/tmp', { enabled: ['EnterPlanMode'] });

    const res = await (built[0] as any).execute('p1', {});
    expect(res.details.error).toBe('missing_session_context');
  });
});
