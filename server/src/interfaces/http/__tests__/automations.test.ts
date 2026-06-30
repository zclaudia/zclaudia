import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAutomationRoutes } from '../automations.js';

function svcStub() {
  const created: any[] = [];
  return {
    created,
    createAutomation: vi.fn((d: any) => { const a = { id: 'a1', enabled: true, createdAt: 1, updatedAt: 1, ...d }; created.push(a); return a; }),
    listAutomations: vi.fn(() => created),
    getAutomation: vi.fn((id: string) => created.find((c) => c.id === id) ?? null),
    updateAutomation: vi.fn((id: string, patch: any) => ({ id, ...patch })),
    deleteAutomation: vi.fn(() => true),
    runAction: vi.fn(async () => ({ id: 'run-1', status: 'running', initiator: 'manual', triggerSource: 'manual', startedAt: 1 })),
    getRunsForAutomation: vi.fn(() => []),
  };
}

function appWith(svc: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/automations', createAutomationRoutes(svc));
  return app;
}

describe('POST /api/automations', () => {
  it('creates an activity automation', async () => {
    const svc = svcStub();
    const res = await request(appWith(svc)).post('/api/automations').send({
      name: 'Auto commit',
      trigger: { type: 'interval', intervalMinutes: 30 },
      action: { kind: 'activity', ref: 'git_commit', input: { messageMode: 'ai' } },
    });
    expect(res.status).toBe(201);
    expect(svc.createAutomation).toHaveBeenCalled();
    expect(res.body.data.action.kind).toBe('activity');
  });

  it('rejects missing name', async () => {
    const res = await request(appWith(svcStub())).post('/api/automations').send({ trigger: { type: 'manual' }, action: { kind: 'activity', ref: 'shell' } });
    expect(res.status).toBe(400);
  });

  it('rejects missing action.ref', async () => {
    const res = await request(appWith(svcStub())).post('/api/automations').send({ name: 'x', trigger: { type: 'manual' }, action: { kind: 'activity' } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/automations/:id/trigger', () => {
  it('runs the action manually', async () => {
    const svc = svcStub();
    svc.createAutomation({ name: 'x', trigger: { type: 'manual' }, action: { kind: 'activity', ref: 'shell' } });
    const res = await request(appWith(svc)).post('/api/automations/a1/trigger');
    expect(res.status).toBe(200);
    expect(svc.runAction).toHaveBeenCalledWith('a1', expect.objectContaining({ initiator: 'manual', triggerSource: 'manual' }));
  });
});
