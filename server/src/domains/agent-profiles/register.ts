import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createAgentProfileRoutes } from './routes.js';
import { createRuntimeDescriptorRoutes } from './runtime-descriptors-routes.js';
import { createManagedRuntimeRoutes } from '../../application/managed-runtimes/routes.js';

export interface AgentProfilesDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  localOnlyMiddleware: RequestHandler;
  db: Database.Database;
}

export function registerAgentProfilesDomain(deps: AgentProfilesDomainDeps): void {
  const { app, authMiddleware, localOnlyMiddleware, db } = deps;
  app.use('/api/agent-profiles', authMiddleware, createAgentProfileRoutes(db));
  app.use('/api/agent-runtimes', authMiddleware, createRuntimeDescriptorRoutes());
  app.use('/api/managed-runtimes', authMiddleware, createManagedRuntimeRoutes(localOnlyMiddleware));
}
