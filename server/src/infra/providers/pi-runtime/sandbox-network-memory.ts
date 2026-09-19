/**
 * Sandbox network-grant persistence (Phase B1) — moved down from
 * application/conversation/agent/permission-memory.ts so the pi-runtime
 * tools (bash/eval/run tools) can persist and load grants without importing
 * the application layer. SQL and key format are unchanged; the application
 * module re-exports these for compatibility.
 */
import { formatNetworkGrantKey, type SandboxGrant } from './sandbox-execution/index.js';

export interface SandboxMemoryDb {
  prepare: (sql: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement uses variadic params and returns row types vary by query
    all: (...args: any[]) => Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (...args: any[]) => unknown;
  };
}

/** Remember-key namespace for Phase B1 session network grants. */
const SANDBOX_NETWORK_KEY_PREFIX = 'sandbox:network:';

/**
 * Load the session's granted sandbox network domains (Phase B1).
 * Defensive: a DB error (e.g. an incomplete/missing `permission_memories` table)
 * must not crash an agent run — degrade to "no grants".
 */
export function loadSessionSandboxDomains(db: SandboxMemoryDb, sessionId: string): string[] {
  try {
    const rows = db
      .prepare(
        "SELECT remember_key FROM permission_memories WHERE session_id = ? AND remember_key LIKE 'sandbox:network:%' AND decision = 'allow'"
      )
      .all(sessionId);
    return rows
      .map(row => (row.remember_key as string).slice(SANDBOX_NETWORK_KEY_PREFIX.length))
      .filter(host => host.length > 0);
  } catch (err) {
    console.warn('[sandbox] failed to load session network grants; treating as none:', err);
    return [];
  }
}

/** Persist a session network grant (Phase B1). Idempotent per (session, host). */
export function persistSessionSandboxDomain(
  db: SandboxMemoryDb,
  sessionId: string,
  host: string
): void {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO permission_memories (session_id, remember_key, decision, created_at, updated_at)
    VALUES (?, ?, 'allow', ?, ?)
    ON CONFLICT(session_id, remember_key)
    DO UPDATE SET decision = 'allow', updated_at = excluded.updated_at
  `
  ).run(sessionId, SANDBOX_NETWORK_KEY_PREFIX + host, now, now);
}

export function persistSessionSandboxGrant(
  db: SandboxMemoryDb,
  sessionId: string,
  grant: SandboxGrant
): void {
  if (grant.type !== 'network') return;
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO permission_memories (session_id, remember_key, decision, created_at, updated_at)
    VALUES (?, ?, 'allow', ?, ?)
    ON CONFLICT(session_id, remember_key)
    DO UPDATE SET decision = 'allow', updated_at = excluded.updated_at
  `
  ).run(sessionId, `sandbox:${formatNetworkGrantKey(grant)}`, now, now);
}

export function loadSessionSandboxGrantKeys(db: SandboxMemoryDb, sessionId: string): string[] {
  try {
    const rows = db
      .prepare(
        "SELECT remember_key FROM permission_memories WHERE session_id = ? AND remember_key LIKE 'sandbox:network:%' AND decision = 'allow'"
      )
      .all(sessionId);
    return rows.map(row => row.remember_key as string);
  } catch (err) {
    console.warn('[sandbox] failed to load session structured grants; treating as none:', err);
    return [];
  }
}
