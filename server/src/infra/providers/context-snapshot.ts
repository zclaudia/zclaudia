import type { ContextUsagePayload } from '@zclaudia/shared';
import type { ContextWindowSource } from '@zclaudia/shared/wire/messages/core';
import { createHash } from 'crypto';

/**
 * Per-session context-composition snapshots backing the /context command.
 *
 * Captured by PiAgentProviderAdapter on every run (after the system prompt and tool
 * set are assembled), with real usage backfilled at run end. In-memory only —
 * a server restart simply means "no data until the next run", same as the
 * deferred-diagnostics store.
 */

export interface ContextSnapshotUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ContextSnapshot {
  sessionId: string;
  capturedAt: number;
  model: string;
  contextWindow: number;
  contextWindowSource: ContextWindowSource;
  systemPromptTokens: number;
  toolTokens: number;
  toolCount: number;
  skillCatalogTokens: number;
  lastUsage?: ContextSnapshotUsage;
}

export interface CaptureContextSnapshotInput {
  sessionId: string;
  model: string;
  contextWindow: number;
  contextWindowSource: ContextWindowSource;
  /** Base system prompt + external provider catalog + plan-mode suffix. */
  systemPromptText: string;
  /** Skill catalog + active skill context (counted separately from the base prompt). */
  skillCatalogText: string;
  tools: ReadonlyArray<{ name: string; description?: string; parameters?: unknown }>;
}

const snapshots = new Map<string, ContextSnapshot>();

interface PrefixHashes { promptHash: string; toolsHash: string }
const prefixHashes = new Map<string, PrefixHashes>();

export interface PrefixCacheAuditResult {
  firstRun: boolean;
  promptStable: boolean;
  toolsStable: boolean;
  promptHash: string;
  toolsHash: string;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Compares this run's cache-relevant prefix (system prompt + skill catalog, and
 * the tool set) against the previous run for the same session. A changed hash
 * means the provider's prompt prefix cache is invalidated at the run boundary.
 * Pure-ish: mutates only the module-local prefixHashes store, like snapshots.
 */
export function diffPrefixForCacheAudit(
  sessionId: string,
  systemPromptText: string,
  skillCatalogText: string,
  tools: ReadonlyArray<{ name: string; description?: string; parameters?: unknown }>,
): PrefixCacheAuditResult {
  const promptHash = sha(systemPromptText + ' ' + skillCatalogText);
  const toolsHash = sha(JSON.stringify(tools.map((t) => [t.name, t.description ?? '', t.parameters ?? null])));
  const prev = prefixHashes.get(sessionId);
  prefixHashes.set(sessionId, { promptHash, toolsHash });
  return {
    firstRun: !prev,
    promptStable: prev ? prev.promptHash === promptHash : true,
    toolsStable: prev ? prev.toolsHash === toolsHash : true,
    promptHash,
    toolsHash,
  };
}

/** Rough token estimate: ceil(chars / 4). Good enough for a breakdown view. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function captureContextSnapshot(input: CaptureContextSnapshotInput): void {
  const toolTokens = input.tools.reduce(
    (sum, t) => sum + estimateTokens(
      `${t.name}${t.description ?? ''}${t.parameters ? JSON.stringify(t.parameters) : ''}`,
    ),
    0,
  );
  // Keep the previous run's usage so a query mid-run still reports the last
  // known real occupancy instead of degrading to estimates.
  const previousUsage = snapshots.get(input.sessionId)?.lastUsage;
  snapshots.set(input.sessionId, {
    sessionId: input.sessionId,
    capturedAt: Date.now(),
    model: input.model,
    contextWindow: input.contextWindow,
    contextWindowSource: input.contextWindowSource,
    systemPromptTokens: estimateTokens(input.systemPromptText),
    toolTokens,
    toolCount: input.tools.length,
    skillCatalogTokens: estimateTokens(input.skillCatalogText),
    lastUsage: previousUsage,
  });
}

export function recordContextUsage(sessionId: string, usage: ContextSnapshotUsage): void {
  const snapshot = snapshots.get(sessionId);
  if (!snapshot) return;
  snapshot.lastUsage = usage;
}

export function getContextSnapshot(sessionId: string): ContextSnapshot | undefined {
  // Shallow copy: the store object is mutated by recordContextUsage; callers
  // get a stable view as of the call.
  const snapshot = snapshots.get(sessionId);
  return snapshot ? { ...snapshot } : undefined;
}

export function computeContextUsage(snapshot: ContextSnapshot): ContextUsagePayload {
  const estimateSum = snapshot.systemPromptTokens + snapshot.toolTokens + snapshot.skillCatalogTokens;
  const lastUsage = snapshot.lastUsage;
  const fromUsage = lastUsage !== undefined;
  const usedTokens = lastUsage !== undefined
    ? lastUsage.input + lastUsage.cacheRead
    : estimateSum;
  const rawResidual = usedTokens - estimateSum;
  const freeTokens = Math.max(0, snapshot.contextWindow - usedTokens);
  return {
    model: snapshot.model,
    contextWindow: snapshot.contextWindow,
    contextWindowSource: snapshot.contextWindowSource,
    usedTokens,
    usedTokensFromUsage: fromUsage,
    breakdown: {
      systemPrompt: { tokens: snapshot.systemPromptTokens, estimated: true },
      tools: { tokens: snapshot.toolTokens, estimated: true, count: snapshot.toolCount },
      skills: { tokens: snapshot.skillCatalogTokens, estimated: true },
      messages: {
        tokens: Math.max(0, rawResidual),
        estimated: true,
        clamped: fromUsage && rawResidual < 0,
      },
      freeSpace: {
        tokens: freeTokens,
        percent: snapshot.contextWindow > 0
          ? Math.round((freeTokens / snapshot.contextWindow) * 1000) / 10
          : 0,
      },
    },
    capturedAt: snapshot.capturedAt,
  };
}

/** Test helper — resets the store between cases. */
export function clearContextSnapshots(): void {
  snapshots.clear();
}
