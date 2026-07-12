import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { PluginAgentProfileService } from '../agent-profile-service.js';
import { AgentProfileRepository } from '../../../domains/agent-profiles/repository.js';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';
import { providerRegistry } from '../../../infra/providers/registry.js';

describe('PluginAgentProfileService runtimeType binding', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const llmRepo = new LlmProfileRepository(db);
    llmRepo.create({ name: 'test-llm', providerType: 'anthropic', apiKey: 'sk-test' });
  });

  afterEach(() => {
    db.close();
  });

  it('installs a profile with the contribution runtimeType when the runtime is registered', () => {
    providerRegistry.registerPluginAdapter('com.test.aps', { type: 'aps-rt', async *run() {} });
    try {
      const svc = new PluginAgentProfileService(db);
      const installed = svc.installContributions('com.test.aps', [
        { id: 'x', name: 'X', runtimeType: 'aps-rt' },
      ]);
      expect(installed).toBe(1);

      const row = new AgentProfileRepository(db).findByPluginProfile('com.test.aps', 'x');
      expect(row).toBeDefined();
      expect(row!.runtimeType).toBe('aps-rt');
    } finally {
      providerRegistry.removePluginAdapters('com.test.aps');
    }
  });

  it('falls back to zclaudia when contribution omits runtimeType', () => {
    const svc = new PluginAgentProfileService(db);
    const installed = svc.installContributions('com.test.aps-default', [{ id: 'y', name: 'Y' }]);
    expect(installed).toBe(1);

    const row = new AgentProfileRepository(db).findByPluginProfile('com.test.aps-default', 'y');
    expect(row).toBeDefined();
    expect(row!.runtimeType).toBe('zclaudia');
  });

  it('falls back to zclaudia when contribution declares an unregistered runtimeType', () => {
    const svc = new PluginAgentProfileService(db);
    const installed = svc.installContributions('com.test.aps-invalid', [
      { id: 'z', name: 'Z', runtimeType: 'not-a-real-runtime' },
    ]);
    expect(installed).toBe(1);

    const row = new AgentProfileRepository(db).findByPluginProfile('com.test.aps-invalid', 'z');
    expect(row).toBeDefined();
    expect(row!.runtimeType).toBe('zclaudia');
  });
});
