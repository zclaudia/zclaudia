import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  McpServerConfig,
  Options,
  PermissionMode,
  SdkPluginConfig,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  EngineExecutionContext,
  ProviderRuntimeEvent,
  RuntimeModelConnection,
  SystemInfo,
} from '@zclaudia/plugin-sdk/providers';
import { RuntimeContractError } from '@zclaudia/plugin-sdk/providers';
import {
  boundedToolInput,
  boundedValue,
  canonicalPlanToolName,
  DEFAULT_DELTA_BYTES,
  DEFAULT_TOOL_RESULT_BYTES,
  modeTransitionForPlanTool,
  planToolSemantic,
  truncateUtf8,
} from '@zclaudia/agent-common';
import { inspectClaudeCli, resolveClaudeCliFromPath } from './resolve-cli.js';
import { buildClaudeSdkEnvironment } from './sdk-environment.js';
import { toClaudeModelConnectionEnv } from './model-connection.js';

export interface ClaudeAgentRunOptions {
  cwd: string;
  sessionId?: string;
  env?: Record<string, string>;
  cliPath?: string;
  permissionMode?: PermissionMode;
  model?: string;
  thinking?: Options['thinking'];
  effort?: Options['effort'];
  systemPrompt?: string;
  abortController?: AbortController;
  canUseTool?: CanUseTool;
  mcpServers?: Record<string, McpServerConfig>;
  plugins?: SdkPluginConfig[];
  onSessionId?: (sessionId: string) => void;
  /** Dual-mode contract: engine-mode execution identity from the host. */
  engineExecution?: EngineExecutionContext;
  /** Dual-mode contract: explicit model connection (SDK mode requires it). */
  modelConnection?: RuntimeModelConnection;
}

/**
 * Transcript retention inside the session-scoped CLAUDE_CONFIG_DIR. The engine
 * sweeps local transcripts after this many days (default 30), so the host
 * pins a long retention window explicitly; archive/backup behaviour is the
 * host's responsibility beyond what the engine guarantees.
 */
const SDK_CLEANUP_PERIOD_DAYS = 36_500;
const SDK_ALTERNATE_AUTH_ENV = {
  ANTHROPIC_AUTH_TOKEN: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  CLAUDE_CODE_USE_BEDROCK: '0',
  CLAUDE_CODE_USE_VERTEX: '0',
  CLAUDE_CODE_USE_FOUNDRY: '0',
};

export async function* runClaudeAgent(
  input: string,
  options: ClaudeAgentRunOptions
): AsyncGenerator<ProviderRuntimeEvent, void, void> {
  if (options.engineExecution?.engineMode === 'sdk') {
    yield* runClaudeSdkAgent(input, options);
    return;
  }

  const abortController = options.abortController ?? new AbortController();
  const sdkOptions: Partial<Options> = {
    cwd: options.cwd,
    abortController,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
  };

  if (options.sessionId) sdkOptions.resume = options.sessionId;
  if (options.permissionMode) sdkOptions.permissionMode = options.permissionMode;
  if (options.model) sdkOptions.model = options.model;
  if (options.thinking) sdkOptions.thinking = options.thinking;
  if (options.effort) sdkOptions.effort = options.effort;
  if (options.systemPrompt) {
    sdkOptions.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: options.systemPrompt,
    };
  }
  const effectiveEnv = options.env ? { ...process.env, ...options.env } : process.env;
  const cliPath = options.cliPath ?? resolveClaudeCliFromPath(effectiveEnv.PATH);
  if (!cliPath) {
    throw new Error(
      'Claude Code CLI is required. Install Claude Code and ensure `claude` is on PATH, or configure its executable path.'
    );
  }
  const compatibility = inspectClaudeCli(cliPath, { env: effectiveEnv });
  if (compatibility.status === 'blocked') throw new Error(compatibility.message);
  if (compatibility.status === 'warning') console.warn(compatibility.message);
  sdkOptions.pathToClaudeCodeExecutable = cliPath;
  if (options.env) sdkOptions.env = effectiveEnv;
  if (options.canUseTool) sdkOptions.canUseTool = options.canUseTool;
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    sdkOptions.mcpServers = options.mcpServers;
  }
  if (options.plugins && options.plugins.length > 0) {
    sdkOptions.plugins = options.plugins;
  }

  const stream = query({ prompt: input, options: sdkOptions });
  yield* pumpClaudeStream(stream, options);
}

/**
 * SDK engine mode: connection, executable and configuration all come from the
 * host contract. The user's environment, login state and settings files are
 * NOT inherited — a run either executes against the explicitly bound
 * connection or fails before any request leaves the process.
 */
async function* runClaudeSdkAgent(
  input: string,
  options: ClaudeAgentRunOptions
): AsyncGenerator<ProviderRuntimeEvent, void, void> {
  const engine = options.engineExecution!;
  const connection = options.modelConnection;
  if (!connection) {
    throw new RuntimeContractError(
      'SDK_ENGINE_UNAVAILABLE',
      'SDK mode requires the host model-connection contract; this host is too old to run it. Upgrade ZClaudia or switch the agent to CLI mode.'
    );
  }
  // Protocol admission is re-verified here: an adapter must not accept a
  // connection combination its runtime did not declare.
  toClaudeModelConnectionEnv(connection);
  if (!engine.configDirectory) {
    throw new RuntimeContractError(
      'SDK_ENGINE_UNAVAILABLE',
      'SDK mode requires a host-managed config directory for this session'
    );
  }
  const cliPath = options.cliPath?.trim();
  if (!cliPath) {
    throw new RuntimeContractError(
      'SDK_ENGINE_UNAVAILABLE',
      'SDK mode requires the app-bundled engine path from the host; PATH lookup is intentionally not performed'
    );
  }

  const env = buildClaudeSdkEnvironment({
    connection,
    configDirectory: engine.configDirectory,
    model: options.model,
    baseEnv: options.env,
  });

  const abortController = options.abortController ?? new AbortController();
  const sdkOptions: Partial<Options> = {
    cwd: options.cwd,
    abortController,
    // Let the engine discover project instructions natively. Global user
    // settings stay isolated; the host still owns the SDK connection.
    settingSources: ['project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // Keep transcripts on disk so provider sessions can be resumed later.
    persistSession: true,
    settings: {
      cleanupPeriodDays: SDK_CLEANUP_PERIOD_DAYS,
      // Project settings may introduce alternate auth/cloud-provider switches.
      // Mask those at the flag-settings layer while the bound API connection
      // stays in the process environment (never serialized into CLI args).
      env: SDK_ALTERNATE_AUTH_ENV,
      apiKeyHelper: '',
    },
    pathToClaudeCodeExecutable: cliPath,
    env,
  };
  if (options.sessionId) sdkOptions.resume = options.sessionId;
  if (options.permissionMode) sdkOptions.permissionMode = options.permissionMode;
  if (options.model) sdkOptions.model = options.model;
  if (options.thinking) sdkOptions.thinking = options.thinking;
  if (options.effort) sdkOptions.effort = options.effort;
  if (options.systemPrompt) {
    sdkOptions.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: options.systemPrompt,
    };
  }
  if (options.canUseTool) sdkOptions.canUseTool = options.canUseTool;
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    sdkOptions.mcpServers = options.mcpServers;
  }
  if (options.plugins && options.plugins.length > 0) {
    sdkOptions.plugins = options.plugins;
  }

  // Do not put credentials in --settings argv or a settings file. Gate the
  // first user message until the native control channel has locked the SDK
  // connection above project settings. This also applies when resuming.
  let releaseInput!: () => void;
  let inputAllowed = false;
  const ready = new Promise<void>(resolve => {
    releaseInput = resolve;
  });
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    await ready;
    if (!inputAllowed || abortController.signal.aborted) return;
    yield {
      type: 'user',
      message: { role: 'user', content: input },
      parent_tool_use_id: null,
      session_id: options.sessionId ?? '',
    };
  }
  const stream = query({ prompt: prompt(), options: sdkOptions });
  try {
    await stream.applyFlagSettings({
      env: {
        ...env,
        ...SDK_ALTERNATE_AUTH_ENV,
        ANTHROPIC_CUSTOM_HEADERS: env.ANTHROPIC_CUSTOM_HEADERS ?? '',
      },
      apiKeyHelper: '',
    });
    inputAllowed = true;
    releaseInput();
    yield* pumpClaudeStream(stream, options);
  } finally {
    inputAllowed = false;
    releaseInput();
    stream.close();
  }
}

/**
 * Context occupancy of one API call, read off a top-level SDK `assistant`
 * message. On a single call the prompt is `input_tokens` (uncached) +
 * `cache_read_input_tokens` (cached prefix) + `cache_creation_input_tokens`
 * (newly cached suffix) — all three occupy the window. Sub-agent calls
 * (`parent_tool_use_id` set) run in their own windows and are skipped.
 */
export function extractClaudeCallContextTokens(message: unknown): number | undefined {
  const msg = message as {
    type?: unknown;
    parent_tool_use_id?: unknown;
    message?: {
      usage?: {
        input_tokens?: unknown;
        cache_read_input_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
      };
    };
  };
  if (msg?.type !== 'assistant' || msg.parent_tool_use_id != null) return undefined;
  const usage = msg.message?.usage;
  if (!usage) return undefined;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const total =
    num(usage.input_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.cache_creation_input_tokens);
  return total > 0 ? total : undefined;
}

/**
 * Context window from an SDK `result` message's per-model usage record. A turn
 * can touch several models (main loop + haiku helpers); the main model is the
 * one whose calls carried the most context, so take the window of the entry
 * with the largest input-side token sum.
 */
export function extractClaudeContextWindow(message: unknown): number | undefined {
  const msg = message as { type?: unknown; modelUsage?: Record<string, unknown> };
  if (msg?.type !== 'result' || !msg.modelUsage || typeof msg.modelUsage !== 'object') {
    return undefined;
  }
  let bestWindow: number | undefined;
  let bestOccupancy = -1;
  for (const entry of Object.values(msg.modelUsage)) {
    const m = entry as {
      inputTokens?: unknown;
      cacheReadInputTokens?: unknown;
      cacheCreationInputTokens?: unknown;
      contextWindow?: unknown;
    };
    if (typeof m?.contextWindow !== 'number' || m.contextWindow <= 0) continue;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const occupancy =
      num(m.inputTokens) + num(m.cacheReadInputTokens) + num(m.cacheCreationInputTokens);
    if (occupancy > bestOccupancy) {
      bestOccupancy = occupancy;
      bestWindow = m.contextWindow;
    }
  }
  return bestWindow;
}

/** Shared SDK message pump: maps events, reports the provider session id, emits plan transitions. Exported for tests. */
export async function* pumpClaudeStream(
  stream: AsyncIterable<unknown> & { close(): void },
  options: ClaudeAgentRunOptions
): AsyncGenerator<ProviderRuntimeEvent, void, void> {
  const planModeTools = new Map<string, 'EnterPlanMode' | 'ExitPlanMode'>();
  let initSystemInfo: SystemInfo | undefined;
  let lastCallContextTokens: number | undefined;
  try {
    for await (const message of stream) {
      lastCallContextTokens = extractClaudeCallContextTokens(message) ?? lastCallContextTokens;
      const transformed = transformClaudeSdkMessage(message);
      const events = Array.isArray(transformed) ? transformed : [transformed];
      for (const event of events) {
        if (event.type === 'init' && event.sessionId) {
          options.onSessionId?.(event.sessionId);
        }
        if (event.type === 'init' && event.systemInfo) {
          initSystemInfo = event.systemInfo;
        }
        if (event.type === 'result') {
          if (event.usage && lastCallContextTokens != null) {
            // `contextUsedTokens` isn't on the plugin-sdk `ProviderUsage` yet,
            // but the host carries it: the server forwards `usage` verbatim as
            // wire `UsageInfo`, which does have the field. Drop the widening
            // once the SDK catches up.
            const withContext: NonNullable<ProviderRuntimeEvent['usage']> & {
              contextUsedTokens?: number;
            } = { ...event.usage, contextUsedTokens: lastCallContextTokens };
            event.usage = withContext;
          }
          // The SDK only reveals the model's real context window at result
          // time (modelUsage). Re-announce systemInfo so the composer's ring
          // gets a denominator; the server treats a sessionId-less init as a
          // pure systemInfo update. Gated on the original init having arrived
          // so the merged info keeps its cwd (the server re-persists it).
          const contextWindow = extractClaudeContextWindow(message);
          if (contextWindow && initSystemInfo && contextWindow !== initSystemInfo.contextWindow) {
            initSystemInfo = {
              ...initSystemInfo,
              contextWindow,
              contextWindowSource: 'runtime',
            };
            yield { type: 'init', systemInfo: initSystemInfo };
          }
        }
        if ((event.type === 'tool_use' || event.type === 'tool_started') && event.toolUseId) {
          const planTool = canonicalClaudePlanTool(event.toolName);
          if (planTool) planModeTools.set(event.toolUseId, planTool);
        }
        yield event;
        if ((event.type === 'tool_result' || event.type === 'tool_finished') && event.toolUseId) {
          const toolName = planModeTools.get(event.toolUseId);
          planModeTools.delete(event.toolUseId);
          if (toolName && !event.isToolError) {
            const transition = modeTransitionForPlanTool(
              toolName,
              event.toolResult,
              event.toolUseId
            );
            if (transition) yield { type: 'mode_transition', modeTransition: transition };
          }
        }
      }
    }
  } finally {
    stream.close();
  }
}

function canonicalClaudePlanTool(toolName: unknown): 'EnterPlanMode' | 'ExitPlanMode' | undefined {
  return canonicalPlanToolName(toolName);
}

export function transformClaudeSdkMessage(
  message: unknown
): ProviderRuntimeEvent | ProviderRuntimeEvent[] {
  const msg = message as Record<string, unknown>;

  if (msg.type === 'system' && msg.subtype === 'init') {
    const systemInfo: SystemInfo = {
      model: msg.model as string | undefined,
      claudeCodeVersion: msg.claude_code_version as string | undefined,
      cwd: msg.cwd as string | undefined,
      tools: msg.tools as string[] | undefined,
      permissionMode: msg.permissionMode as string | undefined,
      slashCommands: msg.slash_commands as string[] | undefined,
      agents: msg.agents as string[] | undefined,
    };
    return {
      type: 'init',
      sessionId: msg.session_id as string | undefined,
      systemInfo,
    };
  }

  if (msg.type === 'system') {
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : 'system';
    const taskId =
      (msg.task_id as string | undefined) ??
      (msg.taskId as string | undefined) ??
      (msg.id as string | undefined);
    if (subtype.startsWith('task_')) {
      const patch = msg.patch as Record<string, unknown> | undefined;
      return {
        type: 'task_notification',
        taskId,
        taskStatus:
          (patch?.status as string | undefined) ??
          (subtype === 'task_started' ? 'started' : subtype.replace(/^task_/, '')),
        taskMessage:
          (msg.description as string | undefined) ??
          (patch?.description as string | undefined) ??
          (patch?.error as string | undefined) ??
          (msg.message as string | undefined) ??
          (msg.title as string | undefined),
      };
    }
    return [];
  }

  if (msg.type === 'tool_progress') {
    return {
      type: 'tool_activity',
      toolUseId: msg.tool_use_id as string | undefined,
      toolName: msg.tool_name as string | undefined,
      taskId: msg.task_id as string | undefined,
      content:
        typeof msg.elapsed_time_seconds === 'number'
          ? `running ${msg.tool_name ?? 'tool'} (${msg.elapsed_time_seconds}s)`
          : undefined,
    };
  }

  if (msg.type === 'tool_use_summary') {
    return {
      type: 'tool_activity',
      content: msg.summary as string | undefined,
    };
  }

  if (msg.type === 'assistant') {
    const blocks = (msg.message as { content?: Array<Record<string, unknown>> } | undefined)
      ?.content;
    if (!Array.isArray(blocks)) return [];

    const events: ProviderRuntimeEvent[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({
          type: 'assistant',
          content: truncateUtf8(block.text, DEFAULT_DELTA_BYTES),
        });
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool_use',
          toolUseId: block.id as string | undefined,
          toolName: block.name as string | undefined,
          toolInput: boundedToolInput(block.input),
          toolSemantic: planToolSemantic(block.name),
        });
      }
    }
    return events.length === 1 ? events[0] : events;
  }

  if (msg.type === 'user') {
    const blocks = (msg.message as { content?: Array<Record<string, unknown>> } | undefined)
      ?.content;
    if (!Array.isArray(blocks)) return [];

    const events = blocks
      .filter(block => block.type === 'tool_result')
      .map<ProviderRuntimeEvent>(block => ({
        type: 'tool_result',
        toolUseId: block.tool_use_id as string | undefined,
        toolResult: boundedValue(block.content, DEFAULT_TOOL_RESULT_BYTES),
        isToolError: block.is_error as boolean | undefined,
      }));
    return events.length === 1 ? events[0] : events;
  }

  if (msg.type === 'result') {
    if (msg.subtype === 'error_during_execution') {
      return {
        type: 'error',
        error:
          (msg.error as string | undefined) ??
          (msg.result as string | undefined) ??
          'Claude execution failed',
      };
    }
    // SDK result usage is per-turn (snake_case wire shape); `input_tokens`
    // excludes cache reads, which arrive separately in `cache_read_input_tokens`.
    const rawUsage = msg.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;
    const input = rawUsage?.input_tokens ?? 0;
    const output = rawUsage?.output_tokens ?? 0;
    const cacheRead = rawUsage?.cache_read_input_tokens ?? 0;
    const cacheWrite = rawUsage?.cache_creation_input_tokens ?? 0;
    const totalCost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0;
    return {
      type: 'result',
      content:
        typeof msg.result === 'string'
          ? truncateUtf8(msg.result, DEFAULT_TOOL_RESULT_BYTES)
          : undefined,
      isComplete: true,
      usage: rawUsage
        ? {
            input,
            output,
            cacheRead,
            cacheWrite,
            totalTokens: input + output + cacheRead + cacheWrite,
            // The SDK reports only the aggregate turn cost, not a per-bucket split.
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCost },
          }
        : undefined,
    };
  }

  return [];
}
