import { describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from './index.js';
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

function assertAssignable<T extends true>(): void {
  void (0 as unknown as T);
}

describe('wire message union coverage', () => {
  it('aggregates every module-level client message union', () => {
    assertAssignable<AssertAssignable<CoreClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<RunClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<CrudClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<TerminalClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<PermissionsClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<SupervisionClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<ClaudiaClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<WorkflowClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<NotificationFeedClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<PluginsClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<MetaWorkflowClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<OpenSpecClientMessage, ClientMessage>>();
    assertAssignable<AssertAssignable<GoalClientMessage, ClientMessage>>();

    expect(true).toBe(true);
  });

  it('aggregates every module-level server message union', () => {
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

    expect(true).toBe(true);
  });
});
