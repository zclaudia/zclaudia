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

  it('lists discussion threads with their bound session and run status', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.exec(`
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES ('project-1', 'Project One', 1, 1);
      INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at)
      VALUES ('llm-1', 'LLM One', 'anthropic', 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
      VALUES ('agent-1', 'Dev Agent', 'llm-1', 1, 1);
      INSERT INTO sessions (id, project_id, agent_profile_id, name, last_run_status, created_at, updated_at)
      VALUES ('session-1', 'project-1', 'agent-1', 'Claudia: fix login', 'interrupted', 1, 2);
      INSERT INTO claudia_branches (id, host_project_id, active_session_id, title, created_at, updated_at)
      VALUES ('branch-1', 'project-1', 'session-1', 'Fix login expiry', 1, 3);
      INSERT INTO claudia_branches (id, host_project_id, active_session_id, title, created_at, updated_at)
      VALUES ('branch-2', 'project-1', NULL, 'New topic', 2, 4);
    `);

    const app = express();
    app.use('/api/claudia', createClaudiaRoutes(db));

    const res = await request(app).get('/api/claudia/threads?projectId=project-1');
    expect(res.status).toBe(200);
    expect(res.body.data.threads).toEqual([
      expect.objectContaining({
        id: 'branch-2',
        projectId: 'project-1',
        title: 'New topic',
        session: null,
      }),
      expect.objectContaining({
        id: 'branch-1',
        projectId: 'project-1',
        title: 'Fix login expiry',
        session: expect.objectContaining({
          id: 'session-1',
          agentProfileId: 'agent-1',
          lastRunStatus: 'interrupted',
        }),
      }),
    ]);

    const detail = await request(app).get('/api/claudia/threads/branch-1');
    expect(detail.status).toBe(200);
    expect(detail.body.data.thread).toEqual(
      expect.objectContaining({
        id: 'branch-1',
        session: expect.objectContaining({ id: 'session-1', lastRunStatus: 'interrupted' }),
      })
    );

    const missing = await request(app).get('/api/claudia/threads/branch-nope');
    expect(missing.status).toBe(404);

    const noProject = await request(app).get('/api/claudia/threads');
    expect(noProject.status).toBe(400);
    db.close();
  });
});
