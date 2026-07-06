# Claude Runtime Phase A Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Claude Code MCP servers and enabled plugins into the Claude Agent SDK for `runtimeType: 'claude'` runs.

**Architecture:** Keep Claude Code config parsing inside `server/src/infra/providers/external-agents/claude` so common runtime code remains provider-agnostic. The adapter asks the loader for SDK-compatible config, then the runner passes `mcpServers` and `plugins` to `query({ prompt, options })`. Invalid or absent config fails closed to empty config.

**Tech Stack:** TypeScript, Vitest, `@anthropic-ai/claude-agent-sdk`, Node `fs/path/os`, existing Claude agent adapter tests.

---

## File Structure

- Create `server/src/infra/providers/external-agents/claude/config.ts`: adapter-local loader for `~/.claude/mcp.json`, `~/.claude/settings.json`, and `~/.claude/plugins/installed_plugins.json`.
- Create `server/src/infra/providers/external-agents/claude/__tests__/config.test.ts`: focused tests for absent config, valid MCP config, valid plugin config, invalid JSON, and cache clearing.
- Modify `server/src/infra/providers/external-agents/claude/runner.ts`: add `mcpServers` and `plugins` to `ClaudeAgentRunOptions` and SDK options.
- Modify `server/src/infra/providers/external-agents/claude/adapter.ts`: load Claude config and pass it to `runClaudeAgent`.
- Modify `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`: assert SDK query receives loaded config through the adapter.
- Modify `docs/plans/claude-runtime-completion.md`: mark Phase A complete after implementation and verification.

---

### Task 1: Claude Config Loader

**Files:**
- Create: `server/src/infra/providers/external-agents/claude/config.ts`
- Create: `server/src/infra/providers/external-agents/claude/__tests__/config.test.ts`

- [ ] **Step 1: Add failing loader tests**

Create `server/src/infra/providers/external-agents/claude/__tests__/config.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const homedirMock = vi.hoisted(() => vi.fn());

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: homedirMock,
  };
});

const { clearClaudeAgentConfigCache, loadClaudeAgentConfig } = await import('../config.js');

const tempDirs: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zclaudia-claude-config-'));
  tempDirs.push(dir);
  homedirMock.mockReturnValue(dir);
  clearClaudeAgentConfigCache();
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value), 'utf-8');
}

afterEach(() => {
  clearClaudeAgentConfigCache();
  homedirMock.mockReset();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadClaudeAgentConfig', () => {
  it('returns empty SDK config when Claude config files are absent', () => {
    makeHome();

    expect(loadClaudeAgentConfig()).toEqual({
      mcpServers: {},
      plugins: [],
    });
  });

  it('loads stdio MCP servers from ~/.claude/mcp.json', () => {
    const home = makeHome();
    writeJson(path.join(home, '.claude', 'mcp.json'), {
      mcpServers: {
        docs: {
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'secret' },
        },
        broken: {
          args: ['missing-command'],
        },
      },
    });

    expect(loadClaudeAgentConfig().mcpServers).toEqual({
      docs: {
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
      },
    });
  });

  it('loads enabled local plugins from Claude settings and installed registry', () => {
    const home = makeHome();
    const pluginPath = path.join(home, 'plugin-a');
    mkdirSync(pluginPath, { recursive: true });
    writeJson(path.join(home, '.claude', 'settings.json'), {
      enabledPlugins: {
        'plugin-a@local': true,
        'plugin-b@local': false,
      },
    });
    writeJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 1,
      plugins: {
        'plugin-a@local': [
          {
            scope: 'user',
            installPath: pluginPath,
            version: '1.0.0',
          },
        ],
      },
    });

    expect(loadClaudeAgentConfig().plugins).toEqual([{ type: 'local', path: pluginPath }]);
  });

  it('ignores invalid JSON instead of throwing', () => {
    const home = makeHome();
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    writeFileSync(path.join(home, '.claude', 'mcp.json'), '{not-json', 'utf-8');

    expect(loadClaudeAgentConfig()).toEqual({
      mcpServers: {},
      plugins: [],
    });
  });

  it('caches config until the cache is cleared', () => {
    const home = makeHome();
    const mcpFile = path.join(home, '.claude', 'mcp.json');
    writeJson(mcpFile, {
      mcpServers: {
        first: { command: 'node' },
      },
    });

    expect(Object.keys(loadClaudeAgentConfig().mcpServers)).toEqual(['first']);
    writeJson(mcpFile, {
      mcpServers: {
        second: { command: 'node' },
      },
    });
    expect(Object.keys(loadClaudeAgentConfig().mcpServers)).toEqual(['first']);

    clearClaudeAgentConfigCache();
    expect(Object.keys(loadClaudeAgentConfig().mcpServers)).toEqual(['second']);
  });
});
```

- [ ] **Step 2: Run the loader test and verify it fails**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/external-agents/claude/__tests__/config.test.ts
```

Expected: FAIL because `server/src/infra/providers/external-agents/claude/config.ts` does not exist.

- [ ] **Step 3: Implement the loader**

Create `server/src/infra/providers/external-agents/claude/config.ts`:

```ts
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { McpServerConfig, SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

interface McpConfigFile {
  mcpServers?: Record<string, Partial<McpServerConfig> & { command?: string }>;
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      installPath: string;
      version: string;
    }>
  >;
}

export interface ClaudeAgentConfig {
  mcpServers: Record<string, McpServerConfig>;
  plugins: SdkPluginConfig[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedConfig: ClaudeAgentConfig | null = null;
let cachedAt = 0;

export function clearClaudeAgentConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

function claudeHome(): string {
  return path.join(os.homedir(), '.claude');
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function loadMcpServers(): Record<string, McpServerConfig> {
  const parsed = readJson<McpConfigFile>(path.join(claudeHome(), 'mcp.json'));
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, server] of Object.entries(parsed?.mcpServers ?? {})) {
    if (!server.command || typeof server.command !== 'string') continue;
    servers[name] = {
      ...server,
      command: server.command,
    } as McpServerConfig;
  }

  return servers;
}

function loadPlugins(): SdkPluginConfig[] {
  const settings = readJson<SettingsFile>(path.join(claudeHome(), 'settings.json'));
  const installed = readJson<InstalledPluginsFile>(
    path.join(claudeHome(), 'plugins', 'installed_plugins.json')
  );
  const enabledPlugins = settings?.enabledPlugins ?? {};
  const registry = installed?.plugins ?? {};
  const plugins: SdkPluginConfig[] = [];

  for (const [pluginKey, enabled] of Object.entries(enabledPlugins)) {
    if (!enabled) continue;
    const install = registry[pluginKey]?.[0];
    if (!install?.installPath || !existsSync(install.installPath)) continue;
    plugins.push({ type: 'local', path: install.installPath });
  }

  return plugins;
}

export function loadClaudeAgentConfig(): ClaudeAgentConfig {
  if (cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  cachedConfig = {
    mcpServers: loadMcpServers(),
    plugins: loadPlugins(),
  };
  cachedAt = Date.now();
  return cachedConfig;
}
```

- [ ] **Step 4: Run the loader test and verify it passes**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/external-agents/claude/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the loader**

Run:

```bash
git add server/src/infra/providers/external-agents/claude/config.ts server/src/infra/providers/external-agents/claude/__tests__/config.test.ts
git commit -m "feat(runtime): load claude agent config"
```

---

### Task 2: Pass Config Through Claude Adapter And Runner

**Files:**
- Modify: `server/src/infra/providers/external-agents/claude/runner.ts`
- Modify: `server/src/infra/providers/external-agents/claude/adapter.ts`
- Modify: `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`

- [ ] **Step 1: Add failing adapter wiring test**

In `server/src/infra/providers/__tests__/claude-agent-adapter.test.ts`, update the SDK mock:

```ts
const { queryMock, loadClaudeAgentConfigMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  loadClaudeAgentConfigMock: vi.fn(() => ({ mcpServers: {}, plugins: [] })),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

vi.mock('../external-agents/claude/config.js', () => ({
  loadClaudeAgentConfig: loadClaudeAgentConfigMock,
}));
```

Add this test:

```ts
it('passes Claude config MCP servers and plugins to the SDK query options', async () => {
  const adapter = new ClaudeAgentAdapter();
  loadClaudeAgentConfigMock.mockReturnValueOnce({
    mcpServers: {
      docs: { command: 'node', args: ['docs-server.js'] },
    },
    plugins: [{ type: 'local', path: '/tmp/claude-plugin' }],
  });
  queryMock.mockReturnValueOnce(claudeStream([]));

  for await (const _event of adapter.run(
    'hello',
    { cwd: '/tmp/project', claudiaSessionId: 'session-1' } as any,
    vi.fn()
  )) {
    // drain
  }

  expect(queryMock).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        mcpServers: {
          docs: { command: 'node', args: ['docs-server.js'] },
        },
        plugins: [{ type: 'local', path: '/tmp/claude-plugin' }],
      }),
    })
  );
});
```

- [ ] **Step 2: Run the adapter test and verify it fails**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts
```

Expected: FAIL because `adapter.ts` does not load config and `runner.ts` does not pass `mcpServers` or `plugins`.

- [ ] **Step 3: Add config fields to the runner**

In `server/src/infra/providers/external-agents/claude/runner.ts`, extend imports:

```ts
import type {
  CanUseTool,
  McpServerConfig,
  Options,
  PermissionMode,
  SdkPluginConfig,
} from '@anthropic-ai/claude-agent-sdk';
```

Add fields to `ClaudeAgentRunOptions`:

```ts
mcpServers?: Record<string, McpServerConfig>;
plugins?: SdkPluginConfig[];
```

Add SDK option assignments after env assignment:

```ts
if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
  sdkOptions.mcpServers = options.mcpServers;
}
if (options.plugins && options.plugins.length > 0) {
  sdkOptions.plugins = options.plugins;
}
```

- [ ] **Step 4: Load config in the adapter**

In `server/src/infra/providers/external-agents/claude/adapter.ts`, add:

```ts
import { loadClaudeAgentConfig } from './config.js';
```

Inside `run`, before `yield* runClaudeAgent(...)`, add:

```ts
const claudeConfig = loadClaudeAgentConfig();
```

Pass through:

```ts
mcpServers: claudeConfig.mcpServers,
plugins: claudeConfig.plugins,
```

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/external-agents/claude/__tests__/config.test.ts
corepack pnpm --filter @zclaudia/server build
```

Expected: PASS.

- [ ] **Step 6: Commit adapter wiring**

Run:

```bash
git add server/src/infra/providers/external-agents/claude/runner.ts server/src/infra/providers/external-agents/claude/adapter.ts server/src/infra/providers/__tests__/claude-agent-adapter.test.ts
git commit -m "feat(runtime): pass claude config to agent sdk"
```

---

### Task 3: Smoke And Documentation Updates

**Files:**
- Modify: `server/scripts/smoke-claude-runtime.ts`
- Modify: `docs/plans/claude-runtime-smoke-check.md`
- Modify: `docs/plans/claude-runtime-completion.md`

- [ ] **Step 1: Add config visibility to smoke output**

In `server/scripts/smoke-claude-runtime.ts`, import:

```ts
import { loadClaudeAgentConfig } from '../src/infra/providers/external-agents/claude/config.js';
```

Inside `main`, after `const adapter = new ClaudeAgentAdapter();`, add:

```ts
const claudeConfig = loadClaudeAgentConfig();
console.log(
  `[smoke] claude config mcpServers=${Object.keys(claudeConfig.mcpServers).length} plugins=${claudeConfig.plugins.length}`
);
```

- [ ] **Step 2: Update smoke documentation**

In `docs/plans/claude-runtime-smoke-check.md`, add:

```md
The smoke script also prints how many Claude Code MCP servers and enabled local
plugins were loaded from `~/.claude`. This confirms the adapter sees the same
configuration that is passed to the Claude Agent SDK.
```

- [ ] **Step 3: Update the completion document**

In `docs/plans/claude-runtime-completion.md`, change Phase A's status by adding:

```md
Phase A status: implemented. Claude SDK receives user MCP servers and enabled
local plugins from Claude Code configuration.
```

under `### Phase A: Claude Config And SDK Loading`.

- [ ] **Step 4: Run non-live smoke and build**

Run:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime
corepack pnpm --filter @zclaudia/server build
git diff --check
```

Expected: PASS. Non-live smoke prints the skip message without calling the live SDK.

- [ ] **Step 5: Commit documentation and smoke updates**

Run:

```bash
git add server/scripts/smoke-claude-runtime.ts docs/plans/claude-runtime-smoke-check.md docs/plans/claude-runtime-completion.md
git commit -m "docs(runtime): document claude config loading"
```

---

## Final Verification

Run:

```bash
NODE_ENV=test corepack pnpm --filter @zclaudia/server test -- src/infra/providers/__tests__/claude-agent-adapter.test.ts src/infra/providers/external-agents/claude/__tests__/config.test.ts src/infra/providers/__tests__/registry.test.ts
corepack pnpm --filter @zclaudia/server test -- src/application/conversation/runtime/__tests__/run-handler.test.ts src/application/conversation/runtime/__tests__/run-provider-launch.test.ts src/application/conversation/runtime/__tests__/run-context.test.ts
corepack pnpm --filter @zclaudia/server smoke:claude-runtime
corepack pnpm --filter @zclaudia/server build
git diff --check
git status --short
git ls-files docs/superpowers | wc -l
```

Expected:

- All listed tests pass.
- Non-live smoke prints the skip message.
- Server build passes.
- `git diff --check` has no output.
- `git status --short` shows only unrelated pre-existing user changes or is clean.
- `git ls-files docs/superpowers | wc -l` prints `0`.

## Execution Notes

- Do not edit or revert the existing uncommitted session lifecycle files:
  - `server/src/domains/sessions/lifecycle-service.ts`
  - `server/src/domains/sessions/__tests__/session-lifecycle-service.test.ts`
- Do not add or commit files under `docs/superpowers`.
- Keep SDK-specific types inside `server/src/infra/providers/external-agents/claude`.
- Do not implement MCP bridge injection in this phase; that is Phase B.
