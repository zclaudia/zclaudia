import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { shouldAutoResetDevDb, backupAndClearDb, withDevAutoReset } from '../dev-db-recovery.js';

describe('shouldAutoResetDevDb', () => {
  it('is true when ZCLAUDIA_CHANNEL is dev', () => {
    expect(shouldAutoResetDevDb({ ZCLAUDIA_CHANNEL: 'dev' })).toBe(true);
  });

  it('is true when NODE_ENV is development', () => {
    expect(shouldAutoResetDevDb({ NODE_ENV: 'development' })).toBe(true);
  });

  it('is true when ZCLAUDIA_DEV is set', () => {
    expect(shouldAutoResetDevDb({ ZCLAUDIA_DEV: '1' })).toBe(true);
  });

  it('is false when no dev signal is present (prod embedded leaves channel unset)', () => {
    expect(shouldAutoResetDevDb({})).toBe(false);
  });

  it('never resets when ZCLAUDIA_CHANNEL is prod, even with other dev signals', () => {
    expect(
      shouldAutoResetDevDb({ ZCLAUDIA_CHANNEL: 'prod', ZCLAUDIA_DEV: '1', NODE_ENV: 'development' })
    ).toBe(false);
  });
});

describe('backupAndClearDb', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zc-recover-'));
    dbPath = path.join(dir, 'data.db');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('renames the db to a timestamped backup and preserves its bytes', () => {
    writeFileSync(dbPath, 'original-db-bytes');
    const backup = backupAndClearDb(dbPath, { timestamp: '20260101-120000' });
    expect(backup).toBe(path.join(dir, 'data.db.bak-20260101-120000'));
    expect(existsSync(dbPath)).toBe(false);
    expect(readFileSync(backup, 'utf-8')).toBe('original-db-bytes');
  });

  it('removes stale -wal and -shm sidecars', () => {
    writeFileSync(dbPath, 'db');
    writeFileSync(`${dbPath}-wal`, 'wal');
    writeFileSync(`${dbPath}-shm`, 'shm');
    backupAndClearDb(dbPath, { timestamp: '20260101-120000' });
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it('prunes older backups, keeping only the most recent (default keep=1)', () => {
    writeFileSync(path.join(dir, 'data.db.bak-20250101-000000'), 'old');
    writeFileSync(path.join(dir, 'data.db.bak-20250601-000000'), 'mid');
    writeFileSync(dbPath, 'db');
    backupAndClearDb(dbPath, { timestamp: '20260101-120000' });
    const backups = readdirSync(dir)
      .filter(f => f.startsWith('data.db.bak-'))
      .sort();
    expect(backups).toEqual(['data.db.bak-20260101-120000']);
  });

  it('honors an explicit keep count', () => {
    writeFileSync(path.join(dir, 'data.db.bak-20250101-000000'), 'old');
    writeFileSync(path.join(dir, 'data.db.bak-20250601-000000'), 'mid');
    writeFileSync(dbPath, 'db');
    backupAndClearDb(dbPath, { timestamp: '20260101-120000', keep: 2 });
    const backups = readdirSync(dir)
      .filter(f => f.startsWith('data.db.bak-'))
      .sort();
    expect(backups).toEqual(['data.db.bak-20250601-000000', 'data.db.bak-20260101-120000']);
  });
});

describe('withDevAutoReset', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zc-reset-'));
    dbPath = path.join(dir, 'data.db');
    writeFileSync(dbPath, 'db');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens once and never backs up when prepare succeeds', () => {
    let opens = 0;
    const db = withDevAutoReset({
      dbPath,
      env: { ZCLAUDIA_CHANNEL: 'dev' },
      open: () => ({ id: ++opens }),
      prepare: () => {},
      close: () => {},
    });
    expect(db).toEqual({ id: 1 });
    expect(opens).toBe(1);
    expect(existsSync(dbPath)).toBe(true);
    expect(readdirSync(dir).some(f => f.startsWith('data.db.bak-'))).toBe(false);
  });

  it('backs up, reopens, and retries prepare once on failure in dev', () => {
    let opens = 0;
    let closes = 0;
    let prepares = 0;
    const db = withDevAutoReset({
      dbPath,
      env: { ZCLAUDIA_CHANNEL: 'dev' },
      open: () => ({ id: ++opens }),
      prepare: () => {
        prepares++;
        if (prepares === 1) throw new Error('incompatible schema');
      },
      close: () => {
        closes++;
      },
    });
    expect(db).toEqual({ id: 2 });
    expect(opens).toBe(2);
    expect(closes).toBe(1);
    expect(prepares).toBe(2);
    expect(readdirSync(dir).some(f => f.startsWith('data.db.bak-'))).toBe(true);
  });

  it('rethrows without touching data when not in dev mode', () => {
    let opens = 0;
    expect(() =>
      withDevAutoReset({
        dbPath,
        env: {},
        open: () => ({ id: ++opens }),
        prepare: () => {
          throw new Error('incompatible schema');
        },
        close: () => {},
      })
    ).toThrow('incompatible schema');
    expect(opens).toBe(1);
    expect(existsSync(dbPath)).toBe(true);
    expect(readdirSync(dir).some(f => f.startsWith('data.db.bak-'))).toBe(false);
  });
});
