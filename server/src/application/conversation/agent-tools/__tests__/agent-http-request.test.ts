import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { registerAgentTools } from '../index.js';
import { toolRegistry } from '../../../../application/plugins/index.js';
import { isBlockedHostname } from '../network-guard.js';

vi.mock('../network-guard.js', () => ({
  isBlockedHostname: vi.fn(),
}));

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      working_directory TEXT
    );
  `);
  db.prepare(`INSERT INTO sessions (id, project_id) VALUES ('session-1', 'project-1')`).run();
  return db;
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoded = chunks.map(chunk => new TextEncoder().encode(chunk));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of encoded) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('agent-tools/agent_http_request', () => {
  let db: Database.Database;

  beforeEach(() => {
    toolRegistry.clear();
    vi.clearAllMocks();
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    db = createDb();
    registerAgentTools({ getDb: () => db });
  });

  afterEach(() => {
    delete process.env.ZCLAUDIA_AGENT_HTTP_TIMEOUT_MS;
    vi.unstubAllGlobals();
  });

  function execute(args: Record<string, unknown>) {
    return toolRegistry.execute(
      'agent_http_request',
      args,
      { sessionId: 'session-1' },
      'agent-assistant'
    );
  }

  it('returns a small response body with status and headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: streamOf('hello world'),
      })
    );

    const result = await execute({ url: 'https://example.com/data' });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe(200);
    expect(parsed.body).toBe('hello world');
    expect(parsed.truncated).toBe(false);
  });

  it('bounds large responses to the 16KB cap (P1-16)', async () => {
    const chunk = 'x'.repeat(8 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: streamOf(...Array(16).fill(chunk)), // 128KB total
      })
    );

    const result = await execute({ url: 'https://example.com/huge' });
    const parsed = JSON.parse(result);

    expect(parsed.truncated).toBe(true);
    expect(parsed.body.length).toBeLessThanOrEqual(8000);
  });

  it('aborts with an overall timeout when the server stalls (P1-16)', async () => {
    process.env.ZCLAUDIA_AGENT_HTTP_TIMEOUT_MS = '50';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            );
          })
      )
    );

    const startedAt = Date.now();
    const result = await execute({ url: 'https://example.com/stalled' });
    const elapsed = Date.now() - startedAt;
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe('Request timed out after 50ms');
    expect(elapsed).toBeLessThan(10_000);
  });

  it('blocks private destinations before fetching', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn());

    const result = await execute({ url: 'http://internal.example.local' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe('Requests to private/internal addresses are blocked');
    expect(fetch).not.toHaveBeenCalled();
  });
});
