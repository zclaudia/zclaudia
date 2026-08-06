import type Database from 'better-sqlite3';

/**
 * The status a session's last run settled on, mirrored into
 * `sessions.last_run_status` so it survives the run leaving memory.
 *
 * `running` and `waiting` are live states written by the run lifecycle;
 * `failed` is terminal and stays until the next run starts. A run that ends
 * normally (or is cancelled by the user) clears the column — leaving `running`
 * behind made state recovery mark healthy sessions "interrupted" on restart.
 */
export type SessionRunStatus = 'running' | 'waiting' | 'failed';

export function setSessionRunStatus(
  db: Database.Database,
  sessionId: string,
  status: SessionRunStatus | null
): void {
  db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?').run(
    status,
    Date.now(),
    sessionId
  );
}
