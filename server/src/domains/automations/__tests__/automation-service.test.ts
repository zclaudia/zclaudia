import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AutomationService } from '../service.js';
import { pluginEvents } from '../../../infra/events/index.js';
import type { Workflow, WorkflowDefinition } from '@zclaudia/shared/features/workflows';
import { SYSTEM_PERMISSION_AUTOMATION_KEY } from '../templates.js';

function fakeEngine() {
  return {
    startRun: vi.fn(async (opts: any) => ({ id: 'run-1', initiator: opts.initiator, status: 'running', triggerSource: opts.triggerSource, startedAt: 1 })),
    isRunningKey: vi.fn(() => false),
  };
}

function fakeWorkflowLookup(wf?: Workflow) {
  return { getWorkflow: vi.fn((id: string) => (wf && wf.id === id ? wf : null)) };
}

describe('AutomationService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
  });

  it('runs an activity action as an ephemeral one-node workflow', async () => {
    const engine = fakeEngine();
    const svc = new AutomationService(db, () => {}, engine as any, fakeWorkflowLookup() as any);
    const a = svc.createAutomation({
      name: 'commit',
      trigger: { type: 'manual' },
      action: { kind: 'activity', ref: 'git_commit', input: { messageMode: 'ai' } },
    });

    await svc.runAction(a.id, { initiator: 'manual', triggerSource: 'manual' });

    expect(engine.startRun).toHaveBeenCalledTimes(1);
    const opts = engine.startRun.mock.calls[0][0];
    expect(opts.workflowId).toBeUndefined();
    expect(opts.actionKind).toBe('activity');
    expect(opts.actionRef).toBe('git_commit');
    expect(opts.trackingKey).toBe(`automation:${a.id}`);
    const def = opts.definition as WorkflowDefinition;
    expect(def.nodes).toHaveLength(1);
    expect(def.nodes[0].type).toBe('git_commit');
    expect(def.nodes[0].config).toEqual({ messageMode: 'ai' });
  });

  it('runs a workflow action against the persisted workflow definition', async () => {
    const wf: Workflow = {
      id: 'w1', name: 'WF', status: 'active',
      definition: { nodes: [{ id: 'n', name: 'n', type: 'shell', config: {}, position: { x: 0, y: 0 } }], edges: [], entryNodeId: 'n' },
      createdAt: 1, updatedAt: 1,
    };
    const engine = fakeEngine();
    const svc = new AutomationService(db, () => {}, engine as any, fakeWorkflowLookup(wf) as any);
    const a = svc.createAutomation({
      name: 'run wf',
      trigger: { type: 'manual' },
      action: { kind: 'workflow', ref: 'w1' },
    });

    await svc.runAction(a.id, { initiator: 'manual', triggerSource: 'manual' });

    const opts = engine.startRun.mock.calls[0][0];
    expect(opts.workflowId).toBe('w1');
    expect(opts.actionKind).toBe('workflow');
    expect(opts.trackingKey).toBe('w1');
    expect(opts.definition).toBe(wf.definition);
  });

  it('throws when a workflow action references a missing workflow', async () => {
    const svc = new AutomationService(db, () => {}, fakeEngine() as any, fakeWorkflowLookup() as any);
    const a = svc.createAutomation({ name: 'x', trigger: { type: 'manual' }, action: { kind: 'workflow', ref: 'missing' } });
    await expect(svc.runAction(a.id, { initiator: 'manual', triggerSource: 'manual' })).rejects.toThrow(/Workflow not found/);
  });
});

describe('AutomationService scheduling + events', () => {
  let db2: Database.Database;
  beforeEach(() => { db2 = new Database(':memory:'); applyMigrations(db2); });

  it('fires a due interval automation on tick and computes the next run', async () => {
    const engine = fakeEngine();
    const svc = new AutomationService(db2, () => {}, engine as any, fakeWorkflowLookup() as any);
    svc.createAutomation({
      name: 'interval',
      trigger: { type: 'interval', intervalMinutes: 1 },
      action: { kind: 'activity', ref: 'shell', input: { command: 'echo hi' } },
    });
    (svc as any).nextRunByAutomation.forEach((_v: number, k: string) => (svc as any).nextRunByAutomation.set(k, Date.now() - 1000));
    await svc.tick();
    expect(engine.startRun).toHaveBeenCalledTimes(1);
    expect(engine.startRun.mock.calls[0][0].triggerSource).toBe('schedule');
  });

  it('skips a due automation whose action is already running', async () => {
    const engine = fakeEngine();
    engine.isRunningKey = vi.fn(() => true);
    const svc = new AutomationService(db2, () => {}, engine as any, fakeWorkflowLookup() as any);
    svc.createAutomation({ name: 'i', trigger: { type: 'interval', intervalMinutes: 1 }, action: { kind: 'activity', ref: 'shell' } });
    (svc as any).nextRunByAutomation.forEach((_v: number, k: string) => (svc as any).nextRunByAutomation.set(k, Date.now() - 1000));
    await svc.tick();
    expect(engine.startRun).not.toHaveBeenCalled();
  });

  it('fires an event automation when its event is emitted', async () => {
    const engine = fakeEngine();
    const svc = new AutomationService(db2, () => {}, engine as any, fakeWorkflowLookup() as any);
    svc.createAutomation({ name: 'evt', trigger: { type: 'event', event: 'demo.fired' }, action: { kind: 'activity', ref: 'shell' } });
    svc.initialize();
    pluginEvents.emit('demo.fired', { hello: 'world' }, 'test');
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.startRun).toHaveBeenCalledTimes(1);
    expect(engine.startRun.mock.calls[0][0].triggerSource).toBe('event');
  });
});

describe('AutomationService.ensureSystemAutomations', () => {
  it('creates an immutable system permission automation bound to the system workflow', () => {
    const db3 = new Database(':memory:'); applyMigrations(db3);
    const svc = new AutomationService(db3, () => {}, fakeEngine() as any, fakeWorkflowLookup() as any);
    svc.ensureSystemAutomations('system-workflow-id');
    const a = (svc as any).repo.findBySystemKey(SYSTEM_PERMISSION_AUTOMATION_KEY);
    expect(a).toBeTruthy();
    expect(a.isSystem).toBe(true);
    expect(a.trigger).toEqual({ type: 'event', event: 'permission.escalated' });
    expect(a.action).toEqual(expect.objectContaining({ kind: 'workflow', ref: 'system-workflow-id' }));
    svc.ensureSystemAutomations('system-workflow-id');
    expect((svc as any).repo.findAll().filter((x: any) => x.systemKey === SYSTEM_PERMISSION_AUTOMATION_KEY)).toHaveLength(1);
  });
});
