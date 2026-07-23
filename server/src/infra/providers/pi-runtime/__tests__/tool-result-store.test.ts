import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  persistToolResultText,
  sweepPersistedStore,
  toolResultsDir,
  TOOL_RESULT_MAX_AGE_MS,
  TOOL_RESULTS_MAX_TOTAL_BYTES,
} from '../tool-result-store.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zc-tool-results-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(name: string, size: number, ageMs: number): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, 'x'.repeat(size));
  const mtime = new Date(Date.now() - ageMs);
  utimesSync(filePath, mtime, mtime);
  return filePath;
}

describe('sweepPersistedStore', () => {
  it('exposes the documented retention defaults (7 days, 256 MB)', () => {
    expect(TOOL_RESULT_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(TOOL_RESULTS_MAX_TOTAL_BYTES).toBe(256 * 1024 * 1024);
  });

  it('deletes files older than the TTL and keeps fresh ones', () => {
    const stale = seed('stale.txt', 100, TOOL_RESULT_MAX_AGE_MS + 60_000);
    const fresh = seed('fresh.txt', 100, 60_000);

    sweepPersistedStore(dir);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('honours a custom TTL', () => {
    const file = seed('recent.txt', 100, 2 * 60_000);

    sweepPersistedStore(dir, { maxAgeMs: 60_000 });
    expect(existsSync(file)).toBe(false);
  });

  it('evicts oldest-first once the total size cap is exceeded', () => {
    const oldest = seed('a.txt', 100, 3 * 60_000);
    const middle = seed('b.txt', 100, 2 * 60_000);
    const newest = seed('c.txt', 100, 60_000);

    sweepPersistedStore(dir, { maxTotalBytes: 150 });

    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(middle)).toBe(false);
    expect(existsSync(newest)).toBe(true);
  });

  it('keeps everything when under the cap and within the TTL', () => {
    seed('a.txt', 100, 60_000);
    seed('b.txt', 100, 30_000);

    sweepPersistedStore(dir, { maxTotalBytes: 1000 });

    expect(existsSync(path.join(dir, 'a.txt'))).toBe(true);
    expect(existsSync(path.join(dir, 'b.txt'))).toBe(true);
  });

  it('ignores subdirectories and survives a missing directory', () => {
    mkdirSync(path.join(dir, 'nested'));
    const stale = seed('stale.txt', 100, TOOL_RESULT_MAX_AGE_MS + 60_000);

    sweepPersistedStore(dir);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(path.join(dir, 'nested'))).toBe(true);
    expect(() => sweepPersistedStore(path.join(dir, 'does-not-exist'))).not.toThrow();
  });
});

describe('persistToolResultText retention', () => {
  let prevDataDir: string | undefined;

  beforeEach(() => {
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
  });

  it('sweeps expired results lazily on each write and writes 0600', () => {
    const resultsDir = toolResultsDir();
    mkdirSync(resultsDir, { recursive: true });
    const stale = path.join(resultsDir, 'stale.txt');
    writeFileSync(stale, 'stale');
    const mtime = new Date(Date.now() - TOOL_RESULT_MAX_AGE_MS - 60_000);
    utimesSync(stale, mtime, mtime);

    const persisted = persistToolResultText('Grep', [{ type: 'text', text: 'fresh spill' }]);

    expect(persisted).toBeDefined();
    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(persisted!.filePath, 'utf8')).toBe('fresh spill');
    expect(statSync(persisted!.filePath).mode & 0o777).toBe(0o600);
  });
});
