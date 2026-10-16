# Cursor agent: additional directories spike (2026-10-16)

Question (multi-directory plan §7, P0): can `cursor-agent`, as driven by `plugins/agents/cursor`, work with
directories beyond its `cwd`? Probed `cursor-agent 2026.09.15-d2fe57e` (macOS, logged in), ACP SDK
`@agentclientprotocol/sdk` 1.4.0. Probe only — no product code changed.

## Verdict: `host`

ACP gives no native multi-root support, but out-of-workspace **file writes** surface as ordinary
`session/request_permission` calls that the existing `AcpPermissionBridge` → host `canUseTool` path can
auto-answer. Reads are never gated. Shell calls are gated by command allowlist, not by directory, so they
cannot be auto-approved per root (see caveats).

## 1. Is there a native add-dir equivalent?

| Surface | Result |
| --- | --- |
| `cursor-agent --help` | Has `--workspace <path-or-name>` and `--add-dir <path>` ("Add an additional workspace root directory", repeatable) — **print/interactive mode only**. |
| `cursor-agent acp --help` | No options at all (`Usage: agent acp [options]`, only `-h`). No flag route for the ACP transport. |
| ACP `initialize` | `agentCapabilities.sessionCapabilities = { list: {} }`. **No `additionalDirectories` capability** (the ACP 1.4.0 schema defines `sessionCapabilities.additionalDirectories` and `additionalDirectories?: string[]` on `session/new`/`load`/`list`; Cursor does not advertise it). |
| ACP `session/new` with `additionalDirectories: [B]` | Accepted without error (response keys `sessionId, modes, models, configOptions`), **silently ignored**: behaviour is identical to the run without the field (§2). Do not rely on it. |
| Legacy `-p --output-format stream-json` + `--add-dir B` (the rollback transport in `runner.ts`) | Probed once per variant, `--trust --auto-review` (auto-review reported "unavailable… Falling back to Allowlist"): the edit tool to `B/written.txt` was `rejected` both with and without `--add-dir`; no file written either way. Headless has no approval path, so the flag did not unlock writes in this probe. Legacy is a gated rollback transport (`ZCLAUDIA_CURSOR_TRANSPORT=stream-json`); treat as `none`. |

Existing probe assets (`plugins/agents/cursor/probes/`, `docs/plans/2026-09-12-cursor-acp-migration.md` §2)
never covered extra roots; this spike is new ground. The plugin sends `newSession({ cwd, mcpServers })` /
`loadSession({ sessionId, cwd, mcpServers })` only (`acp-runner.ts:182-215`).

## 2. cwd=A, agent touches unrelated dir B

Harness: bare JSON-RPC client (`probes/lib/jsonrpc.mjs`, reused unmodified from a scratchpad script);
`cursor-agent acp` spawned with `cwd=A`; `initialize` (fs/terminal capabilities false) → `session/new` →
`session/prompt`. Every `session/request_permission` answered `reject_once` or `allow_once` per run.
Throwaway dirs `A/` (contains `inA.txt`) and `B/` (contains `secret.txt` = `CANARY-B-7391`); `B` is a sibling
of `A`, never a child. Removed afterwards.

Session payloads:

```json
{"method":"session/new","params":{"cwd":"<A>","mcpServers":[]}}
{"method":"session/new","params":{"cwd":"<A>","mcpServers":[],"additionalDirectories":["<B>"]}}
{"method":"session/prompt","params":{"sessionId":"…","prompt":[{"type":"text","text":
 "Do these two things using your file tools, then reply DONE: (1) read the file <B>/secret.txt and quote its content; (2) create the file <B>/written.txt containing the text hello-from-agent."}]}}
```

Results (B location matters — **under `$TMPDIR` nothing is gated, so test fixtures there prove nothing**):

| Run | B location | `additionalDirectories` | Read B | Write B (file edit tool) |
| --- | --- | --- | --- | --- |
| 1 | `/var/folders/…/T` (macOS tmp) | no | silent, canary quoted | **silent success**, 0 permission requests |
| 2 | same | `[B]` | silent | silent success |
| 3 | `~/.zclaudia-spike-tmp-*` (under `$HOME`) | no | **silent**, canary quoted | **`session/request_permission`**; reject → file not written |
| 4 | same | `[B]` | silent | **identical permission request** (twice after the agent retried); reject → not written |
| 5 | same | no, answer `allow_once` | silent | request → allow_once → file written (`hello-from-agent\n`) |
| 6 | same | no | — | write to `A/inside.txt` (inside cwd): **no request**, silent success |
| 7 | same | no | — | shell `echo shell-out > <B>/shell.txt`: request `kind:"execute"`, reject → not written |

Permission request shape for the out-of-workspace write (identical with/without `additionalDirectories`):

```json
{
  "toolCall": {
    "toolCallId": "call-…-1\nfc_…_1",
    "title": "Write <B>/written.txt",
    "kind": "edit",
    "status": "pending",
    "content": [{ "type": "diff", "path": "<B>/written.txt", "oldText": null, "newText": "hello-from-agent\n" }]
  },
  "options": [
    { "optionId": "allow-once",   "kind": "allow_once" },
    { "optionId": "allow-always", "kind": "allow_always" },
    { "optionId": "reject-once",  "kind": "reject_once" }
  ]
}
```

Shell variant: `title` = the command in backticks, `kind: "execute"`, `content` text = `"Not in allowlist: echo"`.

Conclusions:

- **Reads outside cwd: never prompt, never fail** (both under tmp and `$HOME`). Reading additional directories
  already works with no support needed. (Only one canary file was read; Cursor may still treat specific
  sensitive paths differently — not probed.)
- **Writes outside cwd: a permission request the host can answer**, as long as the host is answering ACP
  permission requests (the plugin does: supervised → host callback; bypass → auto `allow_once`). Denial
  and allowance are honoured exactly. This is the `host` behaviour.
- `additionalDirectories` on `session/new` has **no observable effect** — Cursor still treats B as outside.
- Writes under macOS `$TMPDIR` are exempt from the prompt (run 1) — don't use tmp for fixtures of the
  outside-workspace behaviour.
- Shell approval is allowlist-based (`Not in allowlist: <cmd>`), independent of directory. A shell command
  that writes into an additional root prompts exactly like any other command.

## 3. MCP injection and single-root assumptions

- **ACP transport (default for new sessions)**: `acp-mcp.ts` maps the ZClaudia bridge to an **inline stdio
  MCP server** passed in `session/new.mcpServers`. It writes nothing into the workspace and has no
  single-root assumption (no path inputs at all). Nothing needs changing for additional directories.
- **Legacy stream-json transport**: `mcp-inject.ts` writes `<cwd>/.cursor/mcp.json` (with env values
  externalized as `${ZCLAUDIA_CURSOR_BRIDGE_*}` placeholders) and removes/restores it in `cleanup`. It is
  inherently single-root (primary `cwd` only) but that is correct — MCP config is per-workspace, and extra
  roots don't need it. Rollback-only.
- Other single-root points that matter for P4:
  - `cwd` is passed to `spawn`, `session/new`, `session/load` and discovery sessions
    (`invocations.ts` `newSession(context.canonicalCwd)`); there is no roots list anywhere.
  - `AcpPermissionBridge.buildPermissionRequest` (`acp-permissions.ts`) forwards `toolName = title`
    (`"Write <path>"`), `toolInput = boundedToolInput(rawInput)` and `detail` — but the permission request
    from Cursor carries **no `rawInput` and (for edits) no `locations`**; the only structured path is
    `toolCall.content[].path` on `type:"diff"` entries. So today the host sees `toolInput = {}` for the
    write and would have to parse the path out of `title`/`detail`. P4 must add structured path extraction
    (diff `content[].path`, else `locations[].path`) before the host can match a write against configured
    roots.

## 4. What P4 needs if `host` is adopted

1. In `acp-permissions.ts` `buildPermissionRequest`, lift the path from `content[].path` (diff) /
   `locations` into `toolInput` (e.g. `{ path, kind }`) so the server's existing
   `resolveInsideWorkspaces`-style check can classify it. Edits only; do not guess paths from shell
   command strings.
2. Server side already auto-answers per project roots for other agents; Cursor edit requests then resolve
   to `allow_once` via the existing bridge (one-shot only — the plugin deliberately never selects
   `allow_always`; keep that). Each write will still round-trip through `session/request_permission`
   (an extra hop vs `native`) but needs no user prompt for configured roots.
3. Shell: no per-directory behaviour exists to hook; shell writes into additional roots keep going through
   the normal supervised approval flow. Descriptor value `additionalDirectories: 'host'` should be
   documented as "file edits to additional directories are auto-approved; shell commands still ask".
4. Prompt text: tell the agent the additional paths (reads work natively; writes will be approved).
   Do **not** pass `additionalDirectories` on `session/new`/`session/load` — ignored today, but a future CLI
   that starts honouring it can be adopted by flipping the verdict to `native` after re-running these probes
   (capability check: `initialize.agentCapabilities.sessionCapabilities.additionalDirectories`).
5. Bypass mode (`supervised: false`) already auto-allows every request, so no extra work there.

## Caveats / not probed

- One short LLM turn per run, single model default; behaviour of Cursor's own workspace-trust heuristics for
  other path classes (dotfiles, `.git`, system dirs) was not explored.
- `session/load` (resume) with extra directories was not run; since the field is ignored on `session/new`
  it is expected to be ignored there too.
- Plan/ask modes (`session/set_mode`) were not re-probed with extra roots; the existing plan-mode isolation
  rule (`probes/probe-plan-mode.mjs`) still applies.
- Runs were made with the real `$HOME` for Cursor auth/keychain; ZCLAUDIA_DATA_DIR was not used because no
  zclaudia server was involved (probe talks to `cursor-agent acp` directly).
