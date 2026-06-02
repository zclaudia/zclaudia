import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { maybeWipeDevDataDir, writeSchemaVersion } from '../dev-clear.js';

describe('maybeWipeDevDataDir', () => {
  let tmpRoot: string;
  let originalEnv: string | undefined;
  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-dc-'));
    originalEnv = process.env.NODE_ENV;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
    delete process.env.ZCLAUDIA_DEV;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('is a no-op when NODE_ENV !== development and ZCLAUDIA_DEV unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.ZCLAUDIA_DEV;
    mkdirSync(path.join(tmpRoot, 'subdir'));
    const result = maybeWipeDevDataDir(tmpRoot);
    expect(result.wiped).toBe(false);
    expect(existsSync(path.join(tmpRoot, 'subdir'))).toBe(true);
  });

  it('is a no-op when data dir does not exist', () => {
    process.env.NODE_ENV = 'development';
    const missing = path.join(tmpRoot, 'nope');
    const result = maybeWipeDevDataDir(missing);
    expect(result.wiped).toBe(false);
  });

  it('wipes when no version file exists', () => {
    process.env.NODE_ENV = 'development';
    mkdirSync(path.join(tmpRoot, 'data'));
    const result = maybeWipeDevDataDir(tmpRoot);
    expect(result.wiped).toBe(true);
    expect(existsSync(path.join(tmpRoot, 'data'))).toBe(false);
  });

  it('does not wipe when version file matches', () => {
    process.env.NODE_ENV = 'development';
    mkdirSync(path.join(tmpRoot, 'data'));
    writeSchemaVersion(tmpRoot);
    const result = maybeWipeDevDataDir(tmpRoot);
    expect(result.wiped).toBe(false);
    expect(existsSync(path.join(tmpRoot, 'data'))).toBe(true);
  });

  it('wipes when version file mismatches', () => {
    process.env.NODE_ENV = 'development';
    mkdirSync(path.join(tmpRoot, 'data'));
    writeFileSync(path.join(tmpRoot, 'schema-version.txt'), 'old-version');
    const result = maybeWipeDevDataDir(tmpRoot);
    expect(result.wiped).toBe(true);
    expect(existsSync(path.join(tmpRoot, 'data'))).toBe(false);
  });
});
