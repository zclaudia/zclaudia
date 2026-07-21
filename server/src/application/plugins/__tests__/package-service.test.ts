import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginInstance, PluginManifest } from '@zclaudia/shared/plugin-types';
import type { PluginLoader } from '../loader.js';
import { PluginPackageError, PluginPackageService } from '../package-service.js';

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function createStoredZip(
  output: string,
  files: Array<{ name: string; contents: string }>
): Promise<void> {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.contents, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(output, Buffer.concat([...localChunks, ...centralChunks, end]));
}

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

  constructor(private readonly dataDir: string) {}

  getPlugin(id: string) {
    return this.plugins.get(id);
  }

  async remove(id: string) {
    return this.plugins.delete(id);
  }

  async discover() {
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

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'zclaudia-package-service-'));
    loader = new FakeLoader(dataDir);
    service = new PluginPackageService({
      dataDir,
      loader: loader as unknown as PluginLoader,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await rm(dataDir, { force: true, recursive: true });
  });

  async function createPackage(version: string, main = 'export const version = 1;') {
    const archive = path.join(dataDir, `plugin-${version}.zplugin`);
    await createStoredZip(archive, [
      { name: 'plugin.json', contents: JSON.stringify(manifest(version)) },
      { name: 'dist/main.js', contents: main },
    ]);
    return archive;
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
    expect(
      JSON.parse(
        await readFile(path.join(dataDir, 'plugins', 'com.test.package', 'plugin.json'), 'utf8')
      ).version
    ).toBe('1.0.0');

    await service.uninstallPlugin('com.test.package');
    expect(loader.getPlugin('com.test.package')).toBeUndefined();
    await expect(
      readFile(path.join(dataDir, 'plugins', 'com.test.package', 'plugin.json'))
    ).rejects.toThrow();
  });

  it('rejects path traversal before extracting the archive', async () => {
    const archive = path.join(dataDir, 'unsafe.zplugin');
    await createStoredZip(archive, [
      { name: '../outside', contents: 'unsafe' },
      { name: 'plugin.json', contents: JSON.stringify(manifest('1.0.0')) },
      { name: 'dist/main.js', contents: 'export {};' },
    ]);

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
});
