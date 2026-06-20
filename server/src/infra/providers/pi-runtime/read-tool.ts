import type { AgentTool } from '@earendil-works/pi-agent-core';
import { readFile, stat } from 'fs/promises';
import * as path from 'path';

import type { ReadFileStateStore } from './read-file-state.js';
import { getOutlineProvider, type FoldSpan } from './read-outline.js';
import { decodeTextBuffer } from './text-io.js';
import { buildHashlineEntries, formatHashlineOutput, hashlineSnapshotId, hashlineTag } from './hashline.js';
import { readLineWindowStreaming } from './read-window.js';
import { compressImageToLimit, extractPdfText, renderNotebook } from './rich-read.js';
import { errorResult, textResult, toolParams } from './tool-common.js';
import { buildPartialReadStateDescriptor, buildRangeDescriptor, buildReadStateDescriptor } from './file-state.js';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspace-paths.js';

export interface ReadToolOptions {
  supportsVision?: boolean;
  readFileState?: ReadFileStateStore;
}

// Read's own size budget is intentionally decoupled from the mutation caps in
// write-guards.ts (Write content 2MB, Edit file 10MB): reading is non-destructive
// and the model often needs to inspect generated bundles, lock files, or logs.
const READ_FAST_PATH_BYTES = 10 * 1024 * 1024; // whole-file read below this
const MAX_READ_FILE_BYTES = 256 * 1024 * 1024; // hard ceiling, streamed above fast path
const MAX_READ_OUTPUT_TOKENS = 25_000; // cap a single Read's text output
const SUMMARY_MIN_LINES = 250;       // lower trigger (line-count; long lines are handled by column truncation)
const SUMMARY_MAX_LINES = 20_000;    // upper bound (parse cost)
const SUMMARY_MAX_BYTES = 2 * 1024 * 1024; // upper bound (parse cost)
const SUMMARY_MIN_SAVINGS = 0.30;    // fold >= 30% of lines, else read verbatim
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_NOTEBOOK_BYTES = 20 * 1024 * 1024;

// Extensions that are binary even when no NUL byte appears in the leading
// sample (fonts, archives, media, office docs, compiled artifacts). Caught
// before any read so we fail fast with a clear reason. Image/PDF/notebook
// extensions are handled by their own branches above and never reach here.
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib', '.obj', '.class', '.wasm',
  '.pyc', '.pyo', '.pdb', '.node', '.bin', '.dat',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.zst', '.7z', '.rar', '.lz4',
  '.jar', '.war', '.ear', '.apk', '.aab', '.dmg', '.iso', '.img', '.deb', '.rpm', '.msi', '.pkg',
  '.woff', '.woff2', '.ttf', '.ttc', '.otf', '.eot',
  '.ico', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.psd',
  '.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.wma',
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.sqlite', '.sqlite3', '.db', '.mdb',
]);

// Special files whose read would hang the agent or stream forever. Workspace
// containment already blocks most of these (they sit outside cwd) and isFile()
// rejects character devices/FIFOs, so this is defense-in-depth plus a clearer
// error than "not_a_file" for the cwd-at-root edge case.
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
  '/dev/stdin', '/dev/stdout', '/dev/stderr',
  '/dev/tty', '/dev/console',
  '/dev/fd/0', '/dev/fd/1', '/dev/fd/2',
]);

export function isBlockedDevicePath(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  if (BLOCKED_DEVICE_PATHS.has(normalized)) return true;
  // Linux per-process stdio aliases: /proc/<pid|self|thread-self>/fd/{0,1,2}
  return /^\/proc\/(\d+|self|thread-self)\/fd\/[0-2]$/.test(normalized);
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function formatNumberedLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}|${line}`).join('\n');
}

// Per-line display cap. Very long lines (minified bundles, embedded data, long
// log records) are clipped for display only — the line is preserved in full for
// write-guard snapshots, and the clip never applies in hashline mode (anchors
// need whole lines). This keeps every line's structure visible instead of
// losing trailing lines to the token budget.
const READ_MAX_LINE_COLUMNS = 2000;

function truncateDisplayLine(line: string, maxColumns: number): { text: string; truncated: boolean } {
  if (maxColumns <= 0 || line.length <= maxColumns) return { text: line, truncated: false };
  const dropped = line.length - maxColumns;
  return { text: `${line.slice(0, maxColumns)} … [+${dropped} chars clipped]`, truncated: true };
}

// After repeated reads of the same file in a session, nudge the model toward
// the context echoed by Edit or a narrow re-read instead of re-dumping the file.
const REPEAT_READ_NOTICE_THRESHOLD = 3;

function appendTextNotice(result: { content?: unknown; details?: unknown }, notice: string): typeof result {
  const content = result.content;
  if (Array.isArray(content) && content[0] && (content[0] as { type?: string }).type === 'text') {
    const updated = content.slice();
    updated[0] = { ...(content[0] as object), text: `${(content[0] as { text: string }).text}${notice}` };
    return { ...result, content: updated };
  }
  return result;
}

// Trims the window so its rendered text stays under the output token budget,
// preventing a few very long lines (e.g. minified bundles) from blowing the
// context even when the line count is within range. ~4 chars/token heuristic.
function capLinesByTokens(lines: string[], maxTokens: number): { lines: string[]; cappedByTokens: boolean } {
  const charBudget = maxTokens * 4;
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (out.length > 0 && used + cost > charBudget) {
      return { lines: out, cappedByTokens: true };
    }
    out.push(line);
    used += cost;
  }
  return { lines: out, cappedByTokens: false };
}

function capTextByTokens(text: string, maxTokens: number): { text: string; cappedByTokens: boolean } {
  const charBudget = maxTokens * 4;
  if (text.length <= charBudget) return { text, cappedByTokens: false };
  return {
    text: `${text.slice(0, charBudget)}\n\n[PDF output capped at ~${MAX_READ_OUTPUT_TOKENS} tokens. Use the pages parameter (for example pages="1-5") to read a smaller range.]`,
    cappedByTokens: true,
  };
}

function parsePositiveInteger(value: unknown, defaultValue: number, code: string): { ok: true; value: number } | { ok: false; code: string; message: string } {
  if (value === undefined || value === null) return { ok: true, value: defaultValue };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return { ok: false, code, message: `${code.replace('invalid_', '')} must be a positive integer` };
  }
  return { ok: true, value: parsed };
}

function parseReadWindow(args: Record<string, unknown>): { ok: true; offset: number; limit: number } | { ok: false; code: string; message: string } {
  const offset = parsePositiveInteger(args.offset, 1, 'invalid_offset');
  if (!offset.ok) return offset;
  const limit = parsePositiveInteger(args.limit, 2000, 'invalid_limit');
  if (!limit.ok) return limit;
  return { ok: true, offset: offset.value, limit: Math.min(limit.value, 2000) };
}

// Tells the model the file's full size and whether more lines remain, so it
// reads a large window (or stops) instead of probing a few lines at a time.
function buildReadFooter(offset: number, returnedLines: number, totalLines: number, cappedByTokens = false): string {
  if (totalLines === 0) return '\n\n[File is empty — 0 lines.]';
  const lastLine = offset + returnedLines - 1;
  const remaining = totalLines - lastLine;
  if (cappedByTokens && remaining > 0) {
    const nextOffset = lastLine + 1;
    return `\n\n[Showing lines ${offset}-${lastLine} of ${totalLines} — output capped at ~${MAX_READ_OUTPUT_TOKENS} tokens. ${remaining} more line${remaining === 1 ? '' : 's'} below — continue with offset=${nextOffset}, or use Grep to jump to what you need.]`;
  }
  if (remaining > 0) {
    const nextOffset = lastLine + 1;
    return `\n\n[Showing lines ${offset}-${lastLine} of ${totalLines}. ${remaining} more line${remaining === 1 ? '' : 's'} below — call Read again with offset=${nextOffset} to continue.]`;
  }
  if (offset === 1) {
    return `\n\n[End of file — all ${totalLines} line${totalLines === 1 ? '' : 's'} shown.]`;
  }
  return `\n\n[Showing lines ${offset}-${totalLines} of ${totalLines} (end of file).]`;
}

// Token-caps a window and renders it with line numbers + footer. Shared by the
// whole-file, streaming, and notebook text paths.
function renderTextWindow(
  selected: string[],
  offset: number,
  totalLines: number,
): { text: string; returnedLines: number; cappedByTokens: boolean; columnTruncated: boolean } {
  let columnTruncated = false;
  const display = selected.map(line => {
    const clipped = truncateDisplayLine(line, READ_MAX_LINE_COLUMNS);
    if (clipped.truncated) columnTruncated = true;
    return clipped.text;
  });
  const { lines: capped, cappedByTokens } = capLinesByTokens(display, MAX_READ_OUTPUT_TOKENS);
  return {
    text: formatNumberedLines(capped, offset) + buildReadFooter(offset, capped.length, totalLines, cappedByTokens),
    returnedLines: capped.length,
    cappedByTokens,
    columnTruncated,
  };
}

// Renders an in-place folded skeleton: visible lines keep their original line
// numbers; each fold becomes one self-describing marker line. Reuses the
// column-clip + token-cap backstops used by the normal window renderer.
function renderSkeleton(
  lines: string[],
  folds: FoldSpan[],
  totalLines: number,
  relPath: string,
): { text: string; visibleLines: number } {
  const sorted = [...folds].sort((a, b) => a.startLine - b.startLine);
  const out: string[] = [];
  let visible = 0;
  let foldIndex = 0;
  let line = 1;
  while (line <= totalLines) {
    const fold = sorted[foldIndex];
    if (fold && line === fold.startLine) {
      const count = fold.endLine - fold.startLine + 1;
      const indent = lines[fold.startLine - 1].match(/^\s*/)?.[0] ?? '';
      out.push(`${indent}… (+${count} lines)  →  offset=${fold.startLine} limit=${count}`);
      line = fold.endLine + 1;
      foldIndex += 1;
      continue;
    }
    out.push(`${line}|${truncateDisplayLine(lines[line - 1], READ_MAX_LINE_COLUMNS).text}`);
    visible += 1;
    line += 1;
  }
  const { lines: capped } = capLinesByTokens(out, MAX_READ_OUTPUT_TOKENS);
  const elided = totalLines - visible;
  const footer = `\n\n[Structural summary of ${relPath} — ${totalLines} lines, ${folds.length} bod${folds.length === 1 ? 'y' : 'ies'} folded, ${elided} lines elided. Re-read any body with offset/limit, or pass full:true for the whole file.]`;
  return { text: capped.join('\n') + footer, visibleLines: visible };
}

function renderHashlineWindow(
  relPath: string,
  text: string,
  selected: string[],
  offset: number,
  totalLines: number,
): { text: string; entries: ReturnType<typeof buildHashlineEntries>; returnedLines: number; cappedByTokens: boolean } {
  // Hashline anchors require whole lines, so column truncation is off here. If
  // the first line alone blows the budget we cannot emit it without flooding
  // the context — surface a clear notice instead of a single giant line.
  if (selected.length > 0 && selected[0].length > MAX_READ_OUTPUT_TOKENS * 4) {
    return {
      text: `[Line ${offset} is ${selected[0].length} chars and exceeds the ~${MAX_READ_OUTPUT_TOKENS} token output budget. Hashline anchoring needs whole lines — re-read this range without hashline, or use Grep to target the content.]`,
      entries: [],
      returnedLines: 0,
      cappedByTokens: true,
    };
  }
  const { lines: capped, cappedByTokens } = capLinesByTokens(selected, MAX_READ_OUTPUT_TOKENS);
  const entries = buildHashlineEntries(capped, offset);
  const output = formatHashlineOutput(relPath, text, entries);
  const footer = buildReadFooter(offset, entries.length, totalLines, cappedByTokens);
  return {
    text: `${output}${footer}`,
    entries,
    returnedLines: entries.length,
    cappedByTokens,
  };
}

interface LineRange { start: number; end: number }

// Parses a multi-range selector like "5-16,960-973" into sorted, merged ranges.
// Accepts `a-b` (inclusive), `a+n` (n lines from a), and bare `a` (single line),
// all 1-based. Overlapping or contiguous ranges are merged so no line is shown
// twice. Returns an error result on any malformed token.
function parseRanges(value: unknown): { ok: true; ranges: LineRange[] } | { ok: false; code: string; message: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, code: 'invalid_ranges', message: 'ranges must be a non-empty string like "5-16,960-973"' };
  }
  const tokens = value.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, code: 'invalid_ranges', message: 'ranges must list at least one range' };
  }
  const parsed: LineRange[] = [];
  for (const token of tokens) {
    let m: RegExpMatchArray | null;
    if ((m = token.match(/^(\d+)-(\d+)$/))) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (start < 1 || end < start) {
        return { ok: false, code: 'invalid_ranges', message: `invalid range "${token}" (expected 1-based start <= end)` };
      }
      parsed.push({ start, end });
    } else if ((m = token.match(/^(\d+)\+(\d+)$/))) {
      const start = Number(m[1]);
      const count = Number(m[2]);
      if (start < 1 || count < 1) {
        return { ok: false, code: 'invalid_ranges', message: `invalid range "${token}" (expected 1-based start and positive count)` };
      }
      parsed.push({ start, end: start + count - 1 });
    } else if ((m = token.match(/^(\d+)$/))) {
      const start = Number(m[1]);
      if (start < 1) {
        return { ok: false, code: 'invalid_ranges', message: `invalid line "${token}" (lines are 1-based)` };
      }
      parsed.push({ start, end: start });
    } else {
      return { ok: false, code: 'invalid_ranges', message: `unrecognized range "${token}" (use a-b, a+n, or a)` };
    }
  }
  parsed.sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [];
  for (const range of parsed) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return { ok: true, ranges: merged };
}

// Renders several line ranges in one view: each block keeps its real line
// numbers, and non-contiguous blocks are separated by a gap marker so the
// elision is explicit. Reuses the column-clip + token-cap backstops.
function renderMultiRangeWindow(
  lines: string[],
  ranges: LineRange[],
  totalLines: number,
  relPath: string,
): { text: string; returnedLines: number; columnTruncated: boolean; shownRanges: LineRange[] } {
  // Clamp to the file's bounds and drop ranges that start past EOF.
  const clamped: LineRange[] = [];
  for (const range of ranges) {
    if (range.start > totalLines) continue;
    clamped.push({ start: range.start, end: Math.min(range.end, totalLines) });
  }
  const out: string[] = [];
  let columnTruncated = false;
  let returnedLines = 0;
  let prevEnd = 0;
  for (const range of clamped) {
    const gapFrom = prevEnd + 1;
    const gapTo = range.start - 1;
    if (prevEnd > 0 && gapTo >= gapFrom) {
      const skipped = gapTo - gapFrom + 1;
      out.push(`  ⋮ (${skipped} line${skipped === 1 ? '' : 's'} ${gapFrom}-${gapTo} not shown)`);
    }
    for (let line = range.start; line <= range.end; line++) {
      const clipped = truncateDisplayLine(lines[line - 1], READ_MAX_LINE_COLUMNS);
      if (clipped.truncated) columnTruncated = true;
      out.push(`${line}|${clipped.text}`);
      returnedLines += 1;
    }
    prevEnd = range.end;
  }
  const { lines: capped } = capLinesByTokens(out, MAX_READ_OUTPUT_TOKENS);
  const rangeDesc = clamped.map(r => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(', ');
  const footer = `\n\n[Multi-range view of ${relPath} — ${totalLines} total lines, showing ${returnedLines} across ranges ${rangeDesc || '(none in range)'}. Read other ranges with ranges=, or omit ranges for a structural summary.]`;
  return { text: capped.join('\n') + footer, returnedLines, columnTruncated, shownRanges: clamped };
}

export function createReadBridgeTool(cwd: string, options?: ReadToolOptions): AgentTool<any> {
  // Successful reads per workspace-relative path this session, keyed off the
  // result's details.path so every read modality shares one counter.
  const readCounts = new Map<string, number>();

  // Last emitted text/notebook read per resolved path, so an identical re-read
  // (same mtime+size+request) returns a short stub instead of re-sending content
  // already in context. Keyed by absolute path; hashline reads are excluded so
  // the model always gets fresh anchors.
  const lastEmitted = new Map<string, { mtimeMs: number; size: number; signature: string; totalLines: number }>();

  function noteRepeatRead(key: string): string | undefined {
    const count = (readCounts.get(key) ?? 0) + 1;
    readCounts.set(key, count);
    if (count < REPEAT_READ_NOTICE_THRESHOLD) return undefined;
    return `\n\n[Note: read #${count} of this file this session — after edits, prefer the context echoed by the Edit result, or re-read a narrow range with offset/limit instead of the whole file.]`;
  }

  return {
    name: 'Read',
    label: 'Read',
    description: 'Read a file. Text files return up to 2000 lines per call (default reads from the start); the output footer reports the total line count and whether more lines remain, so prefer one large read over many small ones and only paginate with offset when a file exceeds 2000 lines. To pull back several scattered sections at once, pass ranges (e.g. "5-16,960-973"). Images return vision blocks (oversized ones are downscaled automatically); .ipynb notebooks render as cells with outputs; PDFs extract text per page (use pages, e.g. "1-5", max 20 pages per call).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        file_path: { type: 'string' },
        offset: { type: 'number', default: 1 },
        limit: { type: 'number', default: 2000 },
        ranges: { type: 'string', description: 'For text files: read several line ranges in one call, e.g. "5-16,960-973" (also accepts a+n and bare a). Overrides offset/limit.' },
        pages: { type: 'string', description: 'For PDFs: page range like "1-5" or "2,7" (max 20 pages per call)' },
        hashline: { type: 'boolean', description: 'For text files: return content-addressed line hashes for precise edits' },
        full: { type: 'boolean', description: 'Read the entire file verbatim instead of a structural summary' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const result = await (async () => {
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

      if (isBlockedDevicePath(filePath)) {
        return errorResult('blocked_device', `Refusing to read special device file: ${requestedPath}`, {
          path: String(requestedPath),
        });
      }

      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return errorResult('not_a_file', `Path is not a file: ${requestedPath}`, { path: String(requestedPath) });
        }
        // Everything that changes the rendered text output goes into the dedup
        // signature; a re-read with the same signature against an unchanged file
        // (same mtime+size) is served from a stub. hashline is excluded below.
        const readSignature = JSON.stringify({
          o: args.offset ?? null,
          l: args.limit ?? null,
          r: typeof args.ranges === 'string' ? args.ranges : null,
          h: args.hashline === true,
          f: args.full === true,
        });
        const maybeDedup = (relPath: string): ReturnType<typeof textResult> | undefined => {
          if (args.hashline === true) return undefined;
          const prior = lastEmitted.get(filePath);
          if (prior && prior.mtimeMs === fileStat.mtimeMs && prior.size === fileStat.size && prior.signature === readSignature) {
            return textResult(
              `[File ${relPath} is unchanged since your last read (same mtime and size, ${prior.totalLines} line${prior.totalLines === 1 ? '' : 's'}) — its contents are already in the context above and are not being re-sent. Pass full:true, or a different offset/limit/ranges, to force a fresh copy.]`,
              { ok: true, path: relPath, deduped: true, totalLines: prior.totalLines, size: fileStat.size },
            );
          }
          return undefined;
        };
        const recordEmitted = (totalLines: number): void => {
          lastEmitted.set(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, signature: readSignature, totalLines });
        };
        const fileExt = path.extname(filePath).toLowerCase();
        const imageMime = IMAGE_MIME_BY_EXT[fileExt];
        if (imageMime) {
          const relPath = toWorkspaceRelative(cwd, filePath);
          if (!options?.supportsVision) {
            return textResult(`Image file ${relPath} (${imageMime}, ${fileStat.size} bytes) - current model does not support vision.`, {
              ok: false, path: relPath, size: fileStat.size, mimeType: imageMime,
            });
          }
          const buffer = await readFile(filePath);
          if (fileStat.size > MAX_IMAGE_BYTES) {
            const compressed = await compressImageToLimit(buffer, MAX_IMAGE_BYTES);
            if (!compressed) {
              return textResult(`Image file ${relPath} (${imageMime}, ${fileStat.size} bytes) exceeds the 5MB vision limit and could not be downscaled.`, {
                ok: false, path: relPath, size: fileStat.size, mimeType: imageMime,
              });
            }
            return {
              content: [{ type: 'image' as const, data: compressed.data.toString('base64'), mimeType: compressed.mimeType }],
              details: {
                ok: true, path: relPath, size: compressed.data.length, mimeType: compressed.mimeType,
                resized: true, originalSize: fileStat.size,
              },
            };
          }
          return {
            content: [{ type: 'image' as const, data: buffer.toString('base64'), mimeType: imageMime }],
            details: { ok: true, path: relPath, size: fileStat.size, mimeType: imageMime },
          };
        }

        if (fileExt === '.pdf') {
          const relPath = toWorkspaceRelative(cwd, filePath);
          if (fileStat.size > MAX_PDF_BYTES) {
            return errorResult('file_too_large', `PDF is too large to read: ${requestedPath}`, {
              path: relPath, size: fileStat.size, maxBytes: MAX_PDF_BYTES,
            });
          }
          const buffer = await readFile(filePath);
          const pdf = await extractPdfText(buffer, typeof args.pages === 'string' ? args.pages : undefined);
          const capped = capTextByTokens(pdf.text || '(no extractable text)', MAX_READ_OUTPUT_TOKENS);
          return textResult(capped.text, {
            ok: true, path: relPath, format: 'pdf', totalPages: pdf.totalPages, pages: pdf.pages, size: fileStat.size,
            cappedByTokens: capped.cappedByTokens,
          });
        }

        if (fileExt === '.ipynb') {
          if (fileStat.size > MAX_NOTEBOOK_BYTES) {
            return errorResult('file_too_large', `Notebook is too large to read: ${requestedPath}`, {
              path: toWorkspaceRelative(cwd, filePath), size: fileStat.size, maxBytes: MAX_NOTEBOOK_BYTES,
            });
          }
          const relPath = toWorkspaceRelative(cwd, filePath);
          const notebookDedup = maybeDedup(relPath);
          if (notebookDedup) return notebookDedup;
          const buffer = await readFile(filePath);
          const rendered = renderNotebook(decodeTextBuffer(buffer).content);
          const lines = rendered.split('\n');
          const totalLines = lines.length;
          const windowArgs = parseReadWindow(args);
          if (!windowArgs.ok) return errorResult(windowArgs.code, windowArgs.message, { path: relPath });
          const { offset, limit } = windowArgs;
          const selected = lines.slice(offset - 1, offset - 1 + limit);
          const view = renderTextWindow(selected, offset, totalLines);
          recordEmitted(totalLines);
          return textResult(view.text, {
            ok: true, path: relPath, format: 'notebook', offset, limit, totalLines,
            returnedLines: view.returnedLines, size: fileStat.size,
            ...(view.columnTruncated ? { columnTruncated: READ_MAX_LINE_COLUMNS } : {}),
          });
        }

        const relPath = toWorkspaceRelative(cwd, filePath);
        if (BINARY_EXTENSIONS.has(fileExt)) {
          return errorResult('binary_file', `Refusing to read binary file: ${requestedPath}`, {
            path: relPath, size: fileStat.size,
          });
        }
        if (fileStat.size > MAX_READ_FILE_BYTES) {
          return errorResult('file_too_large', `File is too large to read: ${requestedPath}`, {
            path: relPath, size: fileStat.size, maxBytes: MAX_READ_FILE_BYTES,
          });
        }

        const windowArgs = parseReadWindow(args);
        if (!windowArgs.ok) return errorResult(windowArgs.code, windowArgs.message, { path: relPath });
        const { offset, limit } = windowArgs;

        const dedupHit = maybeDedup(relPath);
        if (dedupHit) return dedupHit;

        let multiRanges: LineRange[] | undefined;
        if (args.ranges !== undefined) {
          const parsedRanges = parseRanges(args.ranges);
          if (!parsedRanges.ok) return errorResult(parsedRanges.code, parsedRanges.message, { path: relPath });
          if (fileStat.size > READ_FAST_PATH_BYTES) {
            return errorResult('ranges_unsupported_large',
              `ranges only support files up to ${READ_FAST_PATH_BYTES} bytes; use offset/limit for larger files: ${requestedPath}`,
              { path: relPath, size: fileStat.size });
          }
          multiRanges = parsedRanges.ranges;
        }

        // Fast path: small files are read whole, which keeps full BOM/UTF-16
        // decoding, hashline anchors, and full-content tracking for write guards.
        if (fileStat.size <= READ_FAST_PATH_BYTES) {
          const buffer = await readFile(filePath);
          const decoded = decodeTextBuffer(buffer);
          if (decoded.encoding === 'utf8' && !decoded.hasBom && isBinaryBuffer(buffer)) {
            return errorResult('binary_file', `Refusing to read binary file: ${requestedPath}`, {
              path: relPath, size: fileStat.size,
            });
          }
          const text = decoded.content;
          const lines = text.split(/\r?\n/);
          if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
          const totalLines = lines.length;
          if (multiRanges) {
            const view = renderMultiRangeWindow(lines, multiRanges, totalLines, relPath);
            const rangeStates = view.shownRanges.map(range =>
              buildRangeDescriptor(range.start, lines.slice(range.start - 1, range.end)));
            // We hold the whole file, so record full content: edits stay safe even
            // though only the requested ranges were shown.
            await options?.readFileState?.recordRead(filePath, {
              content: text,
              offset: 1,
              limit: totalLines,
              totalLines,
              returnedLines: view.returnedLines,
              isPartialView: true,
              hasFullContent: true,
              timestamp: fileStat.mtimeMs,
            });
            recordEmitted(totalLines);
            return textResult(view.text, {
              ok: true,
              path: relPath,
              format: 'ranges',
              ranges: view.shownRanges.map(r => [r.start, r.end]),
              totalLines,
              returnedLines: view.returnedLines,
              size: fileStat.size,
              state: buildReadStateDescriptor({
                relPath,
                content: text,
                ranges: rangeStates,
                fullContentCaptured: true,
                partialView: true,
              }),
              ...(view.columnTruncated ? { columnTruncated: READ_MAX_LINE_COLUMNS } : {}),
            });
          }
          try {
            const userGaveWindow = args.offset !== undefined || args.limit !== undefined;
            const summaryEligible = !userGaveWindow
              && args.hashline !== true
              && args.full !== true
              && totalLines >= SUMMARY_MIN_LINES
              && totalLines <= SUMMARY_MAX_LINES
              && buffer.length <= SUMMARY_MAX_BYTES;
            if (summaryEligible) {
              const provider = getOutlineProvider(fileExt);
              if (provider) {
                const folds = await provider.findFolds(text, filePath);
                const foldedLines = folds.reduce((sum, f) => sum + (f.endLine - f.startLine + 1), 0);
                if (foldedLines / totalLines >= SUMMARY_MIN_SAVINGS) {
                  const skeleton = renderSkeleton(lines, folds, totalLines, relPath);
                  await options?.readFileState?.recordRead(filePath, {
                    content: text,
                    offset: 1,
                    limit: totalLines,
                    totalLines,
                    returnedLines: skeleton.visibleLines,
                    isPartialView: true,
                    hasFullContent: true,
                    timestamp: fileStat.mtimeMs,
                  });
                  recordEmitted(totalLines);
                  return textResult(skeleton.text, {
                    ok: true,
                    path: relPath,
                    format: 'outline',
                    totalLines,
                    foldedLines,
                    foldedBodies: folds.length,
                    elidedRanges: folds.map(f => [f.startLine, f.endLine]),
                    returnedLines: skeleton.visibleLines,
                    size: fileStat.size,
                    state: buildReadStateDescriptor({
                      relPath,
                      content: text,
                      fullContentCaptured: true,
                      partialView: true,
                    }),
                  });
                }
              }
            }
          } catch {
            // summary is best-effort: fall through to the normal read
          }
          const selected = lines.slice(offset - 1, offset - 1 + limit);
          const isHashline = args.hashline === true;
          const view = renderTextWindow(selected, offset, totalLines);
          const hashlineView = isHashline ? renderHashlineWindow(relPath, text, selected, offset, totalLines) : undefined;
          const returnedLines = isHashline ? hashlineView!.returnedLines : view.returnedLines;
          const returnedLineTexts = selected.slice(0, returnedLines);
          await options?.readFileState?.recordRead(filePath, {
            content: text,
            offset,
            limit,
            totalLines,
            returnedLines,
            hasFullContent: true,
            timestamp: fileStat.mtimeMs,
          });
          recordEmitted(totalLines);
          return textResult(
            isHashline ? hashlineView!.text : view.text,
            {
              ok: true,
              path: relPath,
              offset,
              limit,
              totalLines,
              returnedLines,
              size: fileStat.size,
              state: buildReadStateDescriptor({
                relPath,
                content: text,
                range: buildRangeDescriptor(offset, returnedLineTexts),
                fullContentCaptured: true,
                partialView: offset !== 1 || returnedLines < totalLines,
              }),
              ...(!isHashline && view.columnTruncated ? { columnTruncated: READ_MAX_LINE_COLUMNS } : {}),
              ...(isHashline ? {
                hashline: {
                  path: relPath,
                  tag: hashlineTag(text),
                  snapshotId: hashlineSnapshotId(relPath, text),
                  lines: hashlineView!.entries,
                  cappedByTokens: hashlineView!.cappedByTokens,
                },
              } : {}),
            });
        }

        // Streaming path: files above the fast-path threshold are read line by
        // line, buffering only the requested window. hashline anchors are not
        // available here (they require the whole file); the model can still page
        // through with offset/limit.
        const window = await readLineWindowStreaming(filePath, offset, limit);
        if (window.binary) {
          return errorResult('binary_file', `Refusing to read binary file: ${requestedPath}`, {
            path: relPath, size: fileStat.size,
          });
        }
        const view = renderTextWindow(window.lines, offset, window.totalLines);
        await options?.readFileState?.recordRead(filePath, {
          content: window.lines.join('\n'),
          offset,
          limit,
          totalLines: window.totalLines,
          returnedLines: view.returnedLines,
          isPartialView: true,
          hasFullContent: false,
          timestamp: fileStat.mtimeMs,
        });
        recordEmitted(window.totalLines);
        return textResult(view.text, {
          ok: true,
          path: relPath,
          offset,
          limit,
          totalLines: window.totalLines,
          returnedLines: view.returnedLines,
          size: fileStat.size,
          streamed: true,
          state: buildPartialReadStateDescriptor({
            start: offset,
            lines: window.lines.slice(0, view.returnedLines),
            streamed: true,
          }),
          ...(view.columnTruncated ? { columnTruncated: READ_MAX_LINE_COLUMNS } : {}),
        });
      } catch (err) {
        return errorResult('read_failed', err instanceof Error ? err.message : String(err), {
          path: String(requestedPath),
        });
      }
      })();
      const details = (result as { details?: { ok?: boolean; path?: unknown; deduped?: boolean } }).details;
      if (details && details.ok !== false && details.deduped !== true && typeof details.path === 'string') {
        const notice = noteRepeatRead(details.path);
        if (notice) return appendTextNotice(result, notice);
      }
      return result;
    },
  } as unknown as AgentTool<any>;
}
