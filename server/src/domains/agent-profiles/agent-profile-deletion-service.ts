import type Database from 'better-sqlite3';
import { AgentProfileRepository } from './repository.js';

export class AgentProfileInUseError extends Error {
  constructor(
    public readonly sessionCount: number,
    public readonly agentId: string,
  ) {
    super(`AgentProfile ${agentId} is referenced by ${sessionCount} session(s) and cannot be deleted`);
    this.name = 'AgentProfileInUseError';
  }
}

export class AgentProfileNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`AgentProfile not found: ${agentId}`);
    this.name = 'AgentProfileNotFoundError';
  }
}

export class AgentProfileDeletionService {
  private readonly repo: AgentProfileRepository;

  constructor(private readonly db: Database.Database) {
    this.repo = new AgentProfileRepository(db);
  }

  deleteAgentProfile(agentId: string): void {
    const profile = this.repo.findById(agentId);
    if (!profile) throw new AgentProfileNotFoundError(agentId);

    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE agent_profile_id = ?')
      .get(agentId) as { n: number } | undefined;
    const sessionCount = row?.n ?? 0;
    if (sessionCount > 0) throw new AgentProfileInUseError(sessionCount, agentId);

    const deleteTx = this.db.transaction(() => {
      if (profile.isDefault) {
        const next = this.db
          .prepare('SELECT id FROM agent_profiles WHERE id != ? ORDER BY updated_at DESC LIMIT 1')
          .get(agentId) as { id?: string } | undefined;
        if (next?.id) {
          this.db
            .prepare('UPDATE agent_profiles SET is_default = 1, updated_at = ? WHERE id = ?')
            .run(Date.now(), next.id);
        }
      }
      this.db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(agentId);
    });

    deleteTx();
  }
}
