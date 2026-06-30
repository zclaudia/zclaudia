// Automation Types — "when to do it": binds one trigger to one action.

import type { WorkflowTrigger, WorkflowTriggerType } from './workflows.js';

/** Trigger shape is identical to a workflow trigger; only its home moves. */
export type AutomationTriggerType = WorkflowTriggerType;
export type AutomationTrigger = WorkflowTrigger;

export type AutomationActionKind = 'activity' | 'workflow';

export interface AutomationAction {
  kind: AutomationActionKind;
  /**
   * For kind 'activity': a workflow step type (e.g. 'git_commit', 'shell', 'ai_prompt')
   * run as a single inline step. For kind 'workflow': a persisted Workflow id.
   */
  ref: string;
  /** Config/input passed to the activity step, or input to the workflow run. */
  input?: Record<string, unknown>;
}

export interface Automation {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  /** System-owned automations are immutable via normal CRUD. */
  isSystem?: boolean;
  /** Stable identifier for system-owned automations. */
  systemKey?: string;
  createdAt: number;
  updatedAt: number;
}
