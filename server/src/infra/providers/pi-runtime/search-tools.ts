import type { AgentTool } from '@earendil-works/pi-agent-core';
import { execFile } from 'child_process';
import { readdir, stat } from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import { runRipgrep } from './ripgrep-runner.js';
import { errorResult, jsonResult, textResult, toolParams } from './tool-common.js';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspace-paths.js';

const execFileAsync = promisify(execFile);

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

export function createGrepBridgeTool(cwd: string): AgentTool<any> {
  return {
    name: 'Grep',
    label: 'Grep',
    description: 'Search file contents with ripgrep. output_mode: "content" (default, matching lines with optional context), "files_with_matches" (file paths), or "count" (total match count). Supports case_insensitive and a glob include filter.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        include: { type: 'string', description: 'Glob filter, e.g. *.ts' },
        output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], default: 'content' },
        case_insensitive: { type: 'boolean', default: false },
        context: { type: 'number', default: 0 },
        max_results: { type: 'number', default: 100 },
      },
      required: ['pattern'],
    } as any,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
      const args = toolParams(toolCallId, params);
      const pattern = String(args.pattern || '').trim();
      if (!pattern) return errorResult('missing_pattern', 'grep requires a pattern');
      let searchRoot: string;
      try {
        searchRoot = resolveInsideWorkspace(cwd, args.path);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err), { pattern });
      }
      const mode = args.output_mode === 'files_with_matches' || args.output_mode === 'count' ? args.output_mode : 'content';
      const caseInsensitive = args.case_insensitive === true;
      const context = Math.max(0, Math.min(Number(args.context ?? 0) || 0, 20));
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 100) || 100, 500));
      const relPath = toWorkspaceRelative(cwd, searchRoot) || '.';
      const include = typeof args.include === 'string' && args.include ? ['--glob', args.include] : [];
      const ci = caseInsensitive ? ['-i'] : [];

      try {
        if (mode === 'files_with_matches') {
          const { lines, truncated, exitCode, stderr } = await runRipgrep(
            ['--files-with-matches', '--color', 'never', ...ci, ...include, pattern, searchRoot],
            { maxLines: maxResults, signal },
          );
          if (exitCode === 2) return errorResult('grep_failed', stderr || 'ripgrep error', { pattern });
          const files = lines.map((f) => toWorkspaceRelative(cwd, f));
          return textResult(JSON.stringify({ pattern, path: relPath, mode, files, total: files.length, truncated }, null, 2),
            { ok: true, pattern, path: relPath, total: files.length, truncated });
        }
        if (mode === 'count') {
          const { lines, truncated, exitCode, stderr } = await runRipgrep(
            ['--count', '--no-messages', '--color', 'never', ...ci, ...include, pattern, searchRoot],
            { maxLines: maxResults, signal },
          );
          if (exitCode === 2) return errorResult('grep_failed', stderr || 'ripgrep error', { pattern });
          const counts = lines.map((l) => {
            const idx = l.lastIndexOf(':');
            return { file: toWorkspaceRelative(cwd, l.slice(0, idx)), count: Number(l.slice(idx + 1)) || 0 };
          });
          const total = counts.reduce((sum, c) => sum + c.count, 0);
          return textResult(JSON.stringify({ pattern, path: relPath, mode, counts, total, truncated }, null, 2),
            { ok: true, pattern, path: relPath, total, truncated });
        }
        const { lines, truncated, exitCode, stderr } = await runRipgrep(
          ['--line-number', '--no-heading', '--color', 'never', ...ci, ...(context > 0 ? ['-C', String(context)] : []), ...include, pattern, searchRoot],
          { maxLines: maxResults * (context > 0 ? context * 2 + 1 : 1) + maxResults, signal },
        );
        if (exitCode === 2) return errorResult('grep_failed', stderr || 'ripgrep error', { pattern });
        const stdout = lines.join('\n');
        const results = context > 0
          ? parseRipgrepContextLines(cwd, stdout, maxResults)
          : parseRipgrepLines(cwd, stdout, maxResults).map((row) => ({ ...row, isMatch: true }));
        return textResult(JSON.stringify({ pattern, path: relPath, mode, results, total: results.length, truncated }, null, 2),
          { ok: true, pattern, path: relPath, total: results.length, truncated, context });
      } catch (err) {
        return errorResult('grep_failed', err instanceof Error ? err.message : String(err), { pattern });
      }
    },
  } as unknown as AgentTool<any>;
}

export function createLsBridgeTool(cwd: string): AgentTool<any> {
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
          } catch { /* un-stattable entry (e.g. dangling symlink) - list it without a suffix */ }
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

export function createGlobTool(cwd: string): AgentTool<any> {
  return {
    name: 'Glob',
    label: 'Glob',
    description: 'Find files by glob pattern under the workspace, returned most-recently-modified first. Respects .gitignore.',
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
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
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
      const rgArgs = [
        '--files',
        '--sortr=modified',
        ...(args.include_hidden === true ? ['--hidden'] : []),
        '--glob',
        pattern,
        searchRoot,
      ];
      try {
        const { lines, truncated: streamTruncated, exitCode, stderr } = await runRipgrep(rgArgs, { maxLines: 10_000, signal });
        if (exitCode === 2) {
          return errorResult('glob_failed', stderr || 'ripgrep error', { pattern });
        }
        const relPath = toWorkspaceRelative(cwd, searchRoot) || '.';
        const all = lines.map((file) => toWorkspaceRelative(cwd, file));
        const results = all.slice(0, maxResults);
        const truncated = streamTruncated || all.length > maxResults;
        return textResult(JSON.stringify({ pattern, path: relPath, results, total: results.length }, null, 2), {
          ok: true,
          pattern,
          path: relPath,
          total: results.length,
          truncated,
        });
      } catch (err) {
        return errorResult('glob_failed', err instanceof Error ? err.message : String(err), { pattern });
      }
    },
  } as unknown as AgentTool<any>;
}

export function createLspTool(cwd: string): AgentTool<any> {
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
