export interface SessionSyncPort {
  broadcastSessionUpdated(
    sessionId: string,
    db: {
      prepare: (sql: string) => {
        get: (id: string) =>
          | {
              id: string;
              name?: string;
              projectId?: string;
              createdAt?: number;
              updatedAt?: number;
              archivedAt?: number | null;
              lastRunStatus?: string | null;
            }
          | undefined;
      };
    }
  ): void;
}
