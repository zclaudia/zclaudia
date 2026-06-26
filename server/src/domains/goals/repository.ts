import type Database from 'better-sqlite3';
import { newId } from '../../utils/uuid.js';
import type { Goal, CreateGoalInput, UpdateGoalInput } from './types.js';

interface GoalRow {
  id: string;
  session_id: string;
  objective_text: string;
  status: string;
  token_budget: number;
  tokens_used: number;
  max_turns: number;
  turns_used: number;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  last_verdict_reason: string | null;
}

function mapRow(row: GoalRow): Goal {
  return {
    id: row.id,
    sessionId: row.session_id,
    objective: row.objective_text,
    status: row.status as Goal['status'],
    tokenBudget: row.token_budget,
    tokensUsed: row.tokens_used,
    maxTurns: row.max_turns,
    turnsUsed: row.turns_used,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    lastVerdictReason: row.last_verdict_reason,
  };
}

export class GoalRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateGoalInput): Goal {
    const id = newId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_goals
         (id, session_id, objective_text, status, token_budget, tokens_used, max_turns, turns_used, started_at)
         VALUES (?, ?, ?, 'active', ?, 0, ?, 0, ?)`,
      )
      .run(id, input.sessionId, input.objective, input.tokenBudget, input.maxTurns, now);
    const created = this.findById(id);
    if (!created) throw new Error(`Failed to create goal: ${id}`);
    return created;
  }

  findById(id: string): Goal | null {
    const row = this.db
      .prepare('SELECT * FROM session_goals WHERE id = ?')
      .get(id) as GoalRow | undefined;
    return row ? mapRow(row) : null;
  }

  findActive(sessionId: string): Goal | null {
    const row = this.db
      .prepare(
        `SELECT * FROM session_goals
         WHERE session_id = ? AND status IN ('active', 'paused')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(sessionId) as GoalRow | undefined;
    return row ? mapRow(row) : null;
  }

  listActive(): Goal[] {
    const rows = this.db
      .prepare(`SELECT * FROM session_goals WHERE status = 'active'`)
      .all() as GoalRow[];
    return rows.map(mapRow);
  }

  update(id: string, input: UpdateGoalInput): Goal {
    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Array<[keyof UpdateGoalInput, string]> = [
      ['status', 'status'],
      ['objective', 'objective_text'],
      ['tokenBudget', 'token_budget'],
      ['tokensUsed', 'tokens_used'],
      ['maxTurns', 'max_turns'],
      ['turnsUsed', 'turns_used'],
      ['endedAt', 'ended_at'],
      ['endReason', 'end_reason'],
      ['lastVerdictReason', 'last_verdict_reason'],
    ];
    for (const [key, column] of map) {
      if (input[key] !== undefined) {
        fields.push(`${column} = ?`);
        params.push(input[key]);
      }
    }
    if (fields.length === 0) {
      const goal = this.findById(id);
      if (!goal) throw new Error(`Goal not found: ${id}`);
      return goal;
    }
    params.push(id);
    const result = this.db
      .prepare(`UPDATE session_goals SET ${fields.join(', ')} WHERE id = ?`)
      .run(...params);
    if (result.changes === 0) throw new Error(`Goal not found: ${id}`);
    const updated = this.findById(id);
    if (!updated) throw new Error(`Goal not found after update: ${id}`);
    return updated;
  }
}
