// Runtime token usage accounting contract (design: docs/specs/2026-09-16-runtime-token-usage-design.md).
//
// The plugin-side twin of these types lives in @zclaudia/agent-common
// (src/usage-snapshot.ts) because runtime plugins cannot depend on this
// workspace. The two declarations must stay structurally identical; the
// server's snapshot validator + contract fixtures are the drift guard.

/** Version of the usage snapshot contract. Bump on any breaking field change. */
export const RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION = 1;

/** Optional, versioned usage capability id declared in runtime PCP manifests. */
export const USAGE_TRACKING_CAPABILITY_ID = 'usage.tracking' as const;

/**
 * Token classification. All values are non-negative safe integers; `null`
 * means "unknown". 0 must always come from an observed zero, never as a
 * placeholder for missing data.
 *
 * A complete classification satisfies
 * `total = inputUncached + cacheRead + cacheWrite + output`.
 * `reasoningOutput` is an output SUBSET — display detail only, never added
 * back into totals.
 */
export interface UsageTokenBreakdown {
  inputUncached: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  reasoningOutput: number | null;
  /** Source-reported cumulative total, or derived from a complete disjoint classification. */
  total: number | null;
}

export type RuntimeUsageDataStatus = 'complete' | 'partial' | 'missing';

/** Per-model allocation inside one invocation. Allocations are mutually exclusive. */
export interface UsageModelAllocation {
  /** Runtime-reported actual model id; null = Unknown model bucket. */
  modelId: string | null;
  tokens: UsageTokenBreakdown;
}

export interface RuntimeUsageSnapshotSource {
  /** Provenance label, e.g. `claude_result` / `codex_thread_delta` / `pi_agent_end`. */
  kind: string;
  /** Accounting scope of the reported numbers. */
  scope: 'invocation';
  includesSubagents: 'yes' | 'no' | 'unknown';
  /** Version of the metering rules that produced this snapshot. */
  ruleVersion: number;
}

/**
 * One cumulative usage snapshot for an invocation. The adapter emits the
 * CURRENT accumulated state (not per-request deltas); the host REPLACES the
 * stored snapshot rather than summing successive notifications.
 */
export interface RuntimeUsageSnapshot {
  schemaVersion: typeof RUNTIME_USAGE_SNAPSHOT_SCHEMA_VERSION;
  /** Strictly increasing within one invocation; used for idempotent replaces. */
  revision: number;
  /** True once the usage snapshot is settled — does NOT imply task success. */
  final: boolean;
  status: RuntimeUsageDataStatus;
  /** Machine-readable downgrade cause, e.g. `missing_baseline` / `interrupted`. */
  reason?: string;
  tokens: UsageTokenBreakdown;
  models: UsageModelAllocation[];
  source: RuntimeUsageSnapshotSource;
  /**
   * Audit summary when the source total and the classification disagree, or
   * when model allocations cannot be reconciled with the invocation total.
   * Never silently force the gap into a bucket.
   */
  discrepancy?: string;
  /**
   * Restricted checkpoint for resumable cumulative counters (Codex thread
   * totals). Counters, native ids and time ONLY — never prompts, replies,
   * tool input or secrets. Host-side storage; never forwarded to clients.
   */
  checkpoint?: UsageSourceCheckpoint;
}

/** Persisted counter state used to baseline the next resumed invocation. */
export interface UsageSourceCheckpoint {
  schemaVersion: 1;
  /** Native thread/session id the counters belong to. */
  nativeThreadId?: string;
  /** Counter epoch when the source resets its accumulators (/clear etc.). */
  counterEpoch?: number;
  /** Cumulative native counters at checkpoint time. */
  cumulative?: CodexTokenUsageCounters | null;
  capturedAt: number;
}

/**
 * Native Codex app-server counters (`thread/tokenUsage/updated` total).
 * OpenAI convention: `cachedInputTokens` ⊆ `inputTokens`.
 */
export interface CodexTokenUsageCounters {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/**
 * Plugin → host usage event. Bridges onto the SDK `ProviderRuntimeEvent`
 * channel until the published SDK grows the variant natively (plugins cast at
 * the yield site; the host union includes it via @zclaudia/shared/providers).
 */
export interface ProviderUsageUpdatedEvent {
  type: 'provider_usage_updated';
  snapshot: RuntimeUsageSnapshot;
}

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
