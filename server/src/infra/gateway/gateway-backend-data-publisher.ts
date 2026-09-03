import type {
  BackendResourceEventMessage,
  BackendResourceSnapshotMessage,
} from '@zclaudia/protocol/gateway';
import type { ProjectItem, SessionItem } from '@zclaudia/protocol/zclaudia';
import type { Database as BetterDatabase } from 'better-sqlite3';
import type { ActiveRun } from '../../application/conversation/transport/types.js';
import { resolveSessionRunStatus } from '../../utils/run-state.js';

type ActiveRunsMap = Map<string, ActiveRun>;
type BackendDataMessage = BackendResourceSnapshotMessage | BackendResourceEventMessage;
type SendBackendDataMessage = (message: BackendDataMessage) => void;

export interface GatewayBackendDataPublisherOptions {
  db?: BetterDatabase;
  activeRuns: ActiveRunsMap;
  sendMessage: SendBackendDataMessage;
  /**
   * Protocol v4 dual-publish: when set, every snapshot/event is also
   * published to the RESOURCES_TOPIC (snapshots retained, so cold topic
   * subscribers get current state instantly). Payloads are the exact v3
   * message objects — consumers share parsing with the legacy path.
   */
  publishTopic?: (topic: string, payload: unknown, options?: { retain?: boolean }) => void;
  namespace?: string;
  logger?: Pick<Console, 'log' | 'error'>;
}

/** Topic carrying backend_resource_snapshot / backend_resource_event payloads. */
export const RESOURCES_TOPIC = 'resources';

export interface GatewaySessionRecord {
  id: string;
  name?: string;
  projectId?: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
  archivedAt?: number | null;
  archived_at?: number | null;
  lastRunStatus?: string | null;
  last_run_status?: string | null;
}

/** Column comes back camelCase from the publisher's own query, snake_case from
 *  callers that hand over a raw row. */
function persistedRunStatus(session: GatewaySessionRecord): string | null {
  return session.lastRunStatus ?? session.last_run_status ?? null;
}

export interface GatewayProjectRecord {
  id: string;
  name?: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

export class GatewayBackendDataPublisher {
  private readonly db: BetterDatabase | null;
  private readonly activeRuns: ActiveRunsMap;
  private readonly sendMessage: SendBackendDataMessage;
  private readonly publishTopic?: GatewayBackendDataPublisherOptions['publishTopic'];
  private readonly namespace: string;
  private readonly logger: Pick<Console, 'log' | 'error'>;

  constructor(options: GatewayBackendDataPublisherOptions) {
    this.db = options.db ?? null;
    this.activeRuns = options.activeRuns;
    this.sendMessage = options.sendMessage;
    this.publishTopic = options.publishTopic;
    this.namespace = options.namespace ?? 'zclaudia';
    this.logger = options.logger ?? console;
  }

  /** Send on the legacy path and mirror to the resources topic (v4). */
  private emit(message: BackendDataMessage, retain: boolean): void {
    this.sendMessage(message);
    this.publishTopic?.(RESOURCES_TOPIC, message, retain ? { retain: true } : undefined);
  }

  /**
   * mirrorToTopic: false for targeted republishes (a single late v3
   * subscriber requested it) — the topic already has the retained snapshot,
   * so mirroring would just duplicate traffic to every topic subscriber.
   */
  publishSnapshot(options?: { mirrorToTopic?: boolean }): boolean {
    if (!this.db) return false;
    const db = this.db;
    try {
      const sessionItems = this.loadSessionItems(db);
      const projectItems = this.loadProjectItems(db);
      const msg: BackendResourceSnapshotMessage = {
        type: 'backend_resource_snapshot',
        namespace: this.namespace,
        resources: [
          ...sessionItems.map(item => ({
            resourceType: 'session' as const,
            resourceId: item.sessionId,
            resource: item,
            updatedAt: item.updatedAt,
          })),
          ...projectItems.map(item => ({
            resourceType: 'project' as const,
            resourceId: item.projectId,
            resource: item,
            updatedAt: item.updatedAt,
          })),
        ],
      };

      if (options?.mirrorToTopic === false) this.sendMessage(msg);
      else this.emit(msg, true);
      this.logger.log(
        `[Gateway] Published backend data snapshot: ${sessionItems.length} sessions, ${projectItems.length} projects`
      );
      return true;
    } catch (error) {
      this.logger.error('[Gateway] Failed to publish backend data snapshot:', error);
      return false;
    }
  }

  publishSessionEvent(eventType: 'upsert' | 'remove', session: GatewaySessionRecord): void {
    const isArchived = session.archivedAt != null || session.archived_at != null;
    if (eventType === 'upsert' && !isArchived) {
      const item = this.mapSessionRecord(session);
      const msg: BackendResourceEventMessage = {
        type: 'backend_resource_event',
        op: 'upsert',
        resourceType: 'session',
        resourceId: item.sessionId,
        resource: item,
        updatedAt: item.updatedAt,
      };
      this.emit(msg, false);
      return;
    }

    const msg: BackendResourceEventMessage = {
      type: 'backend_resource_event',
      op: 'remove',
      resourceType: 'session',
      resourceId: session.id,
    };
    this.emit(msg, false);
  }

  broadcastSessionEvent(
    eventType: 'created' | 'updated' | 'deleted',
    session: GatewaySessionRecord
  ): void {
    this.publishSessionEvent(eventType === 'deleted' ? 'remove' : 'upsert', session);
  }

  broadcastProjectEvent(
    eventType: 'created' | 'updated' | 'deleted',
    project: GatewayProjectRecord
  ): void {
    if (eventType === 'deleted') {
      const msg: BackendResourceEventMessage = {
        type: 'backend_resource_event',
        op: 'remove',
        resourceType: 'project',
        resourceId: project.id,
      };
      this.emit(msg, false);
      return;
    }

    const item = this.mapProjectRecord(project);
    const msg: BackendResourceEventMessage = {
      type: 'backend_resource_event',
      op: 'upsert',
      resourceType: 'project',
      resourceId: item.projectId,
      resource: item,
    };
    this.emit(msg, false);
  }

  private loadSessionItems(db: BetterDatabase): SessionItem[] {
    const sessions = db
      .prepare(
        `
        SELECT s.id, s.name, s.project_id as projectId,
               s.created_at as createdAt, s.updated_at as updatedAt,
               s.archived_at as archivedAt, s.last_run_status as lastRunStatus
        FROM sessions s
        LEFT JOIN projects p ON s.project_id = p.id
        WHERE s.archived_at IS NULL
          AND (p.is_internal IS NULL OR p.is_internal = 0)
        ORDER BY s.updated_at DESC
      `
      )
      .all() as Array<Record<string, unknown>>;

    return sessions.map(session => this.mapSessionRow(session));
  }

  private loadProjectItems(db: BetterDatabase): ProjectItem[] {
    try {
      const projects = db
        .prepare(
          `
          SELECT id, name, created_at as createdAt, updated_at as updatedAt
          FROM projects
          WHERE is_internal = 0
          ORDER BY updated_at DESC
        `
        )
        .all() as Array<Record<string, unknown>>;

      return projects.map(project => this.mapProjectRow(project));
    } catch {
      return [];
    }
  }

  private mapSessionRow(session: Record<string, unknown>): SessionItem {
    return this.mapSessionRecord({
      id: session.id as string,
      projectId: (session.projectId as string) || undefined,
      name: (session.name as string) || undefined,
      createdAt: session.createdAt as number,
      updatedAt: session.updatedAt as number,
    });
  }

  private mapProjectRow(project: Record<string, unknown>): ProjectItem {
    return this.mapProjectRecord({
      id: project.id as string,
      name: (project.name as string) || '',
      createdAt: project.createdAt as number,
      updatedAt: project.updatedAt as number,
    });
  }

  private mapSessionRecord(session: GatewaySessionRecord): SessionItem {
    const updatedAt = session.updatedAt ?? session.updated_at ?? Date.now();
    return {
      sessionId: session.id,
      projectId: session.projectId || undefined,
      title: session.name || undefined,
      createdAt: session.createdAt ?? session.created_at ?? Date.now(),
      updatedAt,
      lastMessageAt: updatedAt,
      runStatus: resolveSessionRunStatus(this.activeRuns, session.id, persistedRunStatus(session)),
    };
  }

  private mapProjectRecord(project: GatewayProjectRecord): ProjectItem {
    return {
      projectId: project.id,
      name: project.name || '',
      createdAt: project.createdAt ?? project.created_at ?? Date.now(),
      updatedAt: project.updatedAt ?? project.updated_at ?? Date.now(),
    };
  }
}
