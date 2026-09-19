import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import type { AgentRuntimeContribution } from '@zclaudia/shared/providers';
import { createAgentProfileRoutes } from './routes.js';
import { createRuntimeDescriptorRoutes } from './runtime-descriptors-routes.js';

export interface AgentProfilesDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
  /** Agent runtime descriptors contributed by built-in plugins (see
   *  runtime-descriptors-routes.ts; supplied by the composition root). */
  builtinRuntimeContributions?: () => AgentRuntimeContribution[];
}

export function registerAgentProfilesDomain(deps: AgentProfilesDomainDeps): void {
  const { app, authMiddleware, db, builtinRuntimeContributions } = deps;
  app.use('/api/agent-profiles', authMiddleware, createAgentProfileRoutes(db));
  app.use(
    '/api/agent-runtimes',
    authMiddleware,
    createRuntimeDescriptorRoutes({ builtinRuntimeContributions })
  );
  // NOTE: /api/managed-runtimes routes are mounted by the composition root
  // (feature-domains.ts) right after this call — they live in the application
  // layer and must not be imported from here.
}
