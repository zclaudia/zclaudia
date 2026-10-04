/**
 * Storage location + legacy migration for PluginStorage, against a real temp
 * filesystem (storage.test.ts mocks fs wholesale).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PluginStorage,
  legacyPluginStorageDir,
  pluginStorageDir,
  resolvePluginStorageFile,
} from '../storage.js';

describe('PluginStorage path', () => {
  let root: string;
  let prevDataDir: string | undefined;
  let prevLegacyDataDir: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-storage-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    prevLegacyDataDir = process.env.ZCLAUDIA_LEGACY_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = path.join(root, 'data');
    process.env.ZCLAUDIA_LEGACY_DATA_DIR = path.join(root, 'home', '.claudia');
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    if (prevLegacyDataDir === undefined) delete process.env.ZCLAUDIA_LEGACY_DATA_DIR;
    else process.env.ZCLAUDIA_LEGACY_DATA_DIR = prevLegacyDataDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const dataFile = (id: string) => path.join(root, 'data', 'plugin-storage', `${id}.json`);
  const legacyFile = (id: string) =>
    path.join(root, 'home', '.claudia', 'plugin-storage', `${id}.json`);

  function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }

  function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  it('resolves the storage dirs from ZCLAUDIA_DATA_DIR and the legacy root', () => {
    expect(pluginStorageDir()).toBe(path.join(root, 'data', 'plugin-storage'));
    expect(legacyPluginStorageDir()).toBe(path.join(root, 'home', '.claudia', 'plugin-storage'));
  });

  it('persists values to the data dir', async () => {
    await new PluginStorage('p').set('k', 'v');

    expect(readJson(dataFile('p'))).toEqual({ k: 'v' });
    expect(await new PluginStorage('p').get('k')).toBe('v');
    expect(fs.existsSync(legacyFile('p'))).toBe(false);
  });

  it('copies the legacy file when the new one does not exist yet', async () => {
    writeJson(legacyFile('p'), { k: 'legacy' });

    const storage = new PluginStorage('p');
    expect(await storage.get('k')).toBe('legacy');
    expect(readJson(dataFile('p'))).toEqual({ k: 'legacy' });

    // Later writes land in the new file only; the legacy file is untouched.
    await storage.set('k', 'new');
    await storage.set('other', 1);
    expect(readJson(dataFile('p'))).toEqual({ k: 'new', other: 1 });
    expect(readJson(legacyFile('p'))).toEqual({ k: 'legacy' });
  });

  it('migrates per plugin', async () => {
    writeJson(legacyFile('a'), { k: 'a' });
    writeJson(dataFile('b'), { k: 'b-current' });
    writeJson(legacyFile('b'), { k: 'b-legacy' });

    expect(await new PluginStorage('a').get('k')).toBe('a');
    expect(await new PluginStorage('b').get('k')).toBe('b-current');
    expect(fs.existsSync(dataFile('c'))).toBe(false);
    expect(await new PluginStorage('c').keys()).toEqual([]);
  });

  it('never overwrites an existing file with the legacy one', async () => {
    writeJson(dataFile('p'), { k: 'current' });
    writeJson(legacyFile('p'), { k: 'legacy', extra: true });

    const storage = new PluginStorage('p');
    expect(await storage.get('k')).toBe('current');
    expect(await storage.get('extra')).toBeUndefined();
    expect(readJson(dataFile('p'))).toEqual({ k: 'current' });
  });

  it('does not migrate when an explicit storage path is given without a legacy path', async () => {
    const storagePath = path.join(root, 'elsewhere', 'p.json');
    writeJson(legacyFile('p'), { k: 'legacy' });

    expect(await new PluginStorage('p', { storagePath }).get('k')).toBeUndefined();
    expect(fs.existsSync(storagePath)).toBe(false);
  });

  it('resolvePluginStorageFile seeds the data-dir file from the legacy one', () => {
    writeJson(legacyFile('p'), { k: 'legacy' });

    expect(resolvePluginStorageFile('p')).toBe(dataFile('p'));
    expect(readJson(dataFile('p'))).toEqual({ k: 'legacy' });

    // A second call after the plugin has written leaves its data alone.
    writeJson(dataFile('p'), { k: 'current' });
    expect(resolvePluginStorageFile('p')).toBe(dataFile('p'));
    expect(readJson(dataFile('p'))).toEqual({ k: 'current' });
  });

  it('resolvePluginStorageFile creates nothing when there is no legacy file', () => {
    expect(resolvePluginStorageFile('p')).toBe(dataFile('p'));
    expect(fs.existsSync(dataFile('p'))).toBe(false);
  });
});
