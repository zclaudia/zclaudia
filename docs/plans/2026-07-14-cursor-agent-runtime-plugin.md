# Cursor Agent Runtime Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@zclaudia/plugin-cursor` so agents with `runtimeType: 'cursor'` can chat, resume, cancel, switch `default`/`plan`/`ask`, inject the host MCP tool bridge into `.cursor/mcp.json`, and normalize `switchMode`/`createPlan` into shared runtime events.

**Architecture:** Mirror `plugins/claude`: declarative `plugin.json` contributes the runtime descriptor + default profile; `activate` registers a `CursorAgentAdapter` (`ExternalAgentAdapter`) that spawns `cursor-agent`, maps NDJSON to `ProviderRuntimeEvent`, and merges the host `createToolBridge` entry into project MCP config. Host adds HTTP capabilities/modes for `cursor` so the chat mode selector works.

**Tech Stack:** TypeScript (ESM), Vitest, Node `child_process` + `readline`, `@zclaudia/shared` provider types, existing plugin contribution loader.

## Global Constraints

- Package lives at `plugins/cursor` only — do **not** add `server/src/infra/providers/external-agents/cursor`.
- Phase 1 scope: chat stream, resume, cancel, MCP bridge inject, modes `default`/`plan`/`ask`, `switchMode`/`createPlan` event normalization.
- Defer: plan decision card, full image attachment pipeline, background tasks, CLI jobs, OAuth hint rewriting, live Cursor login smoke in CI.
- Capability claims stay truthful: support stream/tools/inject/abort; mark `input.image` and background tasks unsupported/degraded.
- Missing adapter fails closed (existing host rule); never fall back to `zclaudia`.
- `modeSwitchSessionPolicy: 'preserve'`; same-name user MCP server wins over bridge.
- Spec: `docs/plans/2026-07-14-cursor-agent-runtime-plugin-design.md`.
- Source ports: `my-claudia/server/src/infrastructure/providers/cursor-adapter.ts`, `cursor-sdk.ts`.

## File Structure

**Create**

- `plugins/cursor/package.json` — `@zclaudia/plugin-cursor`
- `plugins/cursor/tsconfig.json` — match Claude plugin
- `plugins/cursor/plugin.json` — `agentRuntimes` + `agentProfiles`
- `plugins/cursor/src/main.ts` — activate/deactivate
- `plugins/cursor/src/adapter.ts` — `CursorAgentAdapter`
- `plugins/cursor/src/runner.ts` — spawn + stream + abort maps
- `plugins/cursor/src/map-events.ts` — NDJSON → `ProviderRuntimeEvent` (incl. plan tools)
- `plugins/cursor/src/mcp-inject.ts` — merge bridge into `.cursor/mcp.json`
- `plugins/cursor/src/resolve-cli.ts` — PATH / `cliPath` resolution
- `plugins/cursor/src/tool-effects.ts` — minimal shell/file effect helpers
- `plugins/cursor/src/__tests__/mcp-inject.test.ts`
- `plugins/cursor/src/__tests__/resolve-cli.test.ts`
- `plugins/cursor/src/__tests__/map-events.test.ts`
- `plugins/cursor/src/__tests__/runner.test.ts`
- `plugins/cursor/src/__tests__/adapter.test.ts`

**Modify**

- `server/src/interfaces/http/provider-capabilities.ts` — add `CURSOR_CAPABILITIES` with `default`/`plan`/`ask`
- `server/src/interfaces/http/provider-commands.ts` — allow `cursor` type like `claude`
- `server/src/interfaces/http/__tests__/provider-capabilities.test.ts` — cursor modes + AI review false
- `server/src/application/plugins/__tests__/cursor-plugin-lifecycle.test.ts` — create (mirror Claude lifecycle)

**Do not modify for phase 1**

- Profile editor (descriptors come from plugin contributions; `hasCliPath` / `authNote` from `plugin.json`)
- my-claudia tree

---

### Task 1: Scaffold Plugin Package And Manifest

**Files:**
- Create: `plugins/cursor/package.json`
- Create: `plugins/cursor/tsconfig.json`
- Create: `plugins/cursor/plugin.json`
- Create: `plugins/cursor/src/main.ts`
- Create: `plugins/cursor/src/adapter.ts` (stub exporting `CursorAgentAdapter` with empty `run`)

**Interfaces:**
- Consumes: `@zclaudia/shared/plugins` `PluginContext`; `@zclaudia/shared/providers` `ExternalAgentAdapter`
- Produces: package `@zclaudia/plugin-cursor`; plugin id `com.zclaudia.cursor`; runtime type `cursor`; stub `CursorAgentAdapter`

- [ ] **Step 1: Create package.json and tsconfig.json**

`plugins/cursor/package.json`:

```json
{
  "name": "@zclaudia/plugin-cursor",
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

`plugins/cursor/tsconfig.json` — copy from `plugins/claude/tsconfig.json` unchanged.

- [ ] **Step 2: Write plugin.json**

`plugins/cursor/plugin.json` (trim capabilities to truthful phase-1 set; keep PCP shape):

```json
{
  "id": "com.zclaudia.cursor",
  "name": "Cursor Agent",
  "version": "0.1.0",
  "description": "Run Cursor Agent CLI (cursor-agent) as a zclaudia agent runtime.",
  "main": "dist/main.js",
  "executionMode": "main",
  "platform": "desktop",
  "engines": { "claudia": "*" },
  "permissions": ["provider.register", "provider.call", "network.fetch"],
  "contributes": {
    "agentRuntimes": [
      {
        "type": "cursor",
        "label": "Cursor",
        "model": { "kind": "none", "multimodalFallback": false, "thinkingLevel": "auto" },
        "hasCliPath": true,
        "capabilities": { "tools": "native-readonly", "providers": "external", "skills": "external" },
        "authNote": "Cursor uses the local cursor-agent CLI. MCP bridge tools are injected into .cursor/mcp.json for this project; Cursor-native MCP and skills stay outside zclaudia profile tools.",
        "manifest": {
          "id": "cursor",
          "name": "Cursor",
          "version": "1.0.0",
          "apiVersion": "pcp/v1",
          "providerType": "cursor",
          "runtime": "cli",
          "capabilities": [
            { "id": "chat.stream", "supported": true, "mode": "native", "reliability": "best_effort" },
            { "id": "tool.call", "supported": true, "mode": "native", "reliability": "best_effort" },
            { "id": "tool.inject", "supported": true, "mode": "bridged", "reliability": "best_effort", "notes": "Via .cursor/mcp.json injection" },
            { "id": "interaction.form", "supported": false, "degradation": "fallback_to_text" },
            { "id": "interaction.approval", "supported": false, "degradation": "fallback_to_text" },
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
            "plan_only": "plan"
          }
        },
        "policy": {
          "modeSwitchSessionPolicy": "preserve"
        }
      }
    ],
    "agentProfiles": [
      {
        "id": "cursor-default",
        "name": "Cursor",
        "description": "Cursor Agent CLI runtime",
        "runtimeType": "cursor"
      }
    ]
  }
}
```

- [ ] **Step 3: Stub adapter + main.ts**

`plugins/cursor/src/adapter.ts`:

```ts
import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/shared/providers';

export type ToolBridgeFactory = (
  req: ProviderToolBridgeRequest
) => Promise<ProviderToolBridgeEntry | null>;

export class CursorAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'cursor';
  private readonly sessionModes = new Map<string, string>();
  private readonly runStates = new WeakMap<ExternalAgentRunContext, ExternalAgentRunState>();

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    _input: string,
    context: ExternalAgentRunContext,
    _onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    this.runStates.set(context, { providerSessionId: context.sessionId, providerCwd: context.cwd });
    // Implemented in Task 6
  }

  getRunState(context: ExternalAgentRunContext): ExternalAgentRunState {
    return this.runStates.get(context) ?? { providerCwd: context.cwd };
  }

  setSessionMode(sessionId: string, mode: string): void {
    if (!sessionId) return;
    this.sessionModes.set(sessionId, mode);
  }

  async abort(sessionId: string, _cwd: string): Promise<void> {
    this.sessionModes.delete(sessionId);
    // Process kill wired in Task 6
  }
}
```

`plugins/cursor/src/main.ts`:

```ts
import type { PluginContext } from '@zclaudia/shared/plugins';
import { CursorAgentAdapter } from './adapter.js';

export async function activate(context: PluginContext): Promise<void> {
  if (!context.agentRuntimes) {
    context.log.error('provider.register permission missing; cannot register cursor runtime');
    return;
  }
  const adapter = new CursorAgentAdapter(req => context.agentRuntimes!.createToolBridge(req));
  context.agentRuntimes.register(adapter);
}

export async function deactivate(): Promise<void> {
  // Loader unregisters contributions.
}
```

- [ ] **Step 4: Install workspace + build**

Run:

```bash
cd /home/haozhang.guest/Code/zclaudia && pnpm install && pnpm --filter @zclaudia/plugin-cursor build
```

Expected: install links the new package; `tsc` emits `plugins/cursor/dist/main.js` with no errors.

- [ ] **Step 5: Commit**

```bash
git add plugins/cursor/package.json plugins/cursor/tsconfig.json plugins/cursor/plugin.json plugins/cursor/src/main.ts plugins/cursor/src/adapter.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(plugins): scaffold cursor agent runtime package

Add @zclaudia/plugin-cursor with plugin.json contributions and a
stub ExternalAgentAdapter registered on activate.
EOF
)"
```

---

### Task 2: MCP Inject Helper

**Files:**
- Create: `plugins/cursor/src/mcp-inject.ts`
- Test: `plugins/cursor/src/__tests__/mcp-inject.test.ts`

**Interfaces:**
- Consumes: Node `fs`/`path`; bridge `{ name: string; config: unknown }`
- Produces: `injectCursorMcpBridge(cwd, bridge): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write failing tests**

`plugins/cursor/src/__tests__/mcp-inject.test.ts`:

```ts
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { injectCursorMcpBridge } from '../mcp-inject.js';

describe('injectCursorMcpBridge', () => {
  const dirs: string[] = [];
  afterEach(() => {
    // leave tmp dirs; OS cleans. Track for clarity.
    dirs.length = 0;
  });

  function project(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'zclaudia-cursor-mcp-'));
    dirs.push(dir);
    return dir;
  }

  it('creates .cursor/mcp.json and writes the bridge server', () => {
    const cwd = project();
    const result = injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    expect(result).toEqual({ ok: true });
    const raw = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(raw.mcpServers['claudia-plugins']).toEqual({
      command: 'node',
      args: ['bridge.js'],
    });
  });

  it('merges without removing existing servers', () => {
    const cwd = project();
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(
      path.join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'docs' } } })
    );
    injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    const raw = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(raw.mcpServers.docs).toEqual({ command: 'docs' });
    expect(raw.mcpServers['claudia-plugins']).toBeTruthy();
  });

  it('does not overwrite a user server with the same name', () => {
    const cwd = project();
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(
      path.join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: { 'claudia-plugins': { command: 'user-bridge' } },
      })
    );
    injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    const raw = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(raw.mcpServers['claudia-plugins']).toEqual({ command: 'user-bridge' });
  });

  it('recovers from invalid JSON by rewriting a fresh config', () => {
    const cwd = project();
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(path.join(cwd, '.cursor', 'mcp.json'), '{not-json');
    const result = injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    expect(result).toEqual({ ok: true });
    expect(existsSync(path.join(cwd, '.cursor', 'mcp.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zclaudia/plugin-cursor test -- src/__tests__/mcp-inject.test.ts`

Expected: FAIL (module not found / injectCursorMcpBridge missing).

- [ ] **Step 3: Implement mcp-inject.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export interface CursorMcpBridge {
  name: string;
  config: unknown;
}

export type InjectResult = { ok: true } | { ok: false; reason: string };

export function injectCursorMcpBridge(cwd: string, bridge: CursorMcpBridge): InjectResult {
  const mcpJsonPath = path.join(cwd, '.cursor', 'mcp.json');
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(mcpJsonPath)) {
      config = JSON.parse(readFileSync(mcpJsonPath, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    config = {};
  }

  const mcpServers = {
    ...((config.mcpServers as Record<string, unknown> | undefined) ?? {}),
  };
  if (mcpServers[bridge.name]) {
    // User (or prior) entry wins.
    return { ok: true };
  }
  mcpServers[bridge.name] = bridge.config;
  config.mcpServers = mcpServers;

  try {
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(mcpJsonPath, `${JSON.stringify(config, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @zclaudia/plugin-cursor test -- src/__tests__/mcp-inject.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/cursor/src/mcp-inject.ts plugins/cursor/src/__tests__/mcp-inject.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin-cursor): merge MCP bridge into .cursor/mcp.json

Preserve existing servers and never clobber a same-named user entry.
EOF
)"
```

---

### Task 3: Resolve cursor-agent On PATH

**Files:**
- Create: `plugins/cursor/src/resolve-cli.ts`
- Test: `plugins/cursor/src/__tests__/resolve-cli.test.ts`

**Interfaces:**
- Consumes: `PATH` string + optional `exists` / `platform`
- Produces: `resolveCursorCliFromPath(pathEnv, options?) => string | undefined`

- [ ] **Step 1: Write failing tests**

Mirror `plugins/claude/src/__tests__/resolve-cli.test.ts` but with binary name `cursor-agent` (and `cursor-agent.exe` / `.cmd` / `.bat` on win32).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zclaudia/plugin-cursor test -- src/__tests__/resolve-cli.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement resolve-cli.ts**

Copy `plugins/claude/src/resolve-cli.ts`, rename export to `resolveCursorCliFromPath`, change candidate basenames to `cursor-agent` / windows variants.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add plugins/cursor/src/resolve-cli.ts plugins/cursor/src/__tests__/resolve-cli.test.ts
git commit -m "feat(plugin-cursor): resolve cursor-agent from PATH"
```

---

### Task 4: Event Mapping And Tool Effects

**Files:**
- Create: `plugins/cursor/src/tool-effects.ts`
- Create: `plugins/cursor/src/map-events.ts`
- Test: `plugins/cursor/src/__tests__/map-events.test.ts`

**Interfaces:**
- Consumes: raw cursor NDJSON objects; `@zclaudia/shared` `ProviderRuntimeEvent`, `ToolSemantic`, `ToolEffect`
- Produces:
  - `mapCursorEvent(event, inThinkBlock): { events: ProviderRuntimeEvent[]; inThinkBlock: boolean }`
  - helpers: `detectCursorToolSemantic`, `deriveCursorModeTransition`

Port logic from `my-claudia/.../cursor-sdk.ts` (`TOOL_CALL_KEY_MAP`, `extractToolCall`, thinking/`assistant`/`tool_call`/`result`/`system` init). Emit **legacy-compatible** event types the host already handles (`assistant`, `tool_use`, `tool_result`, `result`, `error`, `init`, `mode_transition`) — same shapes Claude runner uses via transform where applicable; Cursor source already used these legacy names.

- [ ] **Step 1: Write failing map-events tests**

```ts
import { describe, expect, it } from 'vitest';
import { mapCursorEvent } from '../map-events.js';

describe('mapCursorEvent', () => {
  it('maps system init to init with sessionId', () => {
    const { events } = mapCursorEvent(
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'gpt' },
      false
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'init', sessionId: 'sess-1' }),
    ]);
  });

  it('maps assistant text blocks', () => {
    const { events } = mapCursorEvent(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      false
    );
    expect(events).toEqual([{ type: 'assistant', content: 'hi' }]);
  });

  it('tags createPlan as plan_proposal on tool_use', () => {
    const { events } = mapCursorEvent(
      {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'cp-1',
        tool_call: { createPlanToolCall: { args: { plan: '# Plan\n\n- step 1' } } },
      },
      false
    );
    expect(events[0]).toMatchObject({
      type: 'tool_use',
      toolName: 'createPlan',
      toolSemantic: 'plan_proposal',
    });
  });

  it('emits mode_transition when switchMode to plan completes', () => {
    const { events } = mapCursorEvent(
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'sm-1',
        tool_call: {
          switchModeToolCall: {
            args: { targetModeId: 'plan' },
            result: { success: { message: 'switched' } },
          },
        },
      },
      false
    );
    expect(events.some(e => e.type === 'mode_transition')).toBe(true);
    expect(
      events.find(e => e.type === 'mode_transition')?.modeTransition
    ).toMatchObject({ mode: 'plan', reason: 'enter', sourceToolUseId: 'sm-1' });
  });

  it('maps result errors to error events', () => {
    const { events } = mapCursorEvent(
      { type: 'result', subtype: 'error', result: 'boom' },
      false
    );
    expect(events[0]).toMatchObject({ type: 'error', error: 'boom' });
  });
});
```

**Important:** Before implementing, open `my-claudia/server/src/infrastructure/providers/__tests__/cursor-sdk.test.ts` and copy 2–3 real NDJSON fixtures for `createPlan` / `switchMode` tool_call keys so the KEY_MAP and extractToolCall match production. Do not invent tool_call object keys that the CLI never emits.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement tool-effects.ts (minimal)**

```ts
import type { FileChangeEffectFile, ToolEffect } from '@zclaudia/shared/core/message';

export function makeShellEffect(command: string | undefined): ToolEffect | undefined {
  const trimmed = command?.trim();
  return trimmed ? { kind: 'shell', command: trimmed } : undefined;
}

export function makeFileChangeEffect(files: FileChangeEffectFile[]): ToolEffect | undefined {
  const normalized = files
    .map(f => ({ ...f, path: (f.path ?? '').trim(), changeKind: f.changeKind ?? ('unknown' as const) }))
    .filter(f => f.path);
  return normalized.length > 0 ? { kind: 'file_change', files: normalized } : undefined;
}

export function fileChangeEffectFromInput(
  input: unknown,
  changeKind: FileChangeEffectFile['changeKind'] = 'unknown'
): ToolEffect | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const path =
    (typeof record.path === 'string' && record.path) ||
    (typeof record.file_path === 'string' && record.file_path) ||
    undefined;
  if (!path) return undefined;
  return makeFileChangeEffect([{ path, changeKind }]);
}
```

Plus `readCursorEditResultEffect` as in my-claudia `cursor-sdk.ts` (diffString / path).

- [ ] **Step 4: Implement map-events.ts**

Port `mapCursorEvent`, `detectCursorToolSemantic`, `deriveCursorModeTransition`, `extractToolCall`, `TOOL_CALL_KEY_MAP` from my-claudia. Return `{ events, inThinkBlock }` instead of `MappedEvent[]` with side-channel `updateThink`.

- [ ] **Step 5: Run tests — expect PASS** (extend fixtures until plan tools covered)

- [ ] **Step 6: Commit**

```bash
git add plugins/cursor/src/tool-effects.ts plugins/cursor/src/map-events.ts plugins/cursor/src/__tests__/map-events.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin-cursor): map cursor-agent NDJSON to runtime events

Include switchMode/createPlan normalization into mode_transition and
toolSemantic for provider-agnostic plan UX hooks.
EOF
)"
```

---

### Task 5: Runner (Spawn, Stream, Abort)

**Files:**
- Create: `plugins/cursor/src/runner.ts`
- Test: `plugins/cursor/src/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: `mapCursorEvent`, `resolveCursorCliFromPath`, `injectCursorMcpBridge`
- Produces:
  - `runCursor(input, options): AsyncGenerator<ProviderRuntimeEvent>`
  - `abortCursorSession(sessionId: string): Promise<void>`
  - `CursorRunOptions` with `cwd`, `sessionId?`, `cliPath?`, `env?`, `model?`, `mode?`, `systemPrompt?`, `serverPort?`, `claudiaSessionId?`, `abortController?`, `bridge?: { name: string; config: unknown } | null`, `onSessionId?: (id: string) => void`

- [ ] **Step 1: Write failing runner tests with mocked spawn**

```ts
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const spawnMock = vi.fn();
vi.mock('child_process', () => ({ spawn: spawnMock }));

// Also mock mcp-inject if needed so tests do not touch real FS:
vi.mock('../mcp-inject.js', () => ({
  injectCursorMcpBridge: vi.fn(() => ({ ok: true })),
}));

import { abortCursorSession, runCursor } from '../runner.js';
import { injectCursorMcpBridge } from '../mcp-inject.js';

function fakeProc(lines: string[]) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  proc.stdout = Readable.from(lines.map(l => l + '\n'));
  proc.stderr = Readable.from([]);
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  proc.killed = false;
  // child_process spawn returns ChildProcess; enough surface for runner
  return proc;
}

describe('runCursor', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('spawns cursor-agent with stream-json, trust, and yolo in default mode', async () => {
    spawnMock.mockReturnValueOnce(fakeProc([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
      JSON.stringify({ type: 'result', result: 'done' }),
    ]));

    const events = [];
    for await (const e of runCursor('hi', { cwd: '/proj' })) events.push(e);

    expect(spawnMock).toHaveBeenCalled();
    const [bin, args] = spawnMock.mock.calls[0];
    expect(bin).toBe('cursor-agent');
    expect(args).toEqual(
      expect.arrayContaining(['-p', 'hi', '--output-format', 'stream-json', '--trust', '--yolo'])
    );
    expect(events.some(e => e.type === 'init' && e.sessionId === 's1')).toBe(true);
    expect(events.some(e => e.type === 'assistant' && e.content === 'hello')).toBe(true);
  });

  it('passes --mode=plan and --resume when set', async () => {
    spawnMock.mockReturnValueOnce(fakeProc([]));
    for await (const _ of runCursor('x', {
      cwd: '/proj',
      mode: 'plan',
      sessionId: 'chat-1',
    })) {
      /* drain */
    }
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--mode=plan');
    expect(args).toContain('--resume');
    expect(args).toContain('chat-1');
    expect(args).not.toContain('--yolo');
  });

  it('passes --mode=ask without yolo', async () => {
    spawnMock.mockReturnValueOnce(fakeProc([]));
    for await (const _ of runCursor('x', { cwd: '/proj', mode: 'ask' })) {
      /* drain */
    }
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--mode=ask');
    expect(args).not.toContain('--yolo');
  });

  it('prepends systemPrompt to the -p payload', async () => {
    spawnMock.mockReturnValueOnce(fakeProc([]));
    for await (const _ of runCursor('user', {
      cwd: '/proj',
      systemPrompt: 'be brief',
    })) {
      /* drain */
    }
    const args = spawnMock.mock.calls[0][1] as string[];
    const promptIdx = args.indexOf('-p');
    expect(args[promptIdx + 1]).toContain('[System Context]');
    expect(args[promptIdx + 1]).toContain('be brief');
    expect(args[promptIdx + 1]).toContain('user');
  });

  it('injects MCP bridge when bridge config is provided', async () => {
    spawnMock.mockReturnValueOnce(fakeProc([]));
    for await (const _ of runCursor('x', {
      cwd: '/proj',
      bridge: { name: 'claudia-plugins', config: { command: 'node' } },
    })) {
      /* drain */
    }
    expect(injectCursorMcpBridge).toHaveBeenCalledWith(
      '/proj',
      expect.objectContaining({ name: 'claudia-plugins' })
    );
  });

  it('yields ENOENT guidance when spawn emits error', async () => {
    const proc = fakeProc([]);
    spawnMock.mockReturnValueOnce(proc);
    queueMicrotask(() => {
      const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
      proc.emit('error', err);
      proc.stdout.push(null);
    });
    const events = [];
    for await (const e of runCursor('x', { cwd: '/proj' })) events.push(e);
    expect(events.some(e => e.type === 'error' && String(e.error).includes('cursor-agent not found'))).toBe(
      true
    );
  });
});

describe('abortCursorSession', () => {
  it('kills the active process for a session id', async () => {
    const proc = fakeProc([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
    ]);
    // Keep stdout open so abort can race — or register process with sessionId option:
    spawnMock.mockReturnValueOnce(proc);
    const gen = runCursor('x', { cwd: '/proj', sessionId: 's1' });
    await gen.next();
    await abortCursorSession('s1');
    expect(proc.kill).toHaveBeenCalled();
  });
});
```

Tune the ENOENT / abort tests if spawn API timing differs; keep assertions on args and mapped events stable.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement runner.ts**

Port `runCursor` / `abortCursorSession` / `activeProcesses` from my-claudia:

- Binary: `options.cliPath` else `resolveCursorCliFromPath(env.PATH)` else `'cursor-agent'`
- Args: `-p`, `--output-format stream-json`, `--trust`, mode flags, optional `--model`, `--resume`
- If `options.bridge`, call `injectCursorMcpBridge(cwd, bridge)` (log failure; continue)
- Subscribe `options.abortController?.signal` → kill process
- On `init` with sessionId, call `onSessionId` and re-key `activeProcesses` if needed
- Map lines via `mapCursorEvent`; surface `I:`/`E:`/`W:` non-JSON and stderr-only errors as in my-claudia
- Close dangling think blocks
- Do **not** depend on my-claudia `fileStore` / process-supervisor in phase 1 (skip image path expand; skip supervisor observe)

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add plugins/cursor/src/runner.ts plugins/cursor/src/__tests__/runner.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin-cursor): spawn cursor-agent and stream runtime events

Wire CLI flags for resume/modes, MCP inject hook, and session abort.
EOF
)"
```

---

### Task 6: Wire CursorAgentAdapter

**Files:**
- Modify: `plugins/cursor/src/adapter.ts`
- Test: `plugins/cursor/src/__tests__/adapter.test.ts`

**Interfaces:**
- Consumes: `runCursor`, `abortCursorSession`, `ToolBridgeFactory`
- Produces: full `ExternalAgentAdapter` behavior matching design data flow

- [ ] **Step 1: Write failing adapter tests**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const runCursorMock = vi.fn(async function* () {
  yield { type: 'init', sessionId: 'prov-1' } as const;
});
const abortCursorSessionMock = vi.fn(async () => {});

vi.mock('../runner.js', () => ({
  runCursor: (...args: unknown[]) => runCursorMock(...args),
  abortCursorSession: (...args: unknown[]) => abortCursorSessionMock(...args),
}));

import { CursorAgentAdapter } from '../adapter.js';

describe('CursorAgentAdapter', () => {
  beforeEach(() => {
    runCursorMock.mockClear();
    abortCursorSessionMock.mockClear();
  });

  it('registers type cursor', () => {
    expect(new CursorAgentAdapter(async () => null).type).toBe('cursor');
  });

  it('calls createToolBridge and passes bridge into runCursor', async () => {
    const bridge = { name: 'claudia-plugins', config: { command: 'node' } };
    const createToolBridge = vi.fn(async () => bridge);
    const adapter = new CursorAgentAdapter(createToolBridge);
    for await (const _ of adapter.run(
      'hi',
      { cwd: '/p', claudiaSessionId: 'sess', serverPort: 3100, mode: 'default' },
      vi.fn()
    )) {
      /* drain */
    }
    expect(createToolBridge).toHaveBeenCalledWith({
      serverPort: 3100,
      sessionId: 'sess',
    });
    expect(runCursorMock).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ cwd: '/p', bridge, mode: 'default' })
    );
  });

  it('uses setSessionMode over context.mode for the next turn', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    adapter.setSessionMode('sess', 'plan');
    for await (const _ of adapter.run(
      'hi',
      { cwd: '/p', claudiaSessionId: 'sess', mode: 'default' },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ mode: 'plan' })
    );
  });

  it('abort clears session mode and kills runner session', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    adapter.setSessionMode('sess', 'ask');
    await adapter.abort('sess', '/p');
    expect(abortCursorSessionMock).toHaveBeenCalledWith('sess');
    // next run should not force ask
    for await (const _ of adapter.run(
      'hi',
      { cwd: '/p', claudiaSessionId: 'sess', mode: 'default' },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ mode: 'default' })
    );
  });

  it('updates getRunState when onSessionId fires', async () => {
    runCursorMock.mockImplementationOnce(async function* (_input, options) {
      options.onSessionId?.('prov-9');
      yield { type: 'init', sessionId: 'prov-9' };
    });
    const adapter = new CursorAgentAdapter(async () => null);
    const context = { cwd: '/p', claudiaSessionId: 'sess' };
    for await (const _ of adapter.run('hi', context, vi.fn())) {
      /* drain */
    }
    expect(adapter.getRunState(context).providerSessionId).toBe('prov-9');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL** (stub run empty)

- [ ] **Step 3: Implement adapter.run / abort**

```ts
// Inside CursorAgentAdapter.run:
const sessionKey = context.claudiaSessionId ?? context.sessionId ?? '';
const effectiveMode =
  (sessionKey && this.sessionModes.get(sessionKey)) ?? context.mode;

const bridge = await this.createToolBridge({
  serverPort: context.serverPort,
  sessionId: context.claudiaSessionId,
});

const abortController = context.abortController ?? new AbortController();

yield* runCursor(input, {
  cwd: context.cwd,
  sessionId: context.sessionId,
  cliPath: context.cliPath,
  env: context.env,
  model: context.model,
  mode: effectiveMode,
  systemPrompt: context.systemPrompt,
  serverPort: context.serverPort,
  claudiaSessionId: context.claudiaSessionId,
  abortController,
  bridge,
  onSessionId: id => {
    this.runStates.set(context, { providerSessionId: id, providerCwd: context.cwd });
  },
});

// abort:
this.sessionModes.delete(sessionId);
await abortCursorSession(sessionId);
context.abortController?.abort(); // if you also stash controllers by key like Claude
```

Prefer also keeping an `abortControllers` map keyed like Claude so host abortController + process kill both fire. Follow Claude adapter abortController pattern closely when adapting.

- [ ] **Step 4: Run adapter + full plugin tests — expect PASS**

Run: `pnpm --filter @zclaudia/plugin-cursor test`

- [ ] **Step 5: Commit**

```bash
git add plugins/cursor/src/adapter.ts plugins/cursor/src/__tests__/adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin-cursor): wire ExternalAgentAdapter to cursor runner

Resolve effective session mode, MCP bridge, resume id, and abort.
EOF
)"
```

---

### Task 7: Host Capabilities And Commands For `cursor`

**Files:**
- Modify: `server/src/interfaces/http/provider-capabilities.ts`
- Modify: `server/src/interfaces/http/provider-commands.ts`
- Modify: `server/src/interfaces/http/__tests__/provider-capabilities.test.ts`

**Interfaces:**
- Consumes: existing `ProviderCapabilities` type
- Produces: `GET /api/providers/type/cursor/capabilities` with modes `default`/`plan`/`ask`; commands route accepts `cursor`

- [ ] **Step 1: Write failing capability test**

In `provider-capabilities.test.ts` add:

```ts
it('returns cursor runtime capabilities with default/plan/ask modes', async () => {
  const app = makeApp();
  const res = await request(app).get('/api/providers/type/cursor/capabilities');
  expect(res.status).toBe(200);
  expect(res.body.data.supportsAIReview).toBe(false);
  expect(res.body.data.defaultModeId).toBe('default');
  expect(res.body.data.modes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'default' }),
      expect.objectContaining({ id: 'plan' }),
      expect.objectContaining({ id: 'ask' }),
    ])
  );
});
```

Optionally extend `provider-commands.test.ts` so `type/cursor/commands` returns 200 (same list as claude).

- [ ] **Step 2: Run test — expect FAIL (404)**

Run: `pnpm --filter @zclaudia/server test -- src/interfaces/http/__tests__/provider-capabilities.test.ts`

- [ ] **Step 3: Implement capabilities + commands allowlist**

In `provider-capabilities.ts`:

```ts
const CURSOR_CAPABILITIES: ProviderCapabilities = {
  modeLabel: 'Mode',
  defaultModeId: 'default',
  modes: [
    { id: 'default', label: 'Default', description: 'Normal Cursor agent turns (--yolo)' },
    { id: 'plan', label: 'Plan', description: 'Cursor plan mode' },
    { id: 'ask', label: 'Ask', description: 'Cursor ask (read-oriented) mode' },
  ],
  modelLabel: 'Model',
  models: [],
  supportsAIReview: false,
};

const RUNTIME_CAPABILITIES: Record<string, ProviderCapabilities> = {
  zclaudia: ZCLAUDIA_CAPABILITIES,
  claude: CLAUDE_CAPABILITIES,
  cursor: CURSOR_CAPABILITIES,
};
```

In `provider-commands.ts` change the guard to:

```ts
if (req.params.type !== 'zclaudia' && req.params.type !== 'claude' && req.params.type !== 'cursor') {
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/interfaces/http/provider-capabilities.ts server/src/interfaces/http/provider-commands.ts server/src/interfaces/http/__tests__/provider-capabilities.test.ts server/src/interfaces/http/__tests__/provider-commands.test.ts
git commit -m "$(cat <<'EOF'
feat(server): expose cursor runtime capabilities and commands

Include default/plan/ask modes so the chat mode selector works for
Cursor agent profiles.
EOF
)"
```

---

### Task 8: Plugin Lifecycle Coverage

**Files:**
- Create: `server/src/application/plugins/__tests__/cursor-plugin-lifecycle.test.ts`

**Interfaces:**
- Consumes: `registerAgentRuntimeContributions`, `providerRegistry.registerPluginAdapter`, `PluginAgentProfileService`
- Produces: proof that `cursor` contribution installs `cursor-default` and tears down cleanly

- [ ] **Step 1: Copy Claude lifecycle test**

Duplicate `claude-plugin-lifecycle.test.ts` → `cursor-plugin-lifecycle.test.ts`, replace plugin id `com.zclaudia.cursor`, type `cursor`, profile `cursor-default`. Keep a minimal valid `AgentRuntimeContribution`.

- [ ] **Step 2: Run test**

Run: `pnpm --filter @zclaudia/server test -- src/application/plugins/__tests__/cursor-plugin-lifecycle.test.ts`

Expected: PASS (uses existing contribution APIs; no new production code if registry already generic).

If the test fails because `runtimeType: 'cursor'` is rejected by repo validation, fix the validation allowlist to include `cursor` (it should already be in `AGENT_RUNTIME_TYPES`).

- [ ] **Step 3: Commit**

```bash
git add server/src/application/plugins/__tests__/cursor-plugin-lifecycle.test.ts
git commit -m "test(server): cover cursor plugin runtime contribution lifecycle"
```

---

### Task 9: Build And Acceptance Check

**Files:** none new (verification only)

- [ ] **Step 1: Build packages**

```bash
pnpm --filter @zclaudia/plugin-cursor build
pnpm --filter @zclaudia/shared build
pnpm --filter @zclaudia/server build
```

Expected: all succeed.

- [ ] **Step 2: Run plugin + focused server tests**

```bash
pnpm --filter @zclaudia/plugin-cursor test
pnpm --filter @zclaudia/server test -- src/interfaces/http/__tests__/provider-capabilities.test.ts src/application/plugins/__tests__/cursor-plugin-lifecycle.test.ts
```

Expected: PASS

- [ ] **Step 3: Manual acceptance notes (engineer checklist, not CI)**

With desktop/dev stack and Cursor CLI installed:

1. Enable/install `com.zclaudia.cursor` plugin if not auto-loaded from `plugins/`.
2. Create or use agent with runtime Cursor; confirm CLI path field + auth note appear.
3. Send a chat message → streaming assistant text.
4. Send follow-up → resume uses prior provider session id.
5. Switch mode to Plan / Ask → next turn spawns with `--mode=`.
6. Cancel mid-run → process stops.
7. With bridge tools registered, confirm `<cwd>/.cursor/mcp.json` contains bridge without deleting user servers.

- [ ] **Step 4: Final commit only if Step 1–2 required small fixes**; otherwise done.

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|---|---|
| `plugins/cursor` package + plugin.json + activate | 1 |
| MCP merge into `.cursor/mcp.json`, no same-name clobber | 2, 5–6 |
| Resolve `cursor-agent` / cliPath | 3, 5 |
| NDJSON → events + switchMode/createPlan | 4–5 |
| Spawn flags, resume, modes, systemPrompt prepend | 5 |
| Adapter sessionModes, bridge, abort, getRunState | 6 |
| HTTP modes default/plan/ask | 7 |
| Commands type allowlist | 7 |
| Contribution lifecycle | 8 |
| Build + acceptance | 9 |
| No server `external-agents/cursor` | Global + File Structure |
| Deferrals (plan card, images, tasks, jobs) | Global Constraints |

## Placeholder / Consistency Check

- Event types: legacy `assistant` / `tool_use` / `tool_result` / `result` / `error` / `init` / `mode_transition` (matches my-claudia Cursor + host normalizer).
- Bridge type: `{ name: string; config: unknown }` consistent across adapter, runner, mcp-inject.
- Runtime type string always `'cursor'`; plugin id `com.zclaudia.cursor`.
- `ask` is a **chat mode** in HTTP capabilities; PCP `permissionModeMap` stays `supervised→default`, `plan_only→plan` (no invented PCP enum).
