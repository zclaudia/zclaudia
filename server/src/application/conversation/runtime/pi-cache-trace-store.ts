/**
 * Adapts the usage domain's CacheTraceRepository to the infra-owned
 * PiCacheTraceStore, so the Pi runtime records its prompt-cache trace without
 * infra importing domains.
 */
import type Database from 'better-sqlite3';
import type { PiCacheTraceStore } from '../../../infra/providers/types.js';
import { CacheTraceRepository } from '../../../domains/usage/cache-trace-repository.js';

/**
 * The trace store for a run's database, or undefined when it predates
 * migration 047. The trace is diagnostics only, so a database that can't be
 * probed simply means the run isn't traced.
 */
export function createPiCacheTraceStore(db: Database.Database): PiCacheTraceStore | undefined {
  try {
    return CacheTraceRepository.hasSchema(db) ? new CacheTraceRepository(db) : undefined;
  } catch (error) {
    console.warn('[CacheTrace] failed to probe trace schema:', error);
    return undefined;
  }
}
