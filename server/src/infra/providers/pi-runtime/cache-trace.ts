import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import {
  CacheTraceRepository,
  type CacheTraceCallRow,
} from '../../../domains/usage/cache-trace-repository.js';

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Hash of a message-digest list (a prefix hash is the hash of a prefix of it). */
function hashDigests(digests: readonly string[]): string {
  return sha(digests.join('\n'));
}

export interface PiCacheTraceInput {
  db?: Database.Database;
  sessionId?: string;
  /** Usage-ledger invocation; falls back to the run id. */
  invocationId?: string;
  runId?: string;
  model: string;
  thinkingLevel?: string;
  cacheRetention?: string;
  systemPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any>[];
  /** History exactly as handed to the Agent (after compaction / trimming). */
  history: AgentMessage[];
  /** Messages the token-budget trim dropped from the front of the history. */
  trimmedMessages: number;
  startedAt?: number;
}

export interface PiCacheTrace {
  /** Persist the run fingerprint plus one row per LLM call in `messages`. */
  finish(messages: AgentMessage[]): void;
}

/**
 * Start the prompt-cache trace for one pi run (plan Phase 2a/2b). The prefix
 * fingerprint is taken from what the Agent actually receives; the history is
 * digested per message so the next run can tell whether this run's history
 * survived as its prefix. Returns null when the run can't be traced (no
 * database / session, or a database without migration 047).
 */
export function startPiCacheTrace(input: PiCacheTraceInput): PiCacheTrace | null {
  const { db, sessionId } = input;
  const invocationId = input.invocationId ?? input.runId;
  if (!db || !sessionId || !invocationId) return null;
  try {
    if (!CacheTraceRepository.hasSchema(db)) return null;
    const repository = new CacheTraceRepository(db);
    // Synthetic session ids (agent playground) have no row to hang a trace on.
    if (!repository.sessionExists(sessionId)) return null;
    const digests = input.history.map(message => sha(JSON.stringify(message)));
    const previous = repository.lastRun(sessionId);
    const historyPrefixIntact =
      previous === null
        ? null
        : previous.historyCount <= digests.length &&
          hashDigests(digests.slice(0, previous.historyCount)) === previous.historyHash;
    const run = {
      invocationId,
      runId: input.runId ?? null,
      sessionId,
      startedAt: input.startedAt ?? Date.now(),
      model: input.model,
      thinkingLevel: input.thinkingLevel ?? null,
      cacheRetention: input.cacheRetention ?? null,
      promptHash: sha(input.systemPrompt),
      toolsHash: sha(
        JSON.stringify(input.tools.map(t => [t.name, t.description ?? '', t.parameters ?? null]))
      ),
      historyCount: digests.length,
      historyHash: hashDigests(digests),
      historyPrefixIntact,
      trimmedMessages: input.trimmedMessages,
    };
    return {
      finish(messages) {
        try {
          repository.recordRun(run, piCallRows(messages));
        } catch (error) {
          console.warn('[CacheTrace] failed to record run:', error);
        }
      },
    };
  } catch (error) {
    console.warn('[CacheTrace] failed to start trace:', error);
    return null;
  }
}

/**
 * One row per assistant message that carried prompt usage, in call order.
 * Calls that never reached the provider (errors, aborts with no input) are
 * skipped so they don't read as a zero-token baseline.
 */
export function piCallRows(messages: AgentMessage[]): CacheTraceCallRow[] {
  const rows: CacheTraceCallRow[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const msg = message as {
      model?: string;
      timestamp?: number;
      stopReason?: string;
      usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    };
    const u = msg.usage ?? {};
    const tokens = {
      inputUncached: u.input ?? 0,
      cacheRead: u.cacheRead ?? 0,
      cacheWrite: u.cacheWrite ?? 0,
    };
    if (tokens.inputUncached + tokens.cacheRead + tokens.cacheWrite === 0) continue;
    rows.push({
      callIndex: rows.length,
      at: msg.timestamp ?? Date.now(),
      model: msg.model || null,
      tokens,
      output: u.output ?? 0,
      stopReason: msg.stopReason ?? null,
    });
  }
  return rows;
}
