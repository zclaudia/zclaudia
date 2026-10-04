/**
 * Store location + legacy migration for PermissionManager, against a real
 * temp filesystem (permissions.test.ts mocks fs wholesale).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionManager, defaultPermissionStorePath } from '../permissions.js';

describe('PermissionManager store path', () => {
  let root: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-store-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }

  it('defaults to plugin-permissions.json in ZCLAUDIA_DATA_DIR', () => {
    process.env.ZCLAUDIA_DATA_DIR = path.join(root, 'data');
    expect(defaultPermissionStorePath()).toBe(path.join(root, 'data', 'plugin-permissions.json'));
  });

  it('persists grants to the store path', () => {
    const storePath = path.join(root, 'data', 'plugin-permissions.json');
    new PermissionManager({ storePath }).grant('p', 'storage');

    expect(JSON.parse(fs.readFileSync(storePath, 'utf-8'))).toEqual({
      p: { granted: ['storage'], denied: [] },
    });
    expect(new PermissionManager({ storePath }).hasPermission('p', 'storage')).toBe(true);
  });

  it('copies the legacy store when the new one does not exist yet', () => {
    const storePath = path.join(root, 'data', 'plugin-permissions.json');
    const legacyStorePath = path.join(root, 'home', '.claudia', 'plugin-permissions.json');
    writeJson(legacyStorePath, { p: { granted: ['fs.read'], denied: ['shell.execute'] } });

    const manager = new PermissionManager({ storePath, legacyStorePath });

    expect(manager.hasPermission('p', 'fs.read')).toBe(true);
    expect(manager.getDeniedPermissions('p')).toEqual(['shell.execute']);
    expect(fs.existsSync(storePath)).toBe(true);

    // Later writes land in the new store only; the legacy file is untouched.
    manager.clearPluginPermissions('p');
    expect(JSON.parse(fs.readFileSync(legacyStorePath, 'utf-8'))).toEqual({
      p: { granted: ['fs.read'], denied: ['shell.execute'] },
    });
  });

  it('never overwrites an existing store with the legacy one', () => {
    const storePath = path.join(root, 'data', 'plugin-permissions.json');
    const legacyStorePath = path.join(root, 'home', '.claudia', 'plugin-permissions.json');
    writeJson(storePath, { current: { granted: ['storage'], denied: [] } });
    writeJson(legacyStorePath, { legacy: { granted: ['fs.read'], denied: [] } });

    const manager = new PermissionManager({ storePath, legacyStorePath });

    expect(manager.hasPermission('current', 'storage')).toBe(true);
    expect(manager.hasPermission('legacy', 'fs.read')).toBe(false);
  });

  it('starts empty when neither store exists', () => {
    const storePath = path.join(root, 'data', 'plugin-permissions.json');
    const legacyStorePath = path.join(root, 'home', '.claudia', 'plugin-permissions.json');

    const manager = new PermissionManager({ storePath, legacyStorePath });

    expect(manager.getAllPluginPermissions()).toEqual({});
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it('does not migrate when an explicit store path is given without a legacy path', () => {
    const storePath = path.join(root, 'data', 'plugin-permissions.json');
    expect(new PermissionManager({ storePath }).getAllPluginPermissions()).toEqual({});
    expect(fs.existsSync(storePath)).toBe(false);
  });
});
