# Claude Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Claude runtime so chat, resume, cancel, permission approval, and SDK event mapping are reliable enough to use before copying the pattern to Codex/Cursor.

**Architecture:** Keep all Claude SDK-specific code in `server/src/infra/providers/claude-agent`. The common runtime continues to consume `ProviderRuntimeEvent`, `RunOptions`, and `PermissionCallback`; it should not import Claude SDK types. Live SDK verification is opt-in via a script and is not part of normal CI.

**Tech Stack:** TypeScript, Vitest, `@anthropic-ai/claude-agent-sdk`, existing zclaudia provider runtime contracts, React ProfileEditor tests.

---

## File Structure

- Create `server/src/infra/providers/claude-agent/permissions.ts`: convert Claude SDK `canUseTool` calls into zclaudia `PermissionCallback` calls.
- Modify `server/src/infra/providers/claude-agent/runner.ts`: pass `canUseTool`, type the SDK options more narrowly, and expand SDK message transforms.
- Modify `server/src/infra/providers/claude-agent/adapter.ts`: pass the zclaudia permission callback through to `runClaudeAgent`.
- Modify `server/src/infra/providers/claude-agent/manifest.ts`: mark `interaction.approval` supported only after permission bridge tests pass.
- Modify `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`: cover permission bridge wiring and event transform shapes.
- Create `server/scripts/smoke-claude-runtime.ts`: opt-in live Claude SDK smoke harness.
- Modify `server/package.json`: add a script for the live smoke harness.
- Modify `apps/desktop/src/features/agents/ProfileEditor.tsx`: show a small runtime capability hint below the runtime selector.
- Modify `apps/desktop/src/features/agents/__tests__/ProfileEditor.test.tsx`: assert the Claude runtime hint appears after selecting Claude.
- Modify `docs/plans/agent-runtime-codex-cursor-replication.md`: update the replication checklist after hardening.

---

### Task 1: Claude Permission Bridge

**Files:**
- Create: `server/src/infra/providers/claude-agent/permissions.ts`
- Modify: `server/src/infra/providers/claude-agent/runner.ts`
- Modify: `server/src/infra/providers/claude-agent/adapter.ts`
- Modify: `server/src/infra/providers/claude-agent/manifest.ts`
- Test: `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`

- [x] **Step 1: Add failing permission bridge tests**

Add these imports to `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`:

```ts
import { buildClaudeCanUseTool } from '../claude-agent/permissions.js';
```

Add tests:

```ts
it('bridges Claude canUseTool allow decisions to the SDK permission result', async () => {
  const onPermission = vi.fn(async () => ({ behavior: 'allow' as const }));
  const canUseTool = buildClaudeCanUseTool(onPermission);

  const result = await canUseTool(
    'Bash',
    { command: 'npm test' },
    {
      signal: new AbortController().signal,
      toolUseID: 'tool-1',
      title: 'Claude wants to run Bash',
      displayName: 'Run command',
      description: 'npm test',
    }
  );

  expect(onPermission).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: 'tool-1',
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      detail: 'Claude wants to run Bash\n\nnpm test',
      timeoutSeconds: 60,
      timeoutBehavior: 'deny',
    })
  );
  expect(result).toEqual({ behavior: 'allow' });
});

it('bridges Claude canUseTool deny decisions to the SDK permission result', async () => {
  const onPermission = vi.fn(async () => ({ behavior: 'deny' as const, message: 'Nope' }));
  const canUseTool = buildClaudeCanUseTool(onPermission);

  const result = await canUseTool(
    'Write',
    { file_path: 'src/app.ts' },
    {
      signal: new AbortController().signal,
      toolUseID: 'tool-2',
      title: 'Claude wants to write a file',
    }
  );

  expect(result).toEqual({ behavior: 'deny', message: 'Nope' });
});

it('passes canUseTool to the Claude SDK query options', async () => {
  const adapter = new ClaudeAgentAdapter();
  queryMock.mockReturnValueOnce(claudeStream([]));

  for await (const _event of adapter.run(
    'hello',
    { cwd: '/tmp/project', claudiaSessionId: 'session-1' } as any,
    vi.fn(async () => ({ behavior: 'allow' }))
  )) {
    // drain
  }

  expect(queryMock).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        canUseTool: expect.any(Function),
      }),
    })
  );
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts
```

Expected: FAIL because `buildClaudeCanUseTool` does not exist and `runner.ts` does not pass `canUseTool`.

- [x] **Step 3: Implement the permission bridge**

Create `server/src/infra/providers/claude-agent/permissions.ts`:

```ts
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionCallback } from '../types.js';

function detailFromClaudeRequest(input: {
  title?: string;
  displayName?: string;
  description?: string;
  toolName: string;
}): string {
  const heading = input.title || input.displayName || `Claude wants to use ${input.toolName}`;
  return input.description ? `${heading}\n\n${input.description}` : heading;
}

export function buildClaudeCanUseTool(onPermission?: PermissionCallback): CanUseTool | undefined {
  if (!onPermission) return undefined;

  return async (toolName, toolInput, options): Promise<PermissionResult> => {
    if (options.signal.aborted) {
      return { behavior: 'deny', message: 'Permission request was aborted.' };
    }

    const decision = await onPermission({
      requestId: options.toolUseID,
      toolName,
      toolInput,
      detail: detailFromClaudeRequest({
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        toolName,
      }),
      timeoutSeconds: 60,
      timeoutBehavior: 'deny',
    });

    if (decision.behavior === 'allow') {
      return decision.updatedInput === undefined
        ? { behavior: 'allow' }
        : { behavior: 'allow', updatedInput: decision.updatedInput as Record<string, unknown> };
    }

    return {
      behavior: 'deny',
      message: decision.message || 'Denied by ZClaudia permission policy.',
    };
  };
}
```

- [x] **Step 4: Wire the bridge through runner and adapter**

In `server/src/infra/providers/claude-agent/runner.ts`, change imports:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk';
```

Add to `ClaudeAgentRunOptions`:

```ts
canUseTool?: CanUseTool;
```

Change SDK options construction:

```ts
const sdkOptions: Partial<Options> = {
  cwd: options.cwd,
  abortController,
};
```

Add:

```ts
if (options.canUseTool) sdkOptions.canUseTool = options.canUseTool;
```

In `server/src/infra/providers/claude-agent/adapter.ts`, import:

```ts
import { buildClaudeCanUseTool } from './permissions.js';
```

Change `_onPermission?: PermissionCallback` to:

```ts
onPermission?: PermissionCallback
```

Pass into `runClaudeAgent`:

```ts
canUseTool: buildClaudeCanUseTool(onPermission),
```

- [x] **Step 5: Update the manifest once tests pass**

In `server/src/infra/providers/claude-agent/manifest.ts`, replace the approval capability:

```ts
{ id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
```

- [x] **Step 6: Run focused tests**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts
corepack pnpm --filter @zclaudia/server build
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/infra/providers/claude-agent/permissions.ts server/src/infra/providers/claude-agent/runner.ts server/src/infra/providers/claude-agent/adapter.ts server/src/infra/providers/claude-agent/manifest.ts server/src/infra/providers/__tests__/claude-agent-adapter.test.ts
git commit -m "feat(runtime): bridge claude tool permissions"
```

---

### Task 2: Claude SDK Event Mapping Hardening

**Files:**
- Modify: `server/src/infra/providers/claude-agent/runner.ts`
- Test: `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`

- [x] **Step 1: Add event transform tests**

Add tests to `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`:

```ts
it('transforms assistant text and tool use blocks', () => {
  expect(
    transformClaudeSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    })
  ).toEqual([
    { type: 'assistant', content: 'hello' },
    {
      type: 'tool_use',
      toolUseId: 'tool-1',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
    },
  ]);
});

it('transforms user tool result blocks', () => {
  expect(
    transformClaudeSdkMessage({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents', is_error: false },
        ],
      },
    })
  ).toEqual({
    type: 'tool_result',
    toolUseId: 'tool-1',
    toolResult: 'file contents',
    isToolError: false,
  });
});

it('transforms result success and execution errors', () => {
  expect(transformClaudeSdkMessage({ type: 'result', result: 'done' })).toEqual({
    type: 'result',
    content: 'done',
    isComplete: true,
  });

  expect(
    transformClaudeSdkMessage({
      type: 'result',
      subtype: 'error_during_execution',
      error: 'boom',
    })
  ).toEqual({
    type: 'error',
    error: 'boom',
  });
});

it('ignores malformed assistant and user messages without emitting empty content', () => {
  expect(transformClaudeSdkMessage({ type: 'assistant', message: {} })).toEqual([]);
  expect(transformClaudeSdkMessage({ type: 'user', message: {} })).toEqual([]);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts
```

Expected: FAIL on malformed assistant/user messages because the current mapper emits `{ type: 'assistant', content: '' }`.

- [x] **Step 3: Update malformed assistant/user handling**

In `server/src/infra/providers/claude-agent/runner.ts`, replace malformed assistant handling:

```ts
if (!Array.isArray(blocks)) return [];
```

Replace malformed user handling:

```ts
if (!Array.isArray(blocks)) return [];
```

- [x] **Step 4: Run focused tests and build**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts
corepack pnpm --filter @zclaudia/server build
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/infra/providers/claude-agent/runner.ts server/src/infra/providers/__tests__/claude-agent-adapter.test.ts
git commit -m "test(runtime): harden claude sdk event mapping"
```

---

### Task 3: Opt-In Claude Live Smoke Harness

**Files:**
- Create: `server/scripts/smoke-claude-runtime.ts`
- Modify: `server/package.json`
- Create: `docs/plans/claude-runtime-smoke-check.md`

- [x] **Step 1: Add the smoke script**

Create `server/scripts/smoke-claude-runtime.ts`:

```ts
import { ClaudeAgentAdapter } from '../src/infra/providers/claude-agent/adapter.js';
import type { ProviderRuntimeEvent } from '../src/infra/providers/types.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /abort|cancel/i.test(`${error.name} ${error.message}`);
}

async function collect(
  adapter: ClaudeAgentAdapter,
  input: string,
  options: {
    cwd: string;
    sessionId?: string;
    abortAfterMs?: number;
  }
): Promise<{
  events: ProviderRuntimeEvent[];
  sessionId?: string;
  aborted: boolean;
  abortObserved: boolean;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const abortController = new AbortController();
  const timer =
    options.abortAfterMs !== undefined
      ? setTimeout(() => abortController.abort(), options.abortAfterMs)
      : undefined;
  const events: ProviderRuntimeEvent[] = [];
  try {
    for await (const event of adapter.run(
      input,
      {
        cwd: options.cwd,
        sessionId: options.sessionId,
        claudiaSessionId: `smoke-${Date.now()}`,
        abortController,
        mode: 'default',
      } as never,
      async () => ({ behavior: 'deny', message: 'Smoke test denies permission prompts.' })
    )) {
      events.push(event);
      if (event.type === 'init' && event.sessionId) {
        console.log(`[smoke] init session=${event.sessionId}`);
      }
      if (event.type === 'assistant' && event.content) {
        console.log(`[smoke] assistant ${event.content.slice(0, 120)}`);
      }
      if (event.type === 'result') {
        console.log('[smoke] result');
      }
      if (event.type === 'error') {
        console.error(`[smoke] provider error: ${event.error}`);
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted || !isAbortLikeError(error)) {
      throw error;
    }
    console.log('[smoke] abort observed');
    return {
      events,
      sessionId: events.find(event => event.type === 'init' && event.sessionId)?.sessionId,
      aborted: true,
      abortObserved: true,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    events,
    sessionId: events.find(event => event.type === 'init' && event.sessionId)?.sessionId,
    aborted: abortController.signal.aborted,
    abortObserved: false,
    elapsedMs: Date.now() - startedAt,
  };
}

function stoppedPromptlyAfterAbort(
  result: Awaited<ReturnType<typeof collect>>,
  abortAfterMs: number
): boolean {
  return (
    result.aborted &&
    (result.abortObserved ||
      (result.elapsedMs <= abortAfterMs + 5_000 &&
        !result.events.some(event => event.type === 'result')))
  );
}

async function main(): Promise<void> {
  if (!hasFlag('live')) {
    console.log('Skipping live Claude smoke. Re-run with --live to call the Claude Agent SDK.');
    return;
  }

  const cwd = arg('cwd') ?? process.cwd();
  const prompt = arg('prompt') ?? 'Reply with exactly: zclaudia claude runtime smoke ok';
  const adapter = new ClaudeAgentAdapter();

  const first = await collect(adapter, prompt, { cwd });
  if (!first.sessionId) {
    throw new Error('Claude smoke did not receive an init session id.');
  }
  if (!first.events.some(event => event.type === 'result' || event.type === 'assistant')) {
    throw new Error('Claude smoke did not receive assistant content or a result event.');
  }

  const second = await collect(adapter, 'Reply with exactly: resumed ok', {
    cwd,
    sessionId: first.sessionId,
  });
  if (second.sessionId !== first.sessionId) {
    throw new Error(
      `Claude resume smoke started a different session: ${second.sessionId ?? 'missing init'}`
    );
  }
  if (!second.events.some(event => event.type === 'result' || event.type === 'assistant')) {
    throw new Error('Claude resume smoke did not receive assistant content or a result event.');
  }

  const abortAfterMs = 250;
  const cancelled = await collect(adapter, 'Wait for 30 seconds before replying.', {
    cwd,
    sessionId: first.sessionId,
    abortAfterMs,
  });
  if (!stoppedPromptlyAfterAbort(cancelled, abortAfterMs)) {
    throw new Error('Claude cancel smoke did not stop promptly after AbortController fired.');
  }
  console.log('[smoke] cancel path invoked through AbortController');
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
```

- [x] **Step 2: Add package script**

In `server/package.json`, add:

```json
"smoke:claude-runtime": "tsx scripts/smoke-claude-runtime.ts"
```

- [x] **Step 3: Add smoke documentation**

Create `docs/plans/claude-runtime-smoke-check.md`:

````md
# Claude Runtime Smoke Check

This smoke check is opt-in and calls the real Claude Agent SDK.

Run from the repo root:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime -- --live --cwd=/path/to/project
```

Expected behavior:

- The first turn prints an init session id.
- The second turn resumes that session id.
- The final turn aborts quickly through the shared AbortController path.

If the Claude Agent SDK or Claude Code authentication is unavailable, the script
fails with the SDK error. This script is not part of normal CI.
````

- [x] **Step 4: Run non-live script**

Run:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime
```

Expected: PASS with "Skipping live Claude smoke".

- [x] **Step 5: Run build**

Run:

```bash
corepack pnpm --filter @zclaudia/server build
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/scripts/smoke-claude-runtime.ts server/package.json docs/plans/claude-runtime-smoke-check.md
git commit -m "chore(runtime): add claude live smoke harness"
```

---

### Task 4: Profile Editor Runtime Hint

**Files:**
- Modify: `apps/desktop/src/features/agents/ProfileEditor.tsx`
- Test: `apps/desktop/src/features/agents/__tests__/ProfileEditor.test.tsx`

- [x] **Step 1: Add failing UI test**

Add this test:

```ts
it('shows Claude runtime limitations when Claude is selected', async () => {
  await renderEditor(null);

  expect(screen.queryByText(/Claude Agent SDK/)).toBeNull();

  fireEvent.change(screen.getByLabelText('Runtime'), {
    target: { value: 'claude' },
  });

  expect(screen.getByText(/Claude Agent SDK/)).toBeInTheDocument();
  expect(screen.getByText(/AI review and multimodal fallback are zclaudia-only/)).toBeInTheDocument();
});
```

- [x] **Step 2: Run test and verify it fails**

Run:

```bash
corepack pnpm --filter @zclaudia/desktop test -- src/features/agents/__tests__/ProfileEditor.test.tsx
```

Expected: FAIL because the hint is not rendered.

- [x] **Step 3: Add the hint**

In `apps/desktop/src/features/agents/ProfileEditor.tsx`, directly below the runtime `<select>`, add:

```tsx
{formRuntimeType === 'claude' && (
  <p className="mt-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
    Claude uses the Claude Agent SDK runtime. AI review and multimodal fallback are zclaudia-only
    in this phase.
  </p>
)}
```

- [x] **Step 4: Run test and build**

Run:

```bash
corepack pnpm --filter @zclaudia/desktop test -- src/features/agents/__tests__/ProfileEditor.test.tsx
corepack pnpm --filter @zclaudia/desktop build
```

Expected: PASS. Existing Vite chunk warnings are acceptable.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/ProfileEditor.tsx apps/desktop/src/features/agents/__tests__/ProfileEditor.test.tsx docs/plans/claude-runtime-hardening-implementation.md
git commit -m "feat(agents): explain claude runtime limitations"
```

---

### Task 5: Replication Checklist Update And Final Verification

**Files:**
- Modify: `docs/plans/agent-runtime-codex-cursor-replication.md`

- [x] **Step 1: Update the checklist**

In `docs/plans/agent-runtime-codex-cursor-replication.md`, add under "Completed Claude Path":

```md
- Claude hardening: permission bridge, event mapping coverage, live smoke harness, and UI limitations hint are implemented.
```

Add under "Replication Steps Per Runtime":

```md
10. Add a runtime-local permission bridge before declaring `interaction.approval` supported.
11. Add an opt-in live smoke harness for the runtime before starting UI polish.
```

- [x] **Step 2: Run final verification**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/__tests__/registry.test.ts
corepack pnpm --filter @zclaudia/server test -- src/application/conversation/runtime/__tests__/run-handler.test.ts src/application/conversation/runtime/__tests__/run-provider-launch.test.ts src/application/conversation/runtime/__tests__/run-context.test.ts
corepack pnpm --filter @zclaudia/desktop test -- src/features/agents/__tests__/ProfileEditor.test.tsx
corepack pnpm --filter @zclaudia/shared build
corepack pnpm --filter @zclaudia/server build
corepack pnpm --filter @zclaudia/desktop build
git diff --check
git status --short
```

Expected:

- All tests pass.
- All builds pass.
- `git diff --check` has no output.
- `git status --short` only shows the checklist document before commit.

- [x] **Step 3: Commit**

```bash
git add docs/plans/agent-runtime-codex-cursor-replication.md docs/plans/claude-runtime-hardening-implementation.md
git commit -m "docs(runtime): update runtime replication checklist"
```

---

## Execution Notes

- Do not add or commit anything under `docs/superpowers`.
- Keep live Claude smoke opt-in; do not make it part of CI.
- Do not implement Codex or Cursor in this phase.
- Do not broaden Claude MCP/background task parity unless a test in this plan requires it.
