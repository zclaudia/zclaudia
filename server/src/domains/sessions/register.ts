import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { Router } from 'express';
import { createSessionRoutes } from './routes.js';
import { createSessionDraftRoutes } from './drafts-routes.js';
import { mountSessionInvocableRoutes } from '../../interfaces/http/session-invocables.js';
import { buildSessionCatalogRequest } from '../../application/invocations/session-catalog.js';
import { providerRegistry } from '../../infra/providers/registry.js';
import type { SessionEventPublisherPort } from './session-event-port.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sessions domain treats this as opaque; concrete type lives in application/conversation
type ActiveRunsMap = Map<string, any>;

export interface SessionsDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
  activeRuns: ActiveRunsMap;
  sessionEvents?: SessionEventPublisherPort;
}

export function registerSessionsDomain(deps: SessionsDomainDeps): void {
  const { app, authMiddleware, db, activeRuns, sessionEvents } = deps;

  app.use('/api/sessions', authMiddleware, createSessionRoutes(db, activeRuns, sessionEvents));
  app.use('/api/sessions', authMiddleware, createSessionDraftRoutes(db));
  // URIP session invocable catalog (§15.1): host actions + runtime + portable
  // entries composed per session. Snapshot building wires to the live session
  // context as runtime adapters publish catalogs; the routes exist now so the
  // desktop consumes session-scoped catalogs, never provider-type ones.
  const invocablesRouter = Router();
  mountSessionInvocableRoutes(invocablesRouter, db, {
    buildRequest: (database, sessionId) =>
      buildSessionCatalogRequest(database, sessionId, providerRegistry),
  });
  app.use('/api/sessions', authMiddleware, invocablesRouter);
}
