import { describe, expect, it, vi } from 'vitest';

import { createWebFetchTool, createWebSearchTool } from '../web-tools.js';

describe('web tools', () => {
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
});
