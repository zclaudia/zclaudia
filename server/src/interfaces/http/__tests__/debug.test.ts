import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createDebugRoutes } from '../debug.js';
import type { PermissionWorkflowResolver } from '../../../domains/workflows/permission-workflow-resolver.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      permission_workflow_override_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      definition TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function createTestApp(db: Database.Database, options: Parameters<typeof createDebugRoutes>) {
  const app = express();
  app.use(express.json());
  app.use('/api/debug', createDebugRoutes(...options));
  return app;
}

describe('debug routes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db?.close();
    db = createTestDb();
  });

  it('returns a pending-pi-agent placeholder from simulate-ai-review', async () => {
    const app = createTestApp(db, [undefined, db, undefined]);

    const res = await request(app).post('/api/debug/simulate-ai-review').send({
      toolName: 'Bash',
      detail: 'echo hello',
      cwd: '/workspace',
      mode: 'quick',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        decision: 'uncertain',
        confidence: 0,
        pendingPiAgent: true,
        mode: 'quick',
      },
    });
  });

  it('rejects simulate-ai-review without required fields', async () => {
    const app = createTestApp(db, [undefined, db, undefined]);

    const res = await request(app).post('/api/debug/simulate-ai-review').send({ toolName: 'Bash' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('resolves the effective permission workflow for a project', async () => {
    db.prepare(
      `
      INSERT INTO workflows (id, project_id, name, status, definition, is_system, created_at, updated_at)
      VALUES ('wf-project', NULL, 'Project Workflow', 'active', '{"triggers":[],"nodes":[],"edges":[],"entryNodeId":""}', 0, 1, 1)
    `
    ).run();
    db.prepare(
      `
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('project-1', 'Project', 'code', 'wf-project', 1, 1)
    `
    ).run();
    const permissionWorkflowResolver = {
      resolve: vi.fn(() => ({
        workflowId: 'wf-project',
        source: 'project_override',
        workflow: {
          id: 'wf-project',
          name: 'Project Workflow',
          projectId: null,
          status: 'active',
          isSystem: false,
        },
      })),
    } as unknown as PermissionWorkflowResolver;
    const app = createTestApp(db, [undefined, db, permissionWorkflowResolver]);

    const res = await request(app)
      .post('/api/debug/resolve-permission-workflow')
      .send({ projectId: 'project-1' });

    expect(res.status).toBe(200);
    expect(permissionWorkflowResolver.resolve).toHaveBeenCalledWith('project-1');
    expect(res.body.data).toMatchObject({
      projectId: 'project-1',
      source: 'project_override',
      workflowId: 'wf-project',
      fallbackReason: null,
      workflow: {
        id: 'wf-project',
        name: 'Project Workflow',
        status: 'active',
        isSystem: false,
      },
    });
  });
});
