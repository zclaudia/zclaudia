// WebSocket Protocol Message Types — aggregated from domain sub-modules.
// Import individual sub-modules for focused access, or import from here for the full set.

export * from './core.js';
export * from './run.js';
export * from './crud.js';
export * from './terminal.js';
export * from './permissions.js';
export * from './supervision.js';
export * from './claudia.js';
export * from './workflow.js';
export * from './notification-feed.js';
export * from './plugins.js';
export * from './meta-workflow.js';
export * from './openspec.js';
export * from './goal.js';

import type {
  ApprovalInteractionMessage,
  InteractionPromptMessage,
  InteractionResolvedMessage,
  InteractionResponseMessage,
  PlanReviewInteractionMessage,
  TodoUpdateInteractionMessage,
} from '../../interaction/forms.js';
import type { ClaudiaClientMessage, ClaudiaServerMessage } from './claudia.js';
import type { CoreClientMessage, CoreServerMessage } from './core.js';
import type { CrudClientMessage, CrudServerMessage } from './crud.js';
import type { GoalClientMessage, GoalServerMessage } from './goal.js';
import type { MetaWorkflowClientMessage, MetaWorkflowServerMessage } from './meta-workflow.js';
import type {
  NotificationFeedClientMessage,
  NotificationFeedServerMessage,
} from './notification-feed.js';
import type { OpenSpecClientMessage, OpenSpecServerMessage } from './openspec.js';
import type { PermissionsClientMessage, PermissionsServerMessage } from './permissions.js';
import type { PluginsClientMessage, PluginsServerMessage } from './plugins.js';
import type { RunClientMessage, RunServerMessage } from './run.js';
import type { SupervisionClientMessage, SupervisionServerMessage } from './supervision.js';
import type { TerminalClientMessage, TerminalServerMessage } from './terminal.js';
import type { WorkflowClientMessage, WorkflowServerMessage } from './workflow.js';

export type { InteractionResponseMessage };

// ============================================
// Client -> Server messages (union type)
// ============================================

export type ClientMessage =
  | CoreClientMessage
  | RunClientMessage
  | CrudClientMessage
  | TerminalClientMessage
  | PermissionsClientMessage
  | SupervisionClientMessage
  | InteractionResponseMessage
  | ClaudiaClientMessage
  | WorkflowClientMessage
  | NotificationFeedClientMessage
  | PluginsClientMessage
  | MetaWorkflowClientMessage
  | OpenSpecClientMessage
  | GoalClientMessage;

// ============================================
// Server -> Client messages (union type)
// ============================================

export type ServerMessage =
  | CoreServerMessage
  | RunServerMessage
  | CrudServerMessage
  | TerminalServerMessage
  | PermissionsServerMessage
  | SupervisionServerMessage
  | ClaudiaServerMessage
  | WorkflowServerMessage
  | NotificationFeedServerMessage
  | PluginsServerMessage
  | MetaWorkflowServerMessage
  | OpenSpecServerMessage
  | GoalServerMessage
  | InteractionPromptMessage
  | TodoUpdateInteractionMessage
  | ApprovalInteractionMessage
  | PlanReviewInteractionMessage
  | InteractionResolvedMessage;
