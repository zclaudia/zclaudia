import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { createClaudiaRoutes } from '../claudia.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';

describe('claudia routes', () => {
  it('lists canonical Claudia tasks without requiring orchestrator_tasks rows', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const taskService = new TaskService(new TaskRepository(db));
    const task = taskService.createTask({
      type: 'agent',
      status: 'queued',
      title: 'Investigate auth',
      description: 'Investigate auth flow',
      sessionId: 'session-1',
      metadata: {
        initiator: 'claudia',
        projectId: 'project-1',
        branchId: 'branch-1',
        branchAction: 'reused',
        contextReset: false,
        input: 'Investigate auth flow',
      },
    });
    taskService.startTask(task.id, {
      executorRef: { providerType: 'zclaudia-agent-runner', taskId: task.id },
      sessionId: 'session-1',
    });
    taskService.completeTask(task.id, { text: 'Auth summary' });

    const app = express();
    app.use('/api/claudia', createClaudiaRoutes(db));

    const res = await request(app).get('/api/claudia/tasks?projectId=project-1');

    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toEqual([
      expect.objectContaining({
        id: task.id,
        sessionId: 'session-1',
        branchId: 'branch-1',
        branchAction: 'reused',
        input: 'Investigate auth flow',
        title: 'Investigate auth',
        status: 'completed',
        responseText: 'Auth summary',
      }),
    ]);
    db.close();
  });
});
