/**
 * Language-server status and the master switch.
 *
 * - GET  /api/language-servers                     every server instance (Settings)
 * - PUT  /api/language-servers  { enabled }         the master switch, persisted
 * - GET  /api/language-servers/sessions/:sessionId  what one session's agent can use
 *                                                   (composer indicator)
 * - GET  /api/language-servers/custom               the user's own server definitions
 * - PUT  /api/language-servers/custom  { servers }  replace them, persisted
 * - GET  /api/language-servers/file-diagnostics?root=&path=
 *                                                   a file's diagnostics, from a running server only
 * - POST   /api/language-servers/viewer-leases { root }  keep a workspace's servers running
 * - POST   /api/language-servers/viewer-leases/:id/renew
 * - DELETE /api/language-servers/viewer-leases/:id
 *
 * The file-viewer routes take a workspace root from the client. Starting a
 * server runs code from that workspace (TypeScript uses the project's own
 * `typescript`), so only roots of known projects or session worktrees are
 * accepted.
 */
import { randomUUID } from 'crypto';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import { isPiAgentRuntime } from '@zclaudia/shared/core/agent-profile';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import {
  validateLanguageServerConfig,
  validateLanguageServerConfigs,
  type CustomLanguageServers,
  type FileLanguageServerDiagnostics,
  type LanguageServerViewerLease,
  type LanguageServerConfig,
  type LanguageServerStatusEntry,
  type LanguageServersOverview,
  type SessionLanguageServers,
} from '@zclaudia/shared/core/language-servers';
import {
  createConfiguredPreset,
  languageServerRegistry,
  type FileDiagnostics,
  type LanguageServerManager,
  type LanguageServerRegistry,
  type LanguageServerStatus,
} from '../../infra/lsp/index.js';

export const LANGUAGE_SERVERS_ENABLED_KEY = 'language_servers_enabled';
export const CUSTOM_LANGUAGE_SERVERS_KEY = 'language_servers_custom';
/** A viewer lease lapses unless renewed within this (a closed or crashed client). */
export const VIEWER_LEASE_TTL_MS = 90_000;

/** Whether `root` is a known project root or session worktree. */
function isKnownWorkspaceRoot(db: Database, root: string): boolean {
  const candidates = [...new Set([root, path.resolve(root)])];
  const placeholders = candidates.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT 1 FROM projects WHERE root_path IN (${placeholders})
       UNION SELECT 1 FROM sessions WHERE working_directory IN (${placeholders})
       LIMIT 1`
    )
    .get(...candidates, ...candidates);
  return Boolean(row);
}

function rejectUnknownRoot(res: Response): void {
  res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Not a project or session workspace' },
  });
}

/**
 * The user's saved definitions. One invalid entry is dropped with a log —
 * all-or-nothing here would let a single bad record (a schema drift after an
 * upgrade, a hand-edited config) silently disable every user server for the
 * process. Saving through the API still validates strictly, so the UI is
 * where bad input gets fixed.
 */
export function readCustomLanguageServers(db: Database): LanguageServerConfig[] {
  let parsed: unknown;
  try {
    const row = db
      .prepare('SELECT value FROM app_config WHERE key = ?')
      .get(CUSTOM_LANGUAGE_SERVERS_KEY) as { value: string } | undefined;
    if (!row) return [];
    parsed = JSON.parse(row.value);
  } catch (err) {
    console.error('[language-servers] cannot read custom language servers:', err);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const configs: LanguageServerConfig[] = [];
  const seen = new Set<string>();
  parsed.forEach((entry, index) => {
    const result = validateLanguageServerConfig(entry);
    if (!result.ok) {
      console.error(
        `[language-servers] dropping invalid custom server ${index}:`,
        result.errors.join('; ')
      );
      return;
    }
    if (seen.has(result.config.id)) {
      console.error(`[language-servers] dropping duplicate custom server id "${result.config.id}"`);
      return;
    }
    seen.add(result.config.id);
    configs.push(result.config);
  });
  return configs;
}

/** Make the user's definitions the registry's `user` source. */
export function applyCustomLanguageServers(
  registry: LanguageServerRegistry,
  configs: LanguageServerConfig[]
): void {
  registry.setUserPresets(configs.map(config => createConfiguredPreset(config)));
}

/** The persisted master switch; on unless explicitly turned off. */
export function readLanguageServersEnabled(db: Database): boolean {
  try {
    const row = db
      .prepare('SELECT value FROM app_config WHERE key = ?')
      .get(LANGUAGE_SERVERS_ENABLED_KEY) as { value: string } | undefined;
    return row?.value !== 'false';
  } catch {
    return true;
  }
}

function toEntry(status: LanguageServerStatus): LanguageServerStatusEntry {
  return {
    id: status.id,
    name: status.name,
    languages: status.languages,
    root: status.root,
    state: status.state,
    leases: status.leases.length,
    openDocuments: status.openDocuments,
    pid: status.pid,
    startedAt: status.startedAt,
    lastUsedAt: status.lastUsedAt,
    lastError: status.lastError,
    installHint: status.installHint,
    source: status.source,
    pluginId: status.pluginId,
  };
}

interface SessionRow {
  working_directory: string | null;
  root_path: string | null;
  runtime_type: string | null;
}

export function createLanguageServerRoutes(
  db: Database,
  getManager: () => LanguageServerManager | undefined,
  registry: LanguageServerRegistry = languageServerRegistry
): Router {
  const router = Router();

  // Running instances, plus servers a known project needs but lacks.
  const overview = (manager: LanguageServerManager): LanguageServersOverview => {
    const roots = (
      db
        .prepare('SELECT DISTINCT root_path FROM projects WHERE root_path IS NOT NULL')
        .all() as Array<{
        root_path: string;
      }>
    ).map(row => row.root_path);
    return {
      enabled: manager.isEnabled,
      servers: [...manager.status(), ...roots.flatMap(root => manager.unavailableFor(root))].map(
        toEntry
      ),
    };
  };

  // `?refresh=1` re-probes now (Settings opening, after the user installed something).
  const maybeRedetect = (req: Request, manager: LanguageServerManager | undefined) => {
    if (manager && req.query.refresh === '1') manager.redetect();
  };

  router.get('/', (req: Request, res: Response) => {
    const manager = getManager();
    maybeRedetect(req, manager);
    const data: LanguageServersOverview = manager
      ? overview(manager)
      : { enabled: false, servers: [] };
    res.json({ success: true, data } satisfies ApiResponse<LanguageServersOverview>);
  });

  router.put('/', async (req: Request, res: Response) => {
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    const manager = getManager();
    if (typeof enabled !== 'boolean' || !manager) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'enabled must be a boolean' },
      });
      return;
    }
    db.prepare(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(LANGUAGE_SERVERS_ENABLED_KEY, String(enabled));
    await manager.setEnabled(enabled);
    res.json({
      success: true,
      data: overview(manager),
    } satisfies ApiResponse<LanguageServersOverview>);
  });

  router.get('/sessions/:sessionId', (req: Request, res: Response) => {
    const row = db
      .prepare(
        `SELECT s.working_directory, p.root_path, a.runtime_type
           FROM sessions s
           LEFT JOIN projects p ON p.id = s.project_id
           LEFT JOIN agent_profiles a ON a.id = s.agent_profile_id
          WHERE s.id = ?`
      )
      .get(req.params.sessionId) as SessionRow | undefined;
    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
      return;
    }
    // A session without its own agent profile runs the default one.
    const runtimeType =
      row.runtime_type ??
      (
        db.prepare('SELECT runtime_type FROM agent_profiles WHERE is_default = 1 LIMIT 1').get() as
          | { runtime_type: string | null }
          | undefined
      )?.runtime_type ??
      null;
    const manager = getManager();
    maybeRedetect(req, manager);
    // Same precedence a run uses for its cwd (run-bootstrap).
    const root = row.working_directory || row.root_path || null;
    // Only the ZClaudia (Pi) runtime uses these servers; external CLIs bring their own.
    const applicable = Boolean(manager && root && isPiAgentRuntime(runtimeType));
    const data: SessionLanguageServers = {
      applicable,
      enabled: manager?.isEnabled ?? false,
      root,
      servers: applicable && manager && root ? manager.statusFor(root).map(toEntry) : [],
    };
    res.json({ success: true, data } satisfies ApiResponse<SessionLanguageServers>);
  });

  router.get('/file-diagnostics', async (req: Request, res: Response) => {
    const root = typeof req.query.root === 'string' ? req.query.root : '';
    const file = typeof req.query.path === 'string' ? req.query.path : '';
    if (!root || !file) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'root and path are required' },
      });
      return;
    }
    if (!isKnownWorkspaceRoot(db, root)) return rejectUnknownRoot(res);
    const manager = getManager();
    const result: FileDiagnostics = manager
      ? await manager.fileDiagnostics(root, file)
      : { state: 'unavailable' };
    const data: FileLanguageServerDiagnostics = {
      state: result.state,
      server: result.server ? { id: result.server.id, name: result.server.name } : null,
      diagnostics:
        result.state === 'ready'
          ? result.diagnostics.map(diagnostic => ({
              line: diagnostic.line,
              character: diagnostic.character,
              severity: diagnostic.severity,
              message: diagnostic.message,
              ...(diagnostic.source ? { source: diagnostic.source } : {}),
              ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
            }))
          : [],
    };
    res.json({ success: true, data } satisfies ApiResponse<FileLanguageServerDiagnostics>);
  });

  const viewerLeases = new Map<
    string,
    { release: () => void; timer: ReturnType<typeof setTimeout> }
  >();
  const endLease = (leaseId: string) => {
    const lease = viewerLeases.get(leaseId);
    if (!lease) return false;
    clearTimeout(lease.timer);
    lease.release();
    viewerLeases.delete(leaseId);
    return true;
  };
  const armLease = (leaseId: string) => {
    const timer = setTimeout(() => endLease(leaseId), VIEWER_LEASE_TTL_MS);
    timer.unref?.();
    return timer;
  };

  router.post('/viewer-leases', (req: Request, res: Response) => {
    const root = (req.body as { root?: unknown } | undefined)?.root;
    const manager = getManager();
    if (typeof root !== 'string' || !root || !manager) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'root is required' },
      });
      return;
    }
    if (!isKnownWorkspaceRoot(db, root)) return rejectUnknownRoot(res);
    const leaseId = randomUUID();
    const { release } = manager.acquire(root, 'file viewer');
    viewerLeases.set(leaseId, { release, timer: armLease(leaseId) });
    const data: LanguageServerViewerLease = { leaseId, ttlMs: VIEWER_LEASE_TTL_MS };
    res.json({ success: true, data } satisfies ApiResponse<LanguageServerViewerLease>);
  });

  router.post('/viewer-leases/:leaseId/renew', (req: Request, res: Response) => {
    const lease = viewerLeases.get(req.params.leaseId);
    if (!lease) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lease expired or unknown' },
      });
      return;
    }
    clearTimeout(lease.timer);
    lease.timer = armLease(req.params.leaseId);
    const data: LanguageServerViewerLease = {
      leaseId: req.params.leaseId,
      ttlMs: VIEWER_LEASE_TTL_MS,
    };
    res.json({ success: true, data } satisfies ApiResponse<LanguageServerViewerLease>);
  });

  router.delete('/viewer-leases/:leaseId', (req: Request, res: Response) => {
    res.json({ success: true, data: { released: endLease(req.params.leaseId) } });
  });

  router.get('/custom', (_req: Request, res: Response) => {
    const data: CustomLanguageServers = { servers: readCustomLanguageServers(db) };
    res.json({ success: true, data } satisfies ApiResponse<CustomLanguageServers>);
  });

  router.put('/custom', (req: Request, res: Response) => {
    const result = validateLanguageServerConfigs(
      (req.body as { servers?: unknown } | undefined)?.servers
    );
    if (!result.ok) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: result.errors.join('; ') },
      });
      return;
    }
    db.prepare(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(CUSTOM_LANGUAGE_SERVERS_KEY, JSON.stringify(result.configs));
    applyCustomLanguageServers(registry, result.configs);
    const data: CustomLanguageServers = { servers: result.configs };
    res.json({ success: true, data } satisfies ApiResponse<CustomLanguageServers>);
  });

  return router;
}
