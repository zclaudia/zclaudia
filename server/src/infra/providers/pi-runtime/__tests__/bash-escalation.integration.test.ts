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

  it('does not re-prompt for a domain already granted via the session seed', async () => {
    if (!isSandboxAvailable()) return;
    const db = makeDb();
    let asked = 0;
    const tools = buildTools(process.cwd(), {
      sessionId: 's1',
      db,
      sandboxAllowedDomains: ['denied.example.com'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      permissionCallback: (async () => { asked++; return { behavior: 'allow' }; }) as any,
    });
    const bash = tools.find((t) => t.name === 'Bash')!;
    await bash.execute('call1', { command: 'curl -sS https://denied.example.com -o /dev/null' });
    // The seeded domain is on the allow-list, so detectSandboxDenial filters it out → no escalation prompt.
    expect(asked).toBe(0);
  });

  it('batches multiple un-allowed hosts into a single prompt and persists all of them', async () => {
    if (!isSandboxAvailable()) return;
    const db = makeDb();
    let asked = 0;
    let promptedHosts: string[] = [];
    const bash = getBash(db, async (req: any) => {
      asked++;
      promptedHosts = req.toolInput.hosts;
      return { behavior: 'allow' };
    });
    await bash.execute('call1', {
      command: 'curl -sS https://a.denied.example -o /dev/null; curl -sS https://b.denied.example -o /dev/null',
    });
    expect(asked).toBe(1); // one batched prompt, not one per host
    expect(promptedHosts).toEqual(expect.arrayContaining(['a.denied.example', 'b.denied.example']));
    const persisted = loadSessionSandboxDomains(db, 's1');
    expect(persisted).toEqual(expect.arrayContaining(['a.denied.example', 'b.denied.example']));
  });
});
