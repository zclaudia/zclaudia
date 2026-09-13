import type { ProviderRuntimeEvent, SystemInfo } from '@zclaudia/plugin-sdk/providers';
import type { ContextWindowSource, ToolEffect } from '@zclaudia/plugin-sdk/types';
import type {
  SessionUpdate,
  ToolCallUpdate,
  ToolKind,
  ContentBlock,
} from '@agentclientprotocol/sdk';
import {
  boundedJsonText,
  boundedToolInput,
  DEFAULT_DELTA_BYTES,
  DEFAULT_TOOL_RESULT_BYTES,
  makeModeTransition,
  truncateUtf8,
} from '@zclaudia/agent-common';
import type { CursorModelInfo } from './cursor-acp-extensions.js';
import { parseCursorContextWindow } from './acp-models.js';
import type { LocalToolDecision } from './acp-permissions.js';
import { makeShellEffect } from './tool-effects.js';

/**
 * Map standard ACP session updates to `ProviderRuntimeEvent`s
 * (design doc §9).
 *
 * Three probed facts shape this mapper:
 * - MCP tools open with a placeholder `tool_call` (`title: "MCP: tool"`, empty
 *   `rawInput`); the real identity arrives in a following `tool_call_update`
 *   (§9.1). `tool_started` is therefore deferred until the accumulator holds
 *   something meaningful (or the call finishes).
 * - A DENIED tool call still ends with `status: "completed"` from the agent
 *   (§9.2). Terminal status is overridden by the local permission decision.
 * - `session/load` replays history (`user_message_chunk` included) before its
 *   response; everything surfaced while the replay gate is closed rebuilds
 *   protocol state only and must not reach the conversation.
 */

export interface AcpEventMapperOptions {
  /** ZClaudia mode for this run; drives the plan/ask violation detector (§8.3). */
  zclaudiaMode: string | undefined;
  /** Local permission decisions keyed by toolCallId (§9.2 override). */
  decisionFor: (toolCallId: string) => LocalToolDecision | undefined;
  /** Called when a mutating tool starts executing in plan/ask — the runner cancels. */
  onMutatingToolViolation: (
    toolCallId: string,
    kind: ToolKind | undefined,
    title: string | undefined
  ) => void;
}

interface ToolAccumulator {
  toolCallId: string;
  toolName: string;
  kind: ToolKind | undefined;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  rawInput: unknown;
  rawOutput: unknown;
  contentText: string | undefined;
  locationsCount: number;
  startedEmitted: boolean;
  finishedEmitted: boolean;
  effect: ToolEffect | undefined;
}

export class AcpEventMapper {
  private readonly tools = new Map<string, ToolAccumulator>();
  private slashCommands: string[] = [];
  /** Set by the runner during session/load until the load response arrives. */
  replaying = false;
  /** Last mode the agent reported, to detect unsolicited switches (§9). */
  private lastAgentMode: string | undefined;

  constructor(private readonly options: AcpEventMapperOptions) {}

  /** Entries for the first `init` event's SystemInfo. */
  currentSlashCommands(): string[] | undefined {
    return this.slashCommands.length > 0 ? [...this.slashCommands] : undefined;
  }

  /**
   * Consume one ACP session update. Returns events for the conversation; an
   * empty result means the update was protocol-state only (or replay).
   */
  applyUpdate(update: SessionUpdate): ProviderRuntimeEvent[] {
    if (this.replaying) {
      // Replay: rebuild protocol state only, never new conversation content
      // (§7.3). Slash commands from replay are still useful for autocomplete.
      if (update.sessionUpdate === 'available_commands_update') {
        this.absorbAvailableCommands(update);
      }
      return [];
    }

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return this.textChunkEvents(update, 'assistant_delta');
      case 'agent_thought_chunk':
        return this.textChunkEvents(update, 'thinking_delta');
      case 'user_message_chunk':
        // Only observed during load replay; after the gate closes it would be
        // a protocol violation — drop rather than duplicate user content.
        return [];
      case 'tool_call':
        return this.applyToolCall(update);
      case 'tool_call_update':
        return this.applyToolCallUpdate(update);
      case 'plan':
      case 'plan_update':
        return this.applyPlanUpdate(update);
      case 'plan_removed':
        return [];
      case 'current_mode_update': {
        const requested =
          this.options.zclaudiaMode === 'plan'
            ? 'plan'
            : this.options.zclaudiaMode === 'ask'
              ? 'ask'
              : 'agent';
        this.lastAgentMode = update.currentModeId;
        if (update.currentModeId !== requested) {
          // Provider moved on its own; surface the transition so the UI and
          // session state follow reality (§9).
          return [
            {
              type: 'mode_transition',
              modeTransition: makeModeTransition(
                update.currentModeId === 'plan' ? 'enter' : 'exit'
              ),
            },
          ];
        }
        return [];
      }
      case 'available_commands_update':
        this.absorbAvailableCommands(update);
        return [];
      case 'session_info_update':
      case 'config_option_update':
        // No host contract for session titles / config options in v1 (§9).
        return [];
      case 'usage_update':
        // Usage is taken from the prompt response instead; mid-turn usage
        // events are not persisted separately in v1.
        return [];
      case 'compaction_update':
      case 'compaction_summary_chunk':
        // Compaction is provider-owned state, not a new assistant message (§9).
        return [];
      default:
        // Unrecognized standard update: debug-log and ignore. (A truly unknown
        // discriminator never reaches here — the SDK drops it with a log.)
        return [];
    }
  }

  private textChunkEvents(
    update: SessionUpdate,
    type: 'assistant_delta' | 'thinking_delta'
  ): ProviderRuntimeEvent[] {
    const content = (update as { content?: ContentBlock }).content;
    if (!content || content.type !== 'text' || !content.text) return [];
    const text = truncateUtf8(content.text, DEFAULT_DELTA_BYTES);
    return [type === 'assistant_delta' ? { type, content: text } : { type, thinkingContent: text }];
  }

  private applyToolCall(
    update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>
  ): ProviderRuntimeEvent[] {
    const existing = this.tools.get(update.toolCallId);
    const accumulator: ToolAccumulator = existing ?? {
      toolCallId: update.toolCallId,
      toolName: placeholderAwareName(update),
      kind: update.kind,
      status: 'pending',
      rawInput: update.rawInput,
      rawOutput: undefined,
      contentText: undefined,
      locationsCount: 0,
      startedEmitted: false,
      finishedEmitted: false,
      effect: shellEffectFor(update),
    };
    // Merge the initial call into any out-of-order accumulator (§9).
    if (update.kind) accumulator.kind = update.kind;
    if (update.rawInput !== undefined) accumulator.rawInput = update.rawInput;
    if (
      update.title &&
      !isPlaceholderTitle(update.title) &&
      isPlaceholderTitle(accumulator.toolName)
    )
      accumulator.toolName = update.title;
    if (update.content)
      accumulator.contentText = mergeContentText(accumulator.contentText, update.content);
    if (update.locations) accumulator.locationsCount = update.locations.length;
    if (update.status) accumulator.status = update.status;
    if (!accumulator.effect) accumulator.effect = shellEffectFor(update);
    this.tools.set(update.toolCallId, accumulator);
    return this.emitFromAccumulator(accumulator);
  }

  private applyToolCallUpdate(update: ToolCallUpdate): ProviderRuntimeEvent[] {
    const existing = this.tools.get(update.toolCallId);
    const accumulator: ToolAccumulator = existing ?? {
      // Out-of-order update before tool_call: create a placeholder accumulator
      // instead of dropping (§9).
      toolCallId: update.toolCallId,
      toolName: update.name || update.title || 'tool',
      kind: update.kind ?? undefined,
      status: 'pending',
      rawInput: update.rawInput,
      rawOutput: undefined,
      contentText: undefined,
      locationsCount: 0,
      startedEmitted: false,
      finishedEmitted: false,
      effect: undefined,
    };
    if (update.kind) accumulator.kind = update.kind;
    if (update.name) accumulator.toolName = update.name;
    else if (update.title && isPlaceholderTitle(accumulator.toolName))
      accumulator.toolName = update.title;
    if (update.rawInput !== undefined) accumulator.rawInput = update.rawInput;
    if (update.rawOutput !== undefined) accumulator.rawOutput = update.rawOutput;
    if (update.content)
      accumulator.contentText = mergeContentText(accumulator.contentText, update.content);
    if (update.locations) accumulator.locationsCount = update.locations.length;
    if (update.status) accumulator.status = update.status;
    if (!accumulator.effect) accumulator.effect = shellEffectFor(update);
    this.tools.set(update.toolCallId, accumulator);

    // Plan/ask second line of defense (§8.3): mutating kinds that start
    // executing without a local allow decision are a protocol violation —
    // cancel the run. `other` is NOT checked by kind: it covers MCP tools and
    // cursor/create_plan, which follow the regular permission flow.
    const decision = this.options.decisionFor(update.toolCallId);
    const mutating: ToolKind[] = ['edit', 'delete', 'move', 'execute'];
    if (
      this.isPlanOrAskMode() &&
      accumulator.kind &&
      mutating.includes(accumulator.kind) &&
      (accumulator.status === 'in_progress' || accumulator.status === 'completed') &&
      decision !== 'allowed'
    ) {
      // The run is being cancelled, so the agent's own terminal update may
      // never flush. Close the call out HERE from the local decision (§9.2):
      // the cancelled override renders it as an error deterministically.
      this.options.onMutatingToolViolation(
        update.toolCallId,
        accumulator.kind,
        accumulator.toolName
      );
      accumulator.status = 'failed';
      accumulator.finishedEmitted = false;
    }

    return this.emitFromAccumulator(accumulator);
  }

  private isPlanOrAskMode(): boolean {
    return this.options.zclaudiaMode === 'plan' || this.options.zclaudiaMode === 'ask';
  }

  private applyPlanUpdate(
    update: Extract<SessionUpdate, { sessionUpdate: 'plan' | 'plan_update' }>
  ): ProviderRuntimeEvent[] {
    // Standard ACP plan entries — display as progress, not an editable form (§9).
    let entries: Array<{ content: string; status: string }>;
    if (update.sessionUpdate === 'plan') {
      entries = (Array.isArray(update.entries) ? update.entries : []).map(entry => ({
        content: entry.content,
        status: entry.status,
      }));
    } else {
      const plan = update.plan;
      if (plan.type === 'items') {
        entries = (Array.isArray(plan.entries) ? plan.entries : []).map(entry => ({
          content: entry.content,
          status: entry.status,
        }));
      } else if (plan.type === 'markdown') {
        entries = [{ content: plan.content, status: 'in_progress' }];
      } else {
        entries = [{ content: plan.uri, status: 'in_progress' }];
      }
    }
    const text = entries
      .slice(0, 20)
      .map(entry => {
        const mark =
          entry.status === 'completed' ? '[x]' : entry.status === 'in_progress' ? '[~]' : '[ ]';
        return `${mark} ${entry.content}`.trim();
      })
      .join('\n');
    if (!text) return [];
    return [
      {
        type: 'tool_activity',
        toolUseId: 'acp-plan',
        toolName: 'Plan',
        content: boundedJsonText(text, DEFAULT_TOOL_RESULT_BYTES),
      },
    ];
  }

  private absorbAvailableCommands(
    update: Extract<SessionUpdate, { sessionUpdate: 'available_commands_update' }>
  ): void {
    const commands = Array.isArray(update.availableCommands) ? update.availableCommands : [];
    const names = commands
      .map(command => (typeof command.name === 'string' ? command.name : ''))
      .filter(Boolean);
    const merged = new Set(this.slashCommands);
    for (const name of names) merged.add(name);
    this.slashCommands = [...merged];
  }

  /** Emit started/activity/finished events from the accumulator state. */
  private emitFromAccumulator(accumulator: ToolAccumulator): ProviderRuntimeEvent[] {
    const events: ProviderRuntimeEvent[] = [];
    const decision = this.options.decisionFor(accumulator.toolCallId);
    const terminal = accumulator.status === 'completed' || accumulator.status === 'failed';

    if (!accumulator.startedEmitted && shouldEmitStarted(accumulator)) {
      accumulator.startedEmitted = true;
      events.push({
        type: 'tool_started',
        toolUseId: accumulator.toolCallId,
        toolName: accumulator.toolName,
        toolInput: boundedToolInput(accumulator.rawInput),
        ...(accumulator.effect ? { toolEffect: accumulator.effect } : {}),
      });
    }

    if (!terminal) {
      if (accumulator.startedEmitted && !accumulator.finishedEmitted) {
        events.push({
          type: 'tool_activity',
          toolUseId: accumulator.toolCallId,
          toolName: accumulator.toolName,
          ...(accumulator.contentText
            ? { content: boundedJsonText(accumulator.contentText, DEFAULT_TOOL_RESULT_BYTES) }
            : {}),
        });
      }
      return events;
    }

    if (accumulator.finishedEmitted) return events; // Idempotent on duplicate terminals (§9).
    accumulator.finishedEmitted = true;

    // §9.2 hard rule: terminal status follows the LOCAL permission decision.
    // The agent reports "completed" even for denied calls.
    if (decision === 'denied' || decision === 'cancelled') {
      if (!accumulator.startedEmitted) {
        accumulator.startedEmitted = true;
        events.push({
          type: 'tool_started',
          toolUseId: accumulator.toolCallId,
          toolName: accumulator.toolName,
          toolInput: boundedToolInput(accumulator.rawInput),
          ...(accumulator.effect ? { toolEffect: accumulator.effect } : {}),
        });
      }
      events.push({
        type: 'tool_finished',
        toolUseId: accumulator.toolCallId,
        toolName: accumulator.toolName,
        toolResult: boundedJsonText(
          decision === 'denied'
            ? `Denied by user${accumulator.contentText ? `: ${accumulator.contentText}` : '.'}`
            : 'Cancelled.',
          DEFAULT_TOOL_RESULT_BYTES
        ),
        isToolError: true,
        ...(accumulator.effect ? { toolEffect: accumulator.effect } : {}),
      });
      return events;
    }

    if (!accumulator.startedEmitted) {
      accumulator.startedEmitted = true;
      events.push({
        type: 'tool_started',
        toolUseId: accumulator.toolCallId,
        toolName: accumulator.toolName,
        toolInput: boundedToolInput(accumulator.rawInput),
        ...(accumulator.effect ? { toolEffect: accumulator.effect } : {}),
      });
    }
    events.push({
      type: 'tool_finished',
      toolUseId: accumulator.toolCallId,
      toolName: accumulator.toolName,
      toolResult: boundedJsonText(
        accumulator.status === 'failed'
          ? `Tool failed${accumulator.contentText ? `: ${accumulator.contentText}` : ''}`
          : accumulator.contentText || accumulator.rawOutput || 'Done',
        DEFAULT_TOOL_RESULT_BYTES
      ),
      isToolError: accumulator.status === 'failed',
      ...(accumulator.effect ? { toolEffect: accumulator.effect } : {}),
    });
    return events;
  }

  /**
   * Build the `init` event's SystemInfo payload from the session response.
   */
  buildSystemInfo(input: {
    models?: { currentModelId: string; availableModels: CursorModelInfo[] } | undefined;
    effectiveModelId: string | undefined;
    displayName: string | undefined;
    cwd: string;
    permissionMode: string | undefined;
  }): SystemInfo {
    // The parameterized modelId encodes the window (`context=300k`); surfacing
    // it lets the composer ring show a percentage even though the per-turn
    // counters stay turn-aggregates (see map-events.ts result mapping).
    const contextWindow = parseCursorContextWindow(input.effectiveModelId);
    return {
      model: input.displayName,
      ...(input.effectiveModelId ? { modelId: input.effectiveModelId } : {}),
      ...(contextWindow
        ? // plugin-sdk 0.3.0's ContextWindowSource lags the wire vocabulary,
          // which has `'runtime'`; drop the cast when the SDK catches up.
          { contextWindow, contextWindowSource: 'runtime' as unknown as ContextWindowSource }
        : {}),
      cwd: input.cwd,
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(this.slashCommands.length > 0 ? { slashCommands: [...this.slashCommands] } : {}),
    };
  }
}

/** Placeholder name from the probed MCP first tool_call (§9.1). */
function placeholderAwareName(
  update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>
): string {
  if (update.title && !isPlaceholderTitle(update.title)) return update.title;
  if (typeof (update as { name?: unknown }).name === 'string')
    return (update as { name: string }).name;
  return update.kind || 'tool';
}

function isPlaceholderTitle(title: string): boolean {
  return !title || /^MCP:/i.test(title) || title === 'tool' || title === 'other';
}

function shouldEmitStarted(accumulator: ToolAccumulator): boolean {
  // Defer while the call is only the probed MCP placeholder (§9.1): emit once
  // real input, a meaningful title, or execution progress exists.
  if (
    accumulator.status === 'in_progress' ||
    accumulator.status === 'completed' ||
    accumulator.status === 'failed'
  ) {
    return true;
  }
  return hasMeaningfulInput(accumulator.rawInput) || !isPlaceholderTitle(accumulator.toolName);
}

/** An empty object (the probed placeholder rawInput) is not meaningful input. */
function hasMeaningfulInput(rawInput: unknown): boolean {
  if (rawInput === undefined || rawInput === null) return false;
  if (
    typeof rawInput === 'object' &&
    !Array.isArray(rawInput) &&
    Object.keys(rawInput).length === 0
  ) {
    return false;
  }
  return true;
}

function mergeContentText(current: string | undefined, blocks: unknown): string | undefined {
  const parts: string[] = [];
  if (current) parts.push(current);
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const inner = (block as { content?: { type?: unknown; text?: unknown } }).content;
      const direct = block as {
        type?: unknown;
        text?: unknown;
        path?: unknown;
        oldText?: unknown;
        newText?: unknown;
      };
      if (inner && inner.type === 'text' && typeof inner.text === 'string') parts.push(inner.text);
      else if (direct.type === 'text' && typeof direct.text === 'string') parts.push(direct.text);
      else if (direct.type === 'diff' && typeof direct.path === 'string') {
        parts.push(`diff: ${direct.path}`);
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function shellEffectFor(update: {
  kind?: ToolKind | null;
  rawInput?: unknown;
}): ToolEffect | undefined {
  if (update.kind !== 'execute') return undefined;
  const input = update.rawInput;
  const command =
    input &&
    typeof input === 'object' &&
    typeof (input as { command?: unknown }).command === 'string'
      ? (input as { command: string }).command
      : undefined;
  return makeShellEffect(command);
}
