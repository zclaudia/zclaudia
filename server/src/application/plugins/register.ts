import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { createPluginRoutes } from './routes.js';
import { createPluginToolsRoutes } from './tools-routes.js';
import { pluginLoader } from './loader.js';
import {
  sendMessage,
  bumpPluginsVersion,
} from '../../application/conversation/transport/broadcast.js';
import type { ActiveRun } from '../../application/conversation/transport/types.js';
import { pluginEvents } from '../../infra/events/index.js';
import { permissionManager as pluginPermissionManager } from './permissions.js';
import { isTerminalPhase } from '../conversation/runtime/active-run-phase.js';

type ActiveRunsMap = Map<string, ActiveRun>;

export interface PluginsDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  localOnlyMiddleware: RequestHandler;
  db: Database.Database;
  activeRuns: ActiveRunsMap;
  clients: Map<string, { authenticated: boolean; ws: WebSocket }>;
  broadcastPluginState: () => void;
}

export function registerPluginsDomain(deps: PluginsDomainDeps): void {
  const {
    app,
    authMiddleware,
    localOnlyMiddleware,
    db,
    activeRuns,
    clients,
    broadcastPluginState,
  } = deps;

  app.use('/api/plugins', authMiddleware, createPluginRoutes());
  app.use(
    '/api/plugins',
    localOnlyMiddleware,
    createPluginToolsRoutes({
      getActiveProfile: sessionId => {
        for (const run of activeRuns.values()) {
          if (run.sessionId === sessionId && !isTerminalPhase(run.phase)) {
            return run.effectiveProfile;
          }
        }
        return undefined;
      },
      getSessionType: sessionId => {
        const row = db.prepare('SELECT type FROM sessions WHERE id = ?').get(sessionId) as
          | { type: string }
          | undefined;
        return row?.type;
      },
      resolveActiveSessionId: () => {
        for (const run of activeRuns.values()) {
          if (!isTerminalPhase(run.phase)) {
            return run.sessionId;
          }
        }
        return undefined;
      },
    })
  );

  pluginLoader.setBroadcast(msg => {
    clients.forEach(client => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  });

  pluginEvents.on('plugin.activated', () => {
    bumpPluginsVersion();
    broadcastPluginState();
  });
  pluginEvents.on('plugin.deactivated', () => {
    bumpPluginsVersion();
    broadcastPluginState();
  });
  pluginEvents.on('plugin.error', () => {
    bumpPluginsVersion();
    broadcastPluginState();
  });

  pluginPermissionManager.onRequest(request => {
    const msg: import('@zclaudia/shared/wire/messages').PluginPermissionRequestMessage = {
      type: 'plugin_permission_request',
      pluginId: request.pluginId,
      pluginName: request.pluginName,
      permissions: request.permissions as string[],
    };
    clients.forEach(client => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  });

  // Answered on one device (or cancelled by deactivation) → every other
  // device must retire its dialog too.
  pluginPermissionManager.onResponse(response => {
    const msg: import('@zclaudia/shared/wire/messages').PluginPermissionResolvedMessage = {
      type: 'plugin_permission_resolved',
      pluginId: response.pluginId,
      granted: response.granted,
    };
    clients.forEach(client => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  });
}
