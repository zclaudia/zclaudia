import type Database from 'better-sqlite3';

/**
 * Transport-level dedup ledger for Claudia requests (design §去重与恢复, P0).
 *
 * The row is written inside the same serialized boundary that allocates the
 * branch/session and admits the run — never after the run completes. A replayed
 * clientRequestId resolves to the recorded outcome; the same id with a
 * different payload/target is a conflict.
 */
export type ClaudiaRequestOutcome = 'accepted' | 'rejected' | 'uncertain';

export interface ClaudiaRequestRecord {
  clientRequestId: string;
  callerScope: string;
  projectId: string;
  branchId: string | null;
  sessionId: string | null;
  runId: string | null;
  payloadFingerprint: string;
  outcome: ClaudiaRequestOutcome;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

interface RequestRecordRow {
  client_request_id: string;
  caller_scope: string;
  project_id: string;
  branch_id: string | null;
  session_id: string | null;
  run_id: string | null;
  payload_fingerprint: string;
  outcome: ClaudiaRequestOutcome;
  error_code: string | null;
  created_at: number;
  updated_at: number;
}

function rowToRecord(row: RequestRecordRow): ClaudiaRequestRecord {
  return {
    clientRequestId: row.client_request_id,
    callerScope: row.caller_scope,
    projectId: row.project_id,
    branchId: row.branch_id,
    sessionId: row.session_id,
    runId: row.run_id,
    payloadFingerprint: row.payload_fingerprint,
    outcome: row.outcome,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ClaudiaRequestRecordRepository {
  constructor(private readonly db: Database.Database) {}

  findById(clientRequestId: string): ClaudiaRequestRecord | null {
    const row = this.db
      .prepare('SELECT * FROM claudia_request_records WHERE client_request_id = ?')
      .get(clientRequestId) as RequestRecordRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Register a request before the run starts. `outcome` starts as 'uncertain';
   * callers transition it via {@link markAccepted} / {@link markRejected}.
   * Returns the pre-existing record when the id is already taken.
   */
  register(input: {
    clientRequestId: string;
    callerScope: string;
    projectId: string;
    branchId: string | null;
    sessionId: string | null;
    payloadFingerprint: string;
  }): { record: ClaudiaRequestRecord; replayed: boolean } {
    const now = Date.now();
    const existing = this.findById(input.clientRequestId);
    if (existing) return { record: existing, replayed: true };
    this.db
      .prepare(
        `
      INSERT INTO claudia_request_records (
        client_request_id, caller_scope, project_id, branch_id, session_id,
        payload_fingerprint, outcome, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'uncertain', ?, ?)
    `
      )
      .run(
        input.clientRequestId,
        input.callerScope,
        input.projectId,
        input.branchId,
        input.sessionId,
        input.payloadFingerprint,
        now,
        now
      );
    const record = this.findById(input.clientRequestId);
    if (!record) throw new Error(`Failed to register Claudia request ${input.clientRequestId}`);
    return { record, replayed: false };
  }

  markAccepted(
    clientRequestId: string,
    ids: { branchId: string; sessionId: string; runId: string }
  ): void {
    this.db
      .prepare(
        `
      UPDATE claudia_request_records
      SET outcome = 'accepted', branch_id = ?, session_id = ?, run_id = ?, error_code = NULL, updated_at = ?
      WHERE client_request_id = ?
    `
      )
      .run(ids.branchId, ids.sessionId, ids.runId, Date.now(), clientRequestId);
  }

  /** Bind the allocated branch/session to the request record once admission passed. */
  bindTarget(clientRequestId: string, branchId: string, sessionId: string): void {
    this.db
      .prepare(
        'UPDATE claudia_request_records SET branch_id = ?, session_id = ?, updated_at = ? WHERE client_request_id = ?'
      )
      .run(branchId, sessionId, Date.now(), clientRequestId);
  }

  markRejected(
    clientRequestId: string,
    errorCode: string,
    ids?: { branchId?: string; sessionId?: string; runId?: string }
  ): void {
    const record = this.findById(clientRequestId);
    this.db
      .prepare(
        `
      UPDATE claudia_request_records
      SET outcome = 'rejected', error_code = ?, branch_id = ?, session_id = ?, run_id = ?, updated_at = ?
      WHERE client_request_id = ?
    `
      )
      .run(
        errorCode,
        ids?.branchId ?? record?.branchId ?? null,
        ids?.sessionId ?? record?.sessionId ?? null,
        ids?.runId ?? record?.runId ?? null,
        Date.now(),
        clientRequestId
      );
  }

  setRunId(clientRequestId: string, runId: string): void {
    this.db
      .prepare(
        'UPDATE claudia_request_records SET run_id = ?, updated_at = ? WHERE client_request_id = ?'
      )
      .run(runId, Date.now(), clientRequestId);
  }
}
