/**
 * Language-server status and the master switch.
 *
 * - GET  /api/language-servers                     every server instance (Settings)
 * - PUT  /api/language-servers  { enabled }         the master switch, persisted
 * - GET  /api/language-servers/sessions/:sessionId  what one session's agent can use
 *                                                   (composer indicator)
 * - GET  /api/language-servers/custom               the user's own server definitions
 * - PUT  /api/language-servers/custom  { servers }  replace them, persisted
 */
import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import { isPiAgentRuntime } from '@zclaudia/shared/core/agent-profile';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import {
  validateLanguageServerConfigs,
  type CustomLanguageServers,
  type LanguageServerConfig,
  type LanguageServerStatusEntry,
  type LanguageServersOverview,
  type SessionLanguageServers,
} from '@zclaudia/shared/core/language-servers';
import {
  createConfiguredPreset,
  languageServerRegistry,
  type LanguageServerManager,
  type LanguageServerRegistry,
  type LanguageServerStatus,
} from '../../infra/lsp/index.js';

export const LANGUAGE_SERVERS_ENABLED_KEY = 'language_servers_enabled';
export const CUSTOM_LANGUAGE_SERVERS_KEY = 'language_servers_custom';

/** The user's saved definitions; invalid or unreadable storage yields none. */
export function readCustomLanguageServers(db: Database): LanguageServerConfig[] {
  try {
    const row = db
      .prepare('SELECT value FROM app_config WHERE key = ?')
      .get(CUSTOM_LANGUAGE_SERVERS_KEY) as { value: string } | undefined;
    if (!row) return [];
    const result = validateLanguageServerConfigs(JSON.parse(row.value));
    return result.ok ? result.configs : [];
  } catch {
    return [];
  }
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
