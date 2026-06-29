# Lightweight Agent Runner Workflow Migration Design

## Summary

Introduce a neutral `LightweightAgentRunner` as an embeddable bounded agent loop for internal product workflows. The first migration moves all workflow AI steps (`ai_prompt`, `ai_review`, and `ai_risk_analysis`) off the current virtual background-session path and onto this runner in one coordinated change.

The runner is not a second agent runtime. It reuses the existing pi-agent foundation (`buildModel`, `buildTools`, `buildAgentHooks`, retry, tool output budgeting, and `Agent`) while avoiding the full conversation run lifecycle (`handleRunStart`, active run state, chat message persistence, sidebar/notch updates, and user-facing permission flows).

## Goals

- Provide a reusable internal agent-loop substrate that can be used by workflow now and other domains later.
- Migrate all workflow AI steps in one implementation pass so workflow has one consistent AI execution path.
- Keep context storage neutral rather than workflow-specific.
- Support scoped context retention without creating implicit long-running hidden chat sessions.
- Start with JSON output contracts while keeping the contract layer extensible.
- Start with builtin toolsets only, with an explicit registry shape that can later accept extension-provided toolsets.
- Preserve pi-agent runtime investments instead of reimplementing model/tool/hook/stream behavior.

## Non-Goals

- Do not migrate normal chat sessions or `PiAgentProviderAdapter`.
- Do not migrate local PR, supervision, meta-workflow, or background task agent execution in the first pass.
- Do not expose arbitrary plugin-provided tools to lightweight agent loops in the first pass.
- Do not make workflow AI steps visible as regular background chat runs.
- Do not implement finish-tool output contracts in the first pass, only leave room for them.

## Positioning

The new runner sits below domain consumers and above raw pi-agent primitives:

```text
pi-agent-core Agent
pi-runtime primitives: buildModel / buildTools / hooks / retry / output budget
LightweightAgentRunner
domain consumers: workflow step executors first, later local PR / supervision / automation
```

The existing full conversation runtime remains separate:

```text
PiAgentProviderAdapter
pi-runtime primitives
```

Both full conversation runs and lightweight agent runs reuse the same pi-runtime foundation. They differ in lifecycle and side effects.

## Runner Responsibilities

`LightweightAgentRunner` owns only the internal bounded loop:

- Resolve model and LLM profile through existing profile/model infrastructure.
- Build a declared builtin toolset, including step-specific tool overrides.
- Build hooks for tool calls, output budgeting, retry, and loop stop behavior.
- Execute a bounded pi-agent loop with max turns and timeout.
- Apply the requested context policy.
- Parse the result through an output contract.
- Persist neutral trace/context events for audit and optional future reuse.
- Return a `LightweightAgentRunResult` to the caller.

It does not:

- Broadcast user-facing run lifecycle events.
- Write normal chat messages.
- Manage `activeRuns`.
- Open permission approval UI by default.
- Inherit full agent profile tool permissions.

## Public Port

Domains use the runner through a port:

```ts
interface AgentLoopRunnerPort {
  run(request: LightweightAgentRunRequest): Promise<LightweightAgentRunResult>;
}
```

The workflow domain receives this port through `registerWorkflowDomain` dependencies. Step executors depend on the port, not on concrete pi-agent infrastructure.

## Request Shape

```ts
interface LightweightAgentRunRequest {
  owner: {
    type: 'workflow_run' | 'local_pr' | 'supervision' | 'automation' | 'manual';
    id: string;
  };
  purpose: string;
  llmProfileId?: string;
  model?: string;
  cwd: string;
  systemPrompt: string;
  input: string | AgentMessage[];
  toolset: {
    id: string;
    overrides?: Record<string, AgentTool>;
  };
  outputContract: OutputContract;
  context: {
    policy: 'none' | 'step-local' | 'workflow-artifacts' | 'workflow-thread';
    key?: string;
    maxTokens?: number;
  };
  limits: {
    maxTurns: number;
    timeoutMs: number;
  };
  permissionMode: 'deny-external' | 'allow-declared-tools' | 'custom';
}
```

## Result Shape

```ts
interface LightweightAgentRunResult {
  status: 'completed' | 'failed' | 'timeout' | 'contract_failed';
  output: Record<string, unknown>;
  usage?: unknown;
  traceId?: string;
  contextId?: string;
  error?: string;
}
```

Workflow step executors map this result into `StepResult`.

## Neutral Context Store

Add a neutral context store that is not tied to workflow tables. Workflow is the first owner type.

Conceptual tables:

- `agent_loop_contexts`
- `agent_loop_events`

Context fields:

```ts
interface AgentLoopContext {
  id: string;
  ownerType: string;
  ownerId: string;
  contextKey: string;
  policy: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}
```

Event fields:

```ts
type AgentLoopEventKind =
  | 'input'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'artifact'
  | 'summary'
  | 'contract_result'
  | 'error';
```

The store records trace and reusable context. It should not be treated as user chat history.

## Context Policies

- `none`: no prior context is loaded.
- `step-local`: context is retained only inside one runner invocation. This supports multi-turn tool loops such as permission review file reads.
- `workflow-artifacts`: inject selected prior workflow step outputs/artifacts/summaries, not full natural-language history.
- `workflow-thread`: reuse an agent-loop context by `(ownerType, ownerId, contextKey)` across multiple runner calls, with summarization when needed.

Default for workflow AI steps:

- `ai_risk_analysis`: `step-local`
- `ai_prompt`: `workflow-artifacts`
- `ai_review`: `workflow-artifacts`

Workflow authors can opt into `workflow-thread` for intentionally continuous multi-step review/fix/verify loops.

## Output Contracts

First pass implements JSON output contracts:

```ts
type OutputContract =
  {
    type: 'json';
    schema: Record<string, unknown>;
    repairAttempts?: number;
  };
```

The type shape should reserve room for later contracts:

```ts
type FutureOutputContract =
  | { type: 'finish_tool'; toolName: string; schema: Record<string, unknown> }
  | { type: 'text' };
```

JSON parsing should support one repair attempt by prompting the model to return valid JSON only. If repair fails, the run returns `contract_failed`, and the step executor maps that to the appropriate `StepResult`.

## Builtin Toolsets

First pass allows only builtin toolsets registered by the application:

- `none`: no tools.
- `permission-review`: restricted review file read and no mutation tools.
- `code-review-readonly`: read/search/git-diff oriented tools only.
- `workflow-prompt-readonly`: read/search tools for general workflow prompts.

Toolsets are declared in a registry:

```ts
interface AgentLoopToolsetDescriptor {
  id: string;
  tools: string[];
  createOverrides?: (ctx: ToolsetContext) => Record<string, AgentTool>;
  permissionMode: 'deny-external' | 'allow-declared-tools' | 'custom';
}
```

Future plugin extensibility should register toolsets, not arbitrary ad hoc tools on each run.

## Workflow Migration

The first implementation migrates all workflow AI steps:

### `ai_risk_analysis`

- Uses `permission-review` toolset.
- Uses `step-local` context.
- Uses JSON contract:
  - `decision: approve | deny | uncertain`
  - `reasoning: string`
  - `confidence: number`
  - optional metadata
- Reads AI review config from the effective permission policy and node overrides.
- Does not share natural-language history across permission requests.
- Disabled AI review returns `uncertain` and leaves the permission pending for manual decision.

### `ai_prompt`

- Uses `workflow-prompt-readonly` or `none`, depending on node config.
- Uses `workflow-artifacts` context by default.
- Uses JSON contract with `{ result: string }` by default.
- Returns `output.result` without creating a background chat session.

### `ai_review`

- Uses `code-review-readonly` toolset.
- Uses `workflow-artifacts` context by default.
- Uses JSON contract for review verdict:
  - `reviewPassed: boolean`
  - `reviewNotes: string`
  - optional findings
- Replaces marker-string parsing with contract parsing.

## Runtime Differences From Full Agent Runs

Full conversation runtime:

- User-session oriented.
- Reads session tree history.
- Emits WebSocket run lifecycle events.
- Persists chat messages.
- Updates active run state and UI.
- Uses agent profile tools and user-facing permission flows.

Lightweight runner:

- Internal task oriented.
- Reads only explicit context policy inputs.
- Emits no user-facing run lifecycle by default.
- Persists neutral agent-loop context/trace events.
- Uses explicit builtin toolsets.
- Uses internal permission mode and bounded loop limits.
- Returns structured output to the caller.

## Error Semantics

- Model/provider configuration failure: `failed`.
- Timeout: `timeout`.
- Invalid output after repair attempts: `contract_failed`.
- Tool denial inside allowed boundary: contract-specific result when possible, otherwise `failed`.
- AI review disabled: successful step with `decision: uncertain`, not a runner failure.

Step executors choose how to map runner status to `StepResult`, but the runner status vocabulary stays shared.

## Testing Strategy

- Unit test context store create/append/load behavior for each context policy.
- Unit test output contract parsing and repair failure behavior.
- Unit test builtin toolset registry and denial of unknown toolsets.
- Unit test runner with fake model/stream and fake tools for max-turn, timeout, and JSON-contract paths.
- Integration test workflow `ai_prompt`, `ai_review`, and `ai_risk_analysis` all route through `AgentLoopRunnerPort`.
- Regression test that workflow AI steps do not create background sessions or normal chat messages.
- Regression test that `ai_risk_analysis` does not reuse context across permission requests by default.

## Rollout Plan

1. Add neutral agent-loop context schema and repository.
2. Add output contract parser with JSON support.
3. Add builtin toolset registry.
4. Add `LightweightAgentRunner` backed by pi-runtime primitives.
5. Inject `AgentLoopRunnerPort` into workflow domain.
6. Migrate `ai_prompt`, `ai_review`, and `ai_risk_analysis`.
7. Remove workflow dependency on `VirtualClientAIRunner`.
8. Keep full `PiAgentProviderAdapter` unchanged.

## Open Extension Points

- Finish-tool output contracts.
- Plugin-registered toolsets.
- Non-workflow consumers such as local PR and supervision.
- UI surfaces for inspecting agent-loop traces.
- Context summarization policy for long `workflow-thread` usage.
