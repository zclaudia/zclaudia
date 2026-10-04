import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';

import { resolveDataDir, seedFromLegacyFile, sweepStaleLogs } from '../data-dir.js';

describe('resolveDataDir', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.ZCLAUDIA_DATA_DIR;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prev;
  });

  it('resolves ZCLAUDIA_DATA_DIR when set', () => {
    process.env.ZCLAUDIA_DATA_DIR = 'some/relative/dir';
    expect(resolveDataDir()).toBe(resolve('some/relative/dir'));
  });

  it('falls back to ~/.zclaudia when unset', () => {
    delete process.env.ZCLAUDIA_DATA_DIR;
    expect(resolveDataDir()).toBe(join(homedir(), '.zclaudia'));
  });
});

describe('seedFromLegacyFile', () => {
  const seedTempFiles = (dir: string) =>
    readdirSync(dir).filter((name) => name.includes('.seed-'));

  it('copies the legacy file into place when the target is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-seed-'));
    try {
      const legacy = join(dir, 'legacy', 'store.json');
      mkdirSync(join(dir, 'legacy'));
      writeFileSync(legacy, '{"granted":true}');
      const target = join(dir, 'nested', 'deeper', 'store.json');

      expect(seedFromLegacyFile(legacy, target)).toBe(true);
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, 'utf-8')).toBe('{"granted":true}');
      // a failed/interrupted copy must not leave a marker that blocks retry
      expect(seedTempFiles(join(dir, 'nested', 'deeper'))).toEqual([]);
      expect(existsSync(legacy)).toBe(true); // legacy stays for older builds
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never overwrites an existing target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-seed-'));
    try {
      const legacy = join(dir, 'legacy.json');
      writeFileSync(legacy, '{"from":"legacy"}');
      const target = join(dir, 'store.json');
      writeFileSync(target, '{"from":"new"}');

      expect(seedFromLegacyFile(legacy, target)).toBe(false);
      expect(readFileSync(target, 'utf-8')).toBe('{"from":"new"}');
      expect(seedTempFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false for a missing legacy file or identical paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-seed-'));
    try {
      expect(seedFromLegacyFile(join(dir, 'nope.json'), join(dir, 'store.json'))).toBe(false);
      const same = join(dir, 'store.json');
      writeFileSync(same, '{}');
      expect(seedFromLegacyFile(same, same)).toBe(false);
      expect(seedFromLegacyFile(same, join(dir, '.', 'store.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates copy errors and cleans up its temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-seed-'));
    try {
      const legacy = join(dir, 'legacy.json');
      writeFileSync(legacy, '{}');
      // target parent path is occupied by a regular file → mkdir/copy fails
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, 'x');

      expect(() => seedFromLegacyFile(legacy, join(blocker, 'store.json'))).toThrow();
      expect(seedTempFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sweepStaleLogs', () => {
  it('removes .log files older than the TTL and keeps recent ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-datadir-'));
    try {
      const stale = join(dir, 'stale.log');
      writeFileSync(stale, 'old');
      const backdated = Date.now() / 1000 - 25 * 60 * 60;
      utimesSync(stale, backdated, backdated);
      const fresh = join(dir, 'fresh.log');
      writeFileSync(fresh, 'new');
      const notALog = join(dir, 'keep.json');
      writeFileSync(notALog, '{}');
      const backdatedJson = Date.now() / 1000 - 25 * 60 * 60;
      utimesSync(notALog, backdatedJson, backdatedJson);

      sweepStaleLogs(dir, 24 * 60 * 60 * 1000);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(notALog)).toBe(true); // only *.log files are collected
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a missing directory', () => {
    expect(() => sweepStaleLogs(join(tmpdir(), 'zc-datadir-does-not-exist'), 1000)).not.toThrow();
  });

  it('ignores non-log entries like subdirectories named *.log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-datadir-'));
    try {
      const weird = join(dir, 'subdir.log');
      mkdirSync(weird);
      const backdated = Date.now() / 1000 - 25 * 60 * 60;
      utimesSync(weird, backdated, backdated);

      expect(() => sweepStaleLogs(dir, 24 * 60 * 60 * 1000)).not.toThrow();
      expect(existsSync(weird)).toBe(true); // unlink on a dir fails → best-effort skip
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
