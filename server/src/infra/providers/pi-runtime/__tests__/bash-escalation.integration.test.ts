import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildTools } from '../tool-bridge.js';
import { isSandboxAvailable, __resetSandboxCacheForTests } from '../sandbox.js';
import { loadSessionSandboxDomains } from '../../../../application/conversation/agent/permission-memory.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE permission_memories (
    session_id TEXT NOT NULL, remember_key TEXT NOT NULL,
    decision TEXT CHECK(decision IN ('allow','deny')) NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, remember_key));`);
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getBash(db: Database.Database, permissionCallback: any) {
  const tools = buildTools(process.cwd(), { sessionId: 's1', db, permissionCallback });
  return tools.find((t) => t.name === 'Bash')!;
}

describe('Bash escalate-on-denial (integration, sandbox-gated)', () => {
  beforeEach(() => __resetSandboxCacheForTests());

  it('on deny, does not persist a domain and returns the failed result', async () => {
    if (!isSandboxAvailable()) return;
    const db = makeDb();
    const bash = getBash(db, async () => ({ behavior: 'deny', message: 'no' }));
    const res: any = await bash.execute('call1', { command: 'curl -sS https://denied.example.com -o /dev/null' });
    expect(res.details.ok).not.toBe(true); // tool returns { content, details: { ok, exitCode, ... } }
    expect(loadSessionSandboxDomains(db, 's1')).toEqual([]);
  });

  it('on approve, persists the requested domain to the session', async () => {
    if (!isSandboxAvailable()) return;
    const db = makeDb();
    let asked = 0;
    const bash = getBash(db, async (req: any) => {
      asked++;
      expect(req.toolName).toBe('SandboxNetworkAccess');
      expect(req.toolInput.hosts).toContain('denied.example.com');
      return { behavior: 'allow' };
    });
    await bash.execute('call1', { command: 'curl -sS https://denied.example.com -o /dev/null' });
    expect(asked).toBeGreaterThanOrEqual(1);
    expect(loadSessionSandboxDomains(db, 's1')).toContain('denied.example.com');
  });
});
