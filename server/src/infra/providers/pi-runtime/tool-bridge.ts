import {
  createWriteTool,
  createEditTool,
  createBashTool,
} from '@earendil-works/pi-coding-agent';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { execFile } from 'child_process';
import { readFile, readdir, stat } from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import { ALL_TOOL_NAMES, normalizeToolName, type ToolName } from '@zclaudia/shared/core/tools';
import { normalizeTodoItems } from '../../../application/conversation/interactions/todo-normalizer.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import { activateConditionalSkillsForPaths, activateConditionalSkillsForToolNames } from '../../../application/plugins/skill-tools.js';
import { loadMcpServersFromDb } from '../../../utils/mcp-config.js';
import { mcpClientManager } from '../../../utils/mcp-client-manager.js';
import type { PermissionCallback } from '../types.js';
export { ALL_TOOL_NAMES, type ToolName };

const execFileAsync = promisify(execFile);

type ToolContent = Array<{ type: 'text'; text: string }>;
const DEFAULT_READ_MAX_BYTES = 512 * 1024;

function textResult<TDetails extends Record<string, unknown> = Record<string, never>>(
  text: string,
  details?: TDetails,
): { content: ToolContent; details: TDetails | Record<string, never> } {
  return { content: [{ type: 'text', text }], details: details ?? {} };
}

function jsonResult(value: unknown): { content: ToolContent; details: Record<string, never> } {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): { content: ToolContent; details: Record<string, unknown> } {
  return textResult(message, { ok: false, error: code, message, ...details });
}

function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object'
    ? candidate as Record<string, unknown>
    : {};
}

function extractSkillActivationPaths(toolName: ToolName, params: Record<string, unknown>): string[] {
  const value = (() => {
    if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') return params.path ?? params.file_path;
    if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS') return params.path;
    return undefined;
  })();
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function withConditionalSkillActivation(tool: AgentTool<any>, name: ToolName, cwd: string): AgentTool<any> {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown) => {
      const result = await originalExecute(toolCallId, params);
      const paths = extractSkillActivationPaths(name, toolParams(toolCallId, params));
      if (paths.length > 0) activateConditionalSkillsForPaths(paths, cwd);
      activateConditionalSkillsForToolNames([name]);
      return result;
    },
  } as AgentTool<any>;
}

function truncateText(value: string, limit = 80_000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... [truncated ${value.length - limit} chars]`;
}

function resolveInsideWorkspace(cwd: string, requestedPath: unknown): string {
  const rawPath = typeof requestedPath === 'string' && requestedPath.trim()
    ? requestedPath.trim()
    : '.';
  const resolved = path.resolve(cwd, rawPath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside workspace: ${rawPath}`);
  }
  return resolved;
}

function toWorkspaceRelative(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}

function parseRipgrepLines(cwd: string, stdout: string, maxResults: number): Array<{ file: string; line: number; preview: string }> {
  return stdout
    .split('\n')
    .filter(Boolean)
    .slice(0, maxResults)
    .flatMap((line) => {
      const match = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!match) return [];
      return [{
        file: toWorkspaceRelative(cwd, match[1]),
        line: Number(match[2]),
        preview: match[3].trim(),
      }];
    });
}

function parseRipgrepContextLines(cwd: string, stdout: string, maxResults: number): Array<{ file: string; line: number; preview: string; isMatch: boolean }> {
  return stdout
    .split('\n')
    .filter(line => Boolean(line) && line !== '--')
    .slice(0, maxResults)
    .flatMap((line) => {
      const match = /^(.*?)([:-])(\d+)\2(.*)$/.exec(line);
      if (!match) return [];
      return [{
        file: toWorkspaceRelative(cwd, match[1]),
        line: Number(match[3]),
        preview: match[4].trim(),
        isMatch: match[2] === ':',
      }];
    });
}

async function ripgrepSearch(
  cwd: string,
  searchRoot: string,
  query: string,
  maxResults: number,
  include?: string,
): Promise<Array<{ file: string; line: number; preview: string }>> {
  const args = [
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    '--max-count',
    String(maxResults),
    ...(include ? ['--glob', include] : []),
    query,
    searchRoot,
  ];

  try {
    const { stdout } = await execFileAsync('rg', args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
    return parseRipgrepLines(cwd, stdout || '', maxResults);
  } catch (err) {
    const maybeOutput = err as { stdout?: string; code?: number };
    if (maybeOutput.code === 1) return [];
    if (maybeOutput.stdout) return parseRipgrepLines(cwd, maybeOutput.stdout, maxResults);
    throw err;
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function formatNumberedLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}|${line}`).join('\n');
}

function createReadBridgeTool(cwd: string): AgentTool<any> {
  return {
    name: 'Read',
    label: 'Read',
    description: 'Read a text file with line pagination, size limits, and binary-file protection.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        file_path: { type: 'string' },
        offset: { type: 'number', default: 1 },
        limit: { type: 'number', default: 200 },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requestedPath = args.path ?? args.file_path;
      if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
        return errorResult('missing_path', 'read requires a path');
      }
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requestedPath);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }

      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return errorResult('not_a_file', `Path is not a file: ${requestedPath}`, { path: String(requestedPath) });
        }
        if (fileStat.size > DEFAULT_READ_MAX_BYTES) {
          return errorResult('file_too_large', `File is too large to read in one call: ${requestedPath}`, {
            path: toWorkspaceRelative(cwd, filePath),
            size: fileStat.size,
            maxBytes: DEFAULT_READ_MAX_BYTES,
          });
        }
        const buffer = await readFile(filePath);
        if (isBinaryBuffer(buffer)) {
          return errorResult('binary_file', `Refusing to read binary file: ${requestedPath}`, {
            path: toWorkspaceRelative(cwd, filePath),
            size: fileStat.size,
          });
        }
        const text = buffer.toString('utf8');
        const lines = text.split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        const totalLines = lines.length;
        const offset = Math.max(1, Number(args.offset ?? 1) || 1);
        const limit = Math.max(1, Math.min(Number(args.limit ?? 200) || 200, 2000));
        const selected = lines.slice(offset - 1, offset - 1 + limit);
        const relPath = toWorkspaceRelative(cwd, filePath);
        return textResult(formatNumberedLines(selected, offset), {
          ok: true,
          path: relPath,
          offset,
          limit,
          totalLines,
          returnedLines: selected.length,
          size: fileStat.size,
        });
      } catch (err) {
        return errorResult('read_failed', err instanceof Error ? err.message : String(err), {
          path: String(requestedPath),
        });
      }
    },
  } as unknown as AgentTool<any>;
}

function createGrepBridgeTool(cwd: string): AgentTool<any> {
  return {
    name: 'Grep',
    label: 'Grep',
    description: 'Search file contents with ripgrep using optional context, glob filtering, and structured output.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        include: { type: 'string' },
        context: { type: 'number', default: 0 },
        max_results: { type: 'number', default: 100 },
      },
      required: ['pattern'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const pattern = String(args.pattern || '').trim();
      if (!pattern) return errorResult('missing_pattern', 'grep requires a pattern');
      let searchRoot: string;
      try {
        searchRoot = resolveInsideWorkspace(cwd, args.path);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err), { pattern });
      }
      const context = Math.max(0, Math.min(Number(args.context ?? 0) || 0, 20));
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 100) || 100, 500));
      const rgArgs = [
        '--line-number',
        '--no-heading',
        '--color',
        'never',
        ...(context > 0 ? ['-C', String(context)] : []),
        ...(typeof args.include === 'string' && args.include ? ['--glob', args.include] : []),
        pattern,
        searchRoot,
      ];
      try {
        const { stdout } = await execFileAsync('rg', rgArgs, { timeout: 30_000, maxBuffer: 1024 * 1024 });
        const results = context > 0
          ? parseRipgrepContextLines(cwd, stdout || '', maxResults)
          : parseRipgrepLines(cwd, stdout || '', maxResults).map(row => ({ ...row, isMatch: true }));
        return textResult(JSON.stringify({ pattern, path: toWorkspaceRelative(cwd, searchRoot) || '.', results, total: results.length }, null, 2), {
          ok: true,
          pattern,
          path: toWorkspaceRelative(cwd, searchRoot) || '.',
          total: results.length,
          context,
        });
      } catch (err) {
        const maybeOutput = err as { code?: number; stdout?: string };
        if (maybeOutput.code === 1) {
          return textResult(JSON.stringify({ pattern, path: toWorkspaceRelative(cwd, searchRoot) || '.', results: [], total: 0 }, null, 2), {
            ok: true,
            pattern,
            path: toWorkspaceRelative(cwd, searchRoot) || '.',
            total: 0,
            context,
          });
        }
        if (maybeOutput.stdout) {
          const results = context > 0
            ? parseRipgrepContextLines(cwd, maybeOutput.stdout, maxResults)
            : parseRipgrepLines(cwd, maybeOutput.stdout, maxResults).map(row => ({ ...row, isMatch: true }));
          return textResult(JSON.stringify({ pattern, path: toWorkspaceRelative(cwd, searchRoot) || '.', results, total: results.length }, null, 2), {
            ok: true,
            pattern,
            path: toWorkspaceRelative(cwd, searchRoot) || '.',
            total: results.length,
            context,
          });
        }
        return errorResult('grep_failed', err instanceof Error ? err.message : String(err), { pattern });
      }
    },
  } as unknown as AgentTool<any>;
}

function createLsBridgeTool(cwd: string): AgentTool<any> {
  const LS_DEFAULT_LIMIT = 500;
  return {
    name: 'LS',
    label: 'LS',
    description: 'List the immediate contents of a directory, sorted alphabetically, with a "/" suffix for subdirectories. Includes dotfiles. Use Glob/Grep for recursive search.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory (default: workspace root)' },
        limit: { type: 'number', default: LS_DEFAULT_LIMIT },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      let dirPath: string;
      try {
        dirPath = resolveInsideWorkspace(cwd, args.path);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }
      const limit = Math.max(1, Math.min(Number(args.limit ?? LS_DEFAULT_LIMIT) || LS_DEFAULT_LIMIT, 2000));
      try {
        const dirStat = await stat(dirPath);
        if (!dirStat.isDirectory()) {
          return errorResult('not_a_directory', `Path is not a directory: ${toWorkspaceRelative(cwd, dirPath) || '.'}`, { path: toWorkspaceRelative(cwd, dirPath) || '.' });
        }
        const entries = (await readdir(dirPath)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        const lines: string[] = [];
        let truncated = false;
        for (const entry of entries) {
          if (lines.length >= limit) { truncated = true; break; }
          let suffix = '';
          try {
            if ((await stat(path.join(dirPath, entry))).isDirectory()) suffix = '/';
          } catch { /* un-stattable entry (e.g. dangling symlink) — list it without a suffix */ }
          lines.push(entry + suffix);
        }
        const relPath = toWorkspaceRelative(cwd, dirPath) || '.';
        if (lines.length === 0) {
          return textResult('(empty directory)', { ok: true, path: relPath, total: 0, truncated });
        }
        return textResult(lines.join('\n'), { ok: true, path: relPath, total: lines.length, truncated });
      } catch (err) {
        return errorResult('ls_failed', err instanceof Error ? err.message : String(err), { path: String(args.path ?? '.') });
      }
    },
  } as unknown as AgentTool<any>;
}

function withToolName(tool: AgentTool<any>, name: ToolName, label: string = name): AgentTool<any> {
  return { ...tool, name, label } as AgentTool<any>;
}

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

function getMcpServer(db: Database.Database | undefined, serverName: string) {
  if (!db) throw new Error('MCP tools require a database-backed run context');
  const servers = loadMcpServersFromDb(db, 'zclaudia');
  const config = servers[serverName];
  if (!config) throw new Error(`MCP server not configured or enabled: ${serverName}`);
  return config;
}

function mcpErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('database-backed run context')) return 'missing_db_context';
  if (message.includes('not configured or enabled')) return 'server_not_configured';
  if (message.includes('timeout')) return 'request_timeout';
  if (message.includes('not running') || message.includes('exited')) return 'server_unavailable';
  return 'mcp_error';
}

function extractAskUserQuestionDetail(args: Record<string, unknown>): string {
  const questions = args.questions;
  if (Array.isArray(questions)) {
    const [firstQuestion] = questions;
    if (firstQuestion && typeof firstQuestion === 'object') {
      const question = (firstQuestion as { question?: unknown }).question;
      if (typeof question === 'string' && question.trim()) {
        const extra = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
        return question.trim() + extra;
      }
    }
  }
  return 'AskUserQuestion';
}

function createTodoWriteTool(): AgentTool<any> {
  return {
    name: 'TodoWrite',
    label: 'TodoWrite',
    description: 'Update the visible task list for the user.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const todos = normalizeTodoItems(args);
      return jsonResult({ success: true, count: todos.length, todos });
    },
  } as unknown as AgentTool<any>;
}

function createAskUserQuestionTool(permissionCallback?: PermissionCallback): AgentTool<any> {
  return {
    name: 'AskUserQuestion',
    label: 'AskUserQuestion',
    description: 'Ask the user one or more structured questions and wait for an answer.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              header: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['label', 'description'],
                },
              },
              multiSelect: { type: 'boolean' },
              allowCustomValue: { type: 'boolean' },
            },
            required: ['question', 'header', 'options'],
          },
        },
      },
      required: ['questions'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!permissionCallback) {
        return errorResult('missing_interaction_callback', 'AskUserQuestion requires the ZClaudia interaction callback');
      }
      const decision = await permissionCallback({
        requestId: toolCallId,
        toolName: 'AskUserQuestion',
        toolInput: args,
        detail: extractAskUserQuestionDetail(args),
        timeoutSeconds: 0,
      });
      return textResult(decision.message?.trim() || 'No answer provided.', {
        ok: true,
        answered: true,
        behavior: decision.behavior,
      });
    },
  } as unknown as AgentTool<any>;
}

function createWebFetchTool(): AgentTool<any> {
  return {
    name: 'WebFetch',
    label: 'WebFetch',
    description: 'Fetch a URL and return readable text content.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        format: { type: 'string', enum: ['text', 'raw'], default: 'text' },
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
      const content = args.format === 'raw' ? body : stripHtml(body);
      return textResult(
        truncateText(`URL: ${validation.url.toString()}\nStatus: ${response.status} ${response.statusText}\nContent-Type: ${contentType || 'unknown'}\n\n${content}`),
        {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType,
          url: validation.url.toString(),
        },
      );
    },
  } as unknown as AgentTool<any>;
}

function createWebSearchTool(): AgentTool<any> {
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

function createMcpTool(db?: Database.Database): AgentTool<any> {
  return {
    name: 'MCPTool',
    label: 'MCPTool',
    description: 'Call a tool exposed by a configured MCP server.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        arguments: { type: 'object' },
      },
      required: ['server', 'tool'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const server = String(args.server || '');
      const tool = String(args.tool || '');
      if (!server) return errorResult('missing_server', 'MCPTool requires a server name');
      if (!tool) return errorResult('missing_tool', 'MCPTool requires a tool name', { server });
      try {
        const config = getMcpServer(db, server);
        const result = await mcpClientManager.callTool(server, config, tool, (args.arguments as Record<string, unknown>) || {});
        return {
          content: result.content as any,
          details: { ok: !result.isError, server, tool, isError: !!result.isError },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(mcpErrorCode(err), message, { server, tool });
      }
    },
  } as unknown as AgentTool<any>;
}

function createToolSearchTool(db?: Database.Database): AgentTool<any> {
  return {
    name: 'ToolSearch',
    label: 'ToolSearch',
    description: 'Search tools exposed by configured MCP servers without loading every schema into the prompt.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text matched against server, tool name, and description' },
        server: { type: 'string', description: 'Optional MCP server name' },
        max_results: { type: 'number', default: 20 },
        include_schema: { type: 'boolean', default: false },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'ToolSearch requires a database-backed run context');
      const query = String(args.query ?? '').trim().toLowerCase();
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 20) || 20, 100));
      const includeSchema = args.include_schema === true;
      const servers = loadMcpServersFromDb(db, 'zclaudia');
      const requested = args.server ? [String(args.server)] : Object.keys(servers);
      const results: Array<Record<string, unknown>> = [];
      const errors: Array<{ server: string; error: string }> = [];

      for (const server of requested) {
        const config = servers[server];
        if (!config) {
          errors.push({ server, error: 'not configured or disabled' });
          continue;
        }
        try {
          const tools = await mcpClientManager.listTools(server, config);
          for (const tool of tools) {
            const haystack = `${server} ${tool.name} ${tool.description ?? ''}`.toLowerCase();
            if (query && !haystack.includes(query)) continue;
            results.push({
              server,
              tool: tool.name,
              description: tool.description,
              ...(includeSchema && { inputSchema: tool.inputSchema }),
            });
            if (results.length >= maxResults) break;
          }
        } catch (err) {
          errors.push({ server, error: err instanceof Error ? err.message : String(err) });
        }
        if (results.length >= maxResults) break;
      }

      return textResult(JSON.stringify({
        query,
        results,
        errors,
        total: results.length,
      }, null, 2), { ok: true, query, total: results.length, errors });
    },
  } as unknown as AgentTool<any>;
}

function createListMcpResourcesTool(db?: Database.Database): AgentTool<any> {
  return {
    name: 'ListMcpResources',
    label: 'ListMcpResources',
    description: 'List resources exposed by configured MCP servers.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Optional MCP server name' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'MCP resources require a database-backed run context');
      const servers = loadMcpServersFromDb(db, 'zclaudia');
      const requested = args.server ? [String(args.server)] : Object.keys(servers);
      const resources = [];
      for (const server of requested) {
        const config = servers[server];
        if (!config) {
          resources.push({ server, error: 'not configured or disabled' });
          continue;
        }
        try {
          resources.push({ server, resources: await mcpClientManager.listResources(server, config) });
        } catch (err) {
          resources.push({ server, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return textResult(JSON.stringify(resources, null, 2), { ok: true, count: resources.length });
    },
  } as unknown as AgentTool<any>;
}

function createReadMcpResourceTool(db?: Database.Database): AgentTool<any> {
  return {
    name: 'ReadMcpResource',
    label: 'ReadMcpResource',
    description: 'Read a resource exposed by a configured MCP server.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        uri: { type: 'string' },
      },
      required: ['server', 'uri'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const server = String(args.server || '');
      const uri = String(args.uri || '');
      if (!server) return errorResult('missing_server', 'ReadMcpResource requires a server name');
      if (!uri) return errorResult('missing_uri', 'ReadMcpResource requires a resource URI', { server });
      try {
        const config = getMcpServer(db, server);
        const result = await mcpClientManager.readResource(server, config, uri);
        return textResult(JSON.stringify(result, null, 2), { ok: true, server, uri, count: result.contents?.length ?? 0 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(mcpErrorCode(err), message, { server, uri });
      }
    },
  } as unknown as AgentTool<any>;
}

function createGlobTool(cwd: string): AgentTool<any> {
  return {
    name: 'Glob',
    label: 'Glob',
    description: 'Find files by glob pattern under the workspace without invoking a shell command.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern such as **/*.ts' },
        path: { type: 'string', description: 'Optional workspace-relative directory to search' },
        max_results: { type: 'number', default: 100 },
        include_hidden: { type: 'boolean', default: false },
      },
      required: ['pattern'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const pattern = String(args.pattern || '').trim();
      if (!pattern) return errorResult('missing_pattern', 'Glob requires a pattern');
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 100) || 100, 500));
      let searchRoot: string;
      try {
        searchRoot = resolveInsideWorkspace(cwd, args.path);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err), { pattern });
      }
      try {
        const { stdout } = await execFileAsync('rg', [
          '--files',
          ...(args.include_hidden === true ? ['--hidden'] : []),
          '--glob',
          pattern,
          searchRoot,
        ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
        const results = (stdout || '')
          .split('\n')
          .filter(Boolean)
          .map(file => toWorkspaceRelative(cwd, file))
          .sort((a, b) => a.localeCompare(b))
          .slice(0, maxResults);
        return textResult(JSON.stringify({ pattern, path: toWorkspaceRelative(cwd, searchRoot) || '.', results, total: results.length }, null, 2), {
          ok: true,
          pattern,
          path: toWorkspaceRelative(cwd, searchRoot) || '.',
          total: results.length,
        });
      } catch (err) {
        const maybeOutput = err as { code?: number };
        if (maybeOutput.code === 1) {
          return textResult(JSON.stringify({ pattern, path: toWorkspaceRelative(cwd, searchRoot) || '.', results: [], total: 0 }, null, 2), {
            ok: true,
            pattern,
            path: toWorkspaceRelative(cwd, searchRoot) || '.',
            total: 0,
          });
        }
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('glob_failed', message, { pattern });
      }
    },
  } as unknown as AgentTool<any>;
}

function taskTitleFromArgs(args: Record<string, unknown>): string | undefined {
  if (typeof args.description === 'string' && args.description.trim()) return args.description.trim();
  if (typeof args.prompt === 'string' && args.prompt.trim()) return truncateText(args.prompt.trim(), 120);
  return undefined;
}

function createAgentTool(
  sessionId?: string,
  runId?: string,
  db?: Database.Database,
  permissionOverride?: Partial<UnifiedPermissionPolicy>,
  agentTaskExecutor?: TaskExecutor,
): AgentTool<any> {
  return {
    name: 'Agent',
    label: 'Agent',
    description: 'Delegate work to a background sub-agent task.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        description: { type: 'string' },
        wait: { type: 'boolean' },
      },
      required: ['prompt'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!agentTaskExecutor) return jsonResult({ error: 'Agent tool requires a task executor' });
      if (!db) return jsonResult({ error: 'Agent tool requires database context' });
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
        return errorResult('missing_prompt', 'Agent requires a prompt');
      }

      const taskService = new TaskService(new TaskRepository(db));
      const task = taskService.createTask({
        type: 'agent',
        title: taskTitleFromArgs(args),
        parentSessionId: sessionId,
        parentRunId: runId,
        parentToolUseId: typeof toolCallId === 'string' ? toolCallId : undefined,
        metadata: {
          prompt: args.prompt,
          wait: Boolean(args.wait),
          permissionOverride: args.permission_override ?? args.permissionOverride ?? permissionOverride,
        },
      });

      try {
        const started = await agentTaskExecutor.start(task);
        const running = taskService.startTask(task.id, { executorRef: started.executorRef });
        if (args.wait !== true) {
          return jsonResult({
            ok: true,
            taskId: task.id,
            status: running.status,
          });
        }
        const result = await agentTaskExecutor.wait(task.id);
        const updated = result.status === 'completed'
          ? taskService.completeTask(task.id, result.result ?? {})
          : result.status === 'stopped'
            ? taskService.stopTask(task.id, result.result)
            : taskService.failTask(task.id, result.result ?? { error: 'Agent task failed' });
        return jsonResult({
          ok: true,
          taskId: task.id,
          status: updated.status,
          result: result.result,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        taskService.failTask(task.id, { error: message });
        return errorResult('agent_delegate_failed', message, { taskId: task.id });
      }
    },
  } as unknown as AgentTool<any>;
}

function createTaskOutputTool(db?: Database.Database): AgentTool<any> {
  return {
    name: 'TaskOutput',
    label: 'TaskOutput',
    description: 'Read task state, result, and lifecycle events by task id.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        include_events: { type: 'boolean', default: true },
      },
      required: ['task_id'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'TaskOutput requires database context');
      const taskId = args.task_id ?? args.taskId;
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return errorResult('missing_task_id', 'TaskOutput requires task_id');
      }

      const repo = new TaskRepository(db);
      const task = repo.findById(taskId.trim());
      if (!task) return errorResult('task_not_found', `Task not found: ${taskId}`, { taskId });
      const includeEvents = args.include_events !== false;
      const events = includeEvents ? repo.listEvents(task.id) : [];
      return textResult(JSON.stringify({ task, events }, null, 2), {
        ok: true,
        taskId: task.id,
        status: task.status,
        eventCount: events.length,
      });
    },
  } as unknown as AgentTool<any>;
}

function createMonitorTool(sessionId?: string, runId?: string, db?: Database.Database): AgentTool<any> {
  return {
    name: 'Monitor',
    label: 'Monitor',
    description: 'Create, inspect, or stop a monitor task using the shared Task lifecycle.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'stop'], default: 'start' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        target_task_id: { type: 'string' },
        interval_ms: { type: 'number' },
        reason: { type: 'string' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'Monitor requires database context');
      const repo = new TaskRepository(db);
      const service = new TaskService(repo);
      const action = typeof args.action === 'string' ? args.action : 'start';
      const taskId = args.task_id ?? args.taskId;

      if (action === 'start') {
        const task = service.createTask({
          type: 'monitor',
          title: typeof args.title === 'string' ? args.title : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
          parentSessionId: sessionId,
          parentRunId: runId,
          parentToolUseId: typeof toolCallId === 'string' ? toolCallId : undefined,
          metadata: {
            targetTaskId: typeof args.target_task_id === 'string' ? args.target_task_id : undefined,
            intervalMs: typeof args.interval_ms === 'number' ? args.interval_ms : undefined,
          },
        });
        const running = service.startTask(task.id, {
          executorRef: { providerType: 'task-monitor', taskId: task.id },
        });
        return jsonResult({ ok: true, taskId: running.id, status: running.status });
      }

      if (typeof taskId !== 'string' || !taskId.trim()) {
        return errorResult('missing_task_id', `Monitor action "${action}" requires task_id`);
      }
      const task = repo.findById(taskId.trim());
      if (!task) return errorResult('task_not_found', `Monitor task not found: ${taskId}`, { taskId });

      if (action === 'status') {
        return jsonResult({ ok: true, task, events: repo.listEvents(task.id) });
      }
      if (action === 'stop') {
        try {
          const stopped = service.stopTask(task.id, {
            error: typeof args.reason === 'string' ? args.reason : undefined,
          });
          return jsonResult({ ok: true, taskId: stopped.id, status: stopped.status });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult('monitor_stop_failed', message, { taskId: task.id });
        }
      }

      return errorResult('unknown_monitor_action', `Unknown Monitor action: ${action}`);
    },
  } as unknown as AgentTool<any>;
}

function createLspTool(cwd: string): AgentTool<any> {
  return {
    name: 'LSPTool',
    label: 'LSPTool',
    description: 'Find symbols, references, definitions, or diagnostics in the workspace. Uses ripgrep as a structured fallback when no language server is attached.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['symbols', 'references', 'definition', 'diagnostics'], default: 'symbols' },
        query: { type: 'string' },
        path: { type: 'string', description: 'Optional workspace-relative directory to search' },
        include: { type: 'string', description: 'Optional ripgrep glob filter, such as *.ts' },
        max_results: { type: 'number', default: 50 },
      },
      required: ['query'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const action = String(args.action || 'symbols');
      const query = String(args.query || '').trim();
      if (!query) return jsonResult({ error: 'query is required' });
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 50) || 50, 200));
      let searchRoot: string;
      try {
        searchRoot = resolveInsideWorkspace(cwd, args.path);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err), { action, query });
      }
      const results = await ripgrepSearch(cwd, searchRoot, query, maxResults, typeof args.include === 'string' ? args.include : undefined);
      return textResult(JSON.stringify({
        action,
        query,
        fallback: 'ripgrep',
        results,
        total: results.length,
      }, null, 2), {
        ok: true,
        action,
        query,
        fallback: 'ripgrep',
        total: results.length,
      });
    },
  } as unknown as AgentTool<any>;
}

// Dispatch table: tool name → factory taking (cwd, options?) and returning an AgentTool.
// Each pi factory accepts an optional per-tool options object; we don't expose those
// in this MVP (use pi defaults). Future sub-projects can wire ToolBridgeOptions.<name>
// through to the factory.
const TOOL_FACTORIES: Record<ToolName, (cwd: string, options?: ToolBridgeOptions) => AgentTool<any>> = {
  Read: (cwd) => createReadBridgeTool(cwd),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Write: (cwd) => withToolName(createWriteTool(cwd) as AgentTool<any>, 'Write'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Edit: (cwd) => withToolName(createEditTool(cwd) as AgentTool<any>, 'Edit'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Bash: (cwd) => withToolName(createBashTool(cwd) as AgentTool<any>, 'Bash'),
  Grep: (cwd) => createGrepBridgeTool(cwd),
  Glob: (cwd) => createGlobTool(cwd),
  LS: (cwd) => createLsBridgeTool(cwd),
  TodoWrite: () => createTodoWriteTool(),
  AskUserQuestion: (_cwd, options) => createAskUserQuestionTool(options?.permissionCallback),
  WebFetch: () => createWebFetchTool(),
  WebSearch: () => createWebSearchTool(),
  MCPTool: (_cwd, options) => createMcpTool(options?.db),
  ToolSearch: (_cwd, options) => createToolSearchTool(options?.db),
  ListMcpResources: (_cwd, options) => createListMcpResourcesTool(options?.db),
  ReadMcpResource: (_cwd, options) => createReadMcpResourceTool(options?.db),
  TaskOutput: (_cwd, options) => createTaskOutputTool(options?.db),
  Monitor: (_cwd, options) => createMonitorTool(options?.sessionId, options?.runId, options?.db),
  Agent: (_cwd, options) => createAgentTool(
    options?.sessionId,
    options?.runId,
    options?.db,
    options?.permissionOverride,
    options?.agentTaskExecutor,
  ),
  LSPTool: (cwd) => createLspTool(cwd),
};

export interface ToolBridgeOptions {
  /** Subset of tools to enable. Default: all built-ins. */
  enabled?: string[];
  /** Replace specific pi tool implementations. Key is the tool name. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides?: Partial<Record<ToolName, AgentTool<any>>>;
  /** Optional runtime context for tools that bridge into ZClaudia services. */
  serverPort?: number;
  sessionId?: string;
  runId?: string;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  db?: Database.Database;
  agentTaskExecutor?: TaskExecutor;
  /** Provider permission/interaction callback used by AskUserQuestion. */
  permissionCallback?: PermissionCallback;
}

/**
 * Build the AgentTool[] passed to pi `Agent`'s initialState.tools.
 *
 * `cwd` is required by pi tools to enforce a working-directory boundary
 * (e.g. read can't open files outside cwd).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTools(cwd: string, options?: ToolBridgeOptions): AgentTool<any>[] {
  const requested = options?.enabled ?? [...ALL_TOOL_NAMES];
  const overrides = new Map<ToolName, AgentTool<any>>();
  for (const [overrideName, tool] of Object.entries(options?.overrides ?? {})) {
    const normalized = normalizeToolName(overrideName);
    if (normalized && tool) overrides.set(normalized, tool);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: AgentTool<any>[] = [];

  for (const requestedName of requested) {
    const name = normalizeToolName(requestedName);
    if (!name) {
      console.warn(`[buildTools] Unknown tool name skipped: ${requestedName}`);
      continue;
    }
    const override = overrides.get(name);
    if (override) {
      result.push(withConditionalSkillActivation(withToolName(override, name, override.label ?? name), name, cwd));
    } else {
      result.push(withConditionalSkillActivation(TOOL_FACTORIES[name](cwd, options), name, cwd));
    }
  }

  return result;
}
