import type { AgentLoopRunnerPort } from '../agent-loop/index.js';

/** Cross-cutting services any caller can provide. NO workflow-orchestration state here. */
export interface ActivityServices {
  agentLoopRunner: AgentLoopRunnerPort;
  llmProfileId?: string;
}

export interface ActivityResult<O = Record<string, unknown>> {
  status: 'completed' | 'failed';
  output: O;
  error?: string;
}

/**
 * An Activity is the smallest invocable capability: atomic, decoupled from
 * triggers and from the workflow runtime. It does NOT invoke other Activities
 * (composition lives in the workflow layer).
 */
export interface Activity<I = Record<string, unknown>, O = Record<string, unknown>> {
  readonly type: string;
  /** Optional JSON-schema metadata (future automation-form rendering). Not validated yet. */
  readonly configSchema?: Record<string, unknown>;
  invoke(input: I, services: ActivityServices): Promise<ActivityResult<O>>;
}
