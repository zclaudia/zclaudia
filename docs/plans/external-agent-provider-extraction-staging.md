# External Agent Provider Extraction Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Claude and external-agent plugin boundary code into one cohesive directory that can later be extracted from the repository.

**Architecture:** Keep zclaudia core bridge implementations in core locations, and move only external-agent provider code under `server/src/infra/providers/external-agents`. `external-agents/agent-plugin` defines the portable contract/helpers for external agent providers; `external-agents/claude` is the built-in Claude implementation that will eventually become a plugin package.

**Tech Stack:** TypeScript, Vitest, existing provider registry, existing Claude Agent SDK adapter.

---

## File Structure

- Move `server/src/infra/providers/agent-plugin/*` to `server/src/infra/providers/external-agents/agent-plugin/*`.
- Move `server/src/infra/providers/claude-agent/*` to `server/src/infra/providers/external-agents/claude/*`.
- Update imports in provider registry, tests, smoke script, and documentation references.
- Do not move `server/src/utils/mcp-bridge-launch.ts` or `server/src/application/plugins/mcp-bridge.ts`; those are zclaudia core capabilities consumed by external agents.

## Task 1: Move External Agent Files

- [x] Move directories with `git mv`.
- [x] Update TypeScript imports from `claude-agent` and `agent-plugin` paths to `external-agents/claude` and `external-agents/agent-plugin`.
- [x] Run focused tests:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts src/infra/providers/external-agents/claude/__tests__/config.test.ts src/infra/providers/__tests__/registry.test.ts
```

## Task 2: Update Docs And Verify

- [x] Update Claude migration docs to name the new `external-agents` staging directory.
- [x] Run final verification:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts src/infra/providers/external-agents/claude/__tests__/config.test.ts src/infra/providers/__tests__/registry.test.ts
corepack pnpm --filter @zclaudia/server smoke:claude-runtime
corepack pnpm --filter @zclaudia/server build
git diff --check
git ls-files docs/superpowers | wc -l
```

Expected: tests, smoke, and build pass; `git diff --check` prints nothing; `docs/superpowers` tracked count remains `0`.

## Self-Review

- Scope is limited to extraction staging and import/doc updates.
- No zclaudia core bridge implementation is moved.
- No behavior change is intended.
