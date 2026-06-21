import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Database } from 'better-sqlite3';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

import { getWebSearchProviderConfig } from '../../../domains/web-search/config.js';
import { extractPdfText } from './rich-read.js';
import { htmlToMarkdown, stripHtmlToText, shouldExtractAsHtml } from './web-extract.js';
import { errorResult, jsonResult, textResult, toolParams, truncateText } from './tool-common.js';

const USER_AGENT = 'ZClaudia-Agent/1.0';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 8;
const DEFAULT_FETCH_MAX_BYTES = 5 * 1024 * 1024;
const HARD_FETCH_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_OUTPUT_CHARS = 80_000;
const HARD_OUTPUT_CHARS = 200_000;

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
    .map(item => item.trim())
    .filter(Boolean);
}

function clampNumberParam(value: unknown, defaultValue: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function optionalStringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanParam(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return defaultValue;
}

function normalizeDomainFilterEntry(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
      return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${path}`;
    }

    const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? '';
    const slashIndex = withoutQuery.indexOf('/');
    const host = (slashIndex >= 0 ? withoutQuery.slice(0, slashIndex) : withoutQuery)
      .toLowerCase()
      .replace(/^www\./, '');
    const path = slashIndex >= 0 ? withoutQuery.slice(slashIndex) : '';
    if (!host || host.includes('*') || host.includes(':')) return undefined;
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

function domainFiltersParam(value: unknown): { filters: string[]; invalid: string[] } {
  const filters: string[] = [];
  const invalid: string[] = [];
  for (const raw of stringArrayParam(value)) {
    const normalized = normalizeDomainFilterEntry(raw);
    if (!normalized) {
      invalid.push(raw);
    } else if (!filters.includes(normalized)) {
      filters.push(normalized);
    }
  }
  return { filters, invalid };
}

function splitDomainFilter(filter: string): { domain: string; path?: string } {
  const slashIndex = filter.indexOf('/');
  if (slashIndex < 0) return { domain: filter };
  return {
    domain: filter.slice(0, slashIndex),
    path: filter.slice(slashIndex),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathMatchesFilter(pathname: string, filterPath: string): boolean {
  if (filterPath.includes('*')) {
    const pattern = filterPath
      .split('*')
      .map(escapeRegExp)
      .join('[^/]*');
    return new RegExp(`^${pattern}`).test(pathname);
  }
  return pathname === filterPath || pathname.startsWith(filterPath.endsWith('/') ? filterPath : `${filterPath}/`);
}

function filterMatchesUrl(rawUrl: string, filters: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return filters.some((filter) => {
    const { domain: filterDomain, path } = splitDomainFilter(filter);
    if (!domainMatches(domain, [filterDomain])) return false;
    return !path || pathMatchesFilter(parsed.pathname, path);
  });
}

function validateDomainAccess(
  rawUrl: string,
  allowedDomains: string[],
  blockedDomains: string[],
): { ok: true } | { ok: false; reason: string } {
  if (allowedDomains.length > 0 && !filterMatchesUrl(rawUrl, allowedDomains)) {
    return { ok: false, reason: 'blocked_by_allowed_domains' };
  }
  if (blockedDomains.length > 0 && filterMatchesUrl(rawUrl, blockedDomains)) {
    return { ok: false, reason: 'blocked_by_blocked_domains' };
  }
  return { ok: true };
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
  score?: number;
  publishedDate?: string;
  pageAge?: string;
  extraSnippets?: string[];
}

interface WebSearchOptions {
  maxResults: number;
  allowedDomains: string[];
  blockedDomains: string[];
  freshness?: string;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  safeSearch?: 'off' | 'moderate' | 'strict';
  extraSnippets: boolean;
}

interface WebSearchProvider {
  name: string;
  search(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
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
    headers: { 'User-Agent': USER_AGENT, ...(headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

function queryWithDomainOperators(query: string, options: WebSearchOptions): string {
  if (options.allowedDomains.length > 0) {
    const domains = options.allowedDomains.map(filter => splitDomainFilter(filter).domain);
    return `${query} ${domains.map(domain => `site:${domain}`).join(' OR ')}`;
  }
  if (options.blockedDomains.length > 0) {
    const domains = options.blockedDomains.map(filter => splitDomainFilter(filter).domain);
    return `${query} ${domains.map(domain => `-site:${domain}`).join(' ')}`;
  }
  return query;
}

function normalizeFreshness(value: unknown): string | undefined {
  const freshness = optionalStringParam(value)?.toLowerCase();
  if (!freshness) return undefined;
  const aliases: Record<string, string> = {
    day: 'pd',
    daily: 'pd',
    '24h': 'pd',
    pd: 'pd',
    week: 'pw',
    weekly: 'pw',
    pw: 'pw',
    month: 'pm',
    monthly: 'pm',
    pm: 'pm',
    year: 'py',
    yearly: 'py',
    py: 'py',
  };
  if (aliases[freshness]) return aliases[freshness];
  if (/^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/.test(freshness)) return freshness;
  return undefined;
}

function searxngTimeRange(freshness: string | undefined): string | undefined {
  switch (freshness) {
    case 'pd': return 'day';
    case 'pw': return 'week';
    case 'pm': return 'month';
    case 'py': return 'year';
    default: return undefined;
  }
}

function searxngSafeSearch(value: WebSearchOptions['safeSearch']): string | undefined {
  switch (value) {
    case 'off': return '0';
    case 'moderate': return '1';
    case 'strict': return '2';
    default: return undefined;
  }
}

function parseSafeSearch(value: unknown): WebSearchOptions['safeSearch'] | undefined {
  const safeSearch = optionalStringParam(value)?.toLowerCase();
  if (safeSearch === 'off' || safeSearch === 'moderate' || safeSearch === 'strict') return safeSearch;
  return undefined;
}

function createDuckDuckGoSearchProvider(): WebSearchProvider {
  return {
    name: 'duckduckgo-html',
    search: async (query, options) => {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(queryWithDomainOperators(query, options))}`;
      return parseDuckDuckGoResults(await fetchTextProvider(url, 'duckduckgo-html')).slice(0, options.maxResults);
    },
  };
}

function createSearxngSearchProvider(baseUrl: string): WebSearchProvider {
  return {
    name: 'searxng',
    search: async (query, options) => {
      const endpoint = new URL('/search', baseUrl);
      endpoint.searchParams.set('q', queryWithDomainOperators(query, options));
      endpoint.searchParams.set('format', 'json');
      endpoint.searchParams.set('safesearch', searxngSafeSearch(options.safeSearch) ?? '1');
      if (options.searchLang) endpoint.searchParams.set('language', options.searchLang);
      const timeRange = searxngTimeRange(options.freshness);
      if (timeRange) endpoint.searchParams.set('time_range', timeRange);
      const payload = await fetchJsonProvider<{
        results?: Array<{ title?: string; url?: string; content?: string; snippet?: string; score?: number; publishedDate?: string }>;
      }>(endpoint.toString(), 'searxng');
      return (payload.results ?? []).slice(0, options.maxResults).flatMap((result) => {
        if (!result.url) return [];
        return [{
          title: stripHtml(result.title ?? ''),
          url: result.url,
          domain: urlDomain(result.url),
          snippet: stripHtml(result.content ?? result.snippet ?? ''),
          ...(typeof result.score === 'number' ? { score: result.score } : {}),
          ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
        }];
      });
    },
  };
}

function createBraveSearchProvider(apiKey: string): WebSearchProvider {
  return {
    name: 'brave',
    search: async (query, options) => {
      const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
      const providerMaxResults = Math.min(options.maxResults, 20);
      endpoint.searchParams.set('q', queryWithDomainOperators(query, options));
      endpoint.searchParams.set('count', String(providerMaxResults));
      if (options.freshness) endpoint.searchParams.set('freshness', options.freshness);
      if (options.country) endpoint.searchParams.set('country', options.country.toUpperCase());
      if (options.searchLang) endpoint.searchParams.set('search_lang', options.searchLang);
      if (options.uiLang) endpoint.searchParams.set('ui_lang', options.uiLang);
      if (options.safeSearch) endpoint.searchParams.set('safesearch', options.safeSearch);
      if (options.extraSnippets) endpoint.searchParams.set('extra_snippets', 'true');
      const payload = await fetchJsonProvider<{
        web?: {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
            age?: string;
            page_age?: string;
            extra_snippets?: string[];
          }>;
        };
      }>(endpoint.toString(), 'brave', {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      });
      return (payload.web?.results ?? []).slice(0, providerMaxResults).flatMap((result) => {
        if (!result.url) return [];
        return [{
          title: stripHtml(result.title ?? ''),
          url: result.url,
          domain: urlDomain(result.url),
          snippet: stripHtml(result.description ?? ''),
          ...(result.age || result.page_age ? { pageAge: result.age ?? result.page_age } : {}),
          ...(Array.isArray(result.extra_snippets) ? {
            extraSnippets: result.extra_snippets.map(snippet => stripHtml(snippet)).filter(Boolean),
          } : {}),
        }];
      });
    },
  };
}

function createWebSearchProviders(db?: Database): WebSearchProvider[] {
  const providers: WebSearchProvider[] = [];
  const config = getWebSearchProviderConfig(db);
  const braveKey = config.braveApiKey;
  if (braveKey) providers.push(createBraveSearchProvider(braveKey));
  const searxngBaseUrl = config.searxngBaseUrl;
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
      || lower === '::'
      || lower.startsWith('fc')
      || lower.startsWith('fd')
      || lower.startsWith('fe80:')
      || lower.startsWith('::ffff:127.')
      || lower.startsWith('::ffff:10.')
      || lower.startsWith('::ffff:192.168.')
      || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(lower);
  }

  const parts = address.split('.').map(part => Number(part));
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && b === 0)
    || (a >= 224)
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

interface FetchBodyResult {
  body: Buffer;
  bytesRead: number;
  truncated: boolean;
  contentLength?: number;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<FetchBodyResult> {
  const contentLengthHeader = response.headers?.get?.('content-length') ?? undefined;
  const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader)
    ? Number(contentLengthHeader)
    : undefined;

  if (!response.body) {
    const text = await response.text();
    const body = Buffer.from(text);
    if (body.byteLength <= maxBytes) {
      return { body, bytesRead: body.byteLength, truncated: false, ...(contentLength !== undefined ? { contentLength } : {}) };
    }
    return {
      body: body.subarray(0, maxBytes),
      bytesRead: maxBytes,
      truncated: true,
      ...(contentLength !== undefined ? { contentLength } : {}),
    };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - bytesRead;
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        bytesRead += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(chunk);
      bytesRead += chunk.byteLength;
    }

    if (!truncated && bytesRead >= maxBytes && (contentLength === undefined || contentLength > maxBytes)) {
      truncated = true;
      await reader.cancel();
    }
  } finally {
    reader.releaseLock();
  }

  return {
    body: Buffer.concat(chunks),
    bytesRead,
    truncated,
    ...(contentLength !== undefined ? { contentLength } : {}),
  };
}

interface FetchedPublicBody {
  response: Response;
  finalUrl: string;
  redirects: Array<{ from: string; to: string; status: number }>;
  body: Buffer;
  bytesRead: number;
  bodyTruncated: boolean;
  contentLength?: number;
}

async function fetchPublicHttpBody(
  rawUrl: string,
  options: {
    maxBytes: number;
    allowedDomains: string[];
    blockedDomains: string[];
    useCache: boolean;
  },
): Promise<
  | { ok: true; value: FetchedPublicBody }
  | { ok: false; code: string; message: string; details: Record<string, unknown> }
> {
  let currentUrl = rawUrl;
  const redirects: Array<{ from: string; to: string; status: number }> = [];

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const validation = await validatePublicHttpUrl(currentUrl);
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.reason,
        message: `WebFetch blocked URL: ${validation.reason}`,
        details: { url: currentUrl, redirects },
      };
    }

    const domainAccess = validateDomainAccess(validation.url.toString(), options.allowedDomains, options.blockedDomains);
    if (!domainAccess.ok) {
      return {
        ok: false,
        code: domainAccess.reason,
        message: `WebFetch blocked URL: ${domainAccess.reason}`,
        details: { url: validation.url.toString(), redirects },
      };
    }

    const requestInit = {
      redirect: 'manual',
      cache: options.useCache ? 'default' : 'no-store',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,text/markdown,application/pdf,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    } as RequestInit & { cache?: 'default' | 'no-store' };

    const response = await fetch(validation.url.toString(), requestInit);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      if (!location) {
        const body = await readResponseBody(response, options.maxBytes);
        return {
          ok: true,
          value: {
            response,
            finalUrl: validation.url.toString(),
            redirects,
            body: body.body,
            bytesRead: body.bytesRead,
            bodyTruncated: body.truncated,
            ...(body.contentLength !== undefined ? { contentLength: body.contentLength } : {}),
          },
        };
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return {
          ok: false,
          code: 'too_many_redirects',
          message: `WebFetch exceeded ${MAX_REDIRECTS} redirects`,
          details: { url: validation.url.toString(), redirects },
        };
      }

      const nextUrl = new URL(location, validation.url).toString();
      redirects.push({ from: validation.url.toString(), to: nextUrl, status: response.status });
      await response.body?.cancel();
      currentUrl = nextUrl;
      continue;
    }

    const body = await readResponseBody(response, options.maxBytes);
    return {
      ok: true,
      value: {
        response,
        finalUrl: validation.url.toString(),
        redirects,
        body: body.body,
        bytesRead: body.bytesRead,
        bodyTruncated: body.truncated,
        ...(body.contentLength !== undefined ? { contentLength: body.contentLength } : {}),
      },
    };
  }

  return {
    ok: false,
    code: 'too_many_redirects',
    message: `WebFetch exceeded ${MAX_REDIRECTS} redirects`,
    details: { url: currentUrl, redirects },
  };
}

function isPdfContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(';', 1)[0]?.trim() === 'application/pdf';
}

function isTextLikeContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (!ct) return true;
  if (ct.startsWith('text/')) return true;
  return ct === 'application/json'
    || ct === 'application/xml'
    || ct === 'application/xhtml+xml'
    || ct === 'application/javascript'
    || ct === 'application/x-javascript'
    || ct === 'application/ld+json'
    || ct === 'application/rss+xml'
    || ct === 'application/atom+xml'
    || ct.endsWith('+json')
    || ct.endsWith('+xml');
}

function decodeBodyText(body: Buffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(body);
}

function looksBinary(text: string): boolean {
  return text.slice(0, 8192).includes('\u0000');
}

export function createWebFetchTool(): AgentTool<any> {
  return {
    name: 'WebFetch',
    label: 'WebFetch',
    description: 'Fetch a public URL and return its content. Redirects are followed only after each target is revalidated. HTML pages are extracted to clean Markdown; PDFs are text-extracted; JSON/plain text/markdown are returned as-is. Supports domain filters, cache bypass, and response size limits.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'text', 'raw'], default: 'markdown' },
        allowed_domains: { type: 'array', items: { type: 'string' }, description: 'Only fetch URLs on these domains or paths, e.g. "example.com" or "docs.example.com/api".' },
        blocked_domains: { type: 'array', items: { type: 'string' }, description: 'Do not fetch URLs on these domains or paths.' },
        max_bytes: { type: 'number', default: DEFAULT_FETCH_MAX_BYTES, description: 'Maximum response bytes to read before truncating.' },
        max_content_chars: { type: 'number', default: DEFAULT_OUTPUT_CHARS, description: 'Maximum characters returned to the model.' },
        use_cache: { type: 'boolean', default: true, description: 'Set false to bypass HTTP caches when fresh content is required.' },
        pages: { type: 'string', description: 'For PDFs: page range like "1-5" or "2,7".' },
      },
      required: ['url'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const url = String(args.url || '');
      if (!url) return jsonResult({ error: 'url is required' });

      const allowed = domainFiltersParam(args.allowed_domains);
      const blocked = domainFiltersParam(args.blocked_domains);
      if (allowed.invalid.length > 0 || blocked.invalid.length > 0) {
        return errorResult('invalid_domain_filters', 'WebFetch received invalid domain filters', {
          invalidAllowedDomains: allowed.invalid,
          invalidBlockedDomains: blocked.invalid,
        });
      }
      if (allowed.filters.length > 0 && blocked.filters.length > 0) {
        return errorResult('invalid_domain_filters', 'Use either allowed_domains or blocked_domains, not both');
      }

      const maxBytes = clampNumberParam(args.max_bytes, DEFAULT_FETCH_MAX_BYTES, 1, HARD_FETCH_MAX_BYTES);
      const maxContentChars = clampNumberParam(args.max_content_chars, DEFAULT_OUTPUT_CHARS, 1_000, HARD_OUTPUT_CHARS);
      let fetched: FetchedPublicBody;
      try {
        const result = await fetchPublicHttpBody(url, {
          maxBytes,
          allowedDomains: allowed.filters,
          blockedDomains: blocked.filters,
          useCache: args.use_cache !== false,
        });
        if (!result.ok) return errorResult(result.code, result.message, result.details);
        fetched = result.value;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('fetch_failed', `WebFetch failed: ${message}`, { url });
      }

      const response = fetched.response;
      const bodyText = decodeBodyText(fetched.body);
      const contentType = response.headers?.get?.('content-type') ?? '';
      const finalUrl = fetched.finalUrl;
      const format = args.format === 'raw' || args.format === 'text' ? args.format : 'markdown';

      let content: string;
      let extractMode: string | undefined;
      let title: string | undefined;
      let pdfInfo: { totalPages: number; pages: number[] } | undefined;
      if (isPdfContentType(contentType)) {
        try {
          const extracted = await extractPdfText(fetched.body, optionalStringParam(args.pages));
          content = extracted.text;
          extractMode = 'pdf';
          pdfInfo = { totalPages: extracted.totalPages, pages: extracted.pages };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult('pdf_extract_failed', `WebFetch could not extract PDF text: ${message}`, {
            url: finalUrl,
            status: response.status,
            contentType,
          });
        }
      } else if (format === 'raw') {
        content = bodyText;
        extractMode = 'raw';
      } else if (!shouldExtractAsHtml(contentType, bodyText)) {
        if (!isTextLikeContentType(contentType) || looksBinary(bodyText)) {
          return errorResult('unsupported_binary_content', 'WebFetch received non-text content that cannot be returned safely', {
            url: finalUrl,
            status: response.status,
            contentType: contentType || 'unknown',
            bytesRead: fetched.bytesRead,
            bodyTruncated: fetched.bodyTruncated,
          });
        }
        content = bodyText;
        extractMode = 'passthrough';
      } else if (format === 'text') {
        content = stripHtmlToText(bodyText);
        extractMode = 'text';
      } else {
        const extracted = await htmlToMarkdown(bodyText, finalUrl);
        content = extracted.markdown;
        extractMode = extracted.mode;
        title = extracted.title;
      }

      const header = [
        `URL: ${finalUrl}`,
        `Status: ${response.status} ${response.statusText}`,
        `Content-Type: ${contentType || 'unknown'}`,
        ...(fetched.redirects.length > 0 ? [`Redirects: ${fetched.redirects.length}`] : []),
        ...(fetched.bodyTruncated ? [`Body: truncated after ${fetched.bytesRead} bytes`] : []),
        ...(title ? [`Title: ${title}`] : []),
      ].join('\n');
      return textResult(
        truncateText(`${header}\n\n${content}`, maxContentChars),
        {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType,
          url: finalUrl,
          redirects: fetched.redirects,
          bytesRead: fetched.bytesRead,
          bodyTruncated: fetched.bodyTruncated,
          maxBytes,
          maxContentChars,
          allowedDomains: allowed.filters,
          blockedDomains: blocked.filters,
          ...(fetched.contentLength !== undefined ? { contentLength: fetched.contentLength } : {}),
          ...(extractMode ? { extractMode } : {}),
          ...(title ? { title } : {}),
          ...(pdfInfo ? { pdf: pdfInfo } : {}),
        },
      );
    },
  } as unknown as AgentTool<any>;
}

export function createWebSearchTool(db?: Database): AgentTool<any> {
  return {
    name: 'WebSearch',
    label: 'WebSearch',
    description: 'Search the web for current information. Supports domain filters, freshness, locale, SafeSearch, and richer provider snippets when available.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number', default: 5 },
        allowed_domains: { type: 'array', items: { type: 'string' } },
        blocked_domains: { type: 'array', items: { type: 'string' } },
        freshness: {
          type: 'string',
          description: 'Freshness filter: day/week/month/year, pd/pw/pm/py, or Brave custom YYYY-MM-DDtoYYYY-MM-DD range.',
        },
        country: { type: 'string', description: 'Two-letter country code for providers that support localization.' },
        search_lang: { type: 'string', description: 'Search result language, e.g. "en" or "zh-CN".' },
        ui_lang: { type: 'string', description: 'Provider UI language for metadata when supported.' },
        safe_search: { type: 'string', enum: ['off', 'moderate', 'strict'], default: 'moderate' },
        extra_snippets: { type: 'boolean', default: false },
      },
      required: ['query'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const query = String(args.query || '').trim();
      if (!query) return jsonResult({ error: 'query is required' });
      const maxResults = clampNumberParam(args.max_results, 5, 1, 10);
      const allowed = domainFiltersParam(args.allowed_domains);
      const blocked = domainFiltersParam(args.blocked_domains);
      if (allowed.invalid.length > 0 || blocked.invalid.length > 0) {
        return errorResult('invalid_domain_filters', 'WebSearch received invalid domain filters', {
          invalidAllowedDomains: allowed.invalid,
          invalidBlockedDomains: blocked.invalid,
        });
      }
      if (allowed.filters.length > 0 && blocked.filters.length > 0) {
        return errorResult('invalid_domain_filters', 'Use either allowed_domains or blocked_domains, not both');
      }
      const searchOptions: WebSearchOptions = {
        maxResults: allowed.filters.length > 0 || blocked.filters.length > 0
          ? Math.min(Math.max(maxResults * 5, 20), 50)
          : maxResults,
        allowedDomains: allowed.filters,
        blockedDomains: blocked.filters,
        freshness: normalizeFreshness(args.freshness),
        country: optionalStringParam(args.country),
        searchLang: optionalStringParam(args.search_lang),
        uiLang: optionalStringParam(args.ui_lang),
        safeSearch: parseSafeSearch(args.safe_search) ?? 'moderate',
        extraSnippets: booleanParam(args.extra_snippets),
      };
      const fallbacks: Array<Record<string, unknown>> = [];
      for (const provider of createWebSearchProviders(db)) {
        try {
          const providerResults = await provider.search(query, searchOptions);
          const results = providerResults
            .filter(result => result.url && result.domain)
            .filter(result => allowed.filters.length === 0 || filterMatchesUrl(result.url, allowed.filters))
            .filter(result => blocked.filters.length === 0 || !filterMatchesUrl(result.url, blocked.filters))
            .slice(0, maxResults);
          if (results.length === 0 && providerResults.length > 0 && (allowed.filters.length > 0 || blocked.filters.length > 0)) {
            fallbacks.push({
              provider: provider.name,
              message: 'no results matched domain filters',
              unfilteredTotal: providerResults.length,
            });
            continue;
          }
          return textResult(JSON.stringify({
            query,
            results,
            source: provider.name,
            fallbacks,
            options: {
              max_results: maxResults,
              ...(searchOptions.freshness ? { freshness: searchOptions.freshness } : {}),
              ...(searchOptions.country ? { country: searchOptions.country } : {}),
              ...(searchOptions.searchLang ? { search_lang: searchOptions.searchLang } : {}),
              ...(searchOptions.uiLang ? { ui_lang: searchOptions.uiLang } : {}),
              safe_search: searchOptions.safeSearch,
              extra_snippets: searchOptions.extraSnippets,
              allowed_domains: allowed.filters,
              blocked_domains: blocked.filters,
            },
          }, null, 2), {
            ok: true,
            provider: provider.name,
            query,
            total: results.length,
            results,
            allowedDomains: allowed.filters,
            blockedDomains: blocked.filters,
            ...(searchOptions.freshness ? { freshness: searchOptions.freshness } : {}),
            ...(searchOptions.country ? { country: searchOptions.country } : {}),
            ...(searchOptions.searchLang ? { searchLang: searchOptions.searchLang } : {}),
            ...(searchOptions.uiLang ? { uiLang: searchOptions.uiLang } : {}),
            safeSearch: searchOptions.safeSearch,
            extraSnippets: searchOptions.extraSnippets,
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
