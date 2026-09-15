# Native agent context

Claude, Codex and Cursor use their own instructions, project discovery, memory,
skills and permission modes. Normal, assistant and background sessions no longer
append ZClaudia's workspace SOUL/AGENTS/TOOLS files, project CLAUDE.md copy, memory
index, skill catalog, persona templates or generic interaction/file-push guidance.
Pi's context assembly is unchanged.

An explicitly configured agent profile `systemPrompt` remains supported. Explicit
per-task context and supervised plan-document output requirements travel in the
ordinary message input. Native structured invocations retain their original
arguments. Native permissions still use the runtime's mode mapping.

## Tools

The session-bound MCP bridge is independent of prompt assembly. Tool names,
descriptions and schemas come from `tools/list`; `tools/call` executes them with
the bridge's session identity. In particular, `push_file` describes file delivery
and takes an absolute file path. No curl instruction or extra system prompt is
needed to expose it.

## Claude SDK mode

Both Claude modes explicitly select the native `claude_code` preset. SDK mode
loads project/local settings so the engine discovers CLAUDE.md itself, while
global user settings remain isolated. Before releasing the first user message,
the runner pins the bound connection through `applyFlagSettings` over the SDK
control channel. Credentials are not placed in command-line settings arguments
or a settings file. Failure to apply settings prevents message submission.

## Verification

- Server tests cover default prompt omission for all three runtimes across
  regular/assistant/background sessions, explicit profile instructions, task
  input, native permission modes and unchanged Pi assembly.
- Claude's local-engine tests use the real bundled engine and a local model API
  fixture. They inspect outgoing requests for native project instructions and
  MCP tools with and without a custom prompt, check connection precedence and
  transcript credential exclusion, and exercise session resume.
- Codex's local-engine test verifies native AGENTS.md loading without developer
  instructions and session resume against a local API fixture.
- `mcp.playwright.spec.ts` drives the complete application and real MCP bridge
  with deterministic vendor CLI fixtures (Cursor uses ACP). Each runtime lists
  and calls `push_file` successfully in two concurrent sessions and rejects
  forged cross-session calls. These tests verify integration, not live-model
  tool-selection behavior.

Existing vendor conversation history is retained. Earlier injected instructions
may still be present in old conversations; use a new session to evaluate the
default without that history. Explicit profile instructions are not erased.
