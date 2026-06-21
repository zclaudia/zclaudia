import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { createWebFetchTool, createWebSearchTool } from '../web-tools.js';

describe('web tools', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('WebFetch converts HTML to markdown by default and drops scripts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html><body><h1>Hello</h1><script>bad()</script><p>World &amp; Friends</p></body></html>',
    })));
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
    const fetchMock = vi.fn(async () => new Response('', {
      status: 302,
      headers: { location: 'http://127.0.0.1:3000/admin' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/start' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ ok: false, error: 'blocked_private_network' });
    expect(result.details.redirects).toEqual([
      { from: 'https://example.com/start', to: 'http://127.0.0.1:3000/admin', status: 302 },
    ]);
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('abcdef', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
    })));
    const webFetch = createWebFetchTool() as any;

    const result = await webFetch.execute('fetch-1', { url: 'https://example.com/large.txt', max_bytes: 3 });

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
      text: async () => JSON.stringify({
        web: {
          results: [{
            title: 'Fresh Result',
            url: 'https://docs.example.com/post',
            description: 'Fresh snippet',
            age: 'June 21, 2026',
            extra_snippets: ['More context'],
          }],
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
      text: async () => JSON.stringify({
        web: {
          results: [{
            title: 'Stored Config Result',
            url: 'https://docs.example.com/from-db',
            description: 'Database key was used',
          }],
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
});
