# Claude Runtime Phase B Agent Plugin MCP Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject zclaudia interaction tools into Claude through a provider-plugin boundary that can later be reused by Codex and Cursor providers.

**Architecture:** Add a provider-agnostic agent plugin tool bridge helper under `server/src/infra/providers/external-agents/agent-plugin`. The helper exposes a standard zclaudia bridge context and can create the existing MCP stdio bridge entry without importing Claude SDK types. Claude then translates that bridge entry into Claude SDK `mcpServers`, merging it with user Claude config while preserving user-defined `claudia-plugins` servers.

**Tech Stack:** TypeScript, Vitest, Claude Agent SDK option types, existing `buildMcpBridgeEntry` helper.

---

## File Structure

- Create `server/src/infra/providers/external-agents/agent-plugin/tool-bridge.ts`
  - Owns provider-agnostic tool bridge context types.
  - Calls existing `buildMcpBridgeEntry(serverPort, sessionId)` helper.
  - Does not import Claude SDK types.
- Create `server/src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts`
  - Verifies bridge entry creation from standard context.
  - Verifies missing port and missing registered tools produce no entry.
- Modify `server/src/infra/providers/external-agents/claude/adapter.ts`
  - Builds standard tool bridge context from `RunOptions`.
  - Merges bridge MCP entry into loaded Claude config before calling `runClaudeAgent`.
  - Keeps user-defined `claudia-plugins` config when present.
- Modify `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`
  - Verifies Claude receives user MCP servers plus bridge server.
  - Verifies no bridge is injected without `serverPort`.
  - Verifies user-defined `claudia-plugins` is preserved.
- Modify `docs/plans/claude-runtime-completion.md`
  - Mark Phase B as implemented after tests and build pass.

## Task 1: Standard Agent Plugin Tool Bridge Helper

**Files:**

- Create: `server/src/infra/providers/external-agents/agent-plugin/tool-bridge.ts`
- Create: `server/src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildMcpBridgeEntryMock = vi.fn();

vi.mock('../../../utils/mcp-bridge-launch.js', () => ({
  buildMcpBridgeEntry: buildMcpBridgeEntryMock,
}));

describe('agent plugin tool bridge', () => {
  beforeEach(() => {
    buildMcpBridgeEntryMock.mockReset();
  });

  it('creates a zclaudia tool bridge MCP entry from standard run context', async () => {
    buildMcpBridgeEntryMock.mockReturnValueOnce({
      command: 'node',
      args: ['mcp-bridge.js'],
      env: {
        CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100',
        CLAUDIA_SESSION_ID: 'session-1',
      },
    });

    const { createAgentPluginToolBridgeMcpEntry } = await import('../tool-bridge.js');
    const entry = createAgentPluginToolBridgeMcpEntry({
      serverPort: 3100,
      zclaudiaSessionId: 'session-1',
    });

    expect(buildMcpBridgeEntryMock).toHaveBeenCalledWith(3100, 'session-1');
    expect(entry).toEqual({
      command: 'node',
      args: ['mcp-bridge.js'],
      env: {
        CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100',
        CLAUDIA_SESSION_ID: 'session-1',
      },
    });
  });

  it('does not create a bridge entry without a server port', async () => {
    const { createAgentPluginToolBridgeMcpEntry } = await import('../tool-bridge.js');

    expect(
      createAgentPluginToolBridgeMcpEntry({
        serverPort: undefined,
        zclaudiaSessionId: 'session-1',
      })
    ).toBeNull();
    expect(buildMcpBridgeEntryMock).not.toHaveBeenCalled();
  });

  it('returns null when no bridge tools are registered', async () => {
    buildMcpBridgeEntryMock.mockReturnValueOnce(null);

    const { createAgentPluginToolBridgeMcpEntry } = await import('../tool-bridge.js');

    expect(
      createAgentPluginToolBridgeMcpEntry({
        serverPort: 3100,
        zclaudiaSessionId: 'session-1',
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts
```

Expected: FAIL because `server/src/infra/providers/external-agents/agent-plugin/tool-bridge.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `server/src/infra/providers/external-agents/agent-plugin/tool-bridge.ts`:

```ts
import { buildMcpBridgeEntry, type McpBridgeServerEntry } from '../../utils/mcp-bridge-launch.js';

export const DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME = 'claudia-plugins';

export interface AgentPluginToolBridgeContext {
  serverPort?: number;
  zclaudiaSessionId?: string;
}

export type AgentPluginMcpBridgeEntry = McpBridgeServerEntry;

export function createAgentPluginToolBridgeMcpEntry(
  context: AgentPluginToolBridgeContext
): AgentPluginMcpBridgeEntry | null {
  if (!context.serverPort) return null;
  return buildMcpBridgeEntry(context.serverPort, context.zclaudiaSessionId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/infra/providers/external-agents/agent-plugin/tool-bridge.ts server/src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts
git commit -m "feat(runtime): add agent plugin tool bridge context"
```

## Task 2: Claude Translation And MCP Merge

**Files:**

- Modify: `server/src/infra/providers/external-agents/claude/adapter.ts`
- Modify: `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`

- [ ] **Step 1: Write failing Claude adapter tests**

In `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`, mock the bridge helper:

```ts
const { queryMock, loadClaudeAgentConfigMock, createToolBridgeEntryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  loadClaudeAgentConfigMock: vi.fn(() => ({ mcpServers: {}, plugins: [] })),
  createToolBridgeEntryMock: vi.fn(() => null),
}));
```

Add:

```ts
vi.mock('../external-agents/agent-plugin/tool-bridge.js', () => ({
  DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME: 'claudia-plugins',
  createAgentPluginToolBridgeMcpEntry: createToolBridgeEntryMock,
}));
```

Add tests:

```ts
it('merges the standard tool bridge MCP server into Claude SDK options', async () => {
  const adapter = new ClaudeAgentAdapter();
  loadClaudeAgentConfigMock.mockReturnValueOnce({
    mcpServers: {
      docs: { command: 'node', args: ['docs-server.js'] },
    },
    plugins: [],
  });
  createToolBridgeEntryMock.mockReturnValueOnce({
    command: 'node',
    args: ['mcp-bridge.js'],
    env: {
      CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100',
      CLAUDIA_SESSION_ID: 'session-1',
    },
  });
  queryMock.mockReturnValueOnce(claudeStream([]));

  for await (const _event of adapter.run(
    'hello',
    {
      cwd: '/tmp/project',
      claudiaSessionId: 'session-1',
      serverPort: 3100,
    } as any,
    vi.fn()
  )) {
    // drain stream
  }

  expect(createToolBridgeEntryMock).toHaveBeenCalledWith({
    serverPort: 3100,
    zclaudiaSessionId: 'session-1',
  });
  expect(queryMock).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        mcpServers: {
          docs: { command: 'node', args: ['docs-server.js'] },
          'claudia-plugins': {
            command: 'node',
            args: ['mcp-bridge.js'],
            env: {
              CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100',
              CLAUDIA_SESSION_ID: 'session-1',
            },
          },
        },
      }),
    })
  );
});

it('preserves user-defined claudia-plugins MCP server over the generated bridge', async () => {
  const adapter = new ClaudeAgentAdapter();
  loadClaudeAgentConfigMock.mockReturnValueOnce({
    mcpServers: {
      'claudia-plugins': { command: 'custom-bridge', args: ['user.js'] },
    },
    plugins: [],
  });
  createToolBridgeEntryMock.mockReturnValueOnce({
    command: 'node',
    args: ['mcp-bridge.js'],
    env: { CLAUDIA_BRIDGE_URL: 'http://127.0.0.1:3100' },
  });
  queryMock.mockReturnValueOnce(claudeStream([]));

  for await (const _event of adapter.run(
    'hello',
    { cwd: '/tmp/project', claudiaSessionId: 'session-1', serverPort: 3100 } as any,
    vi.fn()
  )) {
    // drain stream
  }

  expect(queryMock).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        mcpServers: {
          'claudia-plugins': { command: 'custom-bridge', args: ['user.js'] },
        },
      }),
    })
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts
```

Expected: FAIL because the Claude adapter does not call the tool bridge helper or merge the bridge MCP server.

- [ ] **Step 3: Implement Claude MCP merge**

In `server/src/infra/providers/external-agents/claude/adapter.ts`, import:

```ts
import {
  createAgentPluginToolBridgeMcpEntry,
  DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME,
} from '../agent-plugin/tool-bridge.js';
```

Add a small local merge helper:

```ts
function mergeClaudeMcpServers(
  base: ClaudeAgentRunOptions['mcpServers'],
  bridgeEntry: ClaudeAgentRunOptions['mcpServers'][string] | null
): ClaudeAgentRunOptions['mcpServers'] {
  if (!bridgeEntry) return base;
  if (base?.[DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME]) return base;
  return {
    ...base,
    [DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME]: bridgeEntry,
  };
}
```

Before calling `runClaudeAgent`, create and merge:

```ts
const bridgeEntry = createAgentPluginToolBridgeMcpEntry({
  serverPort: options.serverPort,
  zclaudiaSessionId: options.claudiaSessionId,
});
const mcpServers = mergeClaudeMcpServers(claudeConfig.mcpServers, bridgeEntry);
```

Pass `mcpServers` instead of `claudeConfig.mcpServers`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/infra/providers/external-agents/claude/adapter.ts server/src/infra/providers/__tests__/claude-agent-adapter.test.ts
git commit -m "feat(runtime): inject agent plugin bridge into claude"
```

## Task 3: Completion Docs And Verification

**Files:**

- Modify: `docs/plans/claude-runtime-completion.md`

- [ ] **Step 1: Update completion doc**

Add under Phase B:

```md
Phase B status: implemented. zclaudia exposes a provider-agnostic agent plugin
tool bridge context, and Claude translates that bridge into a `claudia-plugins`
MCP server when bridge tools and a server port are available. User-defined
`claudia-plugins` MCP servers are preserved.
```

- [ ] **Step 2: Run final verification**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/external-agents/agent-plugin/__tests__/tool-bridge.test.ts src/utils/__tests__/mcp-bridge-launch.test.ts
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/external-agents/claude/__tests__/config.test.ts src/infra/providers/__tests__/registry.test.ts
corepack pnpm --filter @zclaudia/server test -- src/application/conversation/runtime/__tests__/run-handler.test.ts src/application/conversation/runtime/__tests__/run-provider-launch.test.ts src/application/conversation/runtime/__tests__/run-context.test.ts
corepack pnpm --filter @zclaudia/server smoke:claude-runtime
corepack pnpm --filter @zclaudia/server build
git diff --check
git ls-files docs/superpowers | wc -l
```

Expected: all tests/build/smoke pass, `git diff --check` prints nothing, and `git ls-files docs/superpowers | wc -l` prints `0`.

- [ ] **Step 3: Commit**

```bash
git add docs/plans/claude-runtime-completion.md
git commit -m "docs(runtime): mark claude bridge phase complete"
```

## Self-Review

- Spec coverage: The plan implements the approved provider-plugin boundary by introducing a provider-agnostic helper and keeping Claude-specific SDK translation inside the Claude adapter.
- Placeholder scan: No placeholder tasks remain.
- Type consistency: The helper uses `AgentPluginToolBridgeContext`, returns the existing `McpBridgeServerEntry`, and Claude translates that into `ClaudeAgentRunOptions['mcpServers']`.
