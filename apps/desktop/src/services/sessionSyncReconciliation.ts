export interface SessionSyncRecord {
  id: string;
  updatedAt?: number;
}

export type DeltaSessionEvent<T extends SessionSyncRecord> = {
  eventType: 'created' | 'updated';
  session: T;
};

export function findDeletedSessionIds(
  localSessions: SessionSyncRecord[],
  serverSessions: SessionSyncRecord[]
): string[] {
  const serverSessionIds = new Set(serverSessions.map(session => session.id));
  return localSessions
    .filter(localSession => !serverSessionIds.has(localSession.id))
    .map(localSession => localSession.id);
}

export function planDeltaSessionEvents<T extends SessionSyncRecord>(
  existingSessions: SessionSyncRecord[],
  changedSessions: T[]
): Array<DeltaSessionEvent<T>> {
  const existingById = new Map(existingSessions.map(session => [session.id, session]));
  const events: Array<DeltaSessionEvent<T>> = [];

  for (const session of changedSessions) {
    const existingSession = existingById.get(session.id);
    if (!existingSession) {
      events.push({ eventType: 'created', session });
    } else if ((existingSession.updatedAt ?? 0) < (session.updatedAt ?? 0)) {
      events.push({ eventType: 'updated', session });
    }
  }

  return events;
}
