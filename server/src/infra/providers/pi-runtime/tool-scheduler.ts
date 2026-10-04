import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  BUILTIN_TOOL_METADATA,
  normalizeToolName,
  resolveToolConcurrency,
  type ToolConcurrency,
} from '@zclaudia/shared/core/tools';

/**
 * Tool scheduler: concurrency gate + per-call timeout applied as the outermost
 * `execute` wrapper.
 *
 * Why a wrapper and not pi-agent-core config: pi fans every tool call of an
 * assistant turn out with an unbounded `Promise.all` (agent-loop.js
 * executeToolCallsParallel) and offers only two knobs — a global
 * `toolExecution: 'sequential'` and a per-tool `executionMode: 'sequential'`
 * that demotes the WHOLE batch to sequential when any one call carries it.
 * Neither lets read-only calls overlap while mutating calls serialize. The
 * `beforeToolCall` hook is not usable as a gate either: it runs inside the
 * sequential preparation loop, so awaiting a slot there stalls preparation of
 * every later call (self-deadlock at concurrency < batch size). Wrapping
 * `execute` is safe because pi re-emits results in assistant source order
 * regardless of completion order, so delaying a call never reorders the
 * transcript, and every closure is created before any await, so a queued
 * wait cannot deadlock preparation.
 *
 * Semantics (mirrors ZCode's ToolScheduler grouping):
 * - `shared` calls run together, capped at `maxConcurrency`.
 * - `exclusive` calls run alone: they wait for in-flight shared calls to
 *   drain and block new shared calls behind them (FIFO, writer-preferring).
 * - `unscheduled` calls (blocking user interaction) never hold a slot.
 */

export interface ToolSchedulePolicy {
  concurrency: ToolConcurrency;
  timeoutMs?: number;
}

export interface ToolSchedulerOptions {
  /** Maximum number of `shared` calls in flight at once. Default 10. */
  maxConcurrency?: number;
}

export interface ToolSchedulerSnapshot {
  activeShared: number;
  exclusiveActive: boolean;
  queued: number;
}

type Waiter = {
  kind: 'shared' | 'exclusive';
  resolve: () => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class ToolTimeoutError extends Error {
  constructor(
    readonly toolName: string,
    readonly timeoutMs: number
  ) {
    super(`Tool '${toolName}' exceeded its ${Math.round(timeoutMs / 1000)}s execution budget`);
    this.name = 'ToolTimeoutError';
  }
}

export class ToolScheduler {
  private readonly maxConcurrency: number;
  private activeShared = 0;
  private exclusiveActive = false;
  private readonly queue: Waiter[] = [];

  constructor(options?: ToolSchedulerOptions) {
    const max = options?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.maxConcurrency = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
  }

  snapshot(): ToolSchedulerSnapshot {
    return {
      activeShared: this.activeShared,
      exclusiveActive: this.exclusiveActive,
      queued: this.queue.length,
    };
  }

  /**
   * Acquire a slot of the given kind. Resolves with a release function.
   * Rejects if `signal` aborts while queued.
   */
  acquire(kind: 'shared' | 'exclusive', signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        kind,
        resolve: () => resolve(this.makeRelease(kind)),
        reject,
        signal,
      };
      if (signal) {
        waiter.onAbort = () => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(abortError(signal));
            // A removed waiter may have been blocking later shared calls.
            this.pump();
          }
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.pump();
    });
  }

  private makeRelease(kind: 'shared' | 'exclusive'): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (kind === 'exclusive') this.exclusiveActive = false;
      else this.activeShared = Math.max(0, this.activeShared - 1);
      this.pump();
    };
  }

  private canStart(kind: 'shared' | 'exclusive'): boolean {
    if (this.exclusiveActive) return false;
    if (kind === 'exclusive') return this.activeShared === 0;
    return this.activeShared < this.maxConcurrency;
  }

  private pump(): void {
    // Strict FIFO: an exclusive waiter at the head blocks everything behind
    // it until in-flight shared calls drain (writer preference, no starvation).
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (!this.canStart(head.kind)) return;
      this.queue.shift();
      if (head.signal && head.onAbort) {
        head.signal.removeEventListener('abort', head.onAbort);
      }
      if (head.kind === 'exclusive') this.exclusiveActive = true;
      else this.activeShared += 1;
      head.resolve();
    }
  }
}

export const DEFAULT_MAX_CONCURRENCY = 10;

/**
 * Meta tools appended after `buildTools` (external discovery + skill meta
 * tools). They only read catalogs or delegate to their own runtime, so they
 * are safe to overlap with read-only calls.
 */
const SHARED_META_TOOLS = new Set([
  'ListExternalToolProviders',
  'SearchExternalTools',
  'InspectExternalTool',
  'SearchExternalResources',
  'InspectExternalResource',
  'ReadExternalResource',
  'SearchExternalPrompts',
  'LoadExternalPrompt',
  'LoadExternalTool',
  'ListSkills',
  'SearchSkills',
  'InspectSkill',
  'LoadSkill',
  'InvokeSkill',
  'RunSkill',
]);

/**
 * Resolve the schedule policy for a tool by name. Built-ins come from
 * `BUILTIN_TOOL_METADATA`; known meta tools are shared; everything else
 * (concrete `mcp__*` tools, plugin tools, unknown overrides) is treated as
 * exclusive — an unannotated external tool may well mutate the workspace.
 */
export function resolveToolSchedulePolicy(toolName: string): ToolSchedulePolicy {
  const builtin = normalizeToolName(toolName);
  if (builtin) {
    const meta = BUILTIN_TOOL_METADATA[builtin];
    return { concurrency: resolveToolConcurrency(meta), timeoutMs: meta.timeoutMs };
  }
  if (SHARED_META_TOOLS.has(toolName)) return { concurrency: 'shared' };
  return { concurrency: 'exclusive' };
}

type ToolExecute = NonNullable<AgentTool['execute']>;
type ToolSignal = Parameters<ToolExecute>[2];
type ToolUpdate = Parameters<ToolExecute>[3];

/**
 * Wrap a tool's `execute` so it (a) waits for a scheduler slot before running
 * and (b) is cancelled + rejected when it overruns `policy.timeoutMs`.
 *
 * A timeout throws `ToolTimeoutError`; pi converts thrown errors into an
 * `isError` tool result, which then flows through the normal afterToolCall
 * truncation/telemetry path. The inner tool receives a linked AbortSignal so
 * child processes and HTTP requests are cancelled rather than leaked.
 */
export function withToolScheduler(
  tool: AgentTool,
  scheduler: ToolScheduler,
  policy: ToolSchedulePolicy = resolveToolSchedulePolicy(tool.name)
): AgentTool {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;
  if (policy.concurrency === 'unscheduled' && !policy.timeoutMs) return tool;

  return {
    ...tool,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: ToolSignal,
      onUpdate?: ToolUpdate
    ) => {
      const release =
        policy.concurrency === 'unscheduled'
          ? undefined
          : await scheduler.acquire(policy.concurrency, signal ?? undefined);
      try {
        if (signal?.aborted) throw abortError(signal);
        if (!policy.timeoutMs) {
          return await originalExecute(toolCallId, params, signal, onUpdate);
        }
        return await runWithTimeout(tool.name, policy.timeoutMs, signal ?? undefined, linked =>
          originalExecute(toolCallId, params, linked, onUpdate)
        );
      } finally {
        release?.();
      }
    },
  };
}

async function runWithTimeout<T>(
  toolName: string,
  timeoutMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new ToolTimeoutError(toolName, timeoutMs);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

/** Wrap every tool in `tools` in place with one scheduler per call site. */
export function applyToolScheduler(
  tools: AgentTool[],
  scheduler: ToolScheduler = new ToolScheduler()
): AgentTool[] {
  for (let i = 0; i < tools.length; i += 1) {
    tools[i] = withToolScheduler(tools[i], scheduler);
  }
  return tools;
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(typeof reason === 'string' ? reason : 'Tool call aborted');
  err.name = 'AbortError';
  return err;
}
