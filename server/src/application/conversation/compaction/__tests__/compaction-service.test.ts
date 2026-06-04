import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { SessionCompactionRepository } from '../../../../domains/sessions/compaction-repository.js';
import { maybeCompact, forceCompact } from '../compaction-service.js';

// Mock pi generateSummary to avoid hitting a real LLM. The other pure helpers
// (shouldCompact / estimateContextTokens / findCutPoint / DEFAULT_COMPACTION_SETTINGS)
// stay real so the service tests exercise pi's actual cut-point and threshold logic.
vi.mock('@earendil-works/pi-agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-agent-core')>();
  return {
    ...actual,
    generateSummary: vi.fn(async () => ({ ok: true, value: 'MOCKED-SUMMARY' })),
  };
});

// Mock buildModel — compaction-service uses it but a stub model is fine for
// tests since generateSummary itself is also mocked.
vi.mock('../../../../infra/providers/pi-runtime/build-model.js', () => ({
  buildModel: vi.fn(() => ({
    model: {
      id: 'fake',
      name: 'fake',
      provider: 'anthropic',
      api: 'anthropic-messages',
      reasoning: false,
      maxTokens: 8192,
      contextWindow: 200_000,
    },
  })),
}));

interface SeedResult {
  agentProfile: AgentProfileConfig;
  llmProfile: LlmProfileConfig;
}

function seedSession(db: Database.Database, messageCount: number): SeedResult {
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('lp1', 'p', 'anthropic', 'fake-key', 0, 0);
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ap1', 'a', 'lp1', 'claude-sonnet-4-6', '', '[]', 0, 0);
  db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'P', 'code', 0, 0);
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('s1', 'p1', 'ap1', 0, 0);
  for (let i = 0; i < messageCount; i++) {
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(`m${i + 1}`, 's1', i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(2000), i * 1000, i + 1);
  }
  return {
    agentProfile: {
      id: 'ap1', name: 'a', llmProfileId: 'lp1', model: 'claude-sonnet-4-6',
      systemPrompt: '', enabledTools: [],
      createdAt: 0, updatedAt: 0,
    },
    llmProfile: {
      id: 'lp1', name: 'p', providerType: 'anthropic', apiKey: 'fake-key',
      createdAt: 0, updatedAt: 0,
    },
  };
}

describe('compaction-service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    vi.clearAllMocks();
  });

  it('maybeCompact returns below_threshold when not enough tokens', async () => {
    const { agentProfile, llmProfile } = seedSession(db, 2);
    const result = await maybeCompact({
      db, sessionId: 's1', agentProfile, llmProfile,
      source: 'auto',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('below_threshold');
  });

  it('maybeCompact compacts when above threshold (small contextWindow override)', async () => {
    const seed = seedSession(db, 100);
    // Force threshold: 100-token window, default reserveTokens 16384 → threshold trivially exceeded.
    const ap = { ...seed.agentProfile, contextWindow: 100 };
    const result = await maybeCompact({
      db, sessionId: 's1', agentProfile: ap, llmProfile: seed.llmProfile,
      source: 'auto',
    });
    expect(result.compacted).toBe(true);
    expect(result.compactionId).toBeTruthy();
    const created = new SessionCompactionRepository(db).getLatest('s1')!;
    expect(created.summary).toBe('MOCKED-SUMMARY');
    expect(created.source).toBe('auto');
  });

  it('forceCompact ignores threshold (long conversation)', async () => {
    // Seed enough messages so total tokens exceed DEFAULT keepRecentTokens (20000).
    // Each fixture message is ~500 tokens; 100 messages ⇒ ~50k tokens total.
    const { agentProfile, llmProfile } = seedSession(db, 100);
    const result = await forceCompact({
      db, sessionId: 's1', agentProfile, llmProfile,
      source: 'manual',
      customInstructions: 'focus on auth',
    });
    expect(result.compacted).toBe(true);
    const created = new SessionCompactionRepository(db).getLatest('s1')!;
    expect(created.source).toBe('manual');
    expect(created.customInstructions).toBe('focus on auth');
  });

  it('forceCompact returns no_cut_point on short conversations (recent budget covers all)', async () => {
    const { agentProfile, llmProfile } = seedSession(db, 4);
    const result = await forceCompact({
      db, sessionId: 's1', agentProfile, llmProfile, source: 'manual',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('no_cut_point');
  });

  it('returns no_messages when session has no messages', async () => {
    db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('lp1', 'p', 'anthropic', 0, 0);
    db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('ap1', 'a', 'lp1', 'm', '', '[]', 0, 0);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('p1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'p1', 'ap1', 0, 0);
    const ap: AgentProfileConfig = {
      id: 'ap1', name: 'a', llmProfileId: 'lp1', model: 'm', systemPrompt: '',
      enabledTools: [], createdAt: 0, updatedAt: 0,
    };
    const lp: LlmProfileConfig = {
      id: 'lp1', name: 'p', providerType: 'anthropic',
      createdAt: 0, updatedAt: 0,
    };
    const result = await forceCompact({
      db, sessionId: 's1', agentProfile: ap, llmProfile: lp, source: 'manual',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('no_messages');
  });

  it('returns error reason when generateSummary fails', async () => {
    const { generateSummary } = await import('@earendil-works/pi-agent-core');
    vi.mocked(generateSummary).mockResolvedValueOnce({
      ok: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'llm timeout' } as any,
    });
    const seed = seedSession(db, 100);
    const ap = { ...seed.agentProfile, contextWindow: 100 };
    const result = await forceCompact({
      db, sessionId: 's1', agentProfile: ap, llmProfile: seed.llmProfile, source: 'manual',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toMatch(/^error:/);
  });

  it('stores correct boundary id (matches a real message id)', async () => {
    // Long enough conversation that findCutPoint finds a meaningful boundary.
    const { agentProfile, llmProfile } = seedSession(db, 100);
    const result = await forceCompact({
      db, sessionId: 's1', agentProfile, llmProfile, source: 'manual',
    });
    expect(result.compacted).toBe(true);
    const created = new SessionCompactionRepository(db).getLatest('s1')!;
    expect(created.firstKeptMessageId).toMatch(/^m\d+$/);
  });
});
