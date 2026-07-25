import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSafeArchivePath,
  extractPluginArchive,
  PLUGIN_PACKAGE_LIMITS,
  readPluginArchive,
  resolveSafeLinkTarget,
  type PluginArchiveEntry,
} from '../package-archive.js';
import { buildZip, symlinkEntry, type ZipEntrySpec } from './zip-test-utils.js';

describe('assertSafeArchivePath', () => {
  it.each(['plugin.json', 'dist/main.js', 'a/b/c.txt'])('accepts %s', name => {
    expect(assertSafeArchivePath(name)).toBe(name);
  });

  it.each([
    '../escape',
    'a/../../escape',
    '/absolute',
    'a//b',
    'a/./b',
    'back\\slash',
    'C:/windows',
    'nul\0byte',
    '',
  ])('rejects %s', name => {
    expect(() => assertSafeArchivePath(name)).toThrow('Unsafe archive path');
  });
});

describe('resolveSafeLinkTarget', () => {
  it('resolves targets relative to the entry directory', () => {
    expect(resolveSafeLinkTarget('a/b/link', '../c.txt')).toBe('a/c.txt');
    expect(resolveSafeLinkTarget('a/b/link', '../../c.txt')).toBe('c.txt');
    expect(resolveSafeLinkTarget('link', 'dist/main.js')).toBe('dist/main.js');
    expect(resolveSafeLinkTarget('a/link', './x/./y')).toBe('a/x/y');
  });

  it.each([
    ['link', '../escape'],
    ['a/b/link', '../../../escape'],
    ['link', '/absolute'],
    ['link', 'back\\slash'],
    ['link', ''],
  ])('rejects %s -> %s', (name, target) => {
    expect(() => resolveSafeLinkTarget(name, target)).toThrow();
  });

  it('rejects a target that resolves to the plugin root', () => {
    expect(() => resolveSafeLinkTarget('a/b', '..')).toThrow('plugin root');
  });
});

describe('readPluginArchive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'zclaudia-package-archive-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  async function writeArchive(specs: ZipEntrySpec[], fileName = 'plugin.zplugin') {
    const archive = path.join(dir, fileName);
    const built = buildZip(specs);
    await writeFile(archive, built.buffer);
    return { archive, built };
  }

  async function readSpecs(specs: ZipEntrySpec[]) {
    const { archive } = await writeArchive(specs);
    return await readPluginArchive(archive);
  }

  it('reads stored and deflated entries with metadata', async () => {
    const entries = await readSpecs([
      { name: 'plugin.json', data: '{"id":"x"}' },
      { name: 'dist/main.js', data: 'export {};'.repeat(100), method: 8 },
      { name: 'bin/tool.sh', data: '#!/bin/sh\n', mode: 0o100755 },
    ]);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ name: 'plugin.json', type: 'file', size: 10 });
    expect(entries[1].data.toString('utf8')).toBe('export {};'.repeat(100));
    expect(entries[2].mode & 0o777).toBe(0o755);
  });

  it('parses symlink entries with their target', async () => {
    const entries = await readSpecs([
      { name: 'dist/main.js', data: 'export {};' },
      symlinkEntry('dist/link.js', 'main.js'),
    ]);
    expect(entries[1]).toMatchObject({ type: 'symlink', target: 'main.js' });
  });

  it('rejects a missing end-of-central-directory record', async () => {
    const archive = path.join(dir, 'broken.zplugin');
    await writeFile(archive, Buffer.alloc(16));
    await expect(readPluginArchive(archive)).rejects.toThrow('end-of-central-directory');
  });

  it('rejects trailing data after the end record', async () => {
    const { archive, built } = await writeArchive([{ name: 'a.txt', data: 'a' }]);
    await writeFile(archive, Buffer.concat([built.buffer, Buffer.from('x')]));
    await expect(readPluginArchive(archive)).rejects.toThrow('trailing data');
  });

  it('rejects multi-disk archives', async () => {
    const { archive, built } = await writeArchive([{ name: 'a.txt', data: 'a' }]);
    const patched = Buffer.from(built.buffer);
    patched.writeUInt16LE(1, built.eocdOffset + 4); // disk number
    await writeFile(archive, patched);
    await expect(readPluginArchive(archive)).rejects.toThrow('Multi-disk');
  });

  it('rejects duplicate entry names', async () => {
    const { archive } = await writeArchive([
      { name: 'a.txt', data: 'a' },
      { name: 'a.txt', data: 'a' },
    ]);
    await expect(readPluginArchive(archive)).rejects.toThrow('Duplicate');
  });

  it('rejects entries with unsafe paths', async () => {
    const { archive } = await writeArchive([
      { name: 'plugin.json', data: '{}' },
      { name: '../outside.txt', data: 'x' },
    ]);
    await expect(readPluginArchive(archive)).rejects.toThrow('Unsafe archive path');
  });

  it('rejects encrypted entries', async () => {
    const { archive } = await writeArchive([{ name: 'a.txt', data: 'a', flags: 0x0801 }]);
    await expect(readPluginArchive(archive)).rejects.toThrow('Encrypted');
  });

  it('rejects unsupported general-purpose flags', async () => {
    const { archive } = await writeArchive([{ name: 'a.txt', data: 'a', flags: 0x0808 }]);
    await expect(readPluginArchive(archive)).rejects.toThrow('Unsupported ZIP flags');
  });

  it('rejects unsupported compression methods', async () => {
    const { archive, built } = await writeArchive([{ name: 'a.txt', data: 'a' }]);
    const patched = Buffer.from(built.buffer);
    const central = built.centralOffsets.get('a.txt')!;
    const local = built.localOffsets.get('a.txt')!;
    patched.writeUInt16LE(99, central + 10);
    patched.writeUInt16LE(99, local + 8);
    await writeFile(archive, patched);
    await expect(readPluginArchive(archive)).rejects.toThrow('Unsupported ZIP method');
  });

  it('rejects a CRC mismatch (forged identically in both headers)', async () => {
    const { archive } = await writeArchive([{ name: 'a.txt', data: 'a', crcOverride: 0xdeadbeef }]);
    await expect(readPluginArchive(archive)).rejects.toThrow('integrity check failed');
  });

  it('rejects local/central header disagreement', async () => {
    const { archive, built } = await writeArchive([{ name: 'a.txt', data: 'a' }]);
    const patched = Buffer.from(built.buffer);
    // Flip one byte of the LOCAL name only; the central name stays intact.
    const local = built.localOffsets.get('a.txt')!;
    patched.writeUInt8('b'.charCodeAt(0), local + 30);
    await writeFile(archive, patched);
    await expect(readPluginArchive(archive)).rejects.toThrow('disagree');
  });

  it('rejects entry data overlapping another entry', async () => {
    // Entry B's central directory claims its local header starts inside A's
    // data. A's data is crafted to embed a byte-identical copy of B's local
    // header so the header checks pass and the overlap check is what fires.
    // A is the first entry, so its data starts at 30 + name length.
    const aName = 'a.txt';
    const bName = 'b.txt';
    const bData = Buffer.from('B'.repeat(8));
    const bHeader = Buffer.alloc(30);
    bHeader.writeUInt32LE(0x04034b50, 0);
    bHeader.writeUInt16LE(20, 4);
    bHeader.writeUInt16LE(0x0800, 6);
    bHeader.writeUInt32LE(bData.length, 18);
    bHeader.writeUInt32LE(bData.length, 22);
    bHeader.writeUInt16LE(bName.length, 26);
    // bHeader CRC fields are patched below once the real CRC is known; the
    // forged header must equal B's central values, so build B first via the
    // builder by letting the builder compute B's CRC over bData.
    const probe = buildZip([{ name: bName, data: bData }]);
    const probeLocal = probe.localOffsets.get(bName)!;
    const realBHeader = probe.buffer.subarray(probeLocal, probeLocal + 30 + bName.length);
    void bHeader;

    const aData = Buffer.concat([realBHeader, bData]);
    const { archive } = await writeArchive([
      { name: aName, data: aData },
      { name: bName, data: bData, localOffsetOverride: 30 + Buffer.byteLength(aName) },
    ]);
    await expect(readPluginArchive(archive)).rejects.toThrow('Overlapping');
  });

  it('enforces the archive size limit', async () => {
    const { archive } = await writeArchive([{ name: 'a.txt', data: 'a' }]);
    await expect(
      readPluginArchive(archive, { ...PLUGIN_PACKAGE_LIMITS, archiveSize: 4 })
    ).rejects.toThrow('size limit');
  });

  it('enforces the entry count limit', async () => {
    const { archive } = await writeArchive([
      { name: 'a.txt', data: 'a' },
      { name: 'b.txt', data: 'b' },
    ]);
    await expect(
      readPluginArchive(archive, { ...PLUGIN_PACKAGE_LIMITS, fileCount: 1 })
    ).rejects.toThrow('entry limit');
  });

  it('enforces the per-file size limit', async () => {
    const { archive } = await writeArchive([{ name: 'big.txt', data: 'x'.repeat(64) }]);
    await expect(
      readPluginArchive(archive, { ...PLUGIN_PACKAGE_LIMITS, fileSize: 8 })
    ).rejects.toThrow('byte limit');
  });

  it('enforces the cumulative unpacked-size limit', async () => {
    const { archive } = await writeArchive([
      { name: 'a.txt', data: 'x'.repeat(32) },
      { name: 'b.txt', data: 'y'.repeat(32) },
    ]);
    await expect(
      readPluginArchive(archive, { ...PLUGIN_PACKAGE_LIMITS, unpackedSize: 40 })
    ).rejects.toThrow('unpacked-size limit');
  });

  it('rejects special filesystem entry types', async () => {
    const { archive } = await writeArchive([{ name: 'pipe', data: '', mode: 0o010644 }]);
    await expect(readPluginArchive(archive)).rejects.toThrow('special filesystem entry');
  });

  it.each([
    ['escape', '../../etc/passwd'],
    ['absolute', '/etc/passwd'],
  ])('rejects a symlink with an %s target', async (label, target) => {
    const { archive } = await writeArchive([
      { name: 'dist/main.js', data: 'export {};' },
      symlinkEntry(`dist/${label}.js`, target),
    ]);
    await expect(readPluginArchive(archive)).rejects.toThrow(/Unsafe symlink|escapes/);
  });
});

describe('extractPluginArchive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'zclaudia-package-extract-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  function fileEntry(name: string, data: string, mode = 0o100644): PluginArchiveEntry {
    return { name, data: Buffer.from(data, 'utf8'), mode, size: data.length, type: 'file' };
  }

  it('extracts files and symlinks with permissions preserved', async () => {
    const destination = path.join(dir, 'out');
    await extractPluginArchive(
      [
        fileEntry('dist/main.js', 'export {};'),
        fileEntry('bin/tool.sh', '#!/bin/sh\n', 0o100755),
        {
          name: 'dist/link.js',
          data: Buffer.from('main.js'),
          mode: 0o120777,
          size: 7,
          target: 'main.js',
          type: 'symlink',
        },
      ],
      destination
    );

    await expect(readFile(path.join(destination, 'dist/main.js'), 'utf8')).resolves.toBe(
      'export {};'
    );
    const { readlink, stat } = await import('node:fs/promises');
    await expect(readlink(path.join(destination, 'dist/link.js'))).resolves.toBe('main.js');
    expect((await stat(path.join(destination, 'bin/tool.sh'))).mode & 0o777).toBe(0o755);
  });

  it('rejects file entries nested below a symlink entry', async () => {
    await expect(
      extractPluginArchive(
        [
          {
            name: 'link',
            data: Buffer.from('real'),
            mode: 0o120777,
            size: 4,
            target: 'real',
            type: 'symlink',
          },
          fileEntry('link/evil.js', 'evil'),
          fileEntry('real/index.js', 'export {};'),
        ],
        path.join(dir, 'out')
      )
    ).rejects.toThrow('nested below symlink');
  });
});
