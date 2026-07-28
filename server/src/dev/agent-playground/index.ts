import { watch, type FSWatcher } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  AgentPlaygroundPermissionDecisionRequest,
  AgentPlaygroundRunRequest,
  AgentPlaygroundServerMessage,
  AgentPlaygroundStatus,
} from '@zclaudia/shared/plugins/agent-playground';
import { parseAgentPlaygroundArgs } from './args.js';
import { PlaygroundPluginHost } from './plugin-host.js';
import { PlaygroundRunController } from './run-controller.js';

const APP_VERSION = process.env.npm_package_version ?? 'dev';
const args = parseAgentPlaygroundArgs(process.argv.slice(2));
const app = express();
const server = http.createServer(app);
const sockets = new Set<WebSocket>();
const history: AgentPlaygroundServerMessage[] = [];
let messageSequence = 0;
let reloadTimer: NodeJS.Timeout | null = null;
let pluginWatcher: FSWatcher | null = null;
let reloading: Promise<void> | null = null;
let queuedReloadReason: string | null = null;

function rememberAndBroadcast(message: AgentPlaygroundServerMessage): void {
  const sequenced = { ...message, sequence: ++messageSequence };
  history.push(sequenced);
  if (history.length > 200) history.shift();
  const serialized = JSON.stringify(sequenced);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
  }
}

function sendToSocket(socket: WebSocket, message: AgentPlaygroundServerMessage): void {
  socket.send(JSON.stringify({ ...message, sequence: ++messageSequence }));
}

const host = new PlaygroundPluginHost({
  pluginPath: args.pluginPath,
  runtime: args.runtime,
  appVersion: APP_VERSION,
  emitLog: (level, message) => {
    const logMessage: AgentPlaygroundServerMessage = {
      type: 'plugin_log',
      level,
      message,
      timestamp: Date.now(),
    };
    rememberAndBroadcast(logMessage);
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(`[AgentPlayground:${level}] ${message}`);
  },
});

const controller = new PlaygroundRunController({
  getAdapter: () => host.runtimeAdapter,
  broadcast: rememberAndBroadcast,
});

function status(): AgentPlaygroundStatus {
  return {
    ready: true,
    plugin: host.pluginInfo,
    runtime: host.runtime,
    defaultCwd: args.defaultCwd,
    activeRunIds: controller.activeRunIds,
    toolBridgeAvailable: false,
  };
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
    );
  } catch {
    return false;
  }
}

function requireToken(req: Request, res: Response, next: NextFunction): void {
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const token = req.header('x-agent-playground-token') ?? bearer;
  if (token !== args.token) {
    res.status(401).json({ error: 'Invalid Agent Playground token' });
    return;
  }
  next();
}

function errorResponse(res: Response, error: unknown): void {
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

async function reloadPlugin(reason: string): Promise<void> {
  queuedReloadReason = reason;
  if (reloading) return reloading;
  reloading = (async () => {
    while (queuedReloadReason) {
      const currentReason = queuedReloadReason;
      queuedReloadReason = null;
      rememberAndBroadcast({
        type: 'plugin_log',
        level: 'info',
        message: `Reloading plugin (${currentReason})`,
        timestamp: Date.now(),
      });
      await controller.abortAll();
      await host.reload();
      rememberAndBroadcast({ type: 'plugin_reloaded', status: status(), timestamp: Date.now() });
    }
  })().finally(() => {
    reloading = null;
  });
  return reloading;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (isLoopbackOrigin(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Agent-Playground-Token'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.status(isLoopbackOrigin(origin) ? 204 : 403).end();
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', requireToken);

app.get('/api/status', (_req, res) => {
  res.json(status());
});

app.post('/api/runs', (req, res) => {
  try {
    res.status(202).json(controller.start(req.body as AgentPlaygroundRunRequest));
  } catch (error) {
    errorResponse(res, error);
  }
});

app.post('/api/runs/:runId/abort', async (req, res) => {
  const aborted = await controller.abort(req.params.runId);
  res.status(aborted ? 200 : 404).json({ aborted });
});

app.post('/api/permissions/:requestId', (req, res) => {
  const body = req.body as Partial<AgentPlaygroundPermissionDecisionRequest>;
  if (body.behavior !== 'allow' && body.behavior !== 'deny') {
    errorResponse(res, new Error('Permission behavior must be allow or deny'));
    return;
  }
  const resolved = controller.resolvePermission({
    requestId: req.params.requestId,
    behavior: body.behavior,
    updatedInput: body.updatedInput,
    message: body.message,
  });
  res.status(resolved ? 200 : 404).json({ resolved });
});

app.post('/api/sessions/:sessionId/mode', (req, res) => {
  const mode = typeof req.body?.mode === 'string' ? req.body.mode : '';
  if (!mode) {
    errorResponse(res, new Error('A mode is required'));
    return;
  }
  const changed = controller.setSessionMode(req.params.sessionId, mode);
  res.status(changed ? 200 : 409).json({ changed });
});

app.post('/api/reload', async (_req, res) => {
  try {
    await reloadPlugin('manual request');
    res.json(status());
  } catch (error) {
    errorResponse(res, error);
  }
});

const webSocketServer = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (
    url.pathname !== '/events' ||
    url.searchParams.get('token') !== args.token ||
    !isLoopbackOrigin(request.headers.origin)
  ) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, ws => {
    webSocketServer.emit('connection', ws, request);
  });
});

webSocketServer.on('connection', socket => {
  sockets.add(socket);
  for (const message of history) socket.send(JSON.stringify(message));
  sendToSocket(socket, { type: 'status', status: status(), timestamp: Date.now() });
  socket.on('close', () => sockets.delete(socket));
});

function startWatcher(): void {
  if (!args.watch) return;
  const distPath = path.join(args.pluginPath, 'dist');
  try {
    pluginWatcher = watch(distPath, { recursive: true }, () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        void reloadPlugin('compiled files changed').catch(error => {
          rememberAndBroadcast({
            type: 'plugin_log',
            level: 'error',
            message: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          });
        });
      }, 250);
    });
  } catch (error) {
    console.warn(
      `[AgentPlayground] Could not watch ${distPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[AgentPlayground] ${signal}; shutting down`);
  pluginWatcher?.close();
  if (reloadTimer) clearTimeout(reloadTimer);
  await controller.abortAll().catch(error => {
    console.warn(`[AgentPlayground] ${error instanceof Error ? error.message : String(error)}`);
  });
  await host.deactivate().catch(() => {});
  for (const socket of sockets) socket.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.exit(0);
}

await host.load();
server.listen(args.port, '127.0.0.1', () => {
  startWatcher();
  console.log(
    `AGENT_PLAYGROUND_HOST_READY ${JSON.stringify({
      port: args.port,
      plugin: host.pluginInfo.id,
      runtime: host.runtime.type,
    })}`
  );
});

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
