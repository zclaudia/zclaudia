import type { AgentTool } from '@earendil-works/pi-agent-core';
import { readdir, stat } from 'fs/promises';
import * as path from 'path';

import { runRipgrep } from './ripgrep-runner.js';
import { agentToolParameters, errorResult, textResult, toolParams } from './tool-common.js';
import {
  resolveInsideWorkspaces,
  toWorkspaceRelative,
  workspaceRootsOf,
  type WorkspaceRootOptions,
} from './workspace-paths.js';

function parseRipgrepLines(
  cwd: string,
  stdout: string,
  maxResults: number,
  offset = 0
): Array<{ file: string; line: number; preview: string }> {
  return stdout
    .split('\n')
    .filter(Boolean)
    .slice(0, maxResults)
    .slice(offset)
    .flatMap(line => {
      // rg runs with `--null`: `path<NUL>line:text` — the only unambiguous
      // framing for paths containing separators (dashed dates, drive letters).
      const nul = line.indexOf('\0');
      if (nul >= 0) {
        const match = /^(\d+):(.*)$/.exec(line.slice(nul + 1));
        if (!match) return [];
        return [
          {
            file: toWorkspaceRelative(cwd, line.slice(0, nul)),
            line: Number(match[1]),
            preview: match[2].trim(),
          },
        ];
      }
      // Legacy fallback for rg without --null (not expected; we always pass it).
      const match = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!match) return [];
      return [
        {
          file: toWorkspaceRelative(cwd, match[1]),
          line: Number(match[2]),
          preview: match[3].trim(),
        },
      ];
    });
}

function parseRipgrepContextLines(
  cwd: string,
  stdout: string,
  maxResults: number,
  offset = 0
): Array<{ file: string; line: number; preview: string; isMatch: boolean }> {
  const groups: string[][] = [];
  let currentGroup: string[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (line === '--') {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [];
      continue;
    }
    currentGroup.push(line);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  const results: Array<{ file: string; line: number; preview: string; isMatch: boolean }> = [];
  let matchCount = 0;
  const parseGroup = (group: string[]) =>
    group.flatMap(line => {
      // rg runs with `--null`: `path<NUL>line<sep>text` where sep is `:` for
      // match lines and `-` for context lines. Parsing left-to-right with a
      // non-greedy file group misparses paths like `report-2024-01.ts` (the
      // `-2024-` segment wins over the real line number) — P1-13.
      const nul = line.indexOf('\0');
      if (nul >= 0) {
        const match = /^(\d+)([:-])(.*)$/.exec(line.slice(nul + 1));
        if (!match) return [];
        return [
          {
            file: toWorkspaceRelative(cwd, line.slice(0, nul)),
            line: Number(match[1]),
            preview: match[3].trim(),
            isMatch: match[2] === ':',
          },
        ];
      }
      // Legacy fallback for rg without --null (not expected; we always pass it).
      const match = /^(.*?)([:-])(\d+)\2(.*)$/.exec(line);
      if (!match) return [];
      return [
        {
          file: toWorkspaceRelative(cwd, match[1]),
          line: Number(match[3]),
          preview: match[4].trim(),
          isMatch: match[2] === ':',
        },
      ];
    });

  if (offset <= 0) {
    for (const group of groups) {
      if (matchCount >= maxResults) break;
      const parsedGroup = parseGroup(group);
      const groupMatches = parsedGroup.filter(entry => entry.isMatch).length;
      if (groupMatches === 0) continue;
      results.push(...parsedGroup);
      matchCount += groupMatches;
    }
    return results;
  }

  // offset > 0: drop every row up to and including the Nth match row, then
  // collect as usual. Context rows travel with their neighbors, so the rows
  // around skipped matches disappear with them; when rg merges overlapping
  // context windows into one group, group-granular skipping would drop kept
  // matches too — hence the row-level walk.
  let seenMatches = 0;
  outer: for (const group of groups) {
    for (const row of parseGroup(group)) {
      if (row.isMatch) seenMatches += 1;
      if (seenMatches <= offset) continue;
      if (matchCount >= maxResults) break outer;
      results.push(row);
      if (row.isMatch) matchCount += 1;
    }
  }
  return results;
}

export function createGrepBridgeTool(cwd: string, options?: WorkspaceRootOptions): AgentTool {
  return {
    name: 'Grep',
    label: 'Grep',
    description:
      'Search file contents with ripgrep. output_mode: "content" (default, matching lines with optional context), "files_with_matches" (file paths), or "count" (total match count). Supports case_insensitive, a glob include filter, a type file-type filter (e.g. "js", "py", "rust"), multiline:true for patterns that span lines, and offset to skip the first N results before applying max_results (pagination). In content mode, total counts matching lines only among the rows collected; returned counts all emitted rows including context lines. When truncated, totals cover only the rows collected.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        include: { type: 'string', description: 'Glob filter, e.g. *.ts' },
        type: {
          type: 'string',
          description: 'File-type filter, e.g. "js", "py", "rust" (ripgrep type names)',
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          default: 'content',
        },
        case_insensitive: { type: 'boolean', default: false },
        multiline: {
          type: 'boolean',
          default: false,
          description: 'Allow the pattern to match across line boundaries',
        },
        context: { type: 'number', default: 0 },
        max_results: { type: 'number', default: 100 },
        offset: {
          type: 'number',
          default: 0,
          description: 'Skip the first N results before applying max_results',
        },
      },
      required: ['pattern'],
    }),
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
      const args = toolParams(toolCallId, params);
      // Trim only for the empty-check: leading/trailing whitespace in the
      // pattern is significant (e.g. searching for an indented `    def foo`),
      // so the raw pattern is passed to ripgrep verbatim (P1-13).
      const pattern = String(args.pattern ?? '');
      if (!pattern.trim()) return errorResult('missing_pattern', 'grep requires a pattern');
      let searchRoot: string;
      try {
        searchRoot = resolveInsideWorkspaces(workspaceRootsOf(cwd, options), args.path);
      } catch (err) {
        return errorResult(
          'path_outside_workspace',
          err instanceof Error ? err.message : String(err),
          { pattern }
        );
      }
      const mode =
        args.output_mode === 'files_with_matches' || args.output_mode === 'count'
          ? args.output_mode
          : 'content';
      const caseInsensitive = args.case_insensitive === true;
      const multiline = args.multiline === true;
      const context = Math.max(0, Math.min(Number(args.context ?? 0) || 0, 20));
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 100) || 100, 500));
      const offset = Math.max(0, Math.min(Number(args.offset ?? 0) || 0, 10_000));
      const relPath = toWorkspaceRelative(cwd, searchRoot) || '.';
      const include =
        typeof args.include === 'string' && args.include ? ['--glob', args.include] : [];
      const ci = caseInsensitive ? ['-i'] : [];
      // -U lets the pattern match across line boundaries; --multiline-dotall
      // makes `.` cover newlines so "a.*b" spans lines like callers expect.
      const ml = multiline ? ['-U', '--multiline-dotall'] : [];
      const typeFilter =
        typeof args.type === 'string' && args.type.trim() ? ['--type', args.type.trim()] : [];

      try {
        if (mode === 'files_with_matches') {
          const { lines, truncated, exitCode, stderr } = await runRipgrep(
            [
              '--files-with-matches',
              '--color',
              'never',
              '--with-filename',
              ...ml,
              ...ci,
              ...typeFilter,
              ...include,
              '--',
              pattern,
              searchRoot,
            ],
            { maxLines: maxResults + offset, signal }
          );
          if (exitCode === 2)
            return errorResult('grep_failed', stderr || 'ripgrep error', { pattern });
          const files = lines.slice(offset).map(f => toWorkspaceRelative(cwd, f));
          return textResult(
            JSON.stringify(
              {
                pattern,
                path: relPath,
                mode,
                files,
                total: files.length,
                truncated,
                ...(offset > 0 ? { offset, nextOffset: offset + files.length } : {}),
              },
              null,
              2
            ),
            {
              ok: true,
              pattern,
              path: relPath,
              total: files.length,
              truncated,
              ...(offset > 0 ? { offset } : {}),
            }
          );
        }
        if (mode === 'count') {
          const { lines, truncated, exitCode, stderr } = await runRipgrep(
            [
              '--count',
              '--no-messages',
              '--color',
              'never',
              '--with-filename',
              ...ml,
              ...ci,
              ...typeFilter,
              ...include,
              '--',
              pattern,
              searchRoot,
            ],
            { maxLines: maxResults + offset, signal }
          );
          if (exitCode === 2)
            return errorResult('grep_failed', stderr || 'ripgrep error', { pattern });
          const counts = lines.slice(offset).flatMap(l => {
            const idx = l.lastIndexOf(':');
            if (idx < 0) return [];
            return {
              file: toWorkspaceRelative(cwd, l.slice(0, idx)),
              count: Number(l.slice(idx + 1)) || 0,
            };
          });
          const total = counts.reduce((sum, c) => sum + c.count, 0);
          return textResult(
            JSON.stringify(
              {
                pattern,
                path: relPath,
                mode,
                counts,
                total,
                truncated,
                ...(offset > 0 ? { offset, nextOffset: offset + counts.length } : {}),
              },
              null,
              2
            ),
            {
              ok: true,
              pattern,
              path: relPath,
              total,
              truncated,
              ...(offset > 0 ? { offset } : {}),
            }
          );
        }
        const { lines, truncated, exitCode, stderr } = await runRipgrep(
          [
            '--line-number',
            '--no-heading',
            '--color',
            'never',
            '--with-filename',
            // NUL-terminated path prefix so the parsers handle any filename
            // (dashed dates, colons, drive letters) unambiguously (P1-13).
            '--null',
            ...ml,
            ...ci,
            ...(context > 0 ? ['-C', String(context)] : []),
            ...typeFilter,
            ...include,
            '--',
            pattern,
            searchRoot,
          ],
          {
            maxLines:
              (maxResults + offset) * (context > 0 ? context * 2 + 1 : 1) + maxResults + offset,
            signal,
          }
        );
        if (exitCode === 2)
          return errorResult('grep_failed', stderr || 'ripgrep error', { pattern });
        const stdout = lines.join('\n');
        const results =
          context > 0
            ? parseRipgrepContextLines(cwd, stdout, maxResults, offset)
            : parseRipgrepLines(cwd, stdout, maxResults + offset, offset).map(row => ({
                ...row,
                isMatch: true,
              }));
        // `total` counts matching lines only; `returned` counts every emitted
        // row (context lines included) so the two are never conflated.
        const matchCount = results.reduce((count, row) => count + (row.isMatch ? 1 : 0), 0);
        return textResult(
          JSON.stringify(
            {
              pattern,
              path: relPath,
              mode,
              results,
              total: matchCount,
              returned: results.length,
              truncated,
              ...(offset > 0 ? { offset, nextOffset: offset + matchCount } : {}),
            },
            null,
            2
          ),
          {
            ok: true,
            pattern,
            path: relPath,
            total: matchCount,
            returned: results.length,
            truncated,
            context,
            ...(offset > 0 ? { offset } : {}),
          }
        );
      } catch (err) {
        return errorResult('grep_failed', err instanceof Error ? err.message : String(err), {
          pattern,
        });
      }
    },
  };
}

export function createLsBridgeTool(cwd: string, options?: WorkspaceRootOptions): AgentTool {
  const LS_DEFAULT_LIMIT = 500;
  const LS_STAT_BATCH_SIZE = 32;
  return {
    name: 'LS',
    label: 'LS',
    description:
      'List the immediate contents of a directory, sorted alphabetically, with a "/" suffix for subdirectories. Includes dotfiles. Use Glob/Grep for recursive search.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative directory (default: workspace root)',
        },
        limit: { type: 'number', default: LS_DEFAULT_LIMIT },
      },
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      let dirPath: string;
      try {
        dirPath = resolveInsideWorkspaces(workspaceRootsOf(cwd, options), args.path);
      } catch (err) {
        return errorResult(
          'path_outside_workspace',
          err instanceof Error ? err.message : String(err)
        );
      }
      const limit = Math.max(
        1,
        Math.min(Number(args.limit ?? LS_DEFAULT_LIMIT) || LS_DEFAULT_LIMIT, 2000)
      );
      try {
        const dirStat = await stat(dirPath);
        if (!dirStat.isDirectory()) {
          return errorResult(
            'not_a_directory',
            `Path is not a directory: ${toWorkspaceRelative(cwd, dirPath) || '.'}`,
            { path: toWorkspaceRelative(cwd, dirPath) || '.' }
          );
        }
        const entries = (await readdir(dirPath, { withFileTypes: true })).sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
        const listed = entries.slice(0, limit);
        const truncated = entries.length > limit;
        // Dirent answers the directory bit for plain entries; only symlinks
        // need a real stat (does the TARGET resolve to a directory?). Those
        // stats run in bounded batches instead of one awaited stat per entry.
        const isDirectory: boolean[] = [];
        for (let i = 0; i < listed.length; i += LS_STAT_BATCH_SIZE) {
          const batch = listed.slice(i, i + LS_STAT_BATCH_SIZE);
          isDirectory.push(
            ...(await Promise.all(
              batch.map(async entry => {
                if (!entry.isSymbolicLink()) return entry.isDirectory();
                try {
                  return (await stat(path.join(dirPath, entry.name))).isDirectory();
                } catch {
                  // un-stattable entry (e.g. dangling symlink) - list it without a suffix
                  return false;
                }
              })
            ))
          );
        }
        const lines = listed.map((entry, index) => entry.name + (isDirectory[index] ? '/' : ''));
        const relPath = toWorkspaceRelative(cwd, dirPath) || '.';
        if (lines.length === 0) {
          return textResult('(empty directory)', {
            ok: true,
            path: relPath,
            total: 0,
            returned: 0,
            truncated,
          });
        }
        return textResult(lines.join('\n'), {
          ok: true,
          path: relPath,
          total: entries.length,
          returned: lines.length,
          truncated,
        });
      } catch (err) {
        return errorResult('ls_failed', err instanceof Error ? err.message : String(err), {
          path: String(args.path ?? '.'),
        });
      }
    },
  };
}

export function createGlobTool(cwd: string, options?: WorkspaceRootOptions): AgentTool {
  return {
    name: 'Glob',
    label: 'Glob',
    description:
      'Find files by glob pattern under the workspace, returned most-recently-modified first. Respects .gitignore. total is the number of matching files collected (a lower bound when truncated at the internal stream cap); returned is the number of paths emitted.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern such as **/*.ts' },
        path: { type: 'string', description: 'Optional workspace-relative directory to search' },
        max_results: { type: 'number', default: 100 },
        include_hidden: { type: 'boolean', default: false },
      },
      required: ['pattern'],
    }),
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
      const args = toolParams(toolCallId, params);
      const pattern = String(args.pattern || '').trim();
      if (!pattern) return errorResult('missing_pattern', 'Glob requires a pattern');
      const maxResults = Math.max(1, Math.min(Number(args.max_results ?? 100) || 100, 500));
      let searchRoot: string;
      try {
        searchRoot = resolveInsideWorkspaces(workspaceRootsOf(cwd, options), args.path);
      } catch (err) {
        return errorResult(
          'path_outside_workspace',
          err instanceof Error ? err.message : String(err),
          { pattern }
        );
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
        const {
          lines,
          truncated: streamTruncated,
          exitCode,
          stderr,
        } = await runRipgrep(rgArgs, { maxLines: 10_000, signal });
        if (exitCode === 2) {
          return errorResult('glob_failed', stderr || 'ripgrep error', { pattern });
        }
        const relPath = toWorkspaceRelative(cwd, searchRoot) || '.';
        const all = lines.map(file => toWorkspaceRelative(cwd, file));
        const results = all.slice(0, maxResults);
        const truncated = streamTruncated || all.length > maxResults;
        return textResult(
          JSON.stringify(
            {
              pattern,
              path: relPath,
              results,
              total: all.length,
              returned: results.length,
              truncated,
            },
            null,
            2
          ),
          {
            ok: true,
            pattern,
            path: relPath,
            total: all.length,
            returned: results.length,
            truncated,
          }
        );
      } catch (err) {
        return errorResult('glob_failed', err instanceof Error ? err.message : String(err), {
          pattern,
        });
      }
    },
  };
}
