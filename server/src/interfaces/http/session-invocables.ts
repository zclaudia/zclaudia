import { type Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { InvocableCatalogSnapshot } from '@zclaudia/shared/providers';
import type {
  CatalogSnapshotRequest,
  InvocableCatalogService,
} from '../../application/invocations/catalog-service.js';
import { sessionInvocableCatalogService } from '../../application/invocations/session-catalog.js';

/**
 * Session invocable catalog routes (URIP design doc §15.1).
 *
 * Catalog data is session-scoped and served by the backend that executes the
 * session's runs — never keyed by provider type alone. The legacy
 * provider-type command routes remain read-only compatibility infrastructure
 * during the migration; new desktop code uses these.
 *
 * The catalog service is a process-local, ephemeral cache: snapshots are
 * regenerated after restart and never persisted as business data (§11.4).
 */

export interface InvocablesRouteOptions {
  buildRequest: (
    db: Database.Database,
    sessionId: string
  ) => Promise<CatalogSnapshotRequest | null>;
}

export function mountSessionInvocableRoutes(
  router: Router,
  db: Database.Database,
  options: InvocablesRouteOptions
): void {
  router.get('/:sessionId/invocables', async (req: Request, res: Response) => {
    try {
      const base = await options.buildRequest(db, req.params.sessionId);
      if (!base) {
        res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
        });
        return;
      }
      const snapshot = await sessionInvocableCatalogService.getSnapshot(base);
      const includeUnavailable = req.query.includeUnavailable === 'true';
      res.json({
        success: true,
        data: {
          ...snapshot,
          invocables: includeUnavailable
            ? snapshot.invocables
            : snapshot.invocables.filter(i => i.availability.available),
        },
      } as ApiResponse<InvocableCatalogSnapshot>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INVOCATION_DISCOVERY_FAILED',
          message: error instanceof Error ? error.message : 'Catalog unavailable',
        },
      });
    }
  });

  router.post('/:sessionId/invocables/refresh', async (req: Request, res: Response) => {
    sessionInvocableCatalogService.invalidateSession(req.params.sessionId);
    try {
      const base = await options.buildRequest(db, req.params.sessionId);
      if (!base) {
        res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
        });
        return;
      }
      const snapshot = await sessionInvocableCatalogService.getSnapshot(base);
      res.json({ success: true, data: snapshot } as ApiResponse<InvocableCatalogSnapshot>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INVOCATION_DISCOVERY_FAILED',
          message: error instanceof Error ? error.message : 'Catalog refresh failed',
        },
      });
    }
  });
}

/** Exposed for tests and for the invocation gateway used by run handling. */
export function getInvocableCatalogService(): InvocableCatalogService {
  return sessionInvocableCatalogService;
}
