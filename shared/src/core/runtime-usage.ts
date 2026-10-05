// Runtime token usage accounting contract (design: docs/specs/2026-09-16-runtime-token-usage-design.md).
//
// The contract types are canonical in @zclaudia/plugin-sdk/usage so runtime
// plugins and the host share one declaration; this module re-exports them and
// adds host-side helpers (validation, normalization).
import {
  RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION,
  type RuntimeUsageSnapshot,
  type UsageModelAllocation,
  type UsageSourceCheckpoint,
  type UsageTokenBreakdown,
} from '@zclaudia/plugin-sdk/usage';

export {
  RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION,
  USAGE_TRACKING_CAPABILITY_ID,
} from '@zclaudia/plugin-sdk/usage';
export type {
  CodexTokenUsageCounters,
  ProviderUsageUpdatedEvent,
  RuntimeUsageDataStatus,
  RuntimeUsageSnapshot,
  RuntimeUsageSnapshotSource,
  UsageModelAllocation,
  UsageSourceCheckpoint,
  UsageTokenBreakdown,
} from '@zclaudia/plugin-sdk/usage';

export function emptyUsageBreakdown(): UsageTokenBreakdown {
  return {
    inputUncached: null,
    cacheRead: null,
    cacheWrite: null,
    output: null,
    reasoningOutput: null,
    total: null,
  };
}

export function usageBreakdownFromValues(values: {
  inputUncached?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  output?: number | null;
  reasoningOutput?: number | null;
  total?: number | null;
}): UsageTokenBreakdown {
  return {
    inputUncached: values.inputUncached ?? null,
    cacheRead: values.cacheRead ?? null,
    cacheWrite: values.cacheWrite ?? null,
    output: values.output ?? null,
    reasoningOutput: values.reasoningOutput ?? null,
    total: values.total ?? null,
  };
}

/** True when at least one field carries an observed value (including observed 0). */
export function usageBreakdownHasData(breakdown: UsageTokenBreakdown | undefined | null): boolean {
  if (!breakdown) return false;
  return (
    breakdown.total !== null ||
    breakdown.inputUncached !== null ||
    breakdown.cacheRead !== null ||
    breakdown.cacheWrite !== null ||
    breakdown.output !== null ||
    breakdown.reasoningOutput !== null
  );
}

/** Sum two breakdowns field-wise, preserving null (unknown + anything = unknown). */
export function addUsageBreakdowns(
  a: UsageTokenBreakdown,
  b: UsageTokenBreakdown
): UsageTokenBreakdown {
  const add = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? (x ?? y ?? null) : x + y;
  return {
    inputUncached: add(a.inputUncached, b.inputUncached),
    cacheRead: add(a.cacheRead, b.cacheRead),
    cacheWrite: add(a.cacheWrite, b.cacheWrite),
    output: add(a.output, b.output),
    reasoningOutput: add(a.reasoningOutput, b.reasoningOutput),
    total: add(a.total, b.total),
  };
}

/**
 * Derive the total from a complete, mutually exclusive classification.
 * Returns null when any disjoint component is unknown — a partial
 * classification must never be collapsed into a fabricated total.
 */
export function deriveTotalFromDisjointClassification(
  breakdown: UsageTokenBreakdown
): number | null {
  const { inputUncached, cacheRead, cacheWrite, output } = breakdown;
  if (inputUncached === null || cacheRead === null || cacheWrite === null || output === null) {
    return null;
  }
  return inputUncached + cacheRead + cacheWrite + output;
}

/** Input side = uncached input + cache reads + cache writes (all nullable). */
export function usageBreakdownInputSide(breakdown: UsageTokenBreakdown): number | null {
  const { inputUncached, cacheRead, cacheWrite } = breakdown;
  if (inputUncached === null || cacheRead === null || cacheWrite === null) return null;
  return (inputUncached ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseBreakdown(value: unknown): UsageTokenBreakdown | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const fields = ['inputUncached', 'cacheRead', 'cacheWrite', 'output', 'reasoningOutput', 'total'];
  if (fields.some(k => v[k] !== undefined && v[k] !== null && !isNonNegInt(v[k]))) return null;
  const field = (k: string): number | null =>
    v[k] === undefined || v[k] === null ? null : isNonNegInt(v[k]) ? v[k] : null;
  return {
    inputUncached: field('inputUncached'),
    cacheRead: field('cacheRead'),
    cacheWrite: field('cacheWrite'),
    output: field('output'),
    reasoningOutput: field('reasoningOutput'),
    total: field('total'),
  };
}

/**
 * Structural validation for snapshots arriving from plugins. Returns a parsed
 * snapshot, or null when the value does not honor the contract (the recorder
 * must then ignore the event rather than persist unknown shapes).
 */
export function parseRuntimeUsageSnapshot(value: unknown): RuntimeUsageSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION) return null;
  if (!isNonNegInt(v.revision)) return null;
  if (typeof v.final !== 'boolean') return null;
  if (v.status !== 'complete' && v.status !== 'partial' && v.status !== 'missing') return null;
  const tokens = parseBreakdown(v.tokens);
  if (!tokens) return null;
  if (v.models !== undefined && !Array.isArray(v.models)) return null;
  const models: UsageModelAllocation[] = [];
  if (Array.isArray(v.models)) {
    for (const entry of v.models) {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      if (e.modelId !== null && typeof e.modelId !== 'string') return null;
      const allocation = parseBreakdown(e.tokens);
      if (!allocation) return null;
      models.push({ modelId: e.modelId, tokens: allocation });
    }
  }
  const source = v.source as Record<string, unknown> | undefined;
  if (!source || typeof source.kind !== 'string' || !source.kind) return null;
  if (source.scope !== 'invocation') return null;
  if (
    source.includesSubagents !== 'yes' &&
    source.includesSubagents !== 'no' &&
    source.includesSubagents !== 'unknown'
  ) {
    return null;
  }
  if (!isNonNegInt(source.ruleVersion)) return null;

  const snapshot: RuntimeUsageSnapshot = {
    schemaVersion: RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION,
    revision: v.revision,
    final: v.final,
    status:
      v.status === 'complete' && tokens.total === null
        ? usageBreakdownHasData(tokens)
          ? 'partial'
          : 'missing'
        : v.status,
    tokens,
    models,
    source: {
      kind: source.kind,
      scope: 'invocation',
      includesSubagents: source.includesSubagents,
      ruleVersion: source.ruleVersion,
    },
  };
  if (typeof v.reason === 'string' && v.reason) snapshot.reason = v.reason;
  if (typeof v.discrepancy === 'string' && v.discrepancy) snapshot.discrepancy = v.discrepancy;
  if (v.checkpoint !== undefined && v.checkpoint !== null) {
    const cp = v.checkpoint as Record<string, unknown>;
    if (!isNonNegInt(cp.capturedAt)) return null;
    const parsedCheckpoint: UsageSourceCheckpoint = {
      schemaVersion: 1,
      capturedAt: cp.capturedAt,
    };
    if (typeof cp.nativeThreadId === 'string') parsedCheckpoint.nativeThreadId = cp.nativeThreadId;
    if (isNonNegInt(cp.counterEpoch)) parsedCheckpoint.counterEpoch = cp.counterEpoch;
    if (cp.cumulative !== undefined) {
      if (cp.cumulative === null) parsedCheckpoint.cumulative = null;
      else if (cp.cumulative && typeof cp.cumulative === 'object') {
        const c = cp.cumulative as Record<string, unknown>;
        const counters = [
          'totalTokens',
          'inputTokens',
          'cachedInputTokens',
          'cacheWriteInputTokens',
          'outputTokens',
          'reasoningOutputTokens',
        ];
        if (!counters.every(k => isNonNegInt(c[k]))) return null;
        parsedCheckpoint.cumulative = {
          totalTokens: c.totalTokens as number,
          inputTokens: c.inputTokens as number,
          cachedInputTokens: c.cachedInputTokens as number,
          cacheWriteInputTokens: c.cacheWriteInputTokens as number,
          outputTokens: c.outputTokens as number,
          reasoningOutputTokens: c.reasoningOutputTokens as number,
        };
      } else return null;
    }
    snapshot.checkpoint = parsedCheckpoint;
  }
  return snapshot;
}
