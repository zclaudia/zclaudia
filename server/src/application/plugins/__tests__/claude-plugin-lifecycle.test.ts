import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { providerRegistry } from '../../../infra/providers/registry.js';
import { runtimeDescriptorRegistry } from '../../../infra/providers/runtime-descriptor-registry.js';
import {
  registerAgentRuntimeContributions,
  unregisterAgentRuntimeContributions,
} from '../agent-runtime-contributions.js';
import { PluginAgentProfileService } from '../agent-profile-service.js';
import { AgentProfileRepository } from '../../../domains/agent-profiles/repository.js';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';
import type { AgentRuntimeContribution } from '@zclaudia/shared/providers';

const PLUGIN = 'com.zclaudia.claude';

// Minimal valid AgentRuntimeDescriptor mirroring plugins/claude/plugin.json's
// contributes.agentRuntimes[0] — only the fields required by the type, not the
// full 13-capability manifest.
const claudeContribution: AgentRuntimeContribution = {
  type: 'claude',
  label: 'Claude',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: true },
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  manifest: {
    id: 'claude',
    name: 'Claude',
    version: '1.0.0',
    apiVersion: 'pcp/v1',
    providerType: 'claude',
    runtime: 'cli',
    capabilities: [],
  },
};

describe('claude plugin lifecycle', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const llmRepo = new LlmProfileRepository(db);
    llmRepo.create({ name: 'test-llm', providerType: 'anthropic', apiKey: 'sk-test' });
  });

  afterEach(() => {
    // Belt-and-suspenders cleanup in case an assertion fails mid-test and the
    // teardown lines never run — don't leak claude registrations into other tests.
    unregisterAgentRuntimeContributions(PLUGIN);
    providerRegistry.removePluginAdapters(PLUGIN);
    db.close();
  });

  it('installs a claude-runtime profile on activate and removes it on deactivate', () => {
    registerAgentRuntimeContributions(PLUGIN, [claudeContribution]);
    providerRegistry.registerPluginAdapter(PLUGIN, { type: 'claude', async *run() {} });

    const svc = new PluginAgentProfileService(db);
    svc.installContributions(PLUGIN, [{ id: 'claude-default', name: 'Claude', runtimeType: 'claude' }]);
    const repo = new AgentProfileRepository(db);
    expect(repo.findByPluginProfile(PLUGIN, 'claude-default')?.runtimeType).toBe('claude');

    // deactivate teardown
    unregisterAgentRuntimeContributions(PLUGIN);
    providerRegistry.removePluginAdapters(PLUGIN);
    repo.deleteByPlugin(PLUGIN);

    expect(repo.findByPluginProfile(PLUGIN, 'claude-default')).toBeUndefined();
    expect(providerRegistry.hasType('claude')).toBe(false);
    expect(runtimeDescriptorRegistry.get('claude')).toBeUndefined();
  });
});
