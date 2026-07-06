# Claude Runtime Phase C Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify Claude slash command metadata and pass-through behavior end to end without adding a local Claude command execution layer.

**Architecture:** Keep command discovery backed by `scanCustomCommands` and the provider commands HTTP route. The desktop command handler forwards provider commands and unknown slash inputs to the active runtime, so Claude Code slash commands and ordinary absolute paths are not swallowed by zclaudia local command execution.

**Tech Stack:** TypeScript, Vitest, Express route tests, React hook tests.

---

## File Structure

- Create `server/src/interfaces/http/__tests__/provider-commands.test.ts`
  - Verifies `/api/providers/type/claude/commands` returns scanner-backed user/project/plugin command metadata.
- Create `apps/desktop/src/hooks/chat/useCommandHandler.provider.test.ts`
  - Verifies provider commands and unknown slash commands are forwarded through `startRun`.
- Modify `docs/plans/claude-runtime-completion.md`
  - Mark Phase C implemented when verification passes.

## Task 1: Provider Command Metadata

- [x] Add a route test for `/api/providers/type/claude/commands`.
- [x] Verify scanner-backed custom and plugin commands are returned.
- [x] Verify `projectRoot` is passed into discovery.

## Task 2: Desktop Pass-Through Behavior

- [x] Add hook tests for provider command forwarding.
- [x] Add hook tests for unknown slash command forwarding.
- [x] Verify plugin commands still fall through to command execution instead of runtime pass-through.

## Task 3: Verification

- [x] Run focused server and desktop tests.
- [x] Run server build and hygiene checks.

## Self-Review

- This phase does not implement custom slash command expansion inside zclaudia.
- Claude SDK plugin loading is already covered by Phase A config loading.
- Unknown slash inputs remain runtime pass-through, matching Claude Code behavior and avoiding accidental local interception.
