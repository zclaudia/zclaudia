import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import {
  listCompactions,
  type SessionCompaction,
} from '../../../../domains/sessions/compaction-tree-read.js';
import { appendMessagesToTree } from '../../../../infra/providers/pi-runtime/session-tree/write-path.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  maybeCompact,
  forceCompact,
  compactForOverflow,
  waitForPendingCompaction,
} from '../compaction-service.js';
import { compactionCircuitBreaker } from '../circuit-breaker.js';
import * as pi from '@earendil-works/pi-agent-core';

/** Latest compaction (tree is the source of truth; entries are oldest-first). */
function latestCompaction(db: Database.Database, sessionId: string): SessionCompaction | null {
  const all = listCompactions(db, sessionId);
  return all.length ? all[all.length - 1] : null;
}

/** Alternating user/assistant messages, ~500 tokens each. */
function treeMessages(count: number): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(2000),
    } as AgentMessage);
  }
  return msgs;
}

// Mock pi generateSummary to avoid hitting a real LLM. The other pure helpers
// (shouldCompact / estimateContextTokens / findCutPoint / DEFAULT_COMPACTION_SETTINGS)
// stay real so the service tests exercise pi's actual cut-point and threshold logic.
vi.mock('@earendil-works/pi-agent-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-agent-core')>();
  return {
    ...actual,
    generateSummary: vi.fn(async () => ({ ok: true, value: 'MOCKED-SUMMARY' })),
  };
});

// Mock buildModel — compaction-service uses it but a stub model is fine for
// tests since generateSummary itself is also mocked. modelEntryFor stays real
// (pure lookup) so the service resolves the per-model entry as in production.
vi.mock('../../../../infra/providers/pi-runtime/build-model.js', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../../infra/providers/pi-runtime/build-model.js')
  >()),
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
  db.prepare(
    `INSERT INTO llm_profiles (id, name, provider_type, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('lp1', 'p', 'anthropic', 'fake-key', 0, 0);
  db.prepare(
    `INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ap1', 'a', 'lp1', 'claude-sonnet-4-6', '', '[]', 0, 0);
  db.prepare(
    `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run('p1', 'P', 'code', 0, 0);
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run('s1', 'p1', 'ap1', 0, 0);
  // Route C: compaction reads the session tree, not the messages table.
  appendMessagesToTree(db, 's1', treeMessages(messageCount));
  return {
    agentProfile: {
      id: 'ap1',
      name: 'a',
      llmProfileId: 'lp1',
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      enabledTools: [],
      createdAt: 0,
      updatedAt: 0,
    },
    llmProfile: {
      id: 'lp1',
      name: 'p',
      providerType: 'anthropic',
      apiKey: 'fake-key',
      createdAt: 0,
      updatedAt: 0,
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
      db,
      sessionId: 's1',
      agentProfile,
      llmProfile,
      source: 'auto',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('below_threshold');
  });

  it('maybeCompact compacts when above threshold (small contextWindow override)', async () => {
    const seed = seedSession(db, 100);
    // Force threshold: 100-token window, default reserveTokens 16384 → threshold trivially exceeded.
    // Override lives on the LLM profile's models[] entry (the agent profile
    // no longer carries a contextWindow field as of migration 003).
    const lp = {
      ...seed.llmProfile,
      models: [{ modelId: seed.agentProfile.model, contextWindow: 100 }],
    };
    const result = await maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'auto',
    });
    expect(result.compacted).toBe(true);
    expect(result.compactionId).toBeTruthy();
    const created = latestCompaction(db, 's1')!;
    expect(created.summary).toBe('MOCKED-SUMMARY');
    expect(created.source).toBe('auto');
  });

  it('forceCompact ignores threshold (long conversation)', async () => {
    // Seed enough messages so total tokens exceed DEFAULT keepRecentTokens (20000).
    // Each fixture message is ~500 tokens; 100 messages ⇒ ~50k tokens total.
    const { agentProfile, llmProfile } = seedSession(db, 100);
    const result = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile,
      llmProfile,
      source: 'manual',
      customInstructions: 'focus on auth',
    });
    expect(result.compacted).toBe(true);
    const created = latestCompaction(db, 's1')!;
    expect(created.source).toBe('manual');
    expect(created.customInstructions).toBe('focus on auth');
  });

  it('serializes compaction entry points for the same session', async () => {
    const { generateSummary } = await import('@earendil-works/pi-agent-core');
    const seed = seedSession(db, 100);
    let releaseFirst!: (value: { ok: true; value: string }) => void;
    vi.mocked(generateSummary).mockImplementationOnce(
      () => new Promise(resolve => (releaseFirst = resolve))
    );

    const first = forceCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: seed.llmProfile,
      source: 'manual',
    });
    await vi.waitFor(() => expect(generateSummary).toHaveBeenCalledTimes(1));

    const second = maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: seed.llmProfile,
      source: 'preflight',
    });
    await Promise.resolve();
    expect(generateSummary).toHaveBeenCalledTimes(1);
    let queueReleased = false;
    const waitForQueue = waitForPendingCompaction('s1').then(() => {
      queueReleased = true;
    });
    await Promise.resolve();
    expect(queueReleased).toBe(false);

    releaseFirst({ ok: true, value: 'SERIALIZED-SUMMARY' });
    await first;
    await second;
    await waitForQueue;
    expect(queueReleased).toBe(true);
  });

  it('forceCompact returns no_cut_point on short conversations (recent budget covers all)', async () => {
    const { agentProfile, llmProfile } = seedSession(db, 4);
    const result = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile,
      llmProfile,
      source: 'manual',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('no_cut_point');
  });

  it('returns no_messages when session has no messages', async () => {
    db.prepare(
      `INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('lp1', 'p', 'anthropic', 0, 0);
    db.prepare(
      `INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('ap1', 'a', 'lp1', 'm', '', '[]', 0, 0);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('p1', 'P', 'code', 0, 0);
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('s1', 'p1', 'ap1', 0, 0);
    const ap: AgentProfileConfig = {
      id: 'ap1',
      name: 'a',
      llmProfileId: 'lp1',
      model: 'm',
      systemPrompt: '',
      enabledTools: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const lp: LlmProfileConfig = {
      id: 'lp1',
      name: 'p',
      providerType: 'anthropic',
      createdAt: 0,
      updatedAt: 0,
    };
    const result = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile: ap,
      llmProfile: lp,
      source: 'manual',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('no_messages');
  });

  it('returns error reason when generateSummary fails', async () => {
    const { generateSummary } = await import('@earendil-works/pi-agent-core');
    vi.mocked(generateSummary).mockResolvedValueOnce({
      ok: false,

      error: { message: 'llm timeout' } as any,
    });
    const seed = seedSession(db, 100);
    const lp = {
      ...seed.llmProfile,
      models: [{ modelId: seed.agentProfile.model, contextWindow: 100 }],
    };
    const result = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'manual',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toMatch(/^error:/);
  });

  it('passes the per-model entry to buildModel so overrides and dialect apply to summarization', async () => {
    const { buildModel } = await import('../../../../infra/providers/pi-runtime/build-model.js');
    const seed = seedSession(db, 100);
    const entry = {
      modelId: seed.agentProfile.model,
      contextWindow: 100,
      dialect: 'deepseek' as const,
    };
    const lp = { ...seed.llmProfile, models: [entry] };
    const result = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'manual',
    });
    expect(result.compacted).toBe(true);
    expect(vi.mocked(buildModel)).toHaveBeenCalledWith(lp, seed.agentProfile.model, entry);
  });

  it('stores a boundary id that points at a real tree entry', async () => {
    // Long enough conversation that prepareCompaction finds a meaningful boundary.
    const { agentProfile, llmProfile } = seedSession(db, 100);
    const result = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile,
      llmProfile,
      source: 'manual',
    });
    expect(result.compacted).toBe(true);
    const created = latestCompaction(db, 's1')!;
    // firstKeptMessageId is now a tree entry id — assert it resolves to a real message entry.
    expect(created.firstKeptMessageId).toBeTruthy();
    const entry = db
      .prepare(`SELECT type FROM session_entries WHERE session_id = 's1' AND id = ?`)
      .get(created.firstKeptMessageId) as { type: string } | undefined;
    expect(entry?.type).toBe('message');
  });
});

describe('maybeCompact circuit breaker', () => {
  beforeEach(() => {
    compactionCircuitBreaker.clear();
    vi.mocked(pi.generateSummary).mockReset();
  });

  it('classifies a generateSummary failure as outcome=failed and records it', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const seed = seedSession(db, 100);
    const lp = {
      ...seed.llmProfile,
      models: [{ modelId: seed.agentProfile.model, contextWindow: 100 }],
    };
    vi.mocked(pi.generateSummary).mockResolvedValue({
      ok: false,
      error: new Error('prompt_too_long'),
    } as any);

    const out = await maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'auto',
      now: 1000,
    });
    expect(out.outcome).toBe('failed');
    expect(out.compacted).toBe(false);
    expect(compactionCircuitBreaker.snapshot('s1').consecutiveFailures).toBe(1);
  });

  it('skips with circuit_open after maxFailures without calling generateSummary', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const seed = seedSession(db, 100);
    const lp = {
      ...seed.llmProfile,
      models: [{ modelId: seed.agentProfile.model, contextWindow: 100 }],
    };
    vi.mocked(pi.generateSummary).mockResolvedValue({ ok: false, error: new Error('x') } as any);

    for (let i = 0; i < 3; i++) {
      await maybeCompact({
        db,
        sessionId: 's1',
        agentProfile: seed.agentProfile,
        llmProfile: lp,
        source: 'auto',
        now: 1000,
      });
    }
    const callsBefore = vi.mocked(pi.generateSummary).mock.calls.length;
    const out = await maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'auto',
      now: 1001,
    });
    expect(out.outcome).toBe('skipped');
    expect(out.reason).toBe('circuit_open');
    expect(vi.mocked(pi.generateSummary).mock.calls.length).toBe(callsBefore);
  });

  it('a success clears the failure count', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const seed = seedSession(db, 100);
    const lp = {
      ...seed.llmProfile,
      models: [{ modelId: seed.agentProfile.model, contextWindow: 100 }],
    };
    vi.mocked(pi.generateSummary).mockResolvedValueOnce({
      ok: false,
      error: new Error('x'),
    } as any);
    await maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'auto',
      now: 1000,
    });
    expect(compactionCircuitBreaker.snapshot('s1').consecutiveFailures).toBe(1);
    vi.mocked(pi.generateSummary).mockResolvedValue({ ok: true, value: 'SUMMARY' } as any);
    const out = await maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'auto',
      now: 1001,
    });
    expect(out.outcome).toBe('compacted');
    expect(compactionCircuitBreaker.snapshot('s1').consecutiveFailures).toBe(0);
  });

  it('an aborted compaction does not count as a failure', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const seed = seedSession(db, 100);
    const lp = {
      ...seed.llmProfile,
      models: [{ modelId: seed.agentProfile.model, contextWindow: 100 }],
    };
    const ac = new AbortController();
    ac.abort();
    vi.mocked(pi.generateSummary).mockResolvedValue({
      ok: false,
      error: new Error('aborted'),
    } as any);
    const out = await maybeCompact({
      db,
      sessionId: 's1',
      agentProfile: seed.agentProfile,
      llmProfile: lp,
      source: 'auto',
      signal: ac.signal,
      now: 1000,
    });
    expect(out.outcome).toBe('aborted');
    expect(compactionCircuitBreaker.snapshot('s1').consecutiveFailures).toBe(0);
  });

  it('forceCompact success resets the breaker', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const { agentProfile, llmProfile } = seedSession(db, 100);
    compactionCircuitBreaker.recordFailure('s1', 0);
    compactionCircuitBreaker.recordFailure('s1', 0);
    compactionCircuitBreaker.recordFailure('s1', 0);
    vi.mocked(pi.generateSummary).mockResolvedValue({ ok: true, value: 'SUMMARY' } as any);
    const out = await forceCompact({
      db,
      sessionId: 's1',
      agentProfile,
      llmProfile,
      source: 'manual',
    });
    expect(out.outcome).toBe('compacted');
    expect(compactionCircuitBreaker.size()).toBe(0);
  });
});

describe('compactForOverflow', () => {
  beforeEach(() => {
    compactionCircuitBreaker.clear();
    vi.mocked(pi.generateSummary).mockReset();
    vi.mocked(pi.generateSummary).mockResolvedValue({ ok: true, value: 'MOCKED-SUMMARY' } as any);
  });

  it('compacts even below the auto threshold (skips shouldCompact gate)', async () => {
    // Use a fresh db+session with a unique sessionId to avoid cross-test breaker state.
    const db = new Database(':memory:');
    applyMigrations(db);
    // seedSession always uses sessionId='s1'; use a new db for isolation.
    const { agentProfile, llmProfile } = seedSession(db, 100);
    // Use default llmProfile (no contextWindow override) → tokens would be below
    // the auto threshold for a large window, but compactForOverflow must compact anyway.
    const result = await compactForOverflow({
      db,
      sessionId: 's1',
      agentProfile,
      llmProfile,
      source: 'overflow',
    });
    expect(result.outcome).toBe('compacted');
    expect(result.compacted).toBe(true);
    const created = latestCompaction(db, 's1')!;
    expect(created.source).toBe('overflow');
  });

  it('respects an open circuit breaker and returns circuit_open', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const { agentProfile, llmProfile } = seedSession(db, 100);
    // Use a unique sessionId for this test to avoid cross-talk.
    const sessionId = 'overflow-breaker-test';
    const now = 1_000_000;
    // Trip the breaker past maxFailures (3).
    for (let i = 0; i < 3; i++) compactionCircuitBreaker.recordFailure(sessionId, now);
    const result = await compactForOverflow({
      db,
      sessionId,
      agentProfile,
      llmProfile,
      source: 'overflow',
      now,
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('circuit_open');
    // Cleanup.
    compactionCircuitBreaker.reset(sessionId);
  });

  it('records breaker success on a successful compaction', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const { agentProfile, llmProfile } = seedSession(db, 100);
    const sessionId = 'overflow-success-test';
    // Pre-seed one failure so we can verify it gets cleared.
    compactionCircuitBreaker.recordFailure(sessionId, 1);
    // seedSession hardcodes 's1'; seed a tree under the unique sessionId instead.
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId, 'p1', 'ap1', 0, 0);
    appendMessagesToTree(db, sessionId, treeMessages(100));
    const result = await compactForOverflow({
      db,
      sessionId,
      agentProfile,
      llmProfile,
      source: 'overflow',
    });
    expect(result.outcome).toBe('compacted');
    expect(compactionCircuitBreaker.snapshot(sessionId).consecutiveFailures).toBe(0);
  });
});
