import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  RuntimeUsageSnapshot,
  UsageTokenBreakdown,
} from '@zclaudia/shared/core/runtime-usage';
import { emptyUsageBreakdown } from '@zclaudia/shared/core/runtime-usage';

/** Account the invocation's assistant calls; context occupancy is separate. */
export function buildPiInvocationSnapshot(
  messages: AgentMessage[],
  options: { errored: boolean; revision?: number }
): RuntimeUsageSnapshot {
  const calls: Array<{ modelId: string | null; tokens: UsageTokenBreakdown }> = [];
  const seen = new Set<AgentMessage>();
  const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

  for (const message of messages) {
    if (message.role !== 'assistant' || seen.has(message)) continue;
    seen.add(message);
    const msg: {
      model?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        totalTokens?: number;
      };
    } = message;
    const u = msg.usage ?? {};
    const tokens: UsageTokenBreakdown = {
      inputUncached: count(u.input),
      cacheRead: count(u.cacheRead),
      cacheWrite: count(u.cacheWrite),
      output: count(u.output),
      reasoningOutput: null,
      total: count(u.totalTokens),
    };
    const parts = [tokens.inputUncached, tokens.cacheRead, tokens.cacheWrite, tokens.output];
    if (tokens.total === null && parts.every(v => v !== null)) {
      tokens.total = parts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    }
    calls.push({ modelId: msg.model || null, tokens });
  }

  const sum = (group: typeof calls): UsageTokenBreakdown => {
    if (group.length === 0) return emptyUsageBreakdown();
    const result = emptyUsageBreakdown();
    for (const key of Object.keys(result) as Array<keyof UsageTokenBreakdown>) {
      const values = group.map(c => c.tokens[key]);
      const known = values.filter((v): v is number => v !== null);
      // Total may be a partial lower bound; unknown classification stays unknown.
      result[key] =
        known.length > 0 && (key === 'total' || known.length === values.length)
          ? known.reduce((a, b) => a + b, 0)
          : null;
    }
    return result;
  };
  const tokens = sum(calls);
  const hasData = Object.values(tokens).some(v => v !== null);
  // Error streams initialize empty zero counters even when no request succeeded.
  const missing =
    !hasData || (options.errored && Object.values(tokens).every(v => v === null || v === 0));
  const incomplete = options.errored || calls.some(c => c.tokens.total === null);
  const byModel = new Map<string | null, typeof calls>();
  for (const call of calls) {
    const group = byModel.get(call.modelId) ?? [];
    group.push(call);
    byModel.set(call.modelId, group);
  }
  return {
    schemaVersion: 1,
    revision: options.revision ?? 1,
    final: true,
    status: missing ? 'missing' : incomplete ? 'partial' : 'complete',
    reason: missing ? 'no_usage_reported' : incomplete ? 'incomplete_call_usage' : undefined,
    tokens: missing ? emptyUsageBreakdown() : tokens,
    models: missing
      ? []
      : [...byModel.entries()].map(([modelId, group]) => ({ modelId, tokens: sum(group) })),
    source: {
      kind: 'pi_agent_end',
      scope: 'invocation',
      // Host-dispatched subagents own separate invocation records.
      includesSubagents: 'no',
      ruleVersion: 1,
    },
  };
}
