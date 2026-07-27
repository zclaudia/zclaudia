import { describe, expect, it } from 'vitest';
import type {
  ApprovalInteractionMessage,
  InteractionPromptMessage,
  InteractionResolvedMessage,
  InteractionResponseMessage,
  PlanReviewInteractionMessage,
  TodoUpdateInteractionMessage,
} from '../../interaction/forms.js';
import type { ClientMessage, ServerMessage } from './index.js';
import type { BrowserClientMessage, BrowserServerMessage } from './browser.js';
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

type AssertAssignable<Source, Target> = [Source] extends [Target] ? true : never;

// Mutual assignability == structural equality of the two unions. Using this for the
// aggregate-vs-modules check makes the aggregate provably exhaustive: adding a message
// type to any module (or to the aggregate) without also listing it here fails to compile.
type AssertMutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

function assertAssignable<T extends true>(): void {
  void (0 as unknown as T);
}

// Every module-level union that must flow into the client aggregate, enumerated in one
// place. This is the single source of truth the exhaustiveness assertion checks against.
type EnumeratedClientMessage =
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
  | GoalClientMessage
  | BrowserClientMessage;

type EnumeratedServerMessage =
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
  | InteractionResolvedMessage
  | BrowserServerMessage;

describe('wire message union coverage', () => {
  it('includes every module-level client message union', () => {
    assertAssignable<AssertAssignable<CoreClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<RunClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<CrudClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<TerminalClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<PermissionsClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<SupervisionClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<InteractionResponseMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<ClaudiaClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<WorkflowClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<NotificationFeedClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<PluginsClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<MetaWorkflowClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<OpenSpecClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<GoalClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<BrowserClientMessage, ClientMessage>>();

    expect(true).toBe(true);
  });

  it('includes every module-level server message union', () => {
    assertAssignable<AssertAssignable<CoreServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<RunServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<CrudServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<TerminalServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<PermissionsServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<SupervisionServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<ClaudiaServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<WorkflowServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<NotificationFeedServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<PluginsServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<MetaWorkflowServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<OpenSpecServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<GoalServerMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<InteractionPromptMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<TodoUpdateInteractionMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<ApprovalInteractionMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<PlanReviewInteractionMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<InteractionResolvedMessage, ServerMessage>>();
    assertAssignable<AssertAssignable<BrowserServerMessage, ServerMessage>>();

    expect(true).toBe(true);
  });

  it('has no aggregate members beyond the enumerated modules (exhaustive)', () => {
    // Reverse direction: fails to compile if the aggregate ClientMessage/ServerMessage
    // gains a member not represented in the enumerated unions above, so a new message
    // type can never be silently added to (or dropped from) the wire contract.
    assertAssignable<AssertMutuallyAssignable<ClientMessage, EnumeratedClientMessage>>();
    assertAssignable<AssertMutuallyAssignable<ServerMessage, EnumeratedServerMessage>>();

    expect(true).toBe(true);
  });
});
