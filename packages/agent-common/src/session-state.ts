import type {
  ExternalAgentRunContext,
  ExternalAgentRunState,
  ProviderRuntimeEvent,
} from '@zclaudia/plugin-sdk/providers';

export interface AdapterSessionStateOptions {
  trackModes?: boolean;
}

export interface AdapterRunSession {
  readonly abortController: AbortController;
  readonly context: ExternalAgentRunContext;
  readonly hostSessionId?: string;
  readonly keys: Set<string>;
  readonly providerSessionIds: Set<string>;
  providerSessionId?: string;
}

let pendingSessionSequence = 0;

/**
 * Provider-neutral bookkeeping for run state, provider/host session aliases,
 * abort controllers, and modes that survive across turns.
 */
export class AdapterSessionState {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly providerToHostSessionId = new Map<string, string>();
  private readonly runStates = new WeakMap<ExternalAgentRunContext, ExternalAgentRunState>();
  private readonly sessionModes = new Map<string, string>();
  private readonly trackModes: boolean;

  constructor(options: AdapterSessionStateOptions = {}) {
    this.trackModes = options.trackModes ?? false;
  }

  begin(context: ExternalAgentRunContext): AdapterRunSession {
    const hostSessionId = context.claudiaSessionId ?? context.sessionId;
    const abortController = context.abortController ?? new AbortController();
    const initialKeys = new Set<string>();
    if (context.claudiaSessionId) initialKeys.add(context.claudiaSessionId);
    if (context.sessionId) initialKeys.add(context.sessionId);
    if (initialKeys.size === 0) initialKeys.add(`pending:${++pendingSessionSequence}`);
    for (const key of initialKeys) this.abortControllers.set(key, abortController);

    this.runStates.set(context, {
      providerSessionId: context.sessionId,
      providerCwd: context.cwd,
    });

    return {
      abortController,
      context,
      hostSessionId,
      keys: initialKeys,
      providerSessionIds: new Set<string>(),
      providerSessionId: context.sessionId,
    };
  }

  effectiveMode(context: ExternalAgentRunContext): string | undefined {
    if (!this.trackModes) return context.mode;
    const hostSessionId = context.claudiaSessionId ?? context.sessionId;
    return (hostSessionId && this.sessionModes.get(hostSessionId)) ?? context.mode;
  }

  registerProviderSession(session: AdapterRunSession, providerSessionId: string): void {
    if (!providerSessionId) return;
    session.providerSessionId = providerSessionId;
    session.providerSessionIds.add(providerSessionId);
    session.keys.add(providerSessionId);
    this.abortControllers.set(providerSessionId, session.abortController);
    if (session.hostSessionId && providerSessionId !== session.hostSessionId) {
      this.providerToHostSessionId.set(providerSessionId, session.hostSessionId);
    }
    this.runStates.set(session.context, {
      providerSessionId,
      providerCwd: session.context.cwd,
    });
  }

  observe(session: AdapterRunSession, event: ProviderRuntimeEvent): void {
    if (event.type === 'init' && event.sessionId) {
      this.registerProviderSession(session, event.sessionId);
    }
    const mode = event.modeTransition?.mode;
    if (this.trackModes && event.type === 'mode_transition' && mode) {
      if (session.hostSessionId) this.sessionModes.set(session.hostSessionId, mode);
      if (session.providerSessionId) this.sessionModes.set(session.providerSessionId, mode);
    }
  }

  finish(session: AdapterRunSession): void {
    for (const key of session.keys) {
      if (this.abortControllers.get(key) === session.abortController) {
        this.abortControllers.delete(key);
      }
    }
    for (const providerSessionId of session.providerSessionIds) {
      if (this.providerToHostSessionId.get(providerSessionId) === session.hostSessionId) {
        this.providerToHostSessionId.delete(providerSessionId);
      }
    }
  }

  getRunState(context: ExternalAgentRunContext): ExternalAgentRunState {
    return this.runStates.get(context) ?? { providerCwd: context.cwd };
  }

  setSessionMode(sessionId: string, mode: string): void {
    if (!this.trackModes || !sessionId) return;
    this.sessionModes.set(sessionId, mode);
  }

  abort(sessionId: string): void {
    const hostSessionId = this.providerToHostSessionId.get(sessionId) ?? sessionId;
    if (this.trackModes) {
      this.sessionModes.delete(hostSessionId);
      this.sessionModes.delete(sessionId);
    }

    const controller =
      this.abortControllers.get(sessionId) ?? this.abortControllers.get(hostSessionId);
    if (controller) {
      controller.abort();
      for (const [key, candidate] of this.abortControllers) {
        if (candidate === controller) this.abortControllers.delete(key);
      }
    }

    for (const [providerSessionId, mappedHostId] of this.providerToHostSessionId) {
      if (providerSessionId === sessionId || mappedHostId === hostSessionId) {
        this.providerToHostSessionId.delete(providerSessionId);
      }
    }
  }

  abortAll(): void {
    for (const controller of new Set(this.abortControllers.values())) controller.abort();
    this.abortControllers.clear();
    this.providerToHostSessionId.clear();
    this.sessionModes.clear();
  }
}
