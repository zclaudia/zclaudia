import type { AgentTool } from '@earendil-works/pi-agent-core';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

import { htmlToMarkdown, stripHtmlToText, shouldExtractAsHtml } from './web-extract.js';
import { errorResult, jsonResult, textResult, toolParams, truncateText } from './tool-common.js';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|article|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stringArrayParam(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function decodeSearchUrl(rawUrl: string): string {
  let url = rawUrl.replace(/&amp;/g, '&');
  if (url.startsWith('//')) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    const redirected = parsed.searchParams.get('uddg');
    if (redirected) return redirected;
    return parsed.toString();
  } catch {
    return url;
  }
}

function urlDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function domainMatches(domain: string, filters: string[]): boolean {
  return filters.some(filter => domain === filter || domain.endsWith(`.${filter}`));
}

function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; domain: string; snippet: string }> {
  return [...html.matchAll(/<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*result[^"]*"|$)/gi)]
    .flatMap((blockMatch) => {
      const block = blockMatch[1] || '';
      const linkMatch = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!linkMatch) return [];
      const url = decodeSearchUrl(linkMatch[1] || '');
      return [{
        title: stripHtml(linkMatch[2] || ''),
        url,
        domain: urlDomain(url),
        snippet: stripHtml((/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1])
          ?? (/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1])
          ?? ''),
      }];
    });
}

interface WebSearchResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

interface WebSearchProvider {
  name: string;
  search(query: string, maxResults: number): Promise<WebSearchResult[]>;
}

class WebSearchProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly statusText?: string,
  ) {
    super(message);
  }
}

async function fetchTextProvider(url: string, provider: string, headers?: Record<string, string>): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ZClaudia-Agent/1.0', ...(headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new WebSearchProviderError(
      `${provider} failed: ${response.status} ${response.statusText}`,
      provider,
      response.status,
      response.statusText,
    );
  }
  return response.text();
}

async function fetchJsonProvider<T>(url: string, provider: string, headers?: Record<string, string>): Promise<T> {
  const text = await fetchTextProvider(url, provider, headers);
  return JSON.parse(text) as T;
}

function createDuckDuckGoSearchProvider(): WebSearchProvider {
  return {
    name: 'duckduckgo-html',
    search: async (query, maxResults) => {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      return parseDuckDuckGoResults(await fetchTextProvider(url, 'duckduckgo-html')).slice(0, maxResults);
    },
  };
}

function createSearxngSearchProvider(baseUrl: string): WebSearchProvider {
  return {
    name: 'searxng',
    search: async (query, maxResults) => {
      const endpoint = new URL('/search', baseUrl);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('format', 'json');
      const payload = await fetchJsonProvider<{
        results?: Array<{ title?: string; url?: string; content?: string; snippet?: string }>;
      }>(endpoint.toString(), 'searxng');
      return (payload.results ?? []).slice(0, maxResults).flatMap((result) => {
        if (!result.url) return [];
        return [{
          title: stripHtml(result.title ?? ''),
          url: result.url,
          domain: urlDomain(result.url),
          snippet: stripHtml(result.content ?? result.snippet ?? ''),
        }];
      });
    },
  };
}

function createBraveSearchProvider(apiKey: string): WebSearchProvider {
  return {
    name: 'brave',
    search: async (query, maxResults) => {
      const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('count', String(maxResults));
      const payload = await fetchJsonProvider<{
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      }>(endpoint.toString(), 'brave', {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      });
      return (payload.web?.results ?? []).slice(0, maxResults).flatMap((result) => {
        if (!result.url) return [];
        return [{
          title: stripHtml(result.title ?? ''),
          url: result.url,
          domain: urlDomain(result.url),
          snippet: stripHtml(result.description ?? ''),
        }];
      });
    },
  };
}

function createWebSearchProviders(): WebSearchProvider[] {
  const providers: WebSearchProvider[] = [];
  const braveKey = process.env.ZCLAUDIA_BRAVE_SEARCH_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) providers.push(createBraveSearchProvider(braveKey));
  const searxngBaseUrl = process.env.ZCLAUDIA_SEARXNG_BASE_URL || process.env.SEARXNG_BASE_URL;
  if (searxngBaseUrl) providers.push(createSearxngSearchProvider(searxngBaseUrl));
  providers.push(createDuckDuckGoSearchProvider());
  return providers;
}

function isPrivateIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === '::1'
      || lower.startsWith('fc')
      || lower.startsWith('fd')
      || lower.startsWith('fe80:');
  }

  const parts = address.split('.').map(part => Number(part));
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

async function validatePublicHttpUrl(rawUrl: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'blocked_private_network' };
  }
  if (isPrivateIpAddress(hostname)) {
    return { ok: false, reason: 'blocked_private_network' };
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some(({ address }) => isPrivateIpAddress(address))) {
      return { ok: false, reason: 'blocked_private_network' };
    }
  } catch {
    return { ok: false, reason: 'dns_lookup_failed' };
  }

  return { ok: true, url: parsed };
}

export function createWebFetchTool(): AgentTool<any> {
  return {
    name: 'WebFetch',
    label: 'WebFetch',
    description: 'Fetch a URL and return its content. HTML pages are extracted to clean Markdown (main article, with headings/lists/code/links preserved). format: "markdown" (default), "text" (plain-text strip), or "raw" (unprocessed body). Non-HTML responses (JSON, plain text, markdown) are returned as-is.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'text', 'raw'], default: 'markdown' },
      },
      required: ['url'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const url = String(args.url || '');
      if (!url) return jsonResult({ error: 'url is required' });
      const validation = await validatePublicHttpUrl(url);
      if (!validation.ok) return jsonResult({ error: validation.reason, url });
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'ZClaudia-Agent/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.text();
      const contentType = response.headers?.get?.('content-type') ?? '';
      const finalUrl = validation.url.toString();
      const format = args.format === 'raw' || args.format === 'text' ? args.format : 'markdown';

      let content = body;
      let extractMode: string | undefined;
      let title: string | undefined;
      if (format === 'raw') {
        content = body;
      } else if (!shouldExtractAsHtml(contentType, body)) {
        content = body;
        extractMode = 'passthrough';
      } else if (format === 'text') {
        content = stripHtmlToText(body);
        extractMode = 'text';
      } else {
        const extracted = await htmlToMarkdown(body, finalUrl);
        content = extracted.markdown;
        extractMode = extracted.mode;
        title = extracted.title;
      }

      const header = [
        `URL: ${finalUrl}`,
        `Status: ${response.status} ${response.statusText}`,
        `Content-Type: ${contentType || 'unknown'}`,
        ...(title ? [`Title: ${title}`] : []),
      ].join('\n');
      return textResult(
        truncateText(`${header}\n\n${content}`),
        {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType,
          url: finalUrl,
          ...(extractMode ? { extractMode } : {}),
          ...(title ? { title } : {}),
        },
      );
    },
  } as unknown as AgentTool<any>;
}

export function createWebSearchTool(): AgentTool<any> {
  return {
    name: 'WebSearch',
    label: 'WebSearch',
    description: 'Search the web for current information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number', default: 5 },
        allowed_domains: { type: 'array', items: { type: 'string' } },
        blocked_domains: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const query = String(args.query || '').trim();
      if (!query) return jsonResult({ error: 'query is required' });
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 5) || 5, 10));
      const allowedDomains = stringArrayParam(args.allowed_domains);
      const blockedDomains = stringArrayParam(args.blocked_domains);
      const fallbacks: Array<Record<string, unknown>> = [];
      for (const provider of createWebSearchProviders()) {
        try {
          const results = (await provider.search(query, maxResults))
          .filter(result => result.url && result.domain)
          .filter(result => allowedDomains.length === 0 || domainMatches(result.domain, allowedDomains))
          .filter(result => blockedDomains.length === 0 || !domainMatches(result.domain, blockedDomains))
          .slice(0, maxResults);
          return textResult(JSON.stringify({
            query,
            results,
            source: provider.name,
            fallbacks,
          }, null, 2), {
            ok: true,
            provider: provider.name,
            query,
            total: results.length,
            allowedDomains,
            blockedDomains,
            fallbacks,
          });
        } catch (err) {
          const providerError = err as Partial<WebSearchProviderError>;
          fallbacks.push({
            provider: provider.name,
            message: err instanceof Error ? err.message : String(err),
            ...(typeof providerError.status === 'number' && { status: providerError.status }),
            ...(typeof providerError.statusText === 'string' && { statusText: providerError.statusText }),
          });
        }
      }
      const last = fallbacks[fallbacks.length - 1] ?? {};
      return errorResult('provider_error', `WebSearch provider failed: ${String(last.message ?? 'all providers failed')}`, {
        provider: String(last.provider ?? 'unknown'),
        ...(typeof last.status === 'number' && { status: last.status }),
        ...(typeof last.statusText === 'string' && { statusText: last.statusText }),
        fallbacks,
      });
    },
  } as unknown as AgentTool<any>;
}
