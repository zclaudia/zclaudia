import type Database from 'better-sqlite3';
import { newId } from '../../utils/uuid.js';
import type {
  AgentLoopContext,
  AgentLoopContextPolicy,
  AgentLoopEvent,
  AgentLoopEventKind,
  AgentLoopOwner,
} from './types.js';

interface ClockDeps {
  now?: () => number;
}

export interface ResolveAgentLoopContextArgs {
  owner: AgentLoopOwner;
  policy: AgentLoopContextPolicy;
  key?: string;
  maxEvents?: number;
}

export interface ResolvedAgentLoopContext {
  contextId: string;
  loadedEvents: AgentLoopEvent[];
}

export class AgentLoopContextRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly deps: ClockDeps = {}
  ) {}

  resolveContextForRun(args: ResolveAgentLoopContextArgs): ResolvedAgentLoopContext {
    const contextKey = this.resolveContextKey(args);
    const reusable = args.policy === 'workflow-thread';
    const existing = reusable
      ? this.findContext(args.owner.type, args.owner.id, contextKey)
      : undefined;
    const context = existing ?? this.createContext(args.owner, args.policy, contextKey);
    const loadedEvents = reusable ? this.loadEvents(context.id, args.maxEvents ?? 50) : [];
    return { contextId: context.id, loadedEvents };
  }

  appendEvent(args: {
    contextId: string;
    kind: AgentLoopEventKind;
    payload: Record<string, unknown>;
  }): AgentLoopEvent {
    const now = this.now();
    const event: AgentLoopEvent = {
      id: newId(),
      contextId: args.contextId,
      kind: args.kind,
      payload: args.payload,
      createdAt: now,
    };
    this.db
      .prepare(
        `
      INSERT INTO agent_loop_events (id, context_id, kind, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(event.id, event.contextId, event.kind, JSON.stringify(event.payload), event.createdAt);
    this.db
      .prepare('UPDATE agent_loop_contexts SET updated_at = ? WHERE id = ?')
      .run(now, args.contextId);
    return event;
  }

  loadEvents(contextId: string, limit = 50): AgentLoopEvent[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, context_id, kind, payload, created_at
      FROM (
        SELECT rowid AS event_rowid, id, context_id, kind, payload, created_at
        FROM agent_loop_events
        WHERE context_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      )
      ORDER BY created_at ASC, event_rowid ASC
    `
      )
      .all(contextId, limit) as Array<{
      id: string;
      context_id: string;
      kind: AgentLoopEventKind;
      payload: string;
      created_at: number;
    }>;
    return rows.map(row => ({
      id: row.id,
      contextId: row.context_id,
      kind: row.kind,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  private resolveContextKey(args: ResolveAgentLoopContextArgs): string {
    if (args.policy === 'workflow-thread') return args.key ?? 'default';
    if (args.policy === 'workflow-artifacts') return `trace:workflow-artifacts:${newId()}`;
    if (args.policy === 'step-local') return `trace:step-local:${args.key ?? newId()}:${newId()}`;
    return `trace:none:${newId()}`;
  }

  private findContext(
    ownerType: string,
    ownerId: string,
    contextKey: string
  ): AgentLoopContext | undefined {
    const row = this.db
      .prepare(
        `
      SELECT id, owner_type, owner_id, context_key, policy, summary, created_at, updated_at
      FROM agent_loop_contexts
      WHERE owner_type = ? AND owner_id = ? AND context_key = ?
    `
      )
      .get(ownerType, ownerId, contextKey) as Record<string, unknown> | undefined;
    return row ? this.mapContext(row) : undefined;
  }

  private createContext(
    owner: AgentLoopOwner,
    policy: AgentLoopContextPolicy,
    contextKey: string
  ): AgentLoopContext {
    const now = this.now();
    const context: AgentLoopContext = {
      id: newId(),
      ownerType: owner.type,
      ownerId: owner.id,
      contextKey,
      policy,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `
      INSERT INTO agent_loop_contexts (id, owner_type, owner_id, context_key, policy, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        context.id,
        context.ownerType,
        context.ownerId,
        context.contextKey,
        context.policy,
        null,
        now,
        now
      );
    return context;
  }

  private mapContext(row: Record<string, unknown>): AgentLoopContext {
    return {
      id: String(row.id),
      ownerType: String(row.owner_type),
      ownerId: String(row.owner_id),
      contextKey: String(row.context_key),
      policy: String(row.policy),
      summary: typeof row.summary === 'string' ? row.summary : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
