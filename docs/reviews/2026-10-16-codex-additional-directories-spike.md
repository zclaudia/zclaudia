# Codex additional directories — spike (2026-10-16)

Plan reference: `docs/plans/2026-10-16-multi-directory-projects-plan.md` §7.
Probed against the **pinned** binary `plugins/agents/codex/engine/darwin-arm64/bin/codex` = `codex-cli 0.154.0`,
driven over `app-server --listen stdio://` JSON-RPC with real model turns.
Isolation: throwaway dirs `~/zcprobe-spike/{A,B,C}` (deliberately **not** under `/tmp`, because workspace-write
always makes `/tmp` and `$TMPDIR` writable and would confound the result), per-probe `CODEX_HOME`
(only `auth.json` symlinked in), no `~/.zclaudia` access. Probe dirs deleted afterwards. No product code touched.

## Verdict

**`native`** — Codex 0.154.0 accepts extra writable roots natively, without `experimentalApi`.
Reads outside cwd already work with no roots configured.

## Findings

### 1. Baseline: cwd=A, `workspace-write`, agent touches unrelated dir B

`thread/start {cwd:A, approvalPolicy:"on-request", sandbox:"workspace-write"}`; prompt asks for
`cat B/readme.txt`, `echo x > B/write.txt`, `echo x > A/write.txt` as three shell calls.

- **Read of B: allowed** (exit 0, no approval). Reads are unrestricted.
- **Write to B: blocked by the OS sandbox** (`zsh:1: operation not permitted`), exit 1.
  Whether the host sees an approval depends on the model: in the first 4 runs with no extra roots (s1, s2, s6a, s7) the model simply reported the EPERM
  (no `item/*/requestApproval` ever sent → effectively a hard fail); in later runs with an unconfigured
  dir (s8 turns on C, s9, s9c on B) the model escalated and Codex sent `item/commandExecution/requestApproval`
  (`reason: "Allow writing write-s9.txt in B, which is outside the current writable roots?"`,
  `command`, `cwd`, `proposedExecpolicyAmendment`). So approval-driven fallback exists but is
  **model-initiated and non-deterministic**, and the request has no structured target path
  (only free-text `command`/`reason`). Not a reliable basis for a `host` tier.

### 2. Fields that grant writable roots (all verified writing into B)

Experimental schema generated with `codex app-server generate-json-schema --experimental`.
Relevant fields: `ThreadStartParams/ThreadResumeParams`: `sandbox` (enum string), `config` (free object),
`runtimeWorkspaceRoots`, `permissions`; `TurnStartParams`: `sandboxPolicy`, `runtimeWorkspaceRoots`, `permissions`.

| # | Payload | experimentalApi | Result |
|---|---|---|---|
| s5 | `thread/start {..., sandbox:"workspace-write", config:{"sandbox_workspace_write":{"writable_roots":["B"],"network_access":true}}}` | false | **works**; response `sandbox.writableRoots=[B]`, `runtimeWorkspaceRoots=[A,B]`; write B exit 0 |
| s5c | spawn with `-c 'sandbox_workspace_write.writable_roots=["B"]'` (process-level) | false | **works** (contradicts the `config.ts` comment that `-c sandbox_*` has no effect — only true for `sandbox_permissions`) |
| s4n | `turn/start {..., sandboxPolicy:{"type":"workspaceWrite","writableRoots":["B"],"networkAccess":true}}` | false | **works** |
| s3 | `thread/start {..., runtimeWorkspaceRoots:["A","B"]}` | true | works (response shows sandbox.writableRoots=[B]) |
| s3n | same as s3 | false | **rejected**: `-32600 thread/start.runtimeWorkspaceRoots requires experimentalApi capability` |

Note `sandboxPolicy` replaces the whole policy: `networkAccess` must be re-stated (default false), otherwise the
loopback `push_file` flow that `config.ts` enables via `sandbox_workspace_write.network_access=true` breaks.

### 3. Can roots change after the thread exists?

- **Same loaded thread, next turn: yes** via `turn/start.sandboxPolicy`. Probe s8: turn 1 with
  `sandboxPolicy.writableRoots=[B]`; turn 2 with **no** override still wrote B (the policy persists for
  "this turn and subsequent turns", as the schema says); a later turn can replace it.
- **`thread/resume` on an already-loaded thread ignores overrides**: s8 resumed with
  `config.sandbox_workspace_write.writable_roots=[C]` → `RESUME_RESP.sandbox.writableRoots` stayed `[B]`, writing C
  still needed approval. Use `turn/start.sandboxPolicy` for live changes.
- **`thread/resume` in a fresh process: roots are NOT persisted.** s9: thread created with `config … [B]`, new
  process, `thread/resume {threadId, cwd}` → sandbox back to `writableRoots=[]`, write B needed approval.
  s9c: same resume with `config:{sandbox_workspace_write:{writable_roots:["C"]}}` → `writableRoots=[C]`, C
  writable, B not (override **replaces**, does not merge). So every resume must re-pass the full list.
- `thread/resume` for a thread without a rollout (no turn yet) errors `no rollout found for thread id …`
  (irrelevant to the design; just don't resume before the first turn).

## Recommended wiring in `plugins/agents/codex`

1. `app-server-client.ts` `startThread` / `resumeThread`: add `additionalDirectories?: string[]` option; when
   non-empty pass `sandbox: "workspace-write"` and
   `config: { sandbox_workspace_write: { writable_roots: dirs, network_access: true } }`.
   Must be passed on **every** `thread/resume` (also pass `cwd`, as in s9c).
   Prefer this per-thread `config` over `-c` process args (those feed the process cache key in `runner.ts`
   `getCacheKey`/`configSignature` and are shared by all threads of the process).
2. For project-settings changes mid-run: `turn/start` with `sandboxPolicy:{type:"workspaceWrite",writableRoots:dirs,networkAccess:true}`
   (keep `excludeSlashTmp`/`excludeTmpdirEnvVar` at their defaults to preserve current behaviour).
3. Keep `experimentalApi:false`; do not use `runtimeWorkspaceRoots` (requires experimental on thread/start and
   adds nothing for this goal).
4. Plan mode: do not add roots (plan mode must stay non-writing; the existing handler already declines writes).
5. Descriptor value: `additionalDirectories: 'native'`. Reads of any dir already work, so the plan's "outside
   workspace read prompt" never fires for Codex.
6. Update the stale comment in `config.ts` (`mapModeToConfigArgs`) — it claims sandbox config has no effect.
7. Existing approval flow stays the safety net for dirs that are not configured (approvals do arrive when the
   model escalates).

## Caveats / not covered

- Probed on macOS (seatbelt) only; Linux (bubblewrap/landlock) and Windows sandboxes honour the same policy
  object but weren't run.
- The pinned `runtime-compatibility.json` lists `testedMaximum` 0.144.1 / `minimum` 0.144.1 while the bundled
  engine is 0.154.0; fields above were verified on 0.154.0 only. A `protocol:check` bump or a quick re-run of
  s5/s4n against the minimum supported version is advisable before shipping.
- Model-driven behaviour (whether it escalates after EPERM) varied between runs; that is exactly why the native
  roots, not approvals, should be the mechanism.

## Probe harness (kept out of repo)

Node script speaking JSON-RPC to the pinned binary (`initialize` → `thread/start` or `thread/resume` → N × `turn/start`,
auto-answering `item/*/requestApproval` with `{decision:"decline"}` and logging each). Prompt used for every turn:

```
Use the shell tool. Run these three commands as three separate shell calls, in this order, and then report each
exit code and output verbatim, no other commentary:
1. cat <P>/B/readme.txt
2. echo <tag> > <P>/B/write-<tag>.txt
3. echo <tag> > <P>/A/write-<tag>.txt
```
