import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInstance, PluginManifest } from '@zclaudia/shared/plugin-types';
import type { PluginLoader } from '../loader.js';
import { PluginPackageError, PluginPackageService } from '../package-service.js';
import { buildZip, symlinkEntry, type ZipEntrySpec } from './zip-test-utils.js';

function manifest(version: string): PluginManifest {
  return {
    id: 'com.test.package',
    name: 'Package Test',
    version,
    description: 'A package service test plugin',
    main: 'dist/main.js',
    engines: { claudia: '*' },
    permissions: ['network.fetch'],
  };
}

class FakeLoader {
  plugins = new Map<string, PluginInstance>();
  /** Number of discover() calls that should return nothing (failure injection). */
  discoverFailuresLeft = 0;

  constructor(private readonly dataDir: string) {}

  getPlugin(id: string) {
    return this.plugins.get(id);
  }

  async remove(id: string) {
    return this.plugins.delete(id);
  }

  async discover() {
    if (this.discoverFailuresLeft > 0) {
      this.discoverFailuresLeft -= 1;
      return [];
    }
    const pluginPath = path.join(this.dataDir, 'plugins', 'com.test.package');
    try {
      const parsed = JSON.parse(await readFile(path.join(pluginPath, 'plugin.json'), 'utf8'));
      this.plugins.set(parsed.id, {
        manifest: parsed,
        path: pluginPath,
        isActive: false,
      });
      return [parsed];
    } catch {
      return [];
    }
  }
}

describe('PluginPackageService', () => {
  let dataDir: string;
  let loader: FakeLoader;
  let service: PluginPackageService;
  let now: Date;
  let releasePluginReference: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'zclaudia-package-service-'));
    loader = new FakeLoader(dataDir);
    now = new Date('2026-07-21T00:00:00.000Z');
    releasePluginReference = vi.fn(async () => {});
    service = new PluginPackageService({
      dataDir,
      loader: loader as unknown as PluginLoader,
      now: () => now,
      managedRuntimeReferences: { releasePluginReference },
    });
  });

  afterEach(async () => {
    await rm(dataDir, { force: true, recursive: true });
  });

  async function createPackage(
    version: string,
    main = 'export const version = 1;',
    extras: ZipEntrySpec[] = []
  ) {
    const archive = path.join(
      dataDir,
      `plugin-${version}-${Math.random().toString(36).slice(2)}.zplugin`
    );
    const built = buildZip([
      { name: 'plugin.json', data: JSON.stringify(manifest(version)) },
      { name: 'dist/main.js', data: main },
      ...extras,
    ]);
    await writeFile(archive, built.buffer);
    return archive;
  }

  async function readActiveVersion(): Promise<string> {
    const parsed = JSON.parse(
      await readFile(path.join(dataDir, 'plugins', 'com.test.package', 'plugin.json'), 'utf8')
    );
    return parsed.version;
  }

  it('previews, installs, updates, rolls back, and uninstalls managed versions', async () => {
    const first = await createPackage('1.0.0');
    const firstPreview = await service.inspectPackage(first, 'plugin-1.0.0.zplugin');
    expect(firstPreview).toMatchObject({
      action: 'install',
      manifest: { id: 'com.test.package', version: '1.0.0' },
      permissions: ['network.fetch'],
    });

    await expect(service.installPackage(firstPreview.token)).resolves.toMatchObject({
      id: 'com.test.package',
      activeVersion: '1.0.0',
      inactive: true,
    });
    expect(loader.getPlugin('com.test.package')?.isActive).toBe(false);

    const second = await createPackage('2.0.0', 'export const version = 2;');
    const secondPreview = await service.inspectPackage(second, 'plugin-2.0.0.zplugin');
    expect(secondPreview).toMatchObject({ action: 'update', currentVersion: '1.0.0' });
    await service.installPackage(secondPreview.token);

    const installed = loader.getPlugin('com.test.package')!;
    expect(service.describePlugin(installed.manifest, installed.path)).toMatchObject({
      source: 'managed',
      activeVersion: '2.0.0',
      availableVersions: ['2.0.0', '1.0.0'],
      canRollback: true,
    });

    await service.rollbackPlugin('com.test.package', '1.0.0');
    expect(await readActiveVersion()).toBe('1.0.0');

    await service.uninstallPlugin('com.test.package');
    expect(releasePluginReference).toHaveBeenCalledTimes(2);
    expect(releasePluginReference).toHaveBeenCalledWith('com.test.package', '1.0.0');
    expect(releasePluginReference).toHaveBeenCalledWith('com.test.package', '2.0.0');
    expect(loader.getPlugin('com.test.package')).toBeUndefined();
    await expect(
      readFile(path.join(dataDir, 'plugins', 'com.test.package', 'plugin.json'))
    ).rejects.toThrow();
  });

  it('rejects path traversal before extracting the archive', async () => {
    const archive = path.join(dataDir, 'unsafe.zplugin');
    const built = buildZip([
      { name: '../outside', data: 'unsafe' },
      { name: 'plugin.json', data: JSON.stringify(manifest('1.0.0')) },
      { name: 'dist/main.js', data: 'export {};' },
    ]);
    await writeFile(archive, built.buffer);

    await expect(service.inspectPackage(archive, 'unsafe.zplugin')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
    });
    await expect(readFile(path.join(dataDir, 'outside'))).rejects.toThrow();
  });

  it('rejects runtime imports of host-internal packages', async () => {
    const archive = await createPackage(
      '1.0.0',
      "import { anything } from '@zclaudia/shared'; export { anything };"
    );
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toBeInstanceOf(
      PluginPackageError
    );
  });

  it('does not overwrite a development plugin with the same id', async () => {
    loader.plugins.set('com.test.package', {
      manifest: manifest('0.1.0'),
      path: path.join(dataDir, 'development-plugin'),
      isActive: false,
    });
    const archive = await createPackage('1.0.0');
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toMatchObject({
      code: 'DEVELOPMENT_PLUGIN_CONFLICT',
      status: 409,
    });
  });

  it('expires staged previews after the TTL and cleans up their directory', async () => {
    service = new PluginPackageService({
      dataDir,
      loader: loader as unknown as PluginLoader,
      now: () => now,
      stagedPackageTtlMs: 1_000,
    });
    const archive = await createPackage('1.0.0');
    const preview = await service.inspectPackage(archive, 'plugin.zplugin');

    now = new Date(now.getTime() + 2_000);
    await expect(service.installPackage(preview.token)).rejects.toMatchObject({
      code: 'PACKAGE_PREVIEW_EXPIRED',
      status: 404,
    });
    await expect(readdir(path.join(dataDir, 'plugin-staging'))).resolves.toEqual([]);
  });

  it('reinstalls the same version with the same checksum', async () => {
    const archive = await createPackage('1.0.0');
    const first = await service.inspectPackage(archive, 'plugin.zplugin');
    await service.installPackage(first.token);

    const second = await service.inspectPackage(archive, 'plugin.zplugin');
    expect(second.action).toBe('reinstall');
    await expect(service.installPackage(second.token)).resolves.toMatchObject({
      activeVersion: '1.0.0',
    });
  });

  it('rejects the same version installed with a different checksum', async () => {
    const first = await service.inspectPackage(await createPackage('1.0.0'), 'plugin.zplugin');
    await service.installPackage(first.token);

    const altered = await createPackage('1.0.0', 'export const version = "tampered";');
    const preview = await service.inspectPackage(altered, 'plugin.zplugin');
    await expect(service.installPackage(preview.token)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });
  });

  it('rejects installation over an unmanaged plugin directory', async () => {
    await mkdir(path.join(dataDir, 'plugins', 'com.test.package'), { recursive: true });
    const preview = await service.inspectPackage(await createPackage('1.0.0'), 'plugin.zplugin');
    await expect(service.installPackage(preview.token)).rejects.toMatchObject({
      code: 'UNMANAGED_DIRECTORY_CONFLICT',
      status: 409,
    });
  });

  it.each([
    ['src/index.ts', 'Development-only path'],
    ['.env', 'Environment or cache file'],
    ['.env.production', 'Environment or cache file'],
    ['config/private.pem', 'Potential secret/key file'],
  ])('rejects forbidden package member %s', async (name, message) => {
    const archive = await createPackage('1.0.0', 'export {};', [{ name, data: 'x' }]);
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
      message: expect.stringContaining(message),
    });
  });

  it('rejects a package.json with workspace dependencies', async () => {
    const archive = await createPackage('1.0.0', 'export {};', [
      { name: 'package.json', data: JSON.stringify({ dependencies: { x: 'workspace:*' } }) },
    ]);
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
      message: expect.stringContaining('Workspace dependency'),
    });
  });

  it('rejects a root package.json whose version disagrees with the manifest', async () => {
    const archive = await createPackage('1.0.0', 'export {};', [
      { name: 'package.json', data: JSON.stringify({ version: '2.0.0' }) },
    ]);
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
      message: expect.stringContaining('does not match'),
    });
  });

  it('rejects a manifest entrypoint missing from the archive', async () => {
    const archive = path.join(dataDir, 'missing-entry.zplugin');
    const built = buildZip([{ name: 'plugin.json', data: JSON.stringify(manifest('1.0.0')) }]);
    await writeFile(archive, built.buffer);
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
      message: expect.stringContaining('entrypoint does not exist'),
    });
  });

  it('rejects a failed extraction as INVALID_PACKAGE and removes the staged tree', async () => {
    // 'latest' is a symlink into dist/, so the file nested below it trips the
    // extraction-time guard (validation passes first).
    const archive = await createPackage('1.0.0', 'export {};', [
      symlinkEntry('latest', 'dist/main.js'),
      { name: 'latest/evil.js', data: 'evil' },
    ]);
    await expect(service.inspectPackage(archive, 'plugin.zplugin')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
      status: 400,
    });
    await expect(readdir(path.join(dataDir, 'plugin-staging'))).resolves.toEqual([]);
  });

  it('restores the previous version when an update fails mid-install', async () => {
    const first = await service.inspectPackage(await createPackage('1.0.0'), 'plugin.zplugin');
    await service.installPackage(first.token);

    const second = await service.inspectPackage(
      await createPackage('2.0.0', 'export const version = 2;'),
      'plugin.zplugin'
    );
    // The first rediscover after swapping 2.0.0 in fails; the swap-back then
    // succeeds, proving the previous active version is restored.
    loader.discoverFailuresLeft = 1;
    await expect(service.installPackage(second.token)).rejects.toMatchObject({
      code: 'INSTALLATION_FAILED',
      status: 500,
    });
    expect(await readActiveVersion()).toBe('1.0.0');
    expect(loader.getPlugin('com.test.package')?.manifest.version).toBe('1.0.0');
  });
});
