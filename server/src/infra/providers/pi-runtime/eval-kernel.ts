/**
 * Persistent JavaScript eval kernels for the Eval tool.
 *
 * Each session gets one kernel: a long-lived `node` child process running an
 * embedded REPL script (JSON-line protocol over stdio). The child is spawned
 * through the same sandbox wrapper as Bash, so eval code is subject to the
 * identical filesystem/network policy. A cell that exceeds its timeout kills
 * the kernel (state lost) and the next cell starts a fresh one.
 */
import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as sandbox from './sandbox.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const IDLE_KERNEL_TTL_MS = 30 * 60 * 1000;

/**
 * Kernel child source (CommonJS, written to a temp file at first use).
 * Protocol: one JSON request {id, code} per stdin line; one JSON response
 * {id, ok, output, error?} per stdout line. Cells run sequentially.
 * - Cells without `await` run as global scripts: var/function/const persist.
 * - Cells with `await` run inside an async wrapper: use `return` for the
 *   result value and globalThis.x for persistence.
 */
const KERNEL_SOURCE = [
  "'use strict';",
  "const fs = require('fs');",
  "const vm = require('vm');",
  "const util = require('util');",
  "const readline = require('readline');",
  '',
  'const MAX_OUTPUT_CHARS = 80000;',
  'const captured = [];',
  'let capturedChars = 0;',
  'let outputTruncated = false;',
  'let fullOutputPath;',
  'function appendFullOutput(text) {',
  '  if (!fullOutputPath || !outputTruncated) return;',
  '  try { fs.appendFileSync(fullOutputPath, text, "utf8"); } catch { }',
  '}',
  'function resetCapture(req) {',
  '  captured.length = 0;',
  '  capturedChars = 0;',
  '  outputTruncated = false;',
  '  fullOutputPath = typeof req.fullOutputPath === "string" ? req.fullOutputPath : undefined;',
  '}',
  'function appendCaptured(text) {',
  '  const value = String(text);',
  '  const separator = capturedChars > 0 ? "\\n" : "";',
  '  const nextChars = capturedChars + value.length + separator.length;',
  '  if (nextChars <= MAX_OUTPUT_CHARS) {',
  '    captured.push(value);',
  '    capturedChars = nextChars;',
  '    return;',
  '  }',
  '  if (!outputTruncated && fullOutputPath) {',
  '    try { fs.writeFileSync(fullOutputPath, captured.concat(value).join("\\n"), { encoding: "utf8", mode: 0o600 }); } catch { fullOutputPath = undefined; }',
  '  } else {',
  '    appendFullOutput(separator + value);',
  '  }',
  '  outputTruncated = true;',
  '  capturedChars = nextChars;',
  '  const joined = captured.concat(value).join("\\n");',
  '  const tail = joined.slice(-MAX_OUTPUT_CHARS);',
  '  captured.length = 0;',
  '  captured.push(tail);',
  '}',
  'const kernelConsole = {};',
  "for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {",
  '  kernelConsole[level] = (...args) => {',
  "    appendCaptured(args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4 }))).join(' '));",
  '  };',
  '}',
  '',
  'const contextObject = {',
  '  console: kernelConsole,',
  '  require,',
  '  process,',
  '  Buffer,',
  '  URL, URLSearchParams, TextEncoder, TextDecoder,',
  '  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,',
  '  AbortController, AbortSignal, structuredClone,',
  '  fetch: globalThis.fetch,',
  '  crypto: globalThis.crypto,',
  '};',
  'contextObject.globalThis = contextObject;',
  'const context = vm.createContext(contextObject);',
  '',
  'function inspectValue(value) {',
  '  return util.inspect(value, { depth: 4, maxArrayLength: 200, maxStringLength: 8192 });',
  '}',
  '',
  'const rl = readline.createInterface({ input: process.stdin });',
  'let queue = Promise.resolve();',
  "rl.on('line', (line) => {",
  '  queue = queue.then(async () => {',
  '    let req;',
  '    try { req = JSON.parse(line); } catch { return; }',
  '    resetCapture(req);',
  '    let resp;',
  '    try {',
  '      let value;',
  '      if (/\\bawait\\b/.test(req.code)) {',
  "        const wrapped = '(async () => {\\n' + req.code + '\\n})()';",
  "        value = await vm.runInContext(wrapped, context, { filename: 'eval-cell' });",
  '      } else {',
  "        value = vm.runInContext(req.code, context, { filename: 'eval-cell' });",
  "        if (value && typeof value.then === 'function') value = await value;",
  '      }',
  '      if (value !== undefined) appendCaptured(inspectValue(value));',
  "      resp = { id: req.id, ok: true, output: captured.join('\\n'), outputTruncated, fullOutputPath: outputTruncated ? fullOutputPath : undefined };",
  '    } catch (err) {',
  '      const stack = err && err.stack ? String(err.stack) : String(err);',
  "      resp = { id: req.id, ok: false, output: captured.join('\\n'), error: stack.split('\\n').slice(0, 8).join('\\n'), outputTruncated, fullOutputPath: outputTruncated ? fullOutputPath : undefined };",
  '    }',
  "    process.stdout.write(JSON.stringify(resp) + '\\n');",
  '  });',
  '});',
  "rl.on('close', () => process.exit(0));",
].join('\n');

export interface EvalExecResult {
  ok: boolean;
  output: string;
  error?: string;
  timedOut?: boolean;
  kernelRestarted?: boolean;
  /** Why the kernel restarted when kernelRestarted is set (e.g. 'grants_changed'). */
  kernelRestartReason?: string;
  sandboxed?: boolean;
  outputTruncated?: boolean;
  fullOutputPath?: string;
}

export interface EvalKernelOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  extraAllowedDomains?: string[];
  unsandboxed?: boolean;
}

// Eval full-output logs are kept only long enough for the model to Read them
// back within the session; without a sweep they accumulate forever (one file
// per cell whose output exceeds the capture budget). 24h TTL, swept
// opportunistically on each new write — no background timer (mirrors bash-logs).
const EVAL_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sweepStaleEvalLogs(dir: string, maxAgeMs: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const filePath = path.join(dir, name);
    try {
      if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
    } catch {
      // file vanished or is locked — ignore, this is best-effort
    }
  }
}

function evalLogPath(): string {
  const dir = path.join(os.tmpdir(), 'zclaudia-eval-logs');
  mkdirSync(dir, { recursive: true });
  sweepStaleEvalLogs(dir, EVAL_LOG_MAX_AGE_MS);
  return path.join(dir, `${randomUUID()}.log`);
}

export class EvalKernel {
  private child: ChildProcess | undefined;
  private scriptPath: string | undefined;
  private sandboxed = false;
  private buffer = '';
  private readonly pending = new Map<
    string,
    (result: {
      ok: boolean;
      output: string;
      error?: string;
      outputTruncated?: boolean;
      fullOutputPath?: string;
    }) => void
  >();
  lastUsedAt = Date.now();

  constructor(private readonly options: EvalKernelOptions) {}

  /** Temp script backing this kernel (undefined again after shutdown); exposed for tests. */
  get scriptFilePath(): string | undefined {
    return this.scriptPath;
  }

  private alive(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  private onStdout(text: string): void {
    this.buffer += text;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as {
          id: string;
          ok: boolean;
          output: string;
          error?: string;
          outputTruncated?: boolean;
          fullOutputPath?: string;
        };
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // non-protocol output (e.g. stray writes) — ignore
      }
    }
  }

  private async ensureChild(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.alive()) return { ok: true };
    if (!this.scriptPath) {
      this.scriptPath = path.join(os.tmpdir(), `zclaudia-eval-kernel-${randomUUID()}.cjs`);
      writeFileSync(this.scriptPath, KERNEL_SOURCE, 'utf8');
    }
    const wrap = this.options.unsandboxed
      ? { sandboxed: false }
      : await sandbox.wrapCommand(`node "${this.scriptPath}"`, {
          workspaceRoot: this.options.workspaceRoot,
          readOnly: this.options.readOnly === true,
          extraAllowedDomains: this.options.extraAllowedDomains,
        });
    if (!wrap.sandboxed && this.options.readOnly === true) {
      return {
        ok: false,
        error: 'Eval in read-only mode requires the sandbox, which is not available.',
      };
    }
    this.child = wrap.sandboxed
      ? spawn(wrap.argv![0], wrap.argv!.slice(1), {
          cwd: this.options.workspaceRoot,
          env: wrap.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        })
      : spawn(process.execPath, [this.scriptPath], {
          cwd: this.options.workspaceRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
    this.sandboxed = wrap.sandboxed;
    this.buffer = '';
    this.child.stdout?.on('data', (chunk: Buffer) => this.onStdout(chunk.toString('utf8')));
    this.child.stderr?.on('data', () => {
      /* diagnostics only; protocol uses stdout */
    });
    this.child.on('error', () => this.shutdown());
    return { ok: true };
  }

  async exec(
    code: string,
    opts?: { timeoutMs?: number; reset?: boolean }
  ): Promise<EvalExecResult> {
    this.lastUsedAt = Date.now();
    if (opts?.reset) this.shutdown();
    const ensured = await this.ensureChild();
    if (!ensured.ok) return { ok: false, output: '', error: ensured.error };

    const id = randomUUID();
    const timeoutMs = Math.min(
      Math.max(1000, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    );
    const child = this.child!;
    const fullOutputPath = evalLogPath();

    return await new Promise<EvalExecResult>(resolve => {
      let settled = false;
      const finish = (result: EvalExecResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('exit', onExit);
        this.pending.delete(id);
        resolve({ ...result, sandboxed: this.sandboxed });
      };
      const timer = setTimeout(() => {
        this.shutdown();
        finish({
          ok: false,
          output: '',
          error: `Evaluation timed out after ${Math.round(timeoutMs / 1000)}s. The kernel was restarted; in-memory state was lost.`,
          timedOut: true,
          kernelRestarted: true,
        });
      }, timeoutMs);
      const onExit = () => {
        finish({
          ok: false,
          output: '',
          error: 'Eval kernel exited unexpectedly; it will restart on the next call.',
          kernelRestarted: true,
        });
      };
      child.once('exit', onExit);
      this.pending.set(id, msg =>
        finish({
          ok: msg.ok,
          output: msg.output,
          error: msg.error,
          ...(msg.outputTruncated ? { outputTruncated: true } : {}),
          ...(msg.fullOutputPath ? { fullOutputPath: msg.fullOutputPath } : {}),
        })
      );
      child.stdin?.write(`${JSON.stringify({ id, code, fullOutputPath })}\n`);
    });
  }

  shutdown(): void {
    const child = this.child;
    this.child = undefined;
    if (child) {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    // The temp kernel script is per-kernel state; leaving it behind would leak
    // one file per kernel into the shared tmp dir. Deleting after the child is
    // dead; a later exec re-writes a fresh script via ensureChild().
    const scriptPath = this.scriptPath;
    this.scriptPath = undefined;
    if (scriptPath) {
      try {
        unlinkSync(scriptPath);
      } catch {
        // best-effort: may be locked (Windows) or already removed
      }
    }
  }
}

// ── Per-session kernel registry ────────────────────────────────────────────

const kernels = new Map<string, EvalKernel>();

function sweepIdleKernels(): void {
  const now = Date.now();
  for (const [key, kernel] of kernels) {
    if (now - kernel.lastUsedAt > IDLE_KERNEL_TTL_MS) {
      kernel.shutdown();
      kernels.delete(key);
    }
  }
}

export function getEvalKernel(key: string, options: EvalKernelOptions): EvalKernel {
  sweepIdleKernels();
  let kernel = kernels.get(key);
  if (!kernel) {
    kernel = new EvalKernel(options);
    kernels.set(key, kernel);
  }
  return kernel;
}

export async function runOneShotEval(
  options: EvalKernelOptions,
  code: string,
  opts?: { timeoutMs?: number }
): Promise<EvalExecResult> {
  const kernel = new EvalKernel(options);
  try {
    return await kernel.exec(code, opts);
  } finally {
    kernel.shutdown();
  }
}

export async function __shutdownAllEvalKernelsForTests(): Promise<void> {
  for (const kernel of kernels.values()) kernel.shutdown();
  kernels.clear();
}
