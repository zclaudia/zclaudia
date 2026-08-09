import type { Database } from 'better-sqlite3';
import type { Session } from '@zclaudia/shared/core/session';
import { SessionRepository } from './repository.js';
import { forkSessionAt } from '../../infra/providers/pi-runtime/session-tree/fork.js';
import { readActivePathRows, writeProjectedMessages } from './reproject-messages.js';
import { SqliteSessionStorage } from '../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';

export class ForkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ForkInput {
  sourceSessionId: string;
  treeEntryId: string;
  name?: string;
}

export interface ForkDeps {
  broadcastSessionEvent?: (type: 'created', session: Session) => void;
}

/**
 * Cross-session fork: create a new session that copies the source's root→entry
 * tree path and projects it into the new session's messages table. The `created`
 * broadcast fires only AFTER the DB work commits (so a partial failure never
 * surfaces a half-built session) and carries lineage.
 */
export async function forkSession(
  db: Database,
  input: ForkInput,
  deps: ForkDeps
): Promise<Session> {
  const repo = new SessionRepository(db);
  const source = repo.findById(input.sourceSessionId);
  if (!source)
    throw new ForkError(404, 'NOT_FOUND', `source session not found: ${input.sourceSessionId}`);

  const owns = await new SqliteSessionStorage(db, input.sourceSessionId).getEntry(
    input.treeEntryId
  );
  if (!owns)
    throw new ForkError(
      400,
      'INVALID_ENTRY',
      `entry ${input.treeEntryId} not in session ${input.sourceSessionId}`
    );

  const trimmed = input.name?.trim();
  const name = trimmed && trimmed.length > 0 ? trimmed : `${source.name ?? 'Session'} (fork)`;

  const sortOrder = repo.findNextSortOrder(source.projectId);
  const { sql, params } = repo.createQuery({
    projectId: source.projectId,
    agentProfileId: source.agentProfileId,
    type: 'regular',
    name,
    workingDirectory: source.workingDirectory,
    sortOrder,
    forkedFromSessionId: source.id,
    forkEntryId: input.treeEntryId,
  });
  const newSessionId = params[0] as string;

  // Tx 1: create the new session row + copy the source path (sets the new leaf).
  db.transaction(() => {
    db.prepare(sql).run(...params);
    forkSessionAt(db, source.id, input.treeEntryId, newSessionId);
  })();

  // Read the copied path (async), then Tx 2: project it into the new session's messages.
  const rows = await readActivePathRows(db, newSessionId);
  db.transaction(() => {
    writeProjectedMessages(db, newSessionId, rows);
  })();

  const created = repo.findById(newSessionId)!;
  deps.broadcastSessionEvent?.('created', created);
  return created;
}
