import type { Express, RequestHandler } from 'express';
import type { initDatabase } from '../../infra/storage/db.js';
import { createProjectRoutes, type ProjectChangeEvent } from './routes.js';
import type { ActivityRegistry } from '../activities/index.js';
import type { AgentLoopRunnerPort } from '../agent-loop/index.js';

export interface ProjectsDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  onProjectChanged?: (event?: ProjectChangeEvent) => void;
  activityRegistry?: ActivityRegistry;
  agentLoopRunner?: AgentLoopRunnerPort;
}

export function registerProjectsDomain(deps: ProjectsDomainDeps): void {
  const { db, app, authMiddleware, onProjectChanged, activityRegistry, agentLoopRunner } = deps;
  app.use(
    '/api/projects',
    authMiddleware,
    createProjectRoutes(db, onProjectChanged, { activityRegistry, agentLoopRunner }),
  );
}
