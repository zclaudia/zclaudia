export interface BreakerState {
  consecutiveFailures: number;
  lastFailureAtMs?: number;
  nextRetryAtMs?: number;
}

export const DEFAULT_MAX_FAILURES = 3;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_SOFT_CAP = 2000;

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function resolveMaxFailures(): number {
  return positiveIntEnv(process.env.ZCLAUDIA_COMPACTION_MAX_FAILURES, DEFAULT_MAX_FAILURES);
}

export function resolveCooldownMs(): number {
  return positiveIntEnv(process.env.ZCLAUDIA_COMPACTION_FAILURE_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
}

export type BreakerDecision =
  | { action: 'allow'; wasHalfOpen: boolean }
  | { action: 'skip'; nextRetryAtMs: number };

/**
 * Pure circuit-breaker resolver. Mirrors openclaude's
 * resolveAutoCompactCircuitBreakerState three-state machine:
 *  - failures < max          → allow (closed)
 *  - failures >= max, cooling → skip  (open)
 *  - failures >= max, elapsed → allow (half-open trial; one more failure re-opens
 *    because the count is still >= max)
 */
export function resolveBreaker(
  state: BreakerState | undefined,
  nowMs: number,
  maxFailures: number,
  cooldownMs: number
): BreakerDecision {
  const failures = Math.max(0, state?.consecutiveFailures ?? 0);
  if (failures < maxFailures) return { action: 'allow', wasHalfOpen: false };

  let nextRetryAtMs = state?.nextRetryAtMs;
  if (
    (typeof nextRetryAtMs !== 'number' || !Number.isFinite(nextRetryAtMs)) &&
    typeof state?.lastFailureAtMs === 'number' &&
    Number.isFinite(state.lastFailureAtMs)
  ) {
    nextRetryAtMs = state.lastFailureAtMs + cooldownMs;
  }
  if (
    typeof nextRetryAtMs === 'number' &&
    Number.isFinite(nextRetryAtMs) &&
    nowMs < nextRetryAtMs
  ) {
    return { action: 'skip', nextRetryAtMs };
  }
  return { action: 'allow', wasHalfOpen: true };
}

/**
 * Process-local breaker store keyed by sessionId. State survives across runs
 * within a session (consecutive failures accumulate across turns) but is NOT
 * persisted — a server restart naturally interrupts the retry storm we guard
 * against. Cleared on success, manual compact (reset), and session deletion
 * (evict); a soft size cap backstops abandoned/archived sessions.
 */
export class CompactionCircuitBreaker {
  private readonly map = new Map<string, BreakerState>();
  constructor(private readonly softCap = DEFAULT_SOFT_CAP) {}

  evaluate(sessionId: string, nowMs: number): BreakerDecision {
    return resolveBreaker(
      this.map.get(sessionId),
      nowMs,
      resolveMaxFailures(),
      resolveCooldownMs()
    );
  }

  recordFailure(sessionId: string, nowMs: number): void {
    const prev = this.map.get(sessionId);
    const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;
    const next: BreakerState = { consecutiveFailures, lastFailureAtMs: nowMs };
    if (consecutiveFailures >= resolveMaxFailures()) {
      next.nextRetryAtMs = nowMs + resolveCooldownMs();
    }
    this.map.set(sessionId, next);
    this.enforceSoftCap();
  }

  recordSuccess(sessionId: string): void {
    this.map.delete(sessionId);
  }
  reset(sessionId: string): void {
    this.map.delete(sessionId);
  }
  evict(sessionId: string): void {
    this.map.delete(sessionId);
  }
  size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }

  /** Snapshot for building wire events after a recordFailure. */
  snapshot(sessionId: string): {
    consecutiveFailures: number;
    breakerOpen: boolean;
    nextRetryAtMs?: number;
  } {
    const s = this.map.get(sessionId);
    const consecutiveFailures = s?.consecutiveFailures ?? 0;
    return {
      consecutiveFailures,
      breakerOpen: consecutiveFailures >= resolveMaxFailures(),
      nextRetryAtMs: s?.nextRetryAtMs,
    };
  }

  private enforceSoftCap(): void {
    if (this.map.size <= this.softCap) return;
    const entries = [...this.map.entries()].sort(
      (a, b) => (a[1].lastFailureAtMs ?? 0) - (b[1].lastFailureAtMs ?? 0)
    );
    const toRemove = this.map.size - this.softCap;
    for (let i = 0; i < toRemove; i++) this.map.delete(entries[i][0]);
  }
}

export const compactionCircuitBreaker = new CompactionCircuitBreaker();
