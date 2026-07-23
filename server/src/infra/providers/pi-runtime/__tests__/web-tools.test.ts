import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { createWebFetchTool, createWebSearchTool, fetchPublicHttpBody } from '../web-tools.js';

vi.mock('undici', () => {
  class MockAgent {
    static instances: MockAgent[] = [];
    options: unknown;
    closed = false;
    constructor(options: unknown) {
      this.options = options;
      MockAgent.instances.push(this);
    }
    async close(): Promise<void> {
      this.closed = true;
    }
  }
  return { Agent: MockAgent, __getAgentInstances: () => MockAgent.instances };
});

// Deterministic DNS: IP literals echo back (as libuv does without network),
// example.com resolves to a public address, anything else fails. Keeps these
// tests independent of the ambient resolver (some environments answer every
// query with fake-IP ranges like 198.18.0.0/15, which the guard must block).
vi.mock('dns/promises', async () => {
  const { isIP } = await import('net');
  return {
    lookup: vi.fn(async (hostname: string, options?: { all?: boolean }) => {
      const bare = hostname.replace(/^\[|\]$/g, '');
      const family = isIP(bare);
      if (family !== 0) {
        const entry = { address: bare, family };
        return options?.all ? [entry] : entry;
      }
      if (hostname === 'example.com') {
        const entry = { address: '93.184.216.34', family: 4 };
        return options?.all ? [entry] : entry;
      }
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      throw error;
    }),
  };
});

describe('web tools', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('WebFetch converts HTML to markdown by default and drops scripts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () =>
          '<html><body><h1>Hello</h1><script>bad()</script><p>World &amp; Friends</p></body></html>',
      }))
    );
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com' });

    expect(result.content[0].text).toContain('Status: 200 OK');
    expect(result.content[0].text).toContain('Hello');
    expect(result.content[0].text).toContain('World & Friends');
    expect(result.content[0].text).not.toContain('bad()');
  });

  it('WebFetch rejects localhost and private network URLs before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'http://127.0.0.1:3000/admin' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('blocked_private_network');
  });

  it('WebFetch rejects redirects to private network URLs before following them', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'http://127.0.0.1:3000/admin' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/start' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ ok: false, error: 'blocked_private_network' });
    expect(result.details.redirects).toEqual([
      { from: 'https://example.com/start', to: 'http://127.0.0.1:3000/admin', status: 302 },
    ]);
  });

  it.each([
    'http://[::ffff:169.254.169.254]/latest/meta-data', // mapped cloud metadata (dotted)
    'http://[::ffff:a9fe:a9fe]/latest/meta-data', // mapped cloud metadata (hex tail)
    'http://[::ffff:7f00:1]/', // mapped loopback (hex tail)
    'http://169.254.169.254/latest/meta-data', // link-local cloud metadata
    'http://100.64.0.1/', // CGNAT start
    'http://100.127.1.1/', // CGNAT end
    'http://224.0.0.1/', // multicast
    'http://240.0.0.1/', // reserved
    'http://198.18.0.23/', // benchmarking
    'http://192.0.0.8/', // IETF protocol assignments
  ])('WebFetch rejects special-use IP URL %s before fetch', async url => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ ok: false, error: 'blocked_private_network' });
  });

  it.each(['http://93.184.216.34/', 'http://192.0.2.1/', 'http://[2606:4700:4700::1111]/'])(
    'WebFetch still fetches public IP URL %s',
    async url => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('ok', {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'text/plain' },
            })
        )
      );
      const webFetch = createWebFetchTool() as any;

      const result = await webFetch.execute('fetch-1', { url });

      expect(result.details).toMatchObject({ ok: true, url });
    }
  );

  it('pins the validated DNS answers into the fetch dispatcher', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('ok', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
          })
      )
    );
    const undici = await import('undici');
    const instances = (undici as any).__getAgentInstances() as Array<{
      options: {
        connect: {
          lookup: (
            hostname: string,
            options: { all?: boolean },
            callback: (err: unknown, address: unknown, family?: unknown) => void
          ) => void;
        };
      };
      closed: boolean;
    }>;
    instances.length = 0;
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'http://93.184.216.34/' });

    expect(result.details).toMatchObject({ ok: true });
    expect(instances).toHaveLength(1);
    const pinnedLookup = instances[0].options.connect.lookup;

    const all = await new Promise((resolve, reject) =>
      pinnedLookup('93.184.216.34', { all: true }, (err: unknown, addresses: unknown) =>
        err ? reject(err) : resolve(addresses)
      )
    );
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);

    const single = await new Promise((resolve, reject) =>
      pinnedLookup('93.184.216.34', {}, (err: unknown, address: unknown, family: unknown) =>
        err ? reject(err) : resolve([address, family])
      )
    );
    expect(single).toEqual(['93.184.216.34', 4]);

    expect(instances[0].closed).toBe(true); // dispatcher released after the body was read
  });

  it('WebFetch reports the final URL after safe redirects', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/start') {
        return new Response('', {
          status: 301,
          statusText: 'Moved Permanently',
          headers: { location: '/final' },
        });
      }
      return new Response('<html><body><h1>Final</h1></body></html>', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/start' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.details).toMatchObject({ ok: true, url: 'https://example.com/final' });
    expect(result.content[0].text).toContain('URL: https://example.com/final');
    expect(result.content[0].text).toContain('Redirects: 1');
  });

  it('WebFetch caps response reads before returning content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('abcdef', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
          })
      )
    );
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', {
      url: 'https://example.com/large.txt',
      max_bytes: 3,
    });

    expect(result.details).toMatchObject({ ok: true, bodyTruncated: true, bytesRead: 3 });
    expect(result.content[0].text).toContain('Body: truncated after 3 bytes');
    expect(result.content[0].text).toContain('abc');
    expect(result.content[0].text).not.toContain('abcdef');
  });

  it('WebSearch falls back from configured SearXNG to DuckDuckGo and applies domain filters', async () => {
    vi.stubEnv('ZCLAUDIA_SEARXNG_BASE_URL', 'https://search.example.test');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://search.example.test')) {
        return { ok: false, status: 503, statusText: 'Unavailable', text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `
          <div class="result">
            <a class="result__a" href="https://allowed.example/page">Allowed</a>
            <a class="result__snippet">Snippet</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://blocked.example/page">Blocked</a>
            <a class="result__snippet">Hidden</a>
          </div>
        `,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const webSearch = createWebSearchTool() as any;

    const result = await webSearch.execute('search-1', {
      query: 'docs',
      allowed_domains: ['allowed.example'],
      max_results: 5,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.source).toBe('duckduckgo-html');
    expect(payload.fallbacks[0]).toMatchObject({ provider: 'searxng', status: 503 });
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({ title: 'Allowed', domain: 'allowed.example' });
  });

  it('WebSearch forwards freshness, locale, SafeSearch, and extra snippet options to Brave', async () => {
    vi.stubEnv('ZCLAUDIA_BRAVE_SEARCH_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Fresh Result',
                url: 'https://docs.example.com/post',
                description: 'Fresh snippet',
                age: 'June 21, 2026',
                extra_snippets: ['More context'],
              },
            ],
          },
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const webSearch = createWebSearchTool() as any;

    const result = await webSearch.execute('search-1', {
      query: 'api docs',
      allowed_domains: ['docs.example.com'],
      freshness: 'week',
      country: 'us',
      search_lang: 'en',
      ui_lang: 'en-US',
      safe_search: 'strict',
      extra_snippets: true,
    });
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    const payload = JSON.parse(result.content[0].text);

    expect(requestedUrl.hostname).toBe('api.search.brave.com');
    expect(requestedUrl.searchParams.get('q')).toContain('site:docs.example.com');
    expect(requestedUrl.searchParams.get('freshness')).toBe('pw');
    expect(requestedUrl.searchParams.get('country')).toBe('US');
    expect(requestedUrl.searchParams.get('search_lang')).toBe('en');
    expect(requestedUrl.searchParams.get('ui_lang')).toBe('en-US');
    expect(requestedUrl.searchParams.get('safesearch')).toBe('strict');
    expect(requestedUrl.searchParams.get('extra_snippets')).toBe('true');
    expect(payload.results[0]).toMatchObject({
      title: 'Fresh Result',
      pageAge: 'June 21, 2026',
      extraSnippets: ['More context'],
    });
    expect(result.details.results[0]).toMatchObject({ url: 'https://docs.example.com/post' });
  });

  it('WebSearch reads stored provider config from the database', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE web_search_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        brave_api_key TEXT,
        searxng_base_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO web_search_config (id, brave_api_key, created_at, updated_at)
      VALUES (1, 'stored-brave-key', 1000, 1000);
    `);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Stored Config Result',
                url: 'https://docs.example.com/from-db',
                description: 'Database key was used',
              },
            ],
          },
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const webSearch = createWebSearchTool(db) as any;
      const result = await webSearch.execute('search-1', { query: 'stored config' });
      const payload = JSON.parse(result.content[0].text);

      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
        'X-Subscription-Token': 'stored-brave-key',
      });
      expect(payload.source).toBe('brave');
      expect(payload.results[0]).toMatchObject({ url: 'https://docs.example.com/from-db' });
    } finally {
      db.close();
    }
  });

  it('WebFetch decodes GBK pages using the content-type charset', async () => {
    // '中文' in GBK (WHATWG encoding): 中 = D6 D0, 文 = CE C4.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain; charset=gbk' },
          })
      )
    );
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-gbk', { url: 'https://example.com/gbk.txt' });

    expect(result.details).toMatchObject({ ok: true });
    expect(result.content[0].text).toContain('中文');
  });

  it('WebFetch falls back to UTF-8 for an unknown charset label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('héllo wörld', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain; charset=not-a-real-charset' },
          })
      )
    );
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-bogus-charset', {
      url: 'https://example.com/utf8.txt',
    });

    expect(result.details).toMatchObject({ ok: true });
    expect(result.content[0].text).toContain('héllo wörld');
  });

  it('WebFetch rejects binary content even when format is raw', async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(pngBytes, {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'image/png' },
          })
      )
    );
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-png', {
      url: 'https://example.com/image.png',
      format: 'raw',
    });

    expect(result.details).toMatchObject({ ok: false, error: 'unsupported_binary_content' });
  });

  it('WebFetch treats a 304 without Location as a normal response', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 304, statusText: 'Not Modified' })
    );
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-304', { url: 'https://example.com/cached' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ status: 304 });
    expect(result.content[0].text).toContain('Status: 304 Not Modified');
  });

  it('WebFetch stops redirecting when the overall time budget is exhausted', async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000_000;
      vi.setSystemTime(now);
      const fetchMock = vi.fn(async () => {
        // Each hop "costs" 10s of wall clock, so a 25s budget allows 3 hops.
        now += 10_000;
        vi.setSystemTime(now);
        return new Response(null, { status: 302, headers: { location: '/next' } });
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchPublicHttpBody('https://example.com/start', {
        maxBytes: 1024,
        allowedDomains: [],
        blockedDomains: [],
        totalTimeoutMs: 25_000,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('fetch_timeout');
        expect(result.details.redirects).toHaveLength(3);
      }
      // Budget tripped well before the 8-redirect cap.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('WebFetch fails fast when the overall time budget is already spent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPublicHttpBody('https://example.com/start', {
      maxBytes: 1024,
      allowedDomains: [],
      blockedDomains: [],
      totalTimeoutMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('fetch_timeout');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('WebFetch no longer accepts the dead use_cache parameter', async () => {
    const webFetch = createWebFetchTool() as any;
    expect((webFetch.parameters as any).properties.use_cache).toBeUndefined();
  });

  it('WebFetch reports a missing url as a structured error', async () => {
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-missing', {});

    expect(result.details).toMatchObject({ ok: false, error: 'missing_url' });
  });

  it('WebSearch reports a missing query as a structured error', async () => {
    const webSearch = createWebSearchTool() as any;

    const result = await webSearch.execute('search-missing', {});

    expect(result.details).toMatchObject({ ok: false, error: 'missing_query' });
  });

  it('WebSearch falls back to the next provider when one returns zero results', async () => {
    vi.stubEnv('ZCLAUDIA_BRAVE_SEARCH_API_KEY', 'test-key');
    vi.stubEnv('ZCLAUDIA_SEARXNG_BASE_URL', 'https://search.example.test');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.search.brave.com')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ web: { results: [] } }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            results: [
              {
                title: 'SearXNG hit',
                url: 'https://docs.example.com/page',
                content: 'from searxng',
              },
            ],
          }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const webSearch = createWebSearchTool() as any;

    const result = await webSearch.execute('search-empty', { query: 'docs' });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.source).toBe('searxng');
    expect(payload.fallbacks[0]).toMatchObject({
      provider: 'brave',
      message: 'provider returned no results',
    });
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({ url: 'https://docs.example.com/page' });
    // Brave, then SearXNG — DuckDuckGo never runs once a provider produced results.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
