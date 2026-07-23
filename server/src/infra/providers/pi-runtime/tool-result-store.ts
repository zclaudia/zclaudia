/**
 * Disk persistence for oversize tool results.
 *
 * When a turn's tool results exceed the context budget, the full text of the
 * largest results is written here and the in-context result is replaced with a
 * short preview plus the file path, which the model can Read back on demand.
 *
 * Retention policy: persisted results are spill for in-flight turns and may
 * contain sensitive command output, so they must not accumulate at rest.
 * Files are written 0600, kept at most TOOL_RESULT_MAX_AGE_MS (7 days), and
 * the directory is capped at TOOL_RESULTS_MAX_TOTAL_BYTES with oldest-first
 * (mtime) eviction. The sweep runs lazily on each new write — no background
 * timer (same pattern as bash-runner's spill logs).
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { resolveDataDir } from '../../../domains/tasks/executors/command-executor.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentBlock = { type: string; text?: string; [k: string]: any };

export const TOOL_RESULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TOOL_RESULTS_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export function toolResultsDir(): string {
  return path.join(resolveDataDir(), 'tool-results');
}

export function measureTextBytes(content: ContentBlock[]): number {
  let total = 0;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      total += Buffer.byteLength(block.text, 'utf8');
    }
  }
  return total;
}

export interface PersistedStoreSweepOptions {
  /** Files whose mtime is older than this are deleted. Default: 7 days. */
  maxAgeMs?: number;
  /** Total size cap; oldest files (mtime) are evicted first. Default: 256 MB. */
  maxTotalBytes?: number;
  /** Clock override for tests. */
  now?: number;
}

/**
 * Best-effort TTL + size-cap sweep for a directory of persisted tool output
 * (tool-result spill, MCP output). Deletes files older than maxAgeMs, then —
 * while the remainder exceeds maxTotalBytes — evicts oldest-first. All fs
 * errors are swallowed: a sweep must never break the write that triggered it.
 */
export function sweepPersistedStore(dir: string, options: PersistedStoreSweepOptions = {}): void {
  const maxAgeMs = options.maxAgeMs ?? TOOL_RESULT_MAX_AGE_MS;
  const maxTotalBytes = options.maxTotalBytes ?? TOOL_RESULTS_MAX_TOTAL_BYTES;
  const now = options.now ?? Date.now();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const files: Array<{ path: string; mtimeMs: number; size: number }> = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
      files.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      // vanished mid-sweep — fine
    }
  }
  const cutoff = now - maxAgeMs;
  const kept: typeof files = [];
  for (const file of files) {
    if (file.mtimeMs < cutoff) {
      try {
        unlinkSync(file.path);
      } catch {
        // locked or already gone — best-effort
      }
    } else {
      kept.push(file);
    }
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  if (total <= maxTotalBytes) return;
  kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of kept) {
    if (total <= maxTotalBytes) break;
    try {
      unlinkSync(file.path);
      total -= file.size;
    } catch {
      // locked or already gone — skip
    }
  }
}

/**
 * Write the text blocks of a tool result to disk. Returns undefined when there
 * is no text to persist or the write fails (caller falls back to inline content).
 */
export function persistToolResultText(
  toolName: string,
  content: ContentBlock[]
): { filePath: string; size: number } | undefined {
  const text = content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n');
  if (!text) return undefined;
  try {
    const dir = toolResultsDir();
    mkdirSync(dir, { recursive: true });
    sweepPersistedStore(dir);
    const safeTool = toolName.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'tool';
    const filePath = path.join(dir, `${Date.now()}-${safeTool}-${randomUUID().slice(0, 8)}.txt`);
    writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 });
    return { filePath, size: Buffer.byteLength(text, 'utf8') };
  } catch {
    return undefined;
  }
}
