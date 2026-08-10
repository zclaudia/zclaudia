import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import {
  seedEntry,
  seedLane,
} from '../../../infra/providers/pi-runtime/session-tree/__tests__/fixture.js';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { newId } from '../../../utils/uuid.js';
import { createSessionRoutes } from '../routes.js';

/**
 * Insert a native compaction entry into the session tree (Route C), the way the
 * compaction service now persists them. The route reader projects this back into
 * the `SessionCompaction` shape; `createdAt` round-trips through the ISO timestamp.
 */
function insertCompactionEntry(
  db: Database.Database,
  sessionId: string,
  input: {
    id: string;
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    source: 'auto' | 'manual' | 'overflow' | 'preflight';
    customInstructions?: string | null;
    readFiles?: string[];
    modifiedFiles?: string[];
    createdAt: number;
  }
): void {
  const payload = JSON.stringify({
    summary: input.summary,
    firstKeptEntryId: input.firstKeptEntryId,
    tokensBefore: input.tokensBefore,
    details: {
      source: input.source,
      customInstructions: input.customInstructions ?? null,
      readFiles: input.readFiles ?? [],
      modifiedFiles: input.modifiedFiles ?? [],
    },
    fromHook: false,
  });
  seedEntry(db, sessionId, {
    id: input.id,
    parentId: null,
    type: 'compaction',
    timestamp: input.createdAt,
    ...(JSON.parse(payload) as Record<string, unknown>),
  });
  seedLane(db, sessionId, input.id);
}

vi.mock('../../../infra/events/index.js', () => ({
  pluginEvents: { emit: vi.fn().mockReturnValue(Promise.resolve()) },
}));

vi.mock('../../../infra/storage/metadata-extractor.js', () => ({
  extractAndIndexMetadata: vi.fn(),
}));

function seedSession(db: Database.Database): { sessionId: string; messageId: string } {
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
  const messageId = newId();
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(messageId, 's1', 'user', 'hello', 1000, 1);
  return { sessionId: 's1', messageId };
}

function createApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(db, new Map()));
  return app;
}

describe('sessions compaction routes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /api/sessions/:id/compactions/:compactionId', () => {
    it('returns 404 when the compaction does not exist', async () => {
      seedSession(db);
      const app = createApp(db);
      const res = await request(app).get('/api/sessions/s1/compactions/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns the compaction record when found', async () => {
      const { messageId } = seedSession(db);
      const cid = newId();
      insertCompactionEntry(db, 's1', {
        id: cid,
        summary: 'a summary',
        firstKeptEntryId: messageId,
        tokensBefore: 12345,
        readFiles: ['/a.ts'],
        modifiedFiles: ['/b.ts'],
        source: 'manual',
        customInstructions: 'focus on auth',
        createdAt: 2000,
      });
      const app = createApp(db);
      const res = await request(app).get(`/api/sessions/s1/compactions/${cid}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(cid);
      expect(res.body.data.summary).toBe('a summary');
      expect(res.body.data.tokensBefore).toBe(12345);
      expect(res.body.data.source).toBe('manual');
      expect(res.body.data.customInstructions).toBe('focus on auth');
      expect(res.body.data.details).toEqual({ readFiles: ['/a.ts'], modifiedFiles: ['/b.ts'] });
    });
  });

  describe('GET /api/sessions/:id/messages — compaction marker injection', () => {
    it('interleaves compaction markers chronologically with messages', async () => {
      const { messageId } = seedSession(db);
      // Add a second message AFTER the compaction so the marker sits in the middle.
      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(newId(), 's1', 'assistant', 'reply', 3000, 2);

      const cid = newId();
      insertCompactionEntry(db, 's1', {
        id: cid,
        summary: 'mid summary',
        firstKeptEntryId: messageId,
        tokensBefore: 7777,
        source: 'auto',
        createdAt: 2000,
      });

      const app = createApp(db);
      const res = await request(app).get('/api/sessions/s1/messages');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const items = res.body.data.messages as Array<{
        id: string;
        createdAt: number;
        role: string;
        metadata?: { compactionMarker?: { compactionId: string } };
      }>;
      // Should be ordered: user@1000, marker@2000, assistant@3000
      expect(items).toHaveLength(3);
      expect(items[0].createdAt).toBe(1000);
      expect(items[1].createdAt).toBe(2000);
      expect(items[1].role).toBe('system');
      expect(items[1].metadata?.compactionMarker?.compactionId).toBe(cid);
      expect(items[2].createdAt).toBe(3000);
    });

    it('omits compaction markers outside the requested page window', async () => {
      const { messageId } = seedSession(db);
      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(newId(), 's1', 'assistant', 'reply', 3000, 2);

      // Marker BEFORE the page window (createdAt < oldest message)
      insertCompactionEntry(db, 's1', {
        id: newId(),
        summary: 'stale',
        firstKeptEntryId: messageId,
        tokensBefore: 1,
        source: 'auto',
        createdAt: 500,
      });

      const app = createApp(db);
      // Default route returns the latest N messages reversed — both seeded
      // messages fit (createdAt 1000 and 3000); the marker at 500 is older
      // than the oldest message in the page and should NOT appear.
      const res = await request(app).get('/api/sessions/s1/messages');
      const items = res.body.data.messages as Array<{
        role: string;
        metadata?: { compactionMarker?: unknown };
      }>;
      const markers = items.filter(m => m.metadata?.compactionMarker);
      expect(markers).toHaveLength(0);
    });
  });
});
