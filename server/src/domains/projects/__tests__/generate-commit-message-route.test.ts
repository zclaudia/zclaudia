import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createGitRoutes } from '../git-routes.js';
import { ActivityRegistry } from '../../activities/index.js';
import type { Activity } from '../../activities/index.js';

// Stub the worktree service so resolveWorktreeForGitOp returns a fixed path.
vi.mock('../worktree-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../worktree-service.js')>();
  return {
    ...actual,
    ProjectWorktreeService: class {
      resolveWorktreeForGitOp() {
        return { worktreePath: '/repo' };
      }
    },
  };
});

function appWith(registry?: ActivityRegistry) {
  const app = express();
  app.use(express.json());
  const runner = { run: async () => ({ status: 'completed' as const, output: {} }) };
  app.use('/api/projects', createGitRoutes({} as never, { activityRegistry: registry, agentLoopRunner: runner }));
  return app;
}

function registryWith(activity: Activity): ActivityRegistry {
  const r = new ActivityRegistry();
  r.register(activity);
  return r;
}

describe('POST /:id/git/generate-commit-message', () => {
  it('returns the generated message on success', async () => {
    const registry = registryWith({
      type: 'generate_commit_message',
      invoke: async () => ({ status: 'completed', output: { subject: 'feat: x', message: 'feat: x' } }),
    } as Activity);
    const res = await request(appWith(registry))
      .post('/api/projects/p1/git/generate-commit-message')
      .send({ worktree: '/repo' });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('feat: x');
  });

  it('returns 400 when there are no staged changes', async () => {
    const registry = registryWith({
      type: 'generate_commit_message',
      invoke: async () => ({ status: 'failed', output: {}, error: 'No staged changes' }),
    } as Activity);
    const res = await request(appWith(registry))
      .post('/api/projects/p1/git/generate-commit-message')
      .send({ worktree: '/repo' });
    expect(res.status).toBe(400);
  });

  it('returns 502 when generation fails for another reason', async () => {
    const registry = registryWith({
      type: 'generate_commit_message',
      invoke: async () => ({ status: 'failed', output: {}, error: 'model timeout' }),
    } as Activity);
    const res = await request(appWith(registry))
      .post('/api/projects/p1/git/generate-commit-message')
      .send({ worktree: '/repo' });
    expect(res.status).toBe(502);
  });

  it('returns 503 when the registry is not wired', async () => {
    const res = await request(appWith(undefined))
      .post('/api/projects/p1/git/generate-commit-message')
      .send({ worktree: '/repo' });
    expect(res.status).toBe(503);
  });
});
