import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createSessionRoutes, type SessionTitleGenerationRequester } from './routes.js';
import type { ManagedRuntimeResolverPort } from './model-settings-service.js';
import { createSessionDraftRoutes } from './drafts-routes.js';
import type { SessionEventPublisherPort } from './session-event-port.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sessions domain treats this as opaque; concrete type lives in application/conversation
type ActiveRunsMap = Map<string, any>;

export interface SessionsDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
  activeRuns: ActiveRunsMap;
  sessionEvents?: SessionEventPublisherPort;
  /** Fire-and-forget title generation (application title service), injected
   *  by the composition root so the domain stays layer-clean. */
  requestTitleGeneration?: SessionTitleGenerationRequester;
  /** Managed-runtime resolver (application managed-runtime service), injected
   *  by the composition root so the domain stays layer-clean. */
  managedRuntimes?: ManagedRuntimeResolverPort;
}

export function registerSessionsDomain(deps: SessionsDomainDeps): void {
  const { app, authMiddleware, db, activeRuns, sessionEvents } = deps;

  app.use(
    '/api/sessions',
    authMiddleware,
    createSessionRoutes(
      db,
      activeRuns,
      sessionEvents,
      deps.requestTitleGeneration,
      deps.managedRuntimes
    )
  );
  app.use('/api/sessions', authMiddleware, createSessionDraftRoutes(db));
  // NOTE: the URIP session invocable catalog routes (§15.1) are mounted by the
  // composition root (feature-domains.ts) right after this call — they depend
  // on the interfaces/application layers and must not be imported from here.
}
