# Claude Runtime Phase E Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Claude runtime migration with a documented verification gate and replication handoff for Codex and Cursor.

**Architecture:** Treat the regular gate as deterministic local tests/builds plus the non-live smoke path. Keep the real Claude Agent SDK smoke opt-in because it requires local Claude Code authentication and may spend tokens. Mark advanced features not implemented in Phase D as explicit unsupported capabilities rather than migration blockers.

**Tech Stack:** TypeScript, Vitest, server/desktop builds, opt-in Claude Agent SDK smoke script, migration docs.

---

## Task 1: Documentation Closure

- [x] Update `docs/plans/claude-runtime-completion.md` so completed phases no longer appear as remaining gaps.
- [x] Mark Phase E complete after the verification matrix passes.
- [x] Update `docs/plans/agent-runtime-codex-cursor-replication.md` with the finalized external-agent directory, config loading, tool bridge, slash command, and capability truthfulness requirements.
- [x] Update `docs/plans/claude-runtime-smoke-check.md` to distinguish deterministic non-live smoke from opt-in live SDK smoke.

## Task 2: Verification Matrix

- [x] Run server runtime/provider tests for Claude adapter, config, registry, provider commands, provider capabilities, command scanner, MCP bridge, and agent-plugin bridge.
- [x] Run conversation runtime focused tests.
- [x] Run desktop focused tests for ProfileEditor, provider capabilities, and command handling.
- [x] Run `smoke:claude-runtime` without `--live`.
- [x] Run shared, server, and desktop builds.
- [x] Run `git diff --check`.
- [x] Confirm `docs/superpowers` tracked count remains `0`.

## Live Smoke

Optional command for a machine with Claude Code authentication:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime -- --live --cwd=/path/to/project
```

Expected live behavior:

- Prints Claude Code MCP server and enabled local plugin counts loaded from `~/.claude`.
- Starts a Claude SDK session.
- Resumes the same provider session id.
- Exercises AbortController cancellation.

## Self-Review

- Claude migration is complete for supported capabilities: chat, resume, cancel, permissions, config/plugins, MCP bridge, slash command metadata/pass-through, and capability truthfulness.
- AI review, multimodal attachments/fallback, and background task controls remain explicitly unsupported and are not blockers for Codex/Cursor replication.
