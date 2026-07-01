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
  /** Human-readable label for catalog/UI. */
  readonly name: string;
  /** One-line description for catalog/UI. */
  readonly description: string;
  /** Grouping category for catalog/UI (e.g. 'Git', 'AI'). */
  readonly category: string;
  /** Optional lucide icon name for catalog/UI. */
  readonly icon?: string;
  /** Optional JSON-schema metadata; drives config-form rendering and required-key validation. */
  readonly configSchema?: Record<string, unknown>;
  /** When true, the workflow editor renders loop handles for this step type. */
  readonly supportsLoop?: boolean;
  invoke(input: I, services: ActivityServices): Promise<ActivityResult<O>>;
}
