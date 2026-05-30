import type { PermissionCategory } from '@zclaudia/shared/interaction/permissions';
import type Database from 'better-sqlite3';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface DelegationConfig {
  enabled: boolean;
  /** Confidence threshold (0-1). Below this, escalate to user. Default 0.8 */
  confidenceThreshold: number;
  /** Rate limit: max auto-approvals per minute. Default 10 */
  maxAutoApprovalsPerMinute: number;
  /** Which permission categories can be delegated */
  allowedCategories: PermissionCategory[];
  /** Tool names that should never be auto-approved */
  neverDelegate: string[];
  /** Provider for LLM risk analysis (optional, uses default if not set) */
  analysisProviderId?: string;
}

export const DEFAULT_DELEGATION_CONFIG: DelegationConfig = {
  enabled: false,
  confidenceThreshold: 0.8,
  maxAutoApprovalsPerMinute: 10,
  allowedCategories: ['fileRead', 'fileWrite', 'shellSafe'],
  neverDelegate: ['AskUserQuestion', 'ExitPlanMode'],
  analysisProviderId: undefined,
};

// Rate limiter: circular buffer tracking approvals per minute
let approvalTimestamps: number[] = [];
let approvalStartIdx = 0;
export const AI_REVIEW_DEBUG_ENABLED = process.env.ZCLAUDIA_AI_REVIEW_DEBUG === '1';
export const AI_REVIEW_LOG_PATH = process.env.ZCLAUDIA_DATA_DIR
  ? `${process.env.ZCLAUDIA_DATA_DIR}/ai-review-debug.log`
  : '/tmp/zclaudia-ai-review.log';

export function appendAIReviewDebugLog(message: string): void {
  if (!AI_REVIEW_DEBUG_ENABLED) return;
  try {
    mkdirSync(dirname(AI_REVIEW_LOG_PATH), { recursive: true });
    appendFileSync(AI_REVIEW_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Best-effort debug logging only.
  }
}

export function logAIReviewPayload(kind: 'prompt' | 'response', turn: number, sessionId: string | undefined, payload: string): void {
  if (!AI_REVIEW_DEBUG_ENABLED) return;
  appendAIReviewDebugLog(
    [
      `kind=${kind}`,
      `turn=${turn}`,
      `sessionId=${sessionId || 'new'}`,
      `${kind.toUpperCase()}<<EOF`,
      payload,
      'EOF',
    ].join('\n')
  );
}

export function isRateLimited(maxPerMinute: number): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  while (approvalStartIdx < approvalTimestamps.length && approvalTimestamps[approvalStartIdx] < oneMinuteAgo) {
    approvalStartIdx++;
  }
  if (approvalStartIdx > approvalTimestamps.length / 2) {
    approvalTimestamps = approvalTimestamps.slice(approvalStartIdx);
    approvalStartIdx = 0;
  }
  return (approvalTimestamps.length - approvalStartIdx) >= maxPerMinute;
}

export function recordApproval(): void {
  approvalTimestamps.push(Date.now());
}

/** @internal Test-only: reset the rate limiter state */
export function _resetRateLimiterForTesting(): void {
  approvalTimestamps = [];
  approvalStartIdx = 0;
}

/** Load delegation config from DB */
export function getDelegationConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } }
): DelegationConfig {
  try {
    const row = db.prepare('SELECT config FROM delegation_config WHERE id = 1')
      .get() as { config: string } | undefined;
    if (!row?.config) return DEFAULT_DELEGATION_CONFIG;
    return { ...DEFAULT_DELEGATION_CONFIG, ...JSON.parse(row.config) };
  } catch {
    return DEFAULT_DELEGATION_CONFIG;
  }
}

/** Save delegation config to DB */
export function saveDelegationConfig(
  db: Database.Database,
  config: DelegationConfig
): void {
  db.prepare('UPDATE delegation_config SET config = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(config), Date.now());
}

