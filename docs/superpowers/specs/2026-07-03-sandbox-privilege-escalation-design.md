# Bash/Eval Sandbox Privilege Escalation — Design

**Date:** 2026-07-03
**Status:** Approved (pending spec review)

## Problem

Bash and Eval both run through the sandbox, but privilege escalation behavior is incomplete and inconsistent.

Current behavior:

- Foreground Bash starts sandboxed and has a narrow network escalation loop. It detects selected network failures, asks for `SandboxNetworkAccess`, persists approved hosts for the session, then reruns the whole command.
- Background Bash receives sandbox metadata, but cannot request permission after it has started.
- Foreground Eval starts its persistent Node kernel through the same sandbox wrapper as Bash, but it has no network escalation loop and no permission callback.
- Background Eval also uses the sandbox wrapper directly and cannot request permission.
- The Bash network detector relies on failure text such as `curl: (...)` or `ECONNREFUSED`. Silent commands such as `curl -s http://127.0.0.1:8000/health` can fail with only exit code 7, leaving the model to guess whether the failure was caused by sandbox policy, a dead service, a wrong port, or another ordinary runtime problem.

The result is that the model may infer "needs escalation" from any failed tool call, even when the runtime has not established that the sandbox is the cause.

## Goal

Create one privilege escalation architecture for Bash and Eval that:

- keeps sandboxed execution as the default;
- supports least-privilege capability grants first, especially network targets;
- supports explicit one-shot unsandboxed execution when needed and approved;
- avoids treating ordinary tool failures as permission failures;
- gives the model structured failure classification and recommended next steps instead of forcing it to guess;
- applies consistently to foreground Bash, background Bash, foreground Eval, and background Eval.

Non-goals for the first implementation:

- Do not implement arbitrary filesystem capability grants yet. Existing workspace/read-only filesystem diagnostics should be migrated into the shared classifier, but new file access grants can come later.
- Do not make unsandboxed execution rememberable by default.
- Do not redesign the global permission policy UI beyond the new permission request types and logs needed for this flow.

## Design

### 1. Evidence-gated failure classification

Tool failure does not imply permission failure. Sandbox-related failures are classified by a shared classifier:

```ts
type SandboxFailureClassification =
  | 'confirmed_sandbox_denial'
  | 'probable_sandbox_denial'
  | 'ambiguous_failure'
  | 'not_sandbox_denial';
```

Classification rules:

- `confirmed_sandbox_denial` — clear runtime/sandbox evidence exists, such as known sandbox filesystem denial text or network denial signals paired with an ungranted target.
- `probable_sandbox_denial` — strong but incomplete evidence exists, such as sandboxed execution, a command/code snippet containing an ungranted URL, a network-like exit/error, and suppressed stderr.
- `ambiguous_failure` — the tool failed, but there is not enough evidence to assign it to sandbox policy.
- `not_sandbox_denial` — the failure has a known ordinary cause, such as command not found, test failure, HTTP 404, schema error, or timeout without sandbox indicators.

Only `confirmed_sandbox_denial` automatically enters least-privilege permission flow. `probable_sandbox_denial` may recommend escalation, but must surface that the diagnosis is inferred. `ambiguous_failure` must not request permission automatically.

### 2. Shared sandbox execution controller

Add a shared runtime layer, e.g.:

```text
server/src/infra/providers/pi-runtime/sandbox-execution/
  controller.ts
  classifier.ts
  grants.ts
  permissions.ts
  result-shape.ts
```

Responsibilities:

- build sandbox wrapper options from workspace root, read-only mode, and session grants;
- run the requested operation sandboxed by default;
- classify failed results;
- request least-privilege capability permissions when evidence is strong enough;
- persist approved session grants;
- rerun the operation after approved grants;
- request one-shot unsandboxed execution only when explicitly requested or when a capability retry still shows sandbox blockage;
- return a consistent result shape to Bash, Eval, and their background task launch paths.

The controller should be the only module that decides whether a failed sandboxed operation becomes a permission request.

### 3. Grant model

First implementation supports network grants:

```ts
type SandboxGrant = {
  type: 'network';
  protocol?: 'http' | 'https';
  host: string;
  port?: number;
};
```

Grant identity includes protocol, host, and port when known. This matters for localhost workflows: `127.0.0.1:8000` and `127.0.0.1:3000` are different capabilities.

Approved capability grants are session-scoped and feed `extraAllowedDomains` or the sandbox runtime's closest available network allow-list representation. If the underlying sandbox only supports domain-level allow-lists, the controller must still log the more precise requested target and note the applied granularity.

### 4. Permission request types

Replace the overloaded network-only request with two explicit permission request types:

- `SandboxCapabilityAccess` — asks for a specific least-privilege capability, such as network access to `http://127.0.0.1:8000`.
- `SandboxUnsandboxedAccess` — asks to run the current Bash command or Eval cell outside the sandbox once.

`SandboxCapabilityAccess` may be remembered for the session. `SandboxUnsandboxedAccess` is one-shot and not remembered by default.

Permission copy must distinguish evidence from model intent:

- confirmed capability request: "The sandbox blocked access to X. Approving allows X for this session and reruns the operation."
- probable capability request: "This looks like a sandbox network block because of evidence A/B, but it is not confirmed."
- unsandboxed request: "The model is requesting host execution for this one tool call. This does not prove the previous failure was caused by sandbox policy."

### 5. Tool schema

Bash and Eval both gain the same privilege controls:

```ts
sandbox_mode?: 'auto' | 'sandbox' | 'unsandboxed';
privilege_reason?: string;
```

Semantics:

- `auto` — default. Run sandboxed first. Runtime may request least-privilege capability access only when evidence supports it. Runtime may request unsandboxed access only after an explicit model request or after capability retry still shows sandbox blockage.
- `sandbox` — run sandboxed only. Capability grants may be requested, but unsandboxed execution is forbidden for this call.
- `unsandboxed` — model explicitly requests one-shot host execution. The runtime must ask for `SandboxUnsandboxedAccess` before running.

If `sandbox_mode: 'unsandboxed'` is supplied without `privilege_reason`, the tool should fail with a structured error asking the model to state why host execution is necessary.

### 6. Result shape and model guidance

Bash and Eval return a shared sandbox diagnostic block in `details`:

```ts
interface SandboxExecutionDetails {
  sandboxed: boolean;
  privilegeMode: 'sandbox' | 'capability-granted' | 'unsandboxed';
  failureClassification?: SandboxFailureClassification;
  sandboxEvidence?: {
    matchedSignals: string[];
    candidateTargets: string[];
    missingSignals: string[];
    inference?: string;
  };
  grantsUsed?: SandboxGrant[];
  escalationRequested?: boolean;
  unsandboxedApproved?: boolean;
  recommendedNextStep?: string;
}
```

`agent-hooks` should generate `[fix]` hints from this structured block rather than from Bash-only ad hoc details. Example for the silent curl case:

```json
{
  "sandboxed": true,
  "failureClassification": "ambiguous_failure",
  "sandboxEvidence": {
    "matchedSignals": [],
    "candidateTargets": ["http://127.0.0.1:8000"],
    "missingSignals": ["curl used -s, so stderr was suppressed"]
  },
  "recommendedNextStep": "Re-run with curl -sS, or check whether the service is listening before requesting escalation."
}
```

This prevents the model from turning an unsupported guess into a permission claim.

### 7. Bash integration

Foreground Bash:

- delegates sandbox wrapping, denial classification, permission requests, grant persistence, and retries to the shared controller;
- no longer owns the network escalation loop directly;
- still owns shell-specific command validation, critical command checks, file bypass guards, routing guards, output capture, and background handoff.

Background Bash:

- does not prompt after launch;
- foreground Bash must resolve required grants or unsandboxed approval before creating the background task;
- the task metadata records the resolved privilege plan, grants used, and whether the task is unsandboxed;
- `CommandTaskExecutor` consumes the resolved plan instead of rebuilding privilege policy from partial metadata.

### 8. Eval integration

Foreground Eval:

- delegates privilege decisions to the shared controller before starting or reusing a kernel;
- keys persistent kernels by session, read-only mode, and effective sandbox grant set;
- restarts the sandboxed kernel when grants change;
- keeps unsandboxed Eval separate from sandboxed kernels.

Unsandboxed Eval should default to one-shot execution of the current cell. If a persistent unsandboxed kernel is ever desired, that should be a separate explicit design decision because it preserves host-level state across calls.

Background Eval:

- foreground Eval resolves grants or unsandboxed approval before creating the task;
- task metadata records the resolved privilege plan;
- `EvalTaskRuntime` consumes the resolved plan and does not independently decide whether to escalate.

### 9. Data flow

Default flow:

```text
tool call
  -> controller runs sandboxed
  -> success: return
  -> failure: classifier assigns evidence level

confirmed_sandbox_denial
  -> request SandboxCapabilityAccess
  -> approved: persist session grant, rerun sandboxed
  -> denied: return denied result with evidence

probable_sandbox_denial
  -> if model explicitly requested escalation: ask permission with inferred wording
  -> otherwise return structured diagnostic and recommended next step

ambiguous_failure
  -> no permission request
  -> return diagnostic and next step

not_sandbox_denial
  -> normal failure result
```

Capability retry flow:

```text
capability grant approved
  -> rerun sandboxed with grant
  -> success: return
  -> failure: classify again
  -> still sandbox-related and unsandboxed allowed/requested
      -> request SandboxUnsandboxedAccess
      -> approved: rerun once unsandboxed
      -> denied: return failed sandboxed result with evidence
```

Explicit unsandboxed flow:

```text
sandbox_mode = unsandboxed
  -> require privilege_reason
  -> request SandboxUnsandboxedAccess
  -> approved: run once outside sandbox
  -> denied: return denied result; do not run
```

## Error Handling

- Permission callback missing:
  - capability-required calls return a structured `permission_channel_unavailable` error;
  - explicit unsandboxed calls never run without a permission callback.
- Sandbox unavailable:
  - normal mode may keep existing fail-open behavior for sandboxed Bash/Eval only if no elevated privilege was requested;
  - read-only plan mode and critical-risk calls remain fail-closed;
  - explicit `sandbox_mode: 'sandbox'` fails if sandbox isolation is required but unavailable.
- Ambiguous failures:
  - no automatic permission prompt;
  - return evidence and a diagnostic next step.
- User denies capability:
  - return the original failed result plus denied escalation metadata.
- User denies unsandboxed:
  - do not run outside sandbox; return a denied result with the model's requested reason.

## Testing Strategy

Backend unit tests:

- classifier assigns `confirmed_sandbox_denial`, `probable_sandbox_denial`, `ambiguous_failure`, and `not_sandbox_denial` for representative Bash and Eval failures;
- silent curl with `-s` does not become confirmed denial;
- `curl -sS` with a blocked ungranted target becomes confirmed or probable according to observed sandbox output;
- Eval `fetch()` network errors are classified using JS error text and code-derived candidate targets;
- grants normalize protocol/host/port consistently;
- explicit `sandbox_mode: 'unsandboxed'` requires `privilege_reason`.

Integration tests:

- foreground Bash confirmed network denial asks `SandboxCapabilityAccess`, persists the grant, and reruns sandboxed;
- foreground Eval confirmed/probable network denial follows the same permission path;
- capability denial returns evidence and does not rerun with the grant;
- explicit unsandboxed Bash asks `SandboxUnsandboxedAccess` and runs once only after approval;
- explicit unsandboxed Eval does not reuse the sandboxed kernel;
- background Bash/Eval tasks consume a resolved privilege plan and never prompt after launch.

Regression tests:

- plan mode read-only failures still steer toward `ExitPlanMode`, not unsandboxed execution;
- command-not-found, HTTP 404, test failures, and timeouts without sandbox evidence do not request permission;
- existing `SandboxNetworkAccess` behavior remains compatible during migration or is covered by a deliberate alias test.

## Migration Plan

1. Add classifier, grant normalization, result shape helpers, and tests.
2. Add new permission request names while keeping `SandboxNetworkAccess` as a compatibility alias if needed.
3. Move foreground Bash network escalation into the controller.
4. Add Bash schema fields and explicit unsandboxed permission flow.
5. Route foreground Eval through the controller and add schema fields.
6. Change background Bash and Eval to consume resolved privilege plans.
7. Move Bash-specific sandbox remediation into the shared result-driven hint path.
8. Remove or deprecate duplicated ad hoc sandbox escalation code.

## Affected Files

- `server/src/infra/providers/pi-runtime/bash-tool.ts`
- `server/src/infra/providers/pi-runtime/eval-tool.ts`
- `server/src/infra/providers/pi-runtime/eval-kernel.ts`
- `server/src/infra/providers/pi-runtime/eval-task-runtime.ts`
- `server/src/domains/tasks/executors/command-executor.ts`
- `server/src/infra/providers/pi-runtime/sandbox.ts`
- `server/src/infra/providers/pi-runtime/sandbox-denial.ts`
- `server/src/infra/providers/pi-runtime/remediation.ts`
- `server/src/infra/providers/pi-runtime/agent-hooks.ts`
- `server/src/infra/providers/pi-agent/adapter.ts`
- `server/src/application/conversation/runtime/run-permissions.ts`
- `shared/src/interaction/permissions.ts`
- related Bash/Eval/sandbox permission tests under `server/src/infra/providers/pi-runtime/__tests__`
