import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { createSessionBackendConformance } from '@earendil-works/pi-agent-core/session/testing';
import { migration as sessionLogMigration } from '../../../../storage/migrations/040_session_log.js';
import { SqliteSessionRepo } from '../sqlite-session-repo.js';

/**
 * pi's own conformance suite, run against our SQLite backend.
 *
 * `SessionState` is a hand-port of a class pi does not export, so the thing
 * most worth checking is that the port still means what the original means —
 * branch bounds, cursor direction, open-operation bookkeeping, fork mutation
 * order, the stats ledger. This suite is pi's definition of those, so a future
 * pi upgrade that changes them fails here rather than in production.
 */
const cases = createSessionBackendConformance(async () => {
  const db = new Database(':memory:');
  // Stand-in for `sessions`: the real table sits behind a project and an agent
  // profile, neither of which the session tree knows about.
  db.exec(
    `CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, parent_session_id TEXT);`
  );
  db.exec(sessionLogMigration.sql);
  return {
    repository: new SqliteSessionRepo(db),
    async [Symbol.asyncDispose]() {
      db.close();
    },
  };
});

const groups = [...new Set(cases.map(c => c.group))];

for (const group of groups) {
  describe(`pi session backend conformance — ${group}`, () => {
    for (const testCase of cases.filter(c => c.group === group)) {
      it(testCase.name, () => testCase.run());
    }
  });
}
