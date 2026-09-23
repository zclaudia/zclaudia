import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Automation } from '@zclaudia/shared/features/automations';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import type { AutomationPort } from '../../types.js';
import {
  createCronCreateTool,
  createCronDeleteTool,
  createCronListTool,
  createCronUpdateTool,
  parseSchedule,
} from '../automation-tools.js';

function fakePort(seed: Automation[] = []) {
  const rows = new Map(seed.map(row => [row.id, row]));
  let counter = 0;
  const port: AutomationPort = {
    list: vi.fn((projectId?: string) =>
      [...rows.values()].filter(row => !projectId || row.projectId === projectId)
    ),
    get: vi.fn((id: string) => rows.get(id) ?? null),
    create: vi.fn(data => {
      counter += 1;
      const row: Automation = {
        id: `auto-${counter}`,
        projectId: data.projectId,
        name: data.name,
        description: data.description,
        enabled: data.enabled ?? true,
        trigger: data.trigger,
        action: data.action,
        createdAt: 1,
        updatedAt: 1,
      };
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn((id, data) => {
      const existing = rows.get(id)!;
      const updated = { ...existing, ...data, updatedAt: 2 } as Automation;
      rows.set(id, updated);
      return updated;
    }),
    delete: vi.fn(id => {
      rows.delete(id);
    }),
  };
  return { port, rows };
}

function withSession() {
  const db = new Database(':memory:');
  applyMigrations(db);
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_profiles (id, name, description, runtime_type, llm_profile_id, system_prompt, enabled_tools, is_default, status, source, created_at, updated_at)
     VALUES ('prof', 'Default', '', 'pi', NULL, '', '[]', 1, 'active', 'user', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES ('proj', 'P', '/tmp/p', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
     VALUES ('sess', 'proj', 'prof', 'regular', ?, ?)`
  ).run(now, now);
  return db;
}

describe('parseSchedule', () => {
  it('accepts exactly one schedule form', () => {
    expect(parseSchedule({ cron: '0 9 * * 1-5' })).toMatchObject({
      ok: true,
      trigger: { type: 'cron', cron: '0 9 * * 1-5' },
    });
    expect(parseSchedule({ delayMinutes: 30 }, 1_000)).toMatchObject({
      ok: true,
      trigger: { type: 'once', onceAt: 1_000 + 30 * 60_000 },
    });
    expect(parseSchedule({ intervalMinutes: 120 })).toMatchObject({
      ok: true,
      trigger: { type: 'interval', intervalMinutes: 120 },
    });
    expect(parseSchedule({})).toMatchObject({ ok: false, code: 'invalid_schedule' });
    expect(parseSchedule({ cron: '* * * * *', delayMinutes: 5 })).toMatchObject({
      ok: false,
      code: 'invalid_schedule',
    });
    expect(parseSchedule({ cron: 'every day' })).toMatchObject({ ok: false, code: 'invalid_cron' });
    expect(parseSchedule({ delayMinutes: 0 })).toMatchObject({ ok: false, code: 'invalid_delay' });
    expect(parseSchedule({ intervalMinutes: 1.5 })).toMatchObject({
      ok: false,
      code: 'invalid_interval',
    });
  });
});

describe('Cron tools', () => {
  it('CronCreate stores a project-scoped ai_prompt automation bound to the run LLM profile', async () => {
    const db = withSession();
    const { port } = fakePort();
    try {
      const tool = createCronCreateTool({
        cwd: '/tmp/p',
        sessionId: 'sess',
        db,
        port,
        llmProfileId: 'llm-1',
      }) as any;
      const res = await tool.execute('c1', {
        title: 'Nightly lint',
        prompt: 'Run lint and report',
        cron: '0 2 * * *',
      });
      const body = JSON.parse(res.content[0].text);
      expect(body).toMatchObject({ ok: true, schedule: 'cron: 0 2 * * *' });
      expect(port.create).toHaveBeenCalledWith({
        projectId: 'proj',
        name: 'Nightly lint',
        description: undefined,
        enabled: true,
        trigger: { type: 'cron', cron: '0 2 * * *' },
        action: {
          kind: 'activity',
          ref: 'ai_prompt',
          input: {
            prompt: 'Run lint and report',
            workingDirectory: '/tmp/p',
            llmProfileId: 'llm-1',
          },
        },
      });
    } finally {
      db.close();
    }
  });

  it('CronCreate refuses without a project session or port and validates the schedule', async () => {
    const db = withSession();
    const { port } = fakePort();
    try {
      const noPort = createCronCreateTool({ cwd: '/tmp', sessionId: 'sess', db }) as any;
      expect(
        (await noPort.execute('c1', { title: 't', prompt: 'p', cron: '* * * * *' })).details
      ).toMatchObject({ ok: false, error: 'automations_unavailable' });

      const noSession = createCronCreateTool({ cwd: '/tmp', db, port }) as any;
      expect(
        (await noSession.execute('c2', { title: 't', prompt: 'p', cron: '* * * * *' })).details
      ).toMatchObject({ ok: false, error: 'missing_project' });

      const tool = createCronCreateTool({ cwd: '/tmp', sessionId: 'sess', db, port }) as any;
      expect((await tool.execute('c3', { title: 't', prompt: 'p' })).details).toMatchObject({
        ok: false,
        error: 'invalid_schedule',
      });
      expect(port.create).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('CronList / CronUpdate / CronDelete only see this project and skip system rows', async () => {
    const db = withSession();
    const mine: Automation = {
      id: 'auto-mine',
      projectId: 'proj',
      name: 'Mine',
      enabled: true,
      trigger: { type: 'interval', intervalMinutes: 60 },
      action: { kind: 'activity', ref: 'ai_prompt', input: { prompt: 'old' } },
      createdAt: 1,
      updatedAt: 1,
    };
    const theirs: Automation = { ...mine, id: 'auto-theirs', projectId: 'other', name: 'Theirs' };
    const system: Automation = { ...mine, id: 'auto-sys', name: 'Sys', isSystem: true };
    const { port, rows } = fakePort([mine, theirs, system]);
    const deps = { cwd: '/tmp', sessionId: 'sess', db, port };
    try {
      const list = createCronListTool(deps) as any;
      const listed = JSON.parse((await list.execute('l1', {})).content[0].text);
      expect(listed.automations.map((row: { id: string }) => row.id)).toEqual(['auto-mine']);
      expect(listed.automations[0]).toMatchObject({ title: 'Mine', prompt: 'old' });

      const update = createCronUpdateTool(deps) as any;
      const updated = await update.execute('u1', {
        id: 'auto-mine',
        prompt: 'new prompt',
        delayMinutes: 5,
        enabled: false,
      });
      expect(JSON.parse(updated.content[0].text)).toMatchObject({
        ok: true,
        automation: { id: 'auto-mine', enabled: false, prompt: 'new prompt' },
      });
      expect(rows.get('auto-mine')?.trigger.type).toBe('once');
      expect(rows.get('auto-mine')?.action.input).toEqual({ prompt: 'new prompt' });

      expect(
        (await update.execute('u2', { id: 'auto-theirs', enabled: true })).details
      ).toMatchObject({ ok: false, error: 'automation_not_found' });
      expect((await update.execute('u3', { id: 'auto-sys', enabled: true })).details).toMatchObject(
        {
          ok: false,
          error: 'automation_not_found',
        }
      );
      expect((await update.execute('u4', { id: 'auto-mine' })).details).toMatchObject({
        ok: false,
        error: 'nothing_to_update',
      });

      const del = createCronDeleteTool(deps) as any;
      expect((await del.execute('d1', { id: 'auto-theirs' })).details).toMatchObject({
        ok: false,
        error: 'automation_not_found',
      });
      expect(JSON.parse((await del.execute('d2', { id: 'auto-mine' })).content[0].text)).toEqual({
        ok: true,
        id: 'auto-mine',
        title: 'Mine',
      });
      expect(rows.has('auto-mine')).toBe(false);
      expect(rows.has('auto-sys')).toBe(true);
    } finally {
      db.close();
    }
  });
});
