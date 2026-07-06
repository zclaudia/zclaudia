import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerRuntimeRoutes } from '../../../infra/providers/runtime-routes.js';

const { scanCustomCommandsMock, getCommandsBySourceMock } = vi.hoisted(() => ({
  scanCustomCommandsMock: vi.fn(),
  getCommandsBySourceMock: vi.fn(() => []),
}));

vi.mock('../../../utils/command-scanner.js', () => ({
  scanCustomCommands: scanCustomCommandsMock,
}));

vi.mock('../../../application/commands/registry.js', () => ({
  commandRegistry: {
    getCommandsBySource: getCommandsBySourceMock,
  },
}));

function makeApp() {
  const app = express();
  const db = {
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ id: 'llm-1' })),
    })),
  };
  registerRuntimeRoutes({
    app,
    authMiddleware: (_req, _res, next) => next(),
    db: db as never,
  });
  return app;
}

describe('provider command routes', () => {
  it('returns scanner-backed user, project, and plugin commands for Claude runtime', async () => {
    scanCustomCommandsMock.mockResolvedValueOnce([
      {
        command: '/user-plan',
        description: 'User command',
        source: 'custom',
        scope: 'global',
        filePath: '/home/user/.claude/commands/user-plan.md',
      },
      {
        command: '/project-build',
        description: 'Project command',
        source: 'custom',
        scope: 'project',
        filePath: '/repo/.claude/commands/project-build.md',
      },
      {
        command: '/reviewer:review',
        description: 'Plugin command',
        source: 'plugin',
        scope: 'global',
        filePath: '/plugin/commands/review.md',
      },
    ]);
    getCommandsBySourceMock.mockReturnValueOnce([
      {
        command: '/plugin-panel',
        description: 'Registered plugin command',
        source: 'plugin',
      },
    ]);

    const app = makeApp();
    const res = await request(app)
      .get('/api/providers/type/claude/commands')
      .query({ projectRoot: '/repo' });

    expect(res.status).toBe(200);
    expect(scanCustomCommandsMock).toHaveBeenCalledWith(expect.any(Object), {
      projectRoot: '/repo',
    });
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: '/user-plan', source: 'custom', scope: 'global' }),
        expect.objectContaining({ command: '/project-build', source: 'custom', scope: 'project' }),
        expect.objectContaining({ command: '/reviewer:review', source: 'plugin' }),
        expect.objectContaining({ command: '/plugin-panel', source: 'plugin' }),
      ])
    );
  });

  it('rejects unknown runtime types for command metadata', async () => {
    const app = makeApp();

    const res = await request(app).get('/api/providers/type/codex/commands');

    expect(res.status).toBe(404);
  });
});
