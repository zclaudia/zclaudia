import type {
  BrowserClientMessage,
  BrowserEngineStatusMessage,
  ClientMessage,
} from '@zclaudia/shared/wire/messages';
import type { ConnectedClient } from '../transport/types.js';
import { sendMessage } from '../transport/broadcast.js';
import type { BrowserManager } from '../../browser/browser-manager.js';

const BROWSER_TYPES = new Set<string>([
  'browser_open',
  'browser_attach',
  'browser_detach',
  'browser_close',
  'browser_navigate',
  'browser_history',
  'browser_reload',
  'browser_stop',
  'browser_input',
  'browser_resize',
  'browser_engine_install',
]);

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  // Check the local-address shorthand before the generic scheme check: a bare
  // "localhost:5173" would otherwise parse as scheme "localhost:" and be
  // passed through unchanged instead of gaining the http:// prefix.
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed; // has a scheme
  return `https://${trimmed}`;
}

/**
 * Returns true when the message was a browser message (handled), false otherwise.
 * Async manager work is fire-and-forget; failures surface as browser_error.
 */
export function handleBrowserMessage(
  client: ConnectedClient,
  message: ClientMessage,
  browserMgr: BrowserManager,
  broadcastEngineStatus: (msg: BrowserEngineStatusMessage) => void,
  installEngineFn?: (notify: (msg: BrowserEngineStatusMessage) => void) => Promise<void>
): boolean {
  if (!BROWSER_TYPES.has(message.type)) return false;
  const msg = message as BrowserClientMessage;

  const run = (sessionId: string | undefined, work: Promise<void>) => {
    void work.catch((err: unknown) => {
      sendMessage(client.ws, {
        type: 'browser_error',
        sessionId,
        code: 'browser_op_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  };

  switch (msg.type) {
    case 'browser_open':
      run(
        msg.sessionId,
        browserMgr.open(client.id, msg.sessionId, msg.url ? normalizeUrl(msg.url) : msg.url)
      );
      break;
    case 'browser_attach':
      run(msg.sessionId, browserMgr.attach(client.id, msg.sessionId, msg.viewport));
      break;
    case 'browser_detach':
      run(msg.sessionId, browserMgr.detach(msg.sessionId));
      break;
    case 'browser_close':
      run(msg.sessionId, browserMgr.close(msg.sessionId, 'user'));
      break;
    case 'browser_navigate':
      run(msg.sessionId, browserMgr.navigate(msg.sessionId, normalizeUrl(msg.url)));
      break;
    case 'browser_history':
      run(msg.sessionId, browserMgr.history(msg.sessionId, msg.direction));
      break;
    case 'browser_reload':
      run(msg.sessionId, browserMgr.reload(msg.sessionId));
      break;
    case 'browser_stop':
      run(msg.sessionId, browserMgr.stop(msg.sessionId));
      break;
    case 'browser_input':
      run(msg.sessionId, browserMgr.input(msg.sessionId, msg.event));
      break;
    case 'browser_resize':
      run(msg.sessionId, browserMgr.resize(msg.sessionId, msg.viewport));
      break;
    case 'browser_engine_install':
      if (installEngineFn) run(undefined, installEngineFn(broadcastEngineStatus));
      break;
  }
  return true;
}
