import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createLlmProfileRoutes } from './routes.js';

export interface LlmProfilesDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
}

export function registerLlmProfilesDomain(deps: LlmProfilesDomainDeps): void {
  const { app, authMiddleware, db } = deps;

  app.use('/api/llm-profiles', authMiddleware, createLlmProfileRoutes(db));
}
