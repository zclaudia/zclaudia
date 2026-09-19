import { Router, type Request, type Response } from 'express';
import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { isPiAgentRuntime } from '@zclaudia/shared/core/agent-profile';
import { mountCapabilityRoutes } from '../../interfaces/http/provider-capabilities.js';
import { mountCommandRoutes } from '../../interfaces/http/provider-commands.js';
import { createDeferredDiagnosticsRoutes } from './pi-runtime/deferred-diagnostics-routes.js';
import { createFileHistoryRoutes } from './pi-runtime/file-history-routes.js';
import { createContextUsageRoutes } from './context-usage-routes.js';

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
  router.use(
    createContextUsageRoutes({
      // Only the built-in Pi runtime captures context snapshots; resolve the
      // session's agent profile so the client can tell "no run yet" apart from
      // "this runtime never reports a breakdown".
      supportsContextBreakdown: sessionId => {
        const row = db
          .prepare(
            `SELECT ap.runtime_type AS runtimeType
             FROM sessions s
             LEFT JOIN agent_profiles ap ON ap.id = s.agent_profile_id
             WHERE s.id = ?`
          )
          .get(sessionId) as { runtimeType?: string | null } | undefined;
        // Unknown session or missing profile: keep the generic "no data yet" copy.
        if (!row || row.runtimeType == null) return true;
        return isPiAgentRuntime(row.runtimeType);
      },
    })
  );

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
