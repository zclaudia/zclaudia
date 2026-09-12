import type Database from 'better-sqlite3';
import { LlmProfileRepository } from './repository.js';

export class LlmProfileNotFoundError extends Error {
  constructor(llmProfileId: string) {
    super(`LlmProfile not found: ${llmProfileId}`);
    this.name = 'LlmProfileNotFoundError';
  }
}

export class LlmProfileInUseError extends Error {
  constructor(
    public readonly agentCount: number,
    public readonly llmProfileId: string,
    public readonly sessionBindingCount = 0
  ) {
    super(
      `LlmProfile ${llmProfileId} is referenced by ${agentCount} agent profile(s)` +
        (sessionBindingCount > 0 ? ` and ${sessionBindingCount} session runtime binding(s)` : '') +
        ' and cannot be deleted'
    );
    this.name = 'LlmProfileInUseError';
  }
}

export class LlmProfileDeletionService {
  private readonly repo: LlmProfileRepository;

  constructor(private readonly db: Database.Database) {
    this.repo = new LlmProfileRepository(db);
  }

  deleteLlmProfile(llmProfileId: string): void {
    const existing = this.repo.findById(llmProfileId);
    if (!existing) {
      throw new LlmProfileNotFoundError(llmProfileId);
    }

    // Pre-check: agent_profiles.llm_profile_id and
    // session_runtime_bindings.llm_profile_id are FK RESTRICT, so any reference
    // would otherwise surface as a raw SQLITE_CONSTRAINT_FOREIGNKEY (HTTP 500).
    // Return a structured 409 from the route handler instead. Session runtime
    // bindings count as references too — deleting a profile bound to existing
    // sessions would orphan those sessions' run identities.
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM agent_profiles WHERE llm_profile_id = ?')
      .get(llmProfileId) as { n: number } | undefined;
    const agentCount = row?.n ?? 0;
    let sessionBindingCount = 0;
    if (this.hasTable('session_runtime_bindings')) {
      const bindingRow = this.db
        .prepare('SELECT COUNT(*) AS n FROM session_runtime_bindings WHERE llm_profile_id = ?')
        .get(llmProfileId) as { n: number } | undefined;
      sessionBindingCount = bindingRow?.n ?? 0;
    }
    if (agentCount > 0 || sessionBindingCount > 0) {
      throw new LlmProfileInUseError(agentCount, llmProfileId, sessionBindingCount);
    }

    const deleteLlmProfileTx = this.db.transaction(() => {
      this.clearLlmProfileReferences(llmProfileId);

      if (!this.repo.delete(llmProfileId)) {
        throw new LlmProfileNotFoundError(llmProfileId);
      }

      if (!existing.isDefault) {
        return;
      }

      const replacement = this.findReplacementLlmProfileId();
      if (replacement) {
        this.repo.setDefault(replacement);
      }
    });

    deleteLlmProfileTx();
  }

  private clearLlmProfileReferences(llmProfileId: string): void {
    // projects.default_agent_profile_id no longer references llm_profiles (it now
    // references agent_profiles); sessions no longer carry a direct llm_profile_id
    // either. agent_profiles.llm_profile_id is FK RESTRICT, so AgentProfileRepository /
    // route handler is responsible for cascade behavior when an LlmProfile is
    // referenced by an agent.

    if (this.hasColumn('projects', 'review_llm_profile_id')) {
      this.db
        .prepare('UPDATE projects SET review_llm_profile_id = NULL WHERE review_llm_profile_id = ?')
        .run(llmProfileId);
    }

    if (this.hasColumn('agent_config', 'llm_profile_id')) {
      this.db
        .prepare('UPDATE agent_config SET llm_profile_id = NULL WHERE llm_profile_id = ?')
        .run(llmProfileId);
    }
  }

  private hasColumn(table: string, column: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === column);
  }

  private hasTable(table: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    return !!row;
  }

  private findReplacementLlmProfileId(): string | null {
    const replacement = this.db
      .prepare(
        `
      SELECT id FROM llm_profiles
      ORDER BY created_at ASC
      LIMIT 1
    `
      )
      .get() as { id: string } | undefined;

    return replacement?.id ?? null;
  }
}
