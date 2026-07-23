import type Database from 'better-sqlite3';
import { AgentProfileRepository } from './repository.js';

export class AgentProfileInUseError extends Error {
  constructor(
    public readonly sessionCount: number,
    public readonly agentId: string
  ) {
    super(
      `AgentProfile ${agentId} is referenced by ${sessionCount} session(s) and cannot be deleted`
    );
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

  /**
   * Delete an agent profile, or convert it to readonly if active sessions reference it.
   *
   * - No active session references it → hard-delete (transfers default if needed).
   * - Active sessions reference it → transition to `readonly` (preserves the FK so
   *   existing sessions keep resolving; the agent becomes non-editable and its
   *   sessions become read-only). Returns `{ archived: true, sessionCount }`.
   *   Archived sessions do NOT count toward the reference total, so once every
   *   active session is archived/deleted, a subsequent call hard-deletes the profile.
   */
  deleteAgentProfile(agentId: string): { archived: boolean; sessionCount: number } {
    const profile = this.repo.findById(agentId);
    if (!profile) throw new AgentProfileNotFoundError(agentId);

    const sessionCount = this.repo.countActiveSessionsReferencing(agentId);

    // No active sessions reference it — hard delete (safe under the FK).
    if (sessionCount === 0) {
      const deleteTx = this.db.transaction(() => {
        if (profile.isDefault) {
          const next = this.db
            .prepare(
              "SELECT id FROM agent_profiles WHERE id != ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
            )
            .get(agentId) as { id?: string } | undefined;
          if (next?.id) {
            this.db
              .prepare('UPDATE agent_profiles SET is_default = 1, updated_at = ? WHERE id = ?')
              .run(Date.now(), next.id);
          }
        }
        // Archived sessions still hold a NOT NULL FK to this profile. They are
        // soft-deleted (hidden from the UI, unrestorable), so reassign them to
        // another active agent when one exists; otherwise hard-delete the archived
        // session rows entirely. Without this the DB-level ON DELETE RESTRICT
        // would reject the profile delete.
        const fallbackAgentId = (
          this.db
            .prepare(
              "SELECT id FROM agent_profiles WHERE id != ? AND status = 'active' ORDER BY is_default DESC, updated_at DESC LIMIT 1"
            )
            .get(agentId) as { id?: string } | undefined
        )?.id;
        if (fallbackAgentId) {
          this.db
            .prepare(
              'UPDATE sessions SET agent_profile_id = ? WHERE agent_profile_id = ? AND archived_at IS NOT NULL'
            )
            .run(fallbackAgentId, agentId);
        } else {
          this.db
            .prepare('DELETE FROM sessions WHERE agent_profile_id = ? AND archived_at IS NOT NULL')
            .run(agentId);
        }
        this.db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(agentId);
      });
      deleteTx();
      return { archived: false, sessionCount: 0 };
    }

    // Active sessions reference it — convert to readonly instead of failing.
    const archiveTx = this.db.transaction(() => {
      this.repo.archive(agentId);
      // A readonly profile can't remain the default; promote another active one.
      if (profile.isDefault) {
        this.db
          .prepare('UPDATE agent_profiles SET is_default = 0, updated_at = ? WHERE id = ?')
          .run(Date.now(), agentId);
        const next = this.db
          .prepare(
            "SELECT id FROM agent_profiles WHERE id != ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
          )
          .get(agentId) as { id?: string } | undefined;
        if (next?.id) {
          this.db
            .prepare('UPDATE agent_profiles SET is_default = 1, updated_at = ? WHERE id = ?')
            .run(Date.now(), next.id);
        }
      }
    });
    archiveTx();
    return { archived: true, sessionCount };
  }
}
