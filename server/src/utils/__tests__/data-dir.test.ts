import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';

import { resolveDataDir, sweepStaleLogs } from '../data-dir.js';

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
