import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { WorkflowEngine } from '../engine.js';
import { CompositeStepExecutor } from '../step-executors/composite-executor.js';
import { ShellStepExecutor } from '../step-executors/index.js';
import type { WorkflowDefinition } from '@zclaudia/shared/features/workflows';

describe('WorkflowEngine.startRun (action runs)', () => {
  let db: Database.Database;
  let engine: WorkflowEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    const composite = new CompositeStepExecutor();
    composite.register(new ShellStepExecutor());
    engine = new WorkflowEngine(db, () => {}, composite);
  });

  it('starts an activity run (no workflowId) and records action metadata', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        {
          id: 'n1',
          name: 'Echo',
          type: 'shell',
          config: { command: 'echo hi' },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      entryNodeId: 'n1',
    };
    const run = await engine.startRun({
      workflowId: undefined,
      projectId: undefined,
      definition: def,
      triggerSource: 'schedule',
      initiator: 'automation:a1',
      actionKind: 'activity',
      actionRef: 'shell',
      trackingKey: 'automation:a1',
    });
    expect(run.workflowId).toBeUndefined();
    expect(run.initiator).toBe('automation:a1');
    expect(engine.isRunningKey('automation:a1')).toBe(true);
  });
});
