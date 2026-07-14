# Codex Agent Runtime Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@zclaudia/plugin-codex` so agents with `runtimeType: 'codex'` can chat via `codex app-server`, resume/cancel threads, bridge host MCP tools, forward approval requests to the host, and normalize plan-mode tools into shared runtime events.

**Architecture:** Mirror `plugins/cursor`: declarative `plugin.json` contributes the runtime descriptor + default profile; `activate` registers `CodexAgentAdapter` (`ExternalAgentAdapter`) that manages App Server JSON-RPC, maps notifications to `ProviderRuntimeEvent`, writes MCP bridge config to `$ZCLAUDIA_DATA_DIR/codex-config`, and bridges approval server requests via `onPermission`. Host adds HTTP capabilities/modes for `codex`.

**Tech Stack:** TypeScript (ESM), Vitest, Node `child_process` + `readline`, `@zclaudia/shared` provider types, existing plugin contribution loader.

## Global Constraints

- Package lives at `plugins/codex` only — do **not** add `server/src/infra/providers/external-agents/codex`.
- Runtime path: **`codex app-server --listen stdio://`** (not legacy `@openai/codex-sdk`).
- Phase 1 scope B: chat stream, resume, cancel, MCP bridge inject, approval bridge, plan event normalization, modes `default`/`plan`/`acceptEdits`/`bypassPermissions`.
- Defer: form/todo interaction UI, image attachments, DB/user MCP injection, CLI jobs, AI review, live smoke in CI, SDK rate-limit auto-retry.
- Capability claims stay truthful (see design spec manifest table).
- Missing adapter fails closed; never fall back to `zclaudia`.
- `modeSwitchSessionPolicy: 'preserve'`; `escalateAlwaysTools: ['ExitPlanMode']`.
- Auth: local `codex` CLI only; do not wire zclaudia LLM OAuth into runtime execution.
- MCP config dir: `$ZCLAUDIA_DATA_DIR/codex-config` (fallback `~/.zclaudia/codex-config`).
- Session env: `ZCLAUDIA_SESSION_ID` (also set `CLAUDIA_SESSION_ID` for bridge compatibility).
- Spec: `docs/plans/2026-07-14-codex-agent-runtime-plugin-design.md`.
- Source ports: `my-claudia/server/src/infrastructure/providers/codex-app-server*.ts`, `codex/codex-app-server-client.ts`, `codex/codex-config.ts`.

## File Structure

**Create**

- `plugins/codex/package.json` — `@zclaudia/plugin-codex`
- `plugins/codex/tsconfig.json` — match Claude plugin
- `plugins/codex/plugin.json` — `agentRuntimes` + `agentProfiles`
- `plugins/codex/src/main.ts` — activate/deactivate
- `plugins/codex/src/adapter.ts` — `CodexAgentAdapter`
- `plugins/codex/src/runner.ts` — client cache, thread lifecycle, session recovery
- `plugins/codex/src/app-server-client.ts` — JSON-RPC process + runTurn
- `plugins/codex/src/config.ts` — MCP TOML, env, modes, input prep, trust
- `plugins/codex/src/map-events.ts` — notifications/items → `ProviderRuntimeEvent`
- `plugins/codex/src/permissions.ts` — approval routing + mode rules
- `plugins/codex/src/tool-effects.ts` — shell/file effects
- `plugins/codex/src/resolve-cli.ts` — PATH / `cliPath` resolution
- `plugins/codex/src/__tests__/*.test.ts` — unit tests per module

**Modify**

- `.gitignore` — add `!/plugins/codex/` (mirror cursor/claude)
- `server/src/interfaces/http/provider-capabilities.ts` — add `CODEX_CAPABILITIES`
- `server/src/interfaces/http/provider-commands.ts` — allow `codex` type
- `server/src/interfaces/http/__tests__/provider-capabilities.test.ts`
- `server/src/interfaces/http/__tests__/provider-commands.test.ts`
- `server/src/application/plugins/__tests__/codex-plugin-lifecycle.test.ts`

**Do not modify for phase 1**

- Profile editor (descriptors from plugin contributions)
- my-claudia tree
- zclaudia LLM OAuth modules

---

### Task 1: Scaffold Plugin Package And Manifest

**Files:**
- Create: `plugins/codex/package.json`
- Create: `plugins/codex/tsconfig.json`
- Create: `plugins/codex/plugin.json`
- Create: `plugins/codex/src/main.ts`
- Create: `plugins/codex/src/adapter.ts` (stub)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `@zclaudia/shared/plugins` `PluginContext`; `@zclaudia/shared/providers` `ExternalAgentAdapter`
- Produces: package `@zclaudia/plugin-codex`; plugin id `com.zclaudia.codex`; runtime type `codex`; stub `CodexAgentAdapter`

- [ ] **Step 1: Create package.json and tsconfig.json**

`plugins/codex/package.json`:

```json
{
  "name": "@zclaudia/plugin-codex",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@zclaudia/shared": "workspace:*",
    "@types/node": "^22.13.10",
    "typescript": "^5.9.3",
    "vitest": "^4.1.8"
  }
}
```

`plugins/codex/tsconfig.json` — copy from `plugins/claude/tsconfig.json` unchanged.

- [ ] **Step 2: Write plugin.json**

`plugins/codex/plugin.json`:

```json
{
  "id": "com.zclaudia.codex",
  "name": "Codex Agent",
  "version": "0.1.0",
  "description": "Run OpenAI Codex via codex app-server as a zclaudia agent runtime.",
  "main": "dist/main.js",
  "executionMode": "main",
  "platform": "desktop",
  "engines": { "claudia": "*" },
  "permissions": ["provider.register", "provider.call", "network.fetch"],
  "contributes": {
    "agentRuntimes": [
      {
        "type": "codex",
        "label": "Codex",
        "model": { "kind": "none", "multimodalFallback": false, "thinkingLevel": "auto" },
        "hasCliPath": true,
        "capabilities": { "tools": "native-readonly", "providers": "external", "skills": "external" },
        "authNote": "Codex uses the local codex CLI (codex app-server). Sign in via codex CLI; MCP bridge tools are injected into the stable codex-config dir.",
        "manifest": {
          "id": "codex",
          "name": "Codex",
          "version": "1.0.0",
          "apiVersion": "pcp/v1",
          "providerType": "codex",
          "runtime": "cli",
          "capabilities": [
            { "id": "chat.stream", "supported": true, "mode": "native", "reliability": "strict" },
            { "id": "tool.call", "supported": true, "mode": "native", "reliability": "strict" },
            { "id": "tool.inject", "supported": true, "mode": "bridged", "reliability": "best_effort", "notes": "Via codex-config MCP TOML" },
            { "id": "interaction.form", "supported": false, "degradation": "fallback_to_text" },
            { "id": "interaction.approval", "supported": true, "mode": "bridged", "reliability": "best_effort" },
            { "id": "interaction.todo", "supported": false, "degradation": "fallback_to_text" },
            { "id": "input.image", "supported": false, "degradation": "fallback_to_notice" },
            { "id": "input.text_file", "supported": false, "degradation": "fallback_to_notice" },
            { "id": "input.binary_file", "supported": false, "degradation": "fallback_to_notice" },
            { "id": "permission.mode", "supported": true, "mode": "native", "reliability": "strict" },
            { "id": "session.abort", "supported": true, "mode": "native", "reliability": "strict" },
            { "id": "session.steer", "supported": false, "degradation": "fallback_to_text" },
            { "id": "session.background_task", "supported": false, "degradation": "fallback_to_text" }
          ],
          "permissionModeMap": {
            "supervised": "default",
            "auto_edit": "acceptEdits",
            "autonomous": "bypassPermissions",
            "plan_only": "plan"
          }
        },
        "policy": {
          "modeSwitchSessionPolicy": "preserve",
          "escalateAlwaysTools": ["ExitPlanMode"]
        }
      }
    ],
    "agentProfiles": [
      {
        "id": "codex-default",
        "name": "Codex",
        "description": "Codex App Server runtime",
        "runtimeType": "codex"
      }
    ]
  }
}
```

- [ ] **Step 3: Stub main.ts and adapter.ts**

`plugins/codex/src/main.ts`:

```typescript
import type { PluginContext } from '@zclaudia/shared/plugins';
import { CodexAgentAdapter } from './adapter.js';

export async function activate(context: PluginContext): Promise<void> {
  if (!context.agentRuntimes) {
    context.log.error('provider.register permission missing; cannot register codex runtime');
    return;
  }
  const adapter = new CodexAgentAdapter(req => context.agentRuntimes!.createToolBridge(req));
  context.agentRuntimes.register(adapter);
}

export async function deactivate(): Promise<void> {
  // Loader unregisters contributions.
}
```

`plugins/codex/src/adapter.ts`:

```typescript
import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/shared/providers';

export type ToolBridgeFactory = (
  req: ProviderToolBridgeRequest
) => Promise<ProviderToolBridgeEntry | null>;

export class CodexAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'codex';

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    _input: string,
    _context: ExternalAgentRunContext,
    _onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    yield { type: 'provider_error', error: 'Codex adapter not implemented' };
  }
}
```

- [ ] **Step 4: Allow git to track plugin.json**

In `.gitignore`, add after the cursor exception:

```
!/plugins/codex/
```

- [ ] **Step 5: Install workspace dep and build**

Run:

```bash
cd /home/haozhang.guest/Code/zclaudia && pnpm install && pnpm --filter @zclaudia/plugin-codex build
```

Expected: `tsc` succeeds with stub adapter.

- [ ] **Step 6: Commit**

```bash
git add plugins/codex .gitignore pnpm-lock.yaml
git commit -m "feat(codex): scaffold plugin-codex package and manifest"
```

---

### Task 2: Resolve codex CLI Path

**Files:**
- Create: `plugins/codex/src/resolve-cli.ts`
- Create: `plugins/codex/src/__tests__/resolve-cli.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `resolveCodexCli(explicitPath?: string): string | undefined`

- [ ] **Step 1: Write failing tests**

`plugins/codex/src/__tests__/resolve-cli.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveCodexCli } from '../resolve-cli.js';

describe('resolveCodexCli', () => {
  it('returns explicit cliPath when provided', () => {
    expect(resolveCodexCli('/opt/codex/bin/codex')).toBe('/opt/codex/bin/codex');
  });

  it('finds codex on PATH when present', () => {
    const original = process.env.PATH;
    process.env.PATH = `/tmp/fake-bin:${original ?? ''}`;
    // Test uses vi/mock or a temp executable — implement findExecutable mock
    // Minimal: if `which codex` works in CI dev box, assert typeof string
    const resolved = resolveCodexCli(undefined);
    if (resolved) expect(resolved).toMatch(/codex$/);
  });

  it('returns undefined when not found', () => {
    const original = process.env.PATH;
    process.env.PATH = '/nonexistent';
    expect(resolveCodexCli(undefined)).toBeUndefined();
    process.env.PATH = original;
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @zclaudia/plugin-codex test -- resolve-cli`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolve-cli.ts**

Copy shape from `plugins/cursor/src/resolve-cli.ts`, search for executable name `codex`:

```typescript
import { existsSync } from 'fs';
import path from 'path';

export function resolveCodexCli(explicitPath?: string): string | undefined {
  if (explicitPath) return explicitPath;
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add plugins/codex/src/resolve-cli.ts plugins/codex/src/__tests__/resolve-cli.test.ts
git commit -m "feat(codex): resolve codex CLI on PATH"
```

---

### Task 3: Config — MCP TOML, Env, Modes, Input Prep

**Files:**
- Create: `plugins/codex/src/config.ts`
- Create: `plugins/codex/src/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `ProviderToolBridgeEntry` from bridge factory (optional `{ name, config }`)
- Produces:
  - `getCodexConfigDir(): string`
  - `mcpServersToToml(servers: Record<string, unknown>): string`
  - `buildMcpConfigToml(bridge: ProviderToolBridgeEntry | null): string`
  - `mapModeToConfigArgs(mode?: string): string[]`
  - `buildEnv(options: { env?: Record<string, string>; claudiaSessionId?: string }): Record<string, string>`
  - `prepareAppServerInput(rawInput: string): Array<{ type: 'text'; text: string }>`
  - `writeMcpConfig(bridge: ProviderToolBridgeEntry | null): { configDir: string; configSignature: string }`
  - `normalizeClaudiaToolName(namespace: string | undefined, name: string): string`
  - `detectCodexToolSemantic(toolName: string): 'plan_enter' | 'plan_proposal' | undefined`
  - `deriveCodexModeTransition(...)`

- [ ] **Step 1: Write failing tests for TOML + modes**

Test `mcpServersToToml` with a bridge entry `{ command: 'node', args: ['bridge.js'] }`.
Test `mapModeToConfigArgs('plan')` includes `approval_policy="on-request"`.
Test `buildEnv` sets both `ZCLAUDIA_SESSION_ID` and `CLAUDIA_SESSION_ID`.
Test `prepareAppServerInput('hello')` → `[{ type: 'text', text: 'hello' }]`.
Test `normalizeClaudiaToolName('claudia-plugins', 'enter_plan_mode')` → `'EnterPlanMode'`.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement config.ts**

Port from `my-claudia/.../codex/codex-config.ts` with these changes:

1. `getCodexConfigDir()` uses `process.env.ZCLAUDIA_DATA_DIR ?? join(homedir(), '.zclaudia')` + `/codex-config`.
2. `buildMcpConfigToml(bridge)` — **bridge only** (no `loadMcpServersFromDb`).
3. Inline `sanitizeInheritedProviderEnv` keys (copy `INHERITED_PROVIDER_ENV_KEYS` from `zclaudia/server/src/utils/startup-env.ts` into a local `sanitizeInheritedProviderEnv` in config.ts — plugin must not import server).
4. `prepareAppServerInput` — text-only for phase 1 (no fileStore/image attachments).
5. Port plan helpers: `CLAUDIA_TOOL_NAME_MAP`, `normalizeClaudiaToolName`, `detectCodexToolSemantic`, `deriveCodexModeTransition`.
6. Port `ensureCodexProjectTrusted`, `writeMcpConfig`, `upsertTrustedProjectConfig`.

Bridge TOML example the test should assert:

```toml
[mcp_servers.claudia-plugins]
command = "node"
args = ["/path/to/bridge.js"]
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(codex): add config helpers for MCP TOML and modes"
```

---

### Task 4: Tool Effects

**Files:**
- Create: `plugins/codex/src/tool-effects.ts`
- Create: `plugins/codex/src/__tests__/tool-effects.test.ts`

**Interfaces:**
- Produces: `makeShellEffect`, `makeFileChangeEffect`, `fileChangeEffectFromMap`

- [ ] **Step 1: Write failing test for fileChangeEffectFromMap**

```typescript
import { describe, expect, it } from 'vitest';
import { fileChangeEffectFromMap, makeShellEffect } from '../tool-effects.js';

describe('tool-effects', () => {
  it('makeShellEffect returns shell effect', () => {
    expect(makeShellEffect('ls -la')).toEqual({ kind: 'shell', command: 'ls -la' });
  });

  it('fileChangeEffectFromMap maps codex fileChanges record', () => {
    const effect = fileChangeEffectFromMap({
      'src/a.ts': { type: 'modify' },
      'src/b.ts': { type: 'add' },
    });
    expect(effect?.kind).toBe('file_change');
    expect(effect?.files?.map(f => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
```

- [ ] **Step 2: Implement tool-effects.ts**

Port `makeShellEffect`, `makeFileChangeEffect`, and `fileChangeEffectFromMap` from my-claudia `tool-effects.ts` (map `add`→`create`, `delete`→`delete`, else `modify`).

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 5: Map Events — Notifications To ProviderRuntimeEvent

**Files:**
- Create: `plugins/codex/src/map-events.ts`
- Create: `plugins/codex/src/__tests__/map-events.test.ts`

**Interfaces:**
- Consumes: config plan helpers, tool-effects
- Produces:
  - `mapCodexNotification(method: string, params: Record<string, unknown>, state: MapEventState): ProviderRuntimeEvent[]`
  - `MapEventState` with `inReasoningBlock: boolean`

Map legacy ClaudeMessage shapes to ProviderRuntimeEvent:

| Source | Target |
|---|---|
| `{ type: 'init', sessionId }` | `{ type: 'init', sessionId, systemInfo }` |
| assistant delta | `{ type: 'assistant_delta', content }` |
| `{ type: 'tool_use' }` | `{ type: 'tool_started', toolUseId, toolName, toolInput, toolEffect, toolSemantic }` |
| `{ type: 'tool_result' }` | `{ type: 'tool_finished', ... }` |
| `{ type: 'mode_transition' }` | `{ type: 'mode_transition', modeTransition }` |
| `{ type: 'tool_activity' }` | `{ type: 'tool_activity', content }` |
| `{ type: 'error' }` | `{ type: 'provider_error', error }` |
| turn complete | `{ type: 'provider_turn_finished', isComplete: true }` |

- [ ] **Step 1: Write failing tests**

Cover:
- `item/agentMessage/delta` → `assistant_delta`
- `item/started` commandExecution → `tool_started` Bash + shell effect
- `item/completed` mcpToolCall `enter_plan_mode` → `tool_finished` + `mode_transition` enter
- `item/completed` mcpToolCall `exit_plan_mode` with `{ plan: '# Plan' }` → `toolSemantic: plan_proposal` + mode_transition exit with plan
- reasoning deltas wrap in thinking markers → use `thinking_delta` or assistant_delta with redacted tags (match cursor pattern)

- [ ] **Step 2: Port mapping logic**

Extract `mapNotification`, `mapItemStarted`, `mapItemCompleted`, `closeReasoningBlock` from `codex-app-server-client.ts`; output `ProviderRuntimeEvent[]` instead of `ClaudeMessage[]`.

For mcp completed Enter/ExitPlanMode, emit **both** `tool_finished` and `mode_transition` events (same as my-claudia).

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 6: Permissions — Approval Bridge

**Files:**
- Create: `plugins/codex/src/permissions.ts`
- Create: `plugins/codex/src/__tests__/permissions.test.ts`

**Interfaces:**
- Consumes: `@zclaudia/shared/providers` `PermissionCallback`, `PermissionRequest`
- Produces:
  - `mapApprovalToPermissionRequest(method: string, params?: Record<string, unknown>): PermissionRequest`
  - `resolveApprovalDecision(currentMode: string | undefined, method: string, params: Record<string, unknown> | undefined, onPermission: PermissionCallback | null): Promise<{ decision?: 'accept' | 'decline'; permissions?: Record<string, unknown>; scope?: string }>`

- [ ] **Step 1: Write failing tests**

```typescript
describe('resolveApprovalDecision', () => {
  it('declines writes in plan mode', async () => {
    const r = await resolveApprovalDecision('plan', 'item/fileChange/requestApproval', {}, null);
    expect(r.decision).toBe('decline');
  });

  it('auto-accepts in bypassPermissions', async () => {
    const r = await resolveApprovalDecision('bypassPermissions', 'item/commandExecution/requestApproval', { command: 'rm -rf /' }, null);
    expect(r.decision).toBe('accept');
  });

  it('auto-accepts file change in acceptEdits', async () => {
    const r = await resolveApprovalDecision('acceptEdits', 'item/fileChange/requestApproval', {}, null);
    expect(r.decision).toBe('accept');
  });

  it('forwards command to callback in default mode', async () => {
    const onPermission = vi.fn(async () => ({ behavior: 'allow' as const }));
    const r = await resolveApprovalDecision('default', 'item/commandExecution/requestApproval', { command: 'npm test' }, onPermission);
    expect(onPermission).toHaveBeenCalled();
    expect(r.decision).toBe('accept');
  });
});
```

- [ ] **Step 2: Implement permissions.ts**

Port `mapApprovalToPermissionRequest` and approval branch logic from `handleServerRequest` in `codex-app-server-client.ts`. Handle `item/permissions/requestApproval` separately (permissions object response).

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 7: App Server Client — JSON-RPC Process And runTurn

**Files:**
- Create: `plugins/codex/src/app-server-client.ts`
- Create: `plugins/codex/src/__tests__/app-server-client.test.ts`

**Interfaces:**
- Consumes: `config`, `map-events`, `permissions`, `resolveCodexCli`
- Produces: `CodexAppServerClient` class with:
  - `ensureRunning()`, `destroy()`, `updateExtraArgs(args: string[])`
  - `startThread(cwd: string): Promise<string>`
  - `resumeThread(threadId: string): Promise<void>`
  - `interruptTurn(threadId: string): Promise<void>`
  - `runTurn(threadId, input, onPermission, options): AsyncGenerator<ProviderRuntimeEvent>`
  - `currentMode: string | undefined`

- [ ] **Step 1: Write failing test with mocked spawn**

Mock `child_process.spawn` to feed JSON-RPC lines on stdout:

```typescript
// After spawn, simulate initialize response + turn notifications
const lines = [
  JSON.stringify({ id: 1, result: { capabilities: {} } }),
  JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Hi' } }),
  JSON.stringify({ method: 'turn/completed', params: { turn: { status: 'completed' } } }),
];
```

Assert yielded events include `init`, `assistant_delta` with `'Hi'`, `provider_turn_finished`.

- [ ] **Step 2: Implement CodexAppServerClient**

Port from `my-claudia/.../codex/codex-app-server-client.ts` (~860 LOC) with changes:

1. Remove `getGlobalProcessSupervisor` — direct spawn only.
2. Replace `ClaudeMessage` yields with `mapCodexNotification` from `map-events.ts`.
3. Delegate approval handling to `permissions.resolveApprovalDecision`.
4. `requestUserInput` / `mcpServer/elicitation` → decline/empty (phase 1).
5. `item/tool/call` → unsupported response.
6. Spawn args: `['app-server', '--listen', 'stdio://', ...extraArgs]`.
7. On spawn `error` ENOENT → throw clear error for runner to catch.

- [ ] **Step 3: Write approval integration test**

Feed a server **request** line (has `id` + `method`):

```json
{"id": 42, "method": "item/commandExecution/requestApproval", "params": {"command": "npm test"}}
```

Mock permission callback returning allow; assert client writes response `{ id: 42, result: { decision: "accept" } }` to stdin.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(codex): add CodexAppServerClient with JSON-RPC and approval bridge"
```

---

### Task 8: Runner — Thread Lifecycle And Session Recovery

**Files:**
- Create: `plugins/codex/src/runner.ts`
- Create: `plugins/codex/src/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: `CodexAppServerClient`, `config.writeMcpConfig`, `config.prepareAppServerInput`, `ProviderToolBridgeEntry`
- Produces:
  - `runCodexAppServer(input, options, onPermission): AsyncGenerator<ProviderRuntimeEvent>`
  - `abortCodexSession(sessionId: string): Promise<void>`
  - `setCodexSessionMode(sessionId: string, mode: string): void`
  - `destroyAllCodexClients(): void` (for plugin deactivate)

`CodexRunOptions`:

```typescript
export interface CodexRunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  mode?: string;
  systemPrompt?: string;
  claudiaSessionId?: string;
  bridge?: ProviderToolBridgeEntry | null;
}
```

- [ ] **Step 1: Write failing tests (mock client module)**

```typescript
vi.mock('../app-server-client.js', () => ({
  CodexAppServerClient: vi.fn().mockImplementation(() => ({
    currentMode: undefined,
    startThread: vi.fn(async () => 'thread-1'),
    resumeThread: vi.fn(async () => {}),
    runTurn: vi.fn(async function* () {
      yield { type: 'init', sessionId: 'thread-1' };
      yield { type: 'assistant_delta', content: 'ok' };
    }),
    interruptTurn: vi.fn(async () => {}),
    updateExtraArgs: vi.fn(),
  })),
}));
```

Test: new run calls `writeMcpConfig`, `startThread(cwd)`, streams events.
Test: resume with `sessionId` calls `resumeThread`.
Test: `abortCodexSession` calls `interruptTurn`.

- [ ] **Step 2: Implement runner.ts**

Port `codex-app-server.ts`:

- `getOrCreateAppServerClient` with client cache keyed by cliPath + configSignature + env
- `rememberThreadCwd` / `canResumeThreadInCwd` worktree safety
- Session recovery buffer logic for resumed threads
- System prompt prepend on new sessions only
- `sessionClientMap` for dynamic mode switching
- Idle cleanup timer (30 min) — `cleanupTimer.unref()`

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 9: Wire CodexAgentAdapter

**Files:**
- Modify: `plugins/codex/src/adapter.ts`
- Create: `plugins/codex/src/__tests__/adapter.test.ts`

**Interfaces:**
- Consumes: `runCodexAppServer`, `abortCodexSession`, `setCodexSessionMode`, `createToolBridge`

- [ ] **Step 1: Write failing adapter tests**

Mirror `plugins/cursor/src/__tests__/adapter.test.ts`:

1. `createToolBridge` called with `{ serverPort, sessionId: claudiaSessionId }`.
2. Bridge passed into runner.
3. `setSessionMode` updates internal map; next run uses stored mode.
4. `abort` clears sessionModes even when called with providerSessionId (reverse map pattern from cursor).
5. `getRunState` returns `{ providerSessionId, providerCwd }`.

Mock `./runner.js`:

```typescript
vi.mock('../runner.js', () => ({
  runCodexAppServer: vi.fn(async function* (_input, _opts) {
    yield { type: 'init', sessionId: 't1' };
  }),
  abortCodexSession: vi.fn(async () => {}),
  setCodexSessionMode: vi.fn(),
}));
```

- [ ] **Step 2: Implement adapter.ts**

Pattern from `CursorAgentAdapter` + pass `onPermission` through to runner (required for Codex):

```typescript
async *run(input, context, onPermission) {
  const claudiaSessionId = context.claudiaSessionId ?? context.sessionId ?? '';
  const effectiveMode = this.sessionModes.get(claudiaSessionId) ?? context.mode;
  const bridge = await this.createToolBridge({
    serverPort: context.serverPort,
    sessionId: context.claudiaSessionId,
  });
  // ... abort controller, runStates ...
  yield* runCodexAppServer(input, {
    cwd: context.cwd,
    sessionId: context.sessionId,
    cliPath: context.cliPath,
    env: context.env,
    model: context.model,
    mode: effectiveMode,
    systemPrompt: context.systemPrompt,
    claudiaSessionId: context.claudiaSessionId,
    bridge,
  }, onPermission ?? (async () => ({ behavior: 'deny' })));
}
```

Implement `setSessionMode` → `setCodexSessionMode` + local `sessionModes` map.
Implement `abort` → `abortCodexSession` + cleanup maps.

- [ ] **Step 3: Run adapter tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 10: Host Capabilities, Commands, Plugin Lifecycle

**Files:**
- Modify: `server/src/interfaces/http/provider-capabilities.ts`
- Modify: `server/src/interfaces/http/provider-commands.ts`
- Modify: `server/src/interfaces/http/__tests__/provider-capabilities.test.ts`
- Modify: `server/src/interfaces/http/__tests__/provider-commands.test.ts`
- Create: `server/src/application/plugins/__tests__/codex-plugin-lifecycle.test.ts`

- [ ] **Step 1: Add CODEX_CAPABILITIES**

In `provider-capabilities.ts`:

```typescript
const CODEX_CAPABILITIES: ProviderCapabilities = {
  modeLabel: 'Mode',
  defaultModeId: 'default',
  modes: [
    { id: 'default', label: 'Default', description: 'Supervised Codex turns' },
    { id: 'plan', label: 'Plan', description: 'Read-only planning (decline writes)' },
    { id: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file changes' },
    { id: 'bypassPermissions', label: 'Bypass', description: 'Auto-accept approvals' },
  ],
  modelLabel: 'Model',
  models: [],
  supportsAIReview: false,
};

const RUNTIME_CAPABILITIES = {
  // ...
  codex: CODEX_CAPABILITIES,
};
```

- [ ] **Step 2: Allow codex in provider-commands.ts**

Change allowlist to include `'codex'` alongside `'claude'` and `'cursor'`.

- [ ] **Step 3: Extend HTTP tests**

In `provider-capabilities.test.ts`: assert codex modes include `acceptEdits`, `supportsAIReview: false`.
In `provider-commands.test.ts`: change codex from 404 to 200.

- [ ] **Step 4: Create codex-plugin-lifecycle.test.ts**

Copy `cursor-plugin-lifecycle.test.ts`; replace `PLUGIN = 'com.zclaudia.codex'`, type `'codex'`, profile `'codex-default'`.

- [ ] **Step 5: Run server tests**

```bash
pnpm --filter @zclaudia/server test -- provider-capabilities provider-commands codex-plugin-lifecycle
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(codex): expose HTTP capabilities and plugin lifecycle tests"
```

---

### Task 11: Build And Acceptance Check

**Files:**
- Modify: `plugins/codex/src/main.ts` — call `destroyAllCodexClients()` on deactivate (optional but recommended)

- [ ] **Step 1: Run full plugin test suite**

```bash
pnpm --filter @zclaudia/plugin-codex test
pnpm --filter @zclaudia/plugin-codex build
```

Expected: all tests pass; `dist/main.js` exists.

- [ ] **Step 2: Fix Usage/type mismatches**

If any `ProviderRuntimeEvent.usage` mapping is needed (like Cursor task 9), map Codex usage to pi-ai `Usage` shape: `{ input, output, cacheRead: 0, cacheWrite: 0, totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }`.

- [ ] **Step 3: Run workspace build smoke**

```bash
pnpm --filter @zclaudia/shared build
pnpm --filter @zclaudia/server build
```

- [ ] **Step 4: Manual acceptance checklist** (document in PR; not CI)

1. Enable `com.zclaudia.codex` plugin
2. Create agent profile runtime `codex`; ensure local `codex` CLI logged in
3. Chat → streaming reply → resume second message
4. Supervised: trigger bash approval → UI prompt works
5. Switch modes default/plan/acceptEdits/bypassPermissions
6. AI EnterPlanMode → ExitPlanMode surfaces plan markdown
7. Cancel interrupts turn
8. Verify `$ZCLAUDIA_DATA_DIR/codex-config/.codex/config.toml` contains `claudia-plugins`

- [ ] **Step 5: Commit any fixes**

```bash
git commit -m "fix(codex): build and type fixes for plugin-codex"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|---|---|
| App Server path | Task 7, 8 |
| MCP bridge via createToolBridge | Task 3, 8, 9 |
| Approval bridge | Task 6, 7, 9 |
| Plan normalization | Task 3, 5 |
| Modes default/plan/acceptEdits/bypassPermissions | Task 3, 6, 10 |
| Session recovery + cwd safety | Task 8 |
| Conservative manifest | Task 1 |
| Host capabilities/commands | Task 10 |
| Defer images/form/todo/DB MCP | Global Constraints |
| No LLM OAuth coupling | Global Constraints |
| `$ZCLAUDIA_DATA_DIR/codex-config` | Task 3 |
| Idle cleanup / deactivate | Task 8, 11 |

No TBD placeholders. Type names consistent across tasks.

## Migration Quick Reference

| my-claudia | zclaudia |
|---|---|
| `codex-app-server-adapter.ts` | `adapter.ts` |
| `codex-app-server.ts` | `runner.ts` |
| `codex/codex-app-server-client.ts` | `app-server-client.ts` + uses `map-events.ts` |
| `codex/codex-config.ts` | `config.ts` |
| approval in client | `permissions.ts` |
| `codex-sdk.ts` | **not ported** |
