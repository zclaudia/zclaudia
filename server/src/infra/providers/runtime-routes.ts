import { Router, Request, Response } from 'express';
import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { mountCapabilityRoutes } from '../../interfaces/http/provider-capabilities.js';
import { mountCommandRoutes } from '../../interfaces/http/provider-commands.js';
import { createDeferredDiagnosticsRoutes } from './pi-runtime/deferred-diagnostics-routes.js';
import { createFileHistoryRoutes } from './pi-runtime/file-history-routes.js';

/**
 * Runtime adapter capability / command routes — describe what the runtime
 * shell supports (modes / models / slash commands) regardless of which LLM
 * connection profile is currently selected. Kept under `/api/providers/...`
 * to preserve existing desktop consumers; the truly LLM-profile-specific
 * routes live in `/api/llm-profiles` (see `domains/llm-profiles`).
 */
export interface RuntimeRoutesDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
  toolRegistry?: { getDefinitionsBySource(source: string): unknown[] };
}

export function registerRuntimeRoutes(deps: RuntimeRoutesDeps): void {
  const { app, authMiddleware, db, toolRegistry } = deps;

  const router = Router();

  mountCapabilityRoutes(router, db);
  mountCommandRoutes(router, db);
  router.use(createDeferredDiagnosticsRoutes());
  router.use(createFileHistoryRoutes());

  router.get('/plugin-tools', (_req: Request, res: Response) => {
    try {
      const pluginTools = toolRegistry?.getDefinitionsBySource('plugin') ?? [];
      res.json({ success: true, data: pluginTools });
    } catch (error) {
      console.error('Error fetching plugin tools:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch plugin tools' },
      });
    }
  });

  app.use('/api/providers', authMiddleware, router);
}
