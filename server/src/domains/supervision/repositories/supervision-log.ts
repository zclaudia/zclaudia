import type { Database } from 'better-sqlite3';
import { newId } from '../../../utils/uuid.js';

export class SupervisionLogRepository {
  constructor(private db: Database) {}

  create(projectId: string, event: string, detail?: unknown, taskId?: string): void {
    this.db
      .prepare(
        `INSERT INTO supervision_logs (id, project_id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId(),
        projectId,
        taskId ?? null,
        event,
        detail ? JSON.stringify(detail) : null,
        Date.now()
      );
  }
}
