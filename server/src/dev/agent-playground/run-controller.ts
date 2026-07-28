import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import type {
  ExternalAgentAdapter,
  PermissionDecision,
  PermissionRequest,
} from '@zclaudia/shared/providers';
import type {
  AgentPlaygroundPermissionDecisionRequest,
  AgentPlaygroundRunAccepted,
  AgentPlaygroundRunRequest,
  AgentPlaygroundServerMessage,
} from '@zclaudia/shared/plugins/agent-playground';

interface PendingPermission {
  runId: string;
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

interface ActiveRun {
  id: string;
  request: AgentPlaygroundRunRequest;
  abortController: AbortController;
  providerSessionId?: string;
  aborted: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
}

export interface PlaygroundRunControllerOptions {
  getAdapter: () => ExternalAgentAdapter;
  broadcast: (message: AgentPlaygroundServerMessage) => void;
}

function now(): number {
  return Date.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PlaygroundRunController {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(private readonly options: PlaygroundRunControllerOptions) {}

  get activeRunIds(): string[] {
    return [...this.activeRuns.keys()];
  }

  start(request: AgentPlaygroundRunRequest): AgentPlaygroundRunAccepted {
    if (!request.input.trim()) throw new Error('A non-empty input is required');
    if (!request.cwd || !existsSync(request.cwd) || !statSync(request.cwd).isDirectory()) {
      throw new Error(`Working directory does not exist: ${request.cwd}`);
    }

    const runId = randomUUID();
    let resolveCompletion!: () => void;
    const completion = new Promise<void>(resolve => {
      resolveCompletion = resolve;
    });
    const activeRun: ActiveRun = {
      id: runId,
      request: {
        ...request,
        input: request.input.trim(),
        cwd: request.cwd,
        permissionPolicy: request.permissionPolicy ?? 'prompt',
      },
      abortController: new AbortController(),
      aborted: false,
      completion,
      resolveCompletion,
    };
    this.activeRuns.set(runId, activeRun);
    this.options.broadcast({
      type: 'run_started',
      runId,
      request: activeRun.request,
      timestamp: now(),
    });

    setImmediate(() => {
      void this.execute(activeRun).finally(() => activeRun.resolveCompletion());
    });
    return { runId };
  }

  async abort(runId: string): Promise<boolean> {
    const run = this.activeRuns.get(runId);
    if (!run) return false;
    run.aborted = true;
    run.abortController.abort();
    this.resolvePermissionsForRun(runId, {
      behavior: 'deny',
      message: 'Run aborted in Agent Playground',
    });
    const adapter = this.options.getAdapter();
    const providerSessionId = run.providerSessionId ?? run.request.sessionId;
    if (providerSessionId && adapter.abort) {
      await adapter.abort(providerSessionId, run.request.cwd).catch(() => {});
    }
    return true;
  }

  async abortAll(timeoutMs = 5000): Promise<void> {
    const runs = [...this.activeRuns.values()];
    if (runs.length === 0) return;

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([
          Promise.all(runs.map(run => this.abort(run.id))),
          Promise.all(runs.map(run => run.completion)),
        ]),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for active Agent Playground runs to stop')),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  setSessionMode(sessionId: string, mode: string): boolean {
    const adapter = this.options.getAdapter();
    if (!adapter.setSessionMode) return false;
    adapter.setSessionMode(sessionId, mode);
    return true;
  }

  resolvePermission(decision: AgentPlaygroundPermissionDecisionRequest): boolean {
    const pending = this.pendingPermissions.get(decision.requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(decision.requestId);
    const resolved: PermissionDecision = {
      behavior: decision.behavior,
      updatedInput: decision.updatedInput,
      message: decision.message,
    };
    pending.resolve(resolved);
    this.options.broadcast({
      type: 'permission_resolved',
      runId: pending.runId,
      requestId: decision.requestId,
      decision: resolved,
      timestamp: now(),
    });
    return true;
  }

  private async execute(run: ActiveRun): Promise<void> {
    let outcome: Extract<AgentPlaygroundServerMessage, { type: 'run_finished' | 'run_failed' }>;
    try {
      const adapter = this.options.getAdapter();
      const request = run.request;
      for await (const event of adapter.run(
        request.input,
        {
          cwd: request.cwd,
          sessionId: request.sessionId,
          cliPath: request.cliPath || undefined,
          mode: request.mode || undefined,
          systemPrompt: request.systemPrompt || undefined,
          model: request.model || undefined,
          thinkingLevel: request.thinkingLevel,
          claudiaSessionId: `playground-${run.id}`,
          abortController: run.abortController,
        },
        permissionRequest => this.handlePermission(run, permissionRequest)
      )) {
        if (event.type === 'init' && event.sessionId) run.providerSessionId = event.sessionId;
        this.options.broadcast({
          type: 'runtime_event',
          runId: run.id,
          event,
          timestamp: now(),
        });
      }
      outcome = {
        type: 'run_finished',
        runId: run.id,
        sessionId: run.providerSessionId ?? run.request.sessionId,
        aborted: run.aborted,
        timestamp: now(),
      };
    } catch (error) {
      outcome = {
        type: 'run_failed',
        runId: run.id,
        error: errorMessage(error),
        aborted: run.aborted || run.abortController.signal.aborted,
        timestamp: now(),
      };
    } finally {
      this.resolvePermissionsForRun(run.id, {
        behavior: 'deny',
        message: 'Agent run ended before the permission was resolved',
      });
      this.activeRuns.delete(run.id);
    }
    this.options.broadcast(outcome);
  }

  private handlePermission(
    run: ActiveRun,
    request: PermissionRequest
  ): Promise<PermissionDecision> {
    const policy = run.request.permissionPolicy ?? 'prompt';
    const requestId = request.requestId || randomUUID();
    const normalizedRequest = { ...request, requestId };
    if (policy !== 'prompt') {
      const decision: PermissionDecision = {
        behavior: policy === 'allow' ? 'allow' : 'deny',
        message: `Automatically ${policy === 'allow' ? 'allowed' : 'denied'} by Agent Playground`,
      };
      this.options.broadcast({
        type: 'permission_request',
        runId: run.id,
        request: normalizedRequest,
        timestamp: now(),
      });
      this.options.broadcast({
        type: 'permission_resolved',
        runId: run.id,
        requestId,
        decision,
        timestamp: now(),
      });
      return Promise.resolve(decision);
    }

    return new Promise(resolve => {
      const timeoutSeconds = Math.max(1, request.timeoutSeconds || 60);
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        const decision: PermissionDecision = {
          behavior: request.timeoutBehavior === 'approve' ? 'allow' : 'deny',
          message: 'Permission request timed out in Agent Playground',
        };
        resolve(decision);
        this.options.broadcast({
          type: 'permission_resolved',
          runId: run.id,
          requestId,
          decision,
          timestamp: now(),
        });
      }, timeoutSeconds * 1000);
      this.pendingPermissions.set(requestId, { runId: run.id, resolve, timer });
      this.options.broadcast({
        type: 'permission_request',
        runId: run.id,
        request: normalizedRequest,
        timestamp: now(),
      });
    });
  }

  private resolvePermissionsForRun(runId: string, decision: PermissionDecision): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.runId !== runId) continue;
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(requestId);
      pending.resolve(decision);
      this.options.broadcast({
        type: 'permission_resolved',
        runId,
        requestId,
        decision,
        timestamp: now(),
      });
    }
  }
}
