import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'zc-device-id-'));
  process.env.ZCLAUDIA_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ZCLAUDIA_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

// The module resolves CONFIG_DIR from ZCLAUDIA_DATA_DIR at import time, so re-import per test.
async function loadGetOrCreateDeviceId() {
  const mod = await import('../gateway-device-id.js');
  return mod.getOrCreateDeviceId;
}

describe('getOrCreateDeviceId', () => {
  it('creates and persists a device id on first run', async () => {
    const getOrCreateDeviceId = await loadGetOrCreateDeviceId();
    const id = getOrCreateDeviceId();
    expect(id).toBeTruthy();
    const stored = JSON.parse(readFileSync(path.join(dataDir, 'device.json'), 'utf-8'));
    expect(stored.deviceId).toBe(id);
  });

  it('returns the same id on subsequent calls', async () => {
    const getOrCreateDeviceId = await loadGetOrCreateDeviceId();
    expect(getOrCreateDeviceId()).toBe(getOrCreateDeviceId());
  });

  it('regenerates when device.json is corrupt', async () => {
    writeFileSync(path.join(dataDir, 'device.json'), 'not json');
    const getOrCreateDeviceId = await loadGetOrCreateDeviceId();
    const id = getOrCreateDeviceId();
    expect(id).toBeTruthy();
    expect(existsSync(path.join(dataDir, 'device.json'))).toBe(true);
    const stored = JSON.parse(readFileSync(path.join(dataDir, 'device.json'), 'utf-8'));
    expect(stored.deviceId).toBe(id);
  });
});
