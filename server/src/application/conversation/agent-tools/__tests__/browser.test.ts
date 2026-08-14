import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolRegistry } from '../../../plugins/tool-registry.js';
import { isBlockedHostname } from '../network-guard.js';
import { registerBrowserTool } from '../browser.js';

vi.mock('../network-guard.js', () => ({
  isBlockedHostname: vi.fn(),
}));

const shotDir = mkdtempSync(join(tmpdir(), 'agent-shots-'));

const manager = {
  ensureSession: vi.fn(async () => ({ ok: true as const })),
  navigate: vi.fn(async () => {}),
  extractText: vi.fn(async () => ({ url: 'http://x/', title: 'X', text: 'body text' })),
  screenshot: vi.fn(async () => ({
    data: Buffer.from('jpegbytes').toString('base64'),
    width: 800,
    height: 600,
  })),
  clickSelector: vi.fn(async () => true),
  typeText: vi.fn(async () => true),
  input: vi.fn(async () => {}),
  getConsole: vi.fn((): Array<{ level: string; text: string; ts: number }> | null => [
    { level: 'log', text: 'boot', ts: 1 },
    { level: 'warn', text: 'deprecated', ts: 2 },
    { level: 'error', text: 'kaboom', ts: 3 },
  ]),
  getNetwork: vi.fn(
    (): Array<{ id: string; url: string; method: string; resourceType: string; ts: number; status?: number; errorText?: string }> | null => [
      { id: 'a', url: 'http://x/ok', method: 'GET', resourceType: 'fetch', ts: 1, status: 200 },
      { id: 'b', url: 'http://x/miss', method: 'GET', resourceType: 'fetch', ts: 2, status: 404 },
      { id: 'c', url: 'http://x/dead', method: 'POST', resourceType: 'xhr', ts: 3, errorText: 'net::ERR_CONNECTION_REFUSED' },
    ]
  ),
  getState: vi.fn(() => ({
    url: 'http://x/',
    title: 'X',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  })),
};
const activity: Array<{ sessionId: string; active: boolean }> = [];

const ctx = { sessionId: 's1' };
const run = (args: Record<string, unknown>) =>
  toolRegistry.execute('agent_browser', args, ctx as never, 'agent-assistant');

beforeEach(() => {
  vi.clearAllMocks();
  activity.length = 0;
  // Registration overwrites the previous entry for 'agent_browser' (ToolRegistry.register()
  // is idempotent-by-overwrite already, see tool-registry.ts) so re-registering per test keeps
  // this file isolated from whatever else in the process may have (re)registered the tool.
  registerBrowserTool({
    getBrowserManager: () => manager as never,
    broadcastAgentActivity: (sessionId, active) => activity.push({ sessionId, active }),
    getScreenshotDir: () => shotDir,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent_browser actions', () => {
  it('navigate ensures the session, navigates, returns state + text summary', async () => {
    const out = JSON.parse(await run({ action: 'navigate', url: 'localhost:5173' }));
    expect(manager.ensureSession).toHaveBeenCalledWith('s1');
    expect(manager.navigate).toHaveBeenCalledWith('s1', 'http://localhost:5173');
    expect(out.url).toBe('http://x/');
    expect(out.title).toBe('X');
    expect(out.text).toContain('body text');
  });

  it('navigate rejects non-http(s) schemes like file:// (the visible-panel allowlist)', async () => {
    const out = JSON.parse(await run({ action: 'navigate', url: 'file:///etc/passwd' }));
    expect(out.error).toMatch(/http\(s\)/i);
    expect(manager.navigate).not.toHaveBeenCalled();
  });

  it('navigate still allows localhost/private addresses (dev-preview use case)', async () => {
    const out = JSON.parse(await run({ action: 'navigate', url: 'localhost:5173' }));
    expect(manager.navigate).toHaveBeenCalledWith('s1', 'http://localhost:5173');
    expect(out.error).toBeUndefined();
  });

  it('wraps browser actions in activity broadcasts (true then false, even on error)', async () => {
    await run({ action: 'read_page' });
    expect(activity).toEqual([
      { sessionId: 's1', active: true },
      { sessionId: 's1', active: false },
    ]);
    activity.length = 0;
    manager.extractText.mockRejectedValueOnce(new Error('boom'));
    const out = JSON.parse(await run({ action: 'read_page' }));
    expect(out.error).toBeTruthy();
    expect(activity.map(a => a.active)).toEqual([true, false]);
  });

  it('screenshot writes a jpg under the screenshot dir and returns its path', async () => {
    const out = JSON.parse(await run({ action: 'screenshot' }));
    expect(out.file).toContain(shotDir);
    expect(out.width).toBe(800);
    expect(existsSync(out.file)).toBe(true);
    expect(readFileSync(out.file).toString()).toBe('jpegbytes');
  });

  it('sanitizes a path-traversal sessionId so the screenshot stays inside the screenshot dir', async () => {
    const out = JSON.parse(
      await toolRegistry.execute(
        'agent_browser',
        { action: 'screenshot' },
        { sessionId: '../../evil' } as never,
        'agent-assistant'
      )
    );
    expect(out.file.startsWith(shotDir)).toBe(true);
    expect(out.file).not.toContain('..');
    expect(existsSync(out.file)).toBe(true);
  });

  it('adds a monotonic counter suffix so same-millisecond screenshots do not collide', async () => {
    const [a, b] = await Promise.all([run({ action: 'screenshot' }), run({ action: 'screenshot' })]);
    const fileA = JSON.parse(a).file;
    const fileB = JSON.parse(b).file;
    expect(fileA).not.toBe(fileB);
    expect(existsSync(fileA)).toBe(true);
    expect(existsSync(fileB)).toBe(true);
  });

  it('click by selector and by coordinates', async () => {
    await run({ action: 'click', selector: '#btn' });
    expect(manager.clickSelector).toHaveBeenCalledWith('s1', '#btn');
    await run({ action: 'click', x: 10, y: 20 });
    expect(manager.input).toHaveBeenCalledTimes(2); // down + up
    const [down, up] = manager.input.mock.calls.map(c => c[1]);
    expect(down).toMatchObject({ kind: 'mouse', type: 'down', x: 10, y: 20, button: 'left' });
    expect(up).toMatchObject({ kind: 'mouse', type: 'up', x: 10, y: 20 });
  });

  it('click survives a navigation race: extractText rejecting falls back to a getState()-only summary', async () => {
    manager.extractText.mockRejectedValueOnce(new Error('Execution context was destroyed'));
    const out = JSON.parse(await run({ action: 'click', selector: '#btn' }));
    expect(out.error).toBeUndefined();
    expect(out.url).toBe('http://x/');
    expect(out.title).toBe('X');
    expect(out.text).toBe('');
  });

  it('type and scroll delegate', async () => {
    await run({ action: 'type', text: 'hi', submit: true });
    expect(manager.typeText).toHaveBeenCalledWith('s1', 'hi', true);
    await run({ action: 'scroll', direction: 'down' });
    expect(manager.input).toHaveBeenCalledWith('s1', expect.objectContaining({ kind: 'wheel' }));
  });

  it('type allows empty text when submit is true (just press Enter)', async () => {
    const out = JSON.parse(await run({ action: 'type', submit: true }));
    expect(out.ok).toBe(true);
    expect(manager.typeText).toHaveBeenCalledWith('s1', '', true);
  });

  it('type rejects when there is neither text nor submit', async () => {
    const out = JSON.parse(await run({ action: 'type' }));
    expect(out.error).toMatch(/text or submit/i);
    expect(manager.typeText).not.toHaveBeenCalled();
  });

  it('read_console returns buffered entries with level filtering and limit', async () => {
    const all = JSON.parse(await run({ action: 'read_console' }));
    expect(all.total).toBe(3);
    expect(all.entries.map((e: { text: string }) => e.text)).toEqual(['boot', 'deprecated', 'kaboom']);

    const errors = JSON.parse(await run({ action: 'read_console', level: 'error' }));
    expect(errors.entries).toEqual([{ level: 'error', text: 'kaboom', ts: 3 }]);

    const warnPlus = JSON.parse(await run({ action: 'read_console', level: 'warn' }));
    expect(warnPlus.entries.map((e: { text: string }) => e.text)).toEqual(['deprecated', 'kaboom']);

    const limited = JSON.parse(await run({ action: 'read_console', limit: 1 }));
    expect(limited.total).toBe(3); // total reflects the filtered set, entries the tail
    expect(limited.entries.map((e: { text: string }) => e.text)).toEqual(['kaboom']);
  });

  it('read_console reports no page when the session has no console buffer', async () => {
    manager.getConsole.mockReturnValueOnce(null);
    const out = JSON.parse(await run({ action: 'read_console' }));
    expect(out.error).toMatch(/no page/i);
  });

  it('read_network returns entries; filter=error keeps HTTP >=400 and network failures', async () => {
    const all = JSON.parse(await run({ action: 'read_network' }));
    expect(all.total).toBe(3);
    const errors = JSON.parse(await run({ action: 'read_network', filter: 'error' }));
    expect(errors.entries.map((e: { id: string }) => e.id)).toEqual(['b', 'c']);
    const limited = JSON.parse(await run({ action: 'read_network', limit: 1 }));
    expect(limited.entries.map((e: { id: string }) => e.id)).toEqual(['c']);
    manager.getNetwork.mockReturnValueOnce(null);
    const none = JSON.parse(await run({ action: 'read_network' }));
    expect(none.error).toMatch(/no page/i);
  });

  it('engine missing yields a helpful error and no activity trailing state leak', async () => {
    manager.ensureSession.mockResolvedValueOnce({ ok: false, reason: 'engine_missing' } as never);
    const out = JSON.parse(await run({ action: 'navigate', url: 'http://x/' }));
    expect(out.error).toMatch(/engine/i);
    expect(activity.map(a => a.active)).toEqual([true, false]);
  });

  it('action omitted defaults to legacy fetch behavior (no browser calls)', async () => {
    // fetch hits the network; use an invalid URL to exercise the error path only
    const out = JSON.parse(await run({ url: 'http://127.0.0.1:1/nope' }));
    expect(out.error).toBeTruthy();
    expect(manager.ensureSession).not.toHaveBeenCalled();
    expect(activity).toHaveLength(0);
  });

  it('missing sessionId rejects browser actions', async () => {
    const out = JSON.parse(
      await toolRegistry.execute(
        'agent_browser',
        { action: 'read_page' },
        {} as never,
        'agent-assistant'
      )
    );
    expect(out.error).toMatch(/session/i);
  });
});

describe('agent_browser legacy fetch action', () => {
  it('registers the browser tool and blocks private destinations before fetching', async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(isBlockedHostname).mockResolvedValue(true);

    const tool = toolRegistry.get('agent_browser');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ url: 'http://internal.example.local' });

    expect(isBlockedHostname).toHaveBeenCalledWith('internal.example.local');
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(result)).toEqual({
      error: 'Requests to private/internal addresses are blocked',
    });
  });

  it('fetches pages with redirect blocking and returns extracted text by default', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue('<h1>Hello</h1><script>bad()</script><p>World &amp; Friends</p>'),
      })
    );

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://example.com/docs' });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          'User-Agent': 'ZClaudia-Agent/1.0',
        }),
      })
    );
    expect(JSON.parse(result)).toEqual({
      url: 'https://example.com/docs',
      content: 'Hello\n\nWorld & Friends',
    });
  });

  it('returns raw bodies unchanged when format=raw', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('{"ok":true}'),
      })
    );

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://api.example.com/status', format: 'raw' });

    expect(result).toBe('{"ok":true}');
  });

  it('returns HTTP errors in a structured payload', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: vi.fn(),
      })
    );

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://example.com/rate-limited' });

    expect(JSON.parse(result)).toEqual({
      error: 'HTTP 429: Too Many Requests',
      url: 'https://example.com/rate-limited',
    });
  });

  it('bounds large bodies with a streaming byte budget instead of buffering everything (P1-16)', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    const chunk = new TextEncoder().encode(`<p>${'x'.repeat(4096)}</p>`);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            // ~4MB body: far beyond the 256KB read budget.
            for (let i = 0; i < 1024; i++) controller.enqueue(chunk);
            controller.close();
          },
        }),
      })
    );

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://example.com/huge' });
    const parsed = JSON.parse(result);

    expect(parsed.truncated).toBe(true);
    expect(parsed.content.length).toBeLessThanOrEqual(8000);
  });
});
