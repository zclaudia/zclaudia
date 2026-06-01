import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createAgentProfileRoutes } from './routes.js';

export interface AgentProfilesDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
}

export function registerAgentProfilesDomain(deps: AgentProfilesDomainDeps): void {
  const { app, authMiddleware, db } = deps;
  app.use('/api/agent-profiles', authMiddleware, createAgentProfileRoutes(db));
}
