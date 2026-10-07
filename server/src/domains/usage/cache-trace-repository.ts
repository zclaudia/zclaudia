import type { Database } from 'better-sqlite3';
import type { CacheTokenSums, SessionCacheTimeline } from '@zclaudia/shared/core/cache-stats';
import { classifyCacheTimeline, type TraceCall, type TraceRun } from './cache-trace-classifier.js';

export interface CacheTraceRunRow {
  invocationId: string;
  runId: string | null;
  sessionId: string;
  startedAt: number;
  model: string | null;
  thinkingLevel: string | null;
  cacheRetention: string | null;
  promptHash: string;
  toolsHash: string;
  historyCount: number;
  historyHash: string;
  historyPrefixIntact: boolean | null;
  trimmedMessages: number;
}

export interface CacheTraceCallRow {
  callIndex: number;
  at: number;
  model: string | null;
  tokens: CacheTokenSums;
  output: number;
  stopReason: string | null;
}

function tableExists(db: Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/**
 * Persistence for the prompt-cache trace (migration 047). Writes are
 * diagnostics only: callers swallow failures so a trace problem never
 * affects the run that produced it.
 */
export class CacheTraceRepository {
  constructor(private readonly db: Database) {}

  static hasSchema(db: Database): boolean {
    return tableExists(db, 'prompt_cache_runs') && tableExists(db, 'prompt_cache_calls');
  }

  sessionExists(sessionId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  }

  /** The session's latest traced run, for the next run's history-prefix check. */
  lastRun(sessionId: string): { historyCount: number; historyHash: string } | null {
    const row = this.db
      .prepare(
        `SELECT history_count, history_hash FROM prompt_cache_runs
         WHERE session_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`
      )
      .get(sessionId) as { history_count: number; history_hash: string } | undefined;
    return row ? { historyCount: row.history_count, historyHash: row.history_hash } : null;
  }

  /** Replace one run's fingerprint and calls atomically. */
  recordRun(run: CacheTraceRunRow, calls: CacheTraceCallRow[]): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO prompt_cache_runs (
             invocation_id, run_id, session_id, started_at, model, thinking_level,
             cache_retention, prompt_hash, tools_hash, history_count, history_hash,
             history_prefix_intact, trimmed_messages
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          run.invocationId,
          run.runId,
          run.sessionId,
          run.startedAt,
          run.model,
          run.thinkingLevel,
          run.cacheRetention,
          run.promptHash,
          run.toolsHash,
          run.historyCount,
          run.historyHash,
          run.historyPrefixIntact === null ? null : run.historyPrefixIntact ? 1 : 0,
          run.trimmedMessages
        );
      this.db
        .prepare('DELETE FROM prompt_cache_calls WHERE invocation_id = ?')
        .run(run.invocationId);
      const insert = this.db.prepare(
        `INSERT INTO prompt_cache_calls (
           invocation_id, call_index, session_id, at, model,
           input_uncached, cache_read, cache_write, output_tokens, stop_reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const call of calls) {
        insert.run(
          run.invocationId,
          call.callIndex,
          run.sessionId,
          call.at,
          call.model,
          call.tokens.inputUncached,
          call.tokens.cacheRead,
          call.tokens.cacheWrite,
          call.output,
          call.stopReason
        );
      }
    })();
  }

  /** Classified per-call timeline for one session (newest `limit` calls). */
  sessionTimeline(sessionId: string, limit: number): SessionCacheTimeline {
    const runs = (
      this.db
        .prepare(
          `SELECT invocation_id, started_at, model, thinking_level, cache_retention,
                  prompt_hash, tools_hash, history_prefix_intact, trimmed_messages
           FROM prompt_cache_runs WHERE session_id = ?`
        )
        .all(sessionId) as Array<Record<string, unknown>>
    ).map(
      (row): TraceRun => ({
        invocationId: row.invocation_id as string,
        startedAt: row.started_at as number,
        model: (row.model as string | null) ?? null,
        thinkingLevel: (row.thinking_level as string | null) ?? null,
        cacheRetention: (row.cache_retention as string | null) ?? null,
        promptHash: row.prompt_hash as string,
        toolsHash: row.tools_hash as string,
        historyPrefixIntact:
          row.history_prefix_intact === null ? null : row.history_prefix_intact === 1,
        trimmedMessages: row.trimmed_messages as number,
      })
    );
    const calls = (
      this.db
        .prepare(
          `SELECT invocation_id, call_index, at, model, input_uncached, cache_read,
                  cache_write, output_tokens
           FROM prompt_cache_calls WHERE session_id = ?`
        )
        .all(sessionId) as Array<Record<string, unknown>>
    ).map(
      (row): TraceCall => ({
        invocationId: row.invocation_id as string,
        callIndex: row.call_index as number,
        at: row.at as number,
        model: (row.model as string | null) ?? null,
        tokens: {
          inputUncached: row.input_uncached as number,
          cacheRead: row.cache_read as number,
          cacheWrite: row.cache_write as number,
        },
        output: row.output_tokens as number,
      })
    );
    return classifyCacheTimeline(
      runs,
      calls,
      { forked: this.isForked(sessionId), compactionsAt: this.compactionTimes(sessionId) },
      limit
    );
  }

  private isForked(sessionId: string): boolean {
    try {
      const row = this.db
        .prepare('SELECT forked_from_session_id AS f FROM sessions WHERE id = ?')
        .get(sessionId) as { f: string | null } | undefined;
      return !!row?.f;
    } catch {
      // Fixtures without the lineage column (migration 024).
      return false;
    }
  }

  private compactionTimes(sessionId: string): number[] {
    if (!tableExists(this.db, 'session_log')) return [];
    const rows = this.db
      .prepare(
        `SELECT json_extract(payload, '$.entry.timestamp') AS t FROM session_log
         WHERE session_id = ? AND kind = 'entry'
           AND json_extract(payload, '$.entry.type') = 'compaction'`
      )
      .all(sessionId) as Array<{ t: number | null }>;
    return rows.map(r => r.t).filter((t): t is number => typeof t === 'number');
  }
}
