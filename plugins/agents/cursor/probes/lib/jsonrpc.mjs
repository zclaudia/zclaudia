// Minimal bare JSON-RPC over NDJSON stdio client used by the P0 ACP probes.
//
// The probes deliberately do NOT use @agentclientprotocol/sdk: their purpose is
// to pin down what `cursor-agent acp` actually does on the wire, independent of
// any SDK framing or reconnection behavior. Re-run these whenever the Cursor CLI
// is upgraded and write the observed results back to
// docs/plans/2026-09-12-cursor-acp-migration.md §2.
import { spawn } from 'node:child_process';

/** Probe-internal timeout error. */
export class ProbeTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label}: timed out after ${ms}ms`);
    this.name = 'ProbeTimeoutError';
  }
}

/**
 * Spawn `<cursor-agent> acp` and speak newline-delimited JSON-RPC over stdio.
 *
 * stderr is capped and only surfaced on close / failure; nothing is written to
 * stdout except what the CLI sends. Prompts, session content, and tokens are
 * the caller's responsibility — fixtures must be sanitized before committing.
 */
export class BareAcpConnection {
  constructor({
    cliPath = process.env.CURSOR_AGENT_PATH ?? 'cursor-agent',
    cwd = process.cwd(),
  } = {}) {
    this.cliPath = cliPath;
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.serverRequests = [];
    this.exitPromise = null;
    this.stderrTail = [];
    this.closed = false;
  }

  start() {
    this.proc = spawn(this.cliPath, ['acp'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this.handleLine(line);
        newline = buffer.indexOf('\n');
      }
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => {
      this.stderrTail.push(chunk);
      if (this.stderrTail.join('').length > 16_000) this.stderrTail.splice(0, 10);
    });
    this.exitPromise = new Promise(resolve => {
      this.proc.once('close', code => {
        this.closed = true;
        resolve(code);
      });
    });
    return this.proc;
  }

  handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.notifications.push({ type: '<unparseable>', line: line.slice(0, 500) });
      return;
    }
    if (
      msg.id !== undefined &&
      (msg.method === undefined || msg.result !== undefined || msg.error !== undefined)
    ) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error)
          pending.reject(
            new Error(
              `JSON-RPC ${msg.error.code}: ${msg.error.message} ${JSON.stringify(msg.error.data ?? '')}`
            )
          );
        else pending.resolve(msg.result);
      }
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // Server → client request (e.g. session/request_permission, fs/*).
      this.serverRequests.push(msg);
      return;
    }
    this.notifications.push(msg);
  }

  request(method, params, { timeoutMs = 120_000 } = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProbeTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.proc.stdin.write(payload);
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  /** Respond to a server → client request captured earlier. */
  respondTo(serverRequest, result) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: serverRequest.id, result }) + '\n');
  }

  /** Drain notifications matching a predicate until a promise settles. */
  async collectWhile(promise) {
    const mark = this.notifications.length;
    await promise;
    return this.notifications.slice(mark);
  }

  async close({ graceMs = 5_000 } = {}) {
    if (this.closed) return await this.exitPromise;
    this.proc.stdin.end();
    const exit = await Promise.race([
      this.exitPromise.then(code => ({ code })),
      new Promise(resolve => setTimeout(() => resolve(null), graceMs)),
    ]);
    if (!exit) {
      this.proc.kill('SIGTERM');
      await Promise.race([
        this.exitPromise,
        new Promise(resolve =>
          setTimeout(() => {
            this.proc.kill('SIGKILL');
            resolve();
          }, 1_000)
        ),
      ]);
    }
    return await this.exitPromise;
  }

  stderr() {
    return this.stderrTail.join('').slice(-4_000);
  }
}

/** Standard initialize payload used by every probe. */
export const CLIENT_INFO = { name: 'zclaudia-acp-probe', version: '1' };
export const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

export async function initialize(conn) {
  return await conn.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: CLIENT_CAPABILITIES,
    clientInfo: CLIENT_INFO,
  });
}

/**
 * Redact values that must never land in committed fixtures: session ids are
 * fine (they are user-scoped but worthless off-machine), paths and tokens are
 * not. Extend the map as new probe output shapes appear.
 */
export function sanitize(value) {
  if (typeof value === 'string') {
    return value
      .replaceAll(process.env.HOME ?? '/home/probe', '<home>')
      .replaceAll(/(token|key|secret|authorization)"\s*:\s*"[^"]*"/gi, '$1":"<redacted>"');
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  }
  return value;
}
