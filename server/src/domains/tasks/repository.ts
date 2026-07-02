import type Database from 'better-sqlite3';
import type {
  TaskEvent,
  TaskEventType,
  TaskExecutorRef,
  TaskRecord,
  TaskResult,
  TaskStatus,
  TaskType,
} from '@zclaudia/shared/core/task';

import { newId } from '../../utils/uuid.js';

interface TaskRow {
  id: string;
  type: string;
  status: string;
  parent_task_id: string | null;
  parent_session_id: string | null;
  parent_run_id: string | null;
  parent_tool_use_id: string | null;
  session_id: string | null;
  run_id: string | null;
  title: string | null;
  description: string | null;
  executor_ref: string | null;
  result: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  type: string;
  status: string | null;
  payload: string | null;
  created_at: number;
}

export interface CreateTaskInput {
  type: TaskType;
  status?: TaskStatus;
  parentTaskId?: string;
  parentSessionId?: string;
  parentRunId?: string;
  parentToolUseId?: string;
  sessionId?: string;
  runId?: string;
  title?: string;
  description?: string;
  executorRef?: TaskExecutorRef;
  result?: TaskResult;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  sessionId?: string;
  runId?: string;
  title?: string;
  description?: string;
  executorRef?: TaskExecutorRef;
  result?: TaskResult;
  metadata?: Record<string, unknown>;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateTaskInput): TaskRecord {
    const id = newId();
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO tasks (
        id, type, status, parent_task_id, parent_session_id, parent_run_id, parent_tool_use_id,
        session_id, run_id, title, description, executor_ref, result, metadata, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        input.type,
        input.status ?? 'queued',
        input.parentTaskId ?? null,
        input.parentSessionId ?? null,
        input.parentRunId ?? null,
        input.parentToolUseId ?? null,
        input.sessionId ?? null,
        input.runId ?? null,
        input.title ?? null,
        input.description ?? null,
        stringifyJson(input.executorRef),
        stringifyJson(input.result),
        stringifyJson(input.metadata),
        now,
        now
      );
    const created = this.findById(id);
    if (!created) throw new Error(`Failed to create task: ${id}`);
    return created;
  }

  findById(id: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  listByTypeAndStatuses(type: TaskType, statuses: TaskStatus[], sessionId?: string): TaskRecord[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(', ');
    const sql = sessionId
      ? `SELECT * FROM tasks WHERE type = ? AND status IN (${placeholders}) AND session_id = ?`
      : `SELECT * FROM tasks WHERE type = ? AND status IN (${placeholders})`;
    const params = sessionId ? [type, ...statuses, sessionId] : [type, ...statuses];
    const rows = this.db.prepare(sql).all(...params) as TaskRow[];
    return rows.map(row => this.mapTask(row));
  }

  findLatestClaudiaAgentTaskId(sessionId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT id
       FROM tasks
       WHERE session_id = ?
         AND type = 'agent'
         AND json_extract(metadata, '$.initiator') = 'claudia'
       ORDER BY created_at DESC
       LIMIT 1`
      )
      .get(sessionId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  update(id: string, input: UpdateTaskInput): TaskRecord {
    const existing = this.findById(id);
    if (!existing) throw new Error(`Task not found: ${id}`);
    const mergedExecutorRef =
      input.executorRef === undefined
        ? existing.executorRef
        : { ...(existing.executorRef ?? {}), ...input.executorRef };
    const mergedMetadata =
      input.metadata === undefined
        ? existing.metadata
        : { ...(existing.metadata ?? {}), ...input.metadata };
    const now = Date.now();
    const result = this.db
      .prepare(
        `
      UPDATE tasks
      SET status = ?, session_id = ?, run_id = ?, title = ?, description = ?,
          executor_ref = ?, result = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `
      )
      .run(
        input.status ?? existing.status,
        input.sessionId ?? existing.sessionId ?? null,
        input.runId ?? existing.runId ?? null,
        input.title ?? existing.title ?? null,
        input.description ?? existing.description ?? null,
        stringifyJson(mergedExecutorRef),
        stringifyJson(input.result ?? existing.result),
        stringifyJson(mergedMetadata),
        now,
        id
      );
    if (result.changes === 0) throw new Error(`Task not found: ${id}`);
    const updated = this.findById(id);
    if (!updated) throw new Error(`Failed to update task: ${id}`);
    return updated;
  }

  addEvent(input: {
    taskId: string;
    type: TaskEventType;
    status?: TaskStatus;
    payload?: unknown;
  }): TaskEvent {
    const id = newId();
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO task_events (id, task_id, type, status, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, input.taskId, input.type, input.status ?? null, stringifyJson(input.payload), now);
    return {
      id,
      taskId: input.taskId,
      type: input.type,
      status: input.status,
      payload: input.payload,
      createdAt: now,
    };
  }

  listEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC
    `
      )
      .all(taskId) as TaskEventRow[];
    return rows.map(row => this.mapEvent(row));
  }

  private mapTask(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      type: row.type as TaskType,
      status: row.status as TaskStatus,
      parentTaskId: row.parent_task_id ?? undefined,
      parentSessionId: row.parent_session_id ?? undefined,
      parentRunId: row.parent_run_id ?? undefined,
      parentToolUseId: row.parent_tool_use_id ?? undefined,
      sessionId: row.session_id ?? undefined,
      runId: row.run_id ?? undefined,
      title: row.title ?? undefined,
      description: row.description ?? undefined,
      executorRef: parseJson<TaskExecutorRef>(row.executor_ref),
      result: parseJson<TaskResult>(row.result),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEvent(row: TaskEventRow): TaskEvent {
    return {
      id: row.id,
      taskId: row.task_id,
      type: row.type as TaskEventType,
      status: row.status as TaskStatus | undefined,
      payload: parseJson<unknown>(row.payload),
      createdAt: row.created_at,
    };
  }
}
