/** Isolated synthetic ledger benchmark: pnpm --filter @zclaudia/server exec tsx scripts/benchmark-runtime-usage.ts */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migration } from '../src/infra/storage/migrations/045_runtime_usage_records.js';
import { UsageQueryService } from '../src/domains/usage/usage-query.js';

const db = new Database(':memory:');
db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('bench')");
db.exec(migration.sql);
const asOf = Date.UTC(2026, 8, 17, 12);
const records = 100_000;
const day = 86_400_000;
const insert = db.prepare(`INSERT INTO runtime_usage_records (
  invocation_id, run_id, session_id, runtime_id, execution_state, accounted_at,
  updated_at, usage_status, input_uncached, cache_read, cache_write,
  output_tokens, total_tokens, model_breakdown_json, source_checkpoint_json
) VALUES (?, 'run', 'bench', ?, 'completed', ?, ?, 'complete', 50, 30, 0, 20, 100, ?, ?)`);
const models = JSON.stringify([{ modelId: 'benchmark-model', total: 100, input: 80, output: 20 }]);
// Ensure checkpoint size does not inflate the analytics projection.
const checkpoint = JSON.stringify({
  nativeThreadId: 'synthetic',
  cumulative: { totalTokens: 100 },
});
db.transaction(() => {
  for (let i = 0; i < records; i++) {
    insert.run(
      String(i),
      ['claude', 'codex', 'cursor'][i % 3],
      asOf - (i % 365) * day,
      asOf,
      models,
      checkpoint
    );
  }
})();
const query = new UsageQueryService(db);
const activity = {
  sessions: 1,
  messages: 0,
  activeDaysCount: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  peakHour: null,
  activeDays: [],
};
const measurements = [];
for (const range of ['7d', '30d', 'all'] as const) {
  const elapsed: number[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now();
    const result = db.transaction(() =>
      query.usageStatsPayload(range, activity, 'Asia/Shanghai', asOf, true)
    )();
    elapsed.push(performance.now() - started);
    assert(result.details);
    assert.equal(result.totalTokens, result.details.runtime.totals.recordedTokens);
    assert.equal(
      result.totalTokens,
      result.details.models.models.reduce((sum, model) => sum + model.totalTokens, 0)
    );
    if (range === 'all') assert.equal(result.totalTokens, records * 100);
  }
  measurements.push({ range, milliseconds: elapsed.map(value => Math.round(value)) });
}
const plan = db
  .prepare(
    'EXPLAIN QUERY PLAN SELECT runtime_id, total_tokens FROM runtime_usage_records WHERE accounted_at >= ? AND accounted_at < ?'
  )
  .all(asOf - 7 * day, asOf + 1);
console.log(JSON.stringify({ records, measurements, plan }, null, 2));
db.close();
