import type Database from 'better-sqlite3';
import { LlmProfileRepository } from './repository.js';

export class LlmProfileNotFoundError extends Error {
  constructor(llmProfileId: string) {
    super(`LlmProfile not found: ${llmProfileId}`);
    this.name = 'LlmProfileNotFoundError';
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
    this.db.prepare('UPDATE projects SET llm_profile_id = NULL WHERE llm_profile_id = ?').run(llmProfileId);
    this.db.prepare('UPDATE sessions SET llm_profile_id = NULL WHERE llm_profile_id = ?').run(llmProfileId);

    if (this.hasColumn('projects', 'review_llm_profile_id')) {
      this.db.prepare('UPDATE projects SET review_llm_profile_id = NULL WHERE review_llm_profile_id = ?').run(llmProfileId);
    }

    if (this.hasColumn('agent_config', 'llm_profile_id')) {
      this.db.prepare('UPDATE agent_config SET llm_profile_id = NULL WHERE llm_profile_id = ?').run(llmProfileId);
    }
  }

  private hasColumn(table: string, column: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return columns.some((col) => col.name === column);
  }

  private findReplacementLlmProfileId(): string | null {
    const replacement = this.db.prepare(`
      SELECT id FROM llm_profiles
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as { id: string } | undefined;

    return replacement?.id ?? null;
  }
}
