import { gunzipSync } from 'node:zlib';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ManagedRuntimeArchiveFormat } from '@zclaudia/shared/plugins/managed-runtimes';
import {
  extractPluginArchive,
  readPluginArchive,
  type PluginArchiveEntry,
} from '../plugins/package-archive.js';
import { assertSafeRuntimeRelativePath } from './descriptor.js';

export const MANAGED_RUNTIME_LIMITS = Object.freeze({
  archiveSize: 256 * 1024 * 1024,
  fileCount: 20_000,
  // Current native Agent CLIs can exceed 300 MiB before compression.
  fileSize: 384 * 1024 * 1024,
  unpackedSize: 512 * 1024 * 1024,
});

interface TarEntry {
  name: string;
  data: Buffer;
  mode: number;
  type: 'file' | 'directory';
}

function parseTarString(buffer: Buffer, start: number, length: number): string {
  return buffer
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/s, '')
    .trim();
}

function parseTarOctal(buffer: Buffer, start: number, length: number, label: string): number {
  const field = buffer.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) {
    throw new Error(`Unsupported base-256 TAR ${label}`);
  }
  const text = field.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid TAR ${label}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid TAR ${label}`);
  return value;
}

function tarChecksum(header: Buffer): number {
  let sum = 0;
  for (let index = 0; index < header.length; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return sum;
}

export function readTarGzArchive(archive: Buffer, limits = MANAGED_RUNTIME_LIMITS): TarEntry[] {
  if (archive.length > limits.archiveSize) {
    throw new Error(`Archive exceeds the ${limits.archiveSize}-byte size limit`);
  }
  const unpacked = gunzipSync(archive, { maxOutputLength: limits.unpackedSize });
  const entries: TarEntry[] = [];
  const names = new Set<string>();
  let totalSize = 0;
  let headerCount = 0;
  let offset = 0;
  let foundEnd = false;

  while (offset + 512 <= unpacked.length) {
    const header = unpacked.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      foundEnd = true;
      break;
    }
    if (headerCount >= limits.fileCount) {
      throw new Error(`Archive exceeds the ${limits.fileCount}-entry limit`);
    }
    headerCount += 1;
    const expectedChecksum = parseTarOctal(header, 148, 8, 'checksum');
    if (tarChecksum(header) !== expectedChecksum) throw new Error('TAR checksum mismatch');

    const namePart = parseTarString(header, 0, 100);
    const prefix = parseTarString(header, 345, 155);
    const name = prefix ? `${prefix}/${namePart}` : namePart;
    const size = parseTarOctal(header, 124, 12, 'entry size');
    if (size > limits.fileSize) {
      throw new Error(`TAR entry exceeds the ${limits.fileSize}-byte limit`);
    }
    totalSize += size;
    if (totalSize > limits.unpackedSize) {
      throw new Error(`Archive exceeds the ${limits.unpackedSize}-byte unpacked-size limit`);
    }
    const typeFlag = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > unpacked.length) throw new Error(`Truncated TAR entry: ${name}`);

    // PAX extended/global headers only describe later entries. This parser
    // deliberately does not apply their path or link overrides, so they can
    // be skipped without allowing metadata to redirect extraction.
    if (typeFlag === 'x' || typeFlag === 'g') {
      offset = dataStart + Math.ceil(size / 512) * 512;
      continue;
    }

    assertSafeRuntimeRelativePath(name.replace(/\/$/, ''), 'TAR entry path');
    const normalizedName = name.replace(/\/$/, '');
    if (names.has(normalizedName)) throw new Error(`Duplicate TAR entry: ${normalizedName}`);
    names.add(normalizedName);

    if (typeFlag === '1' || typeFlag === '2') {
      throw new Error(`Runtime archives may not contain links: ${normalizedName}`);
    }
    if (typeFlag !== '\0' && typeFlag !== '0' && typeFlag !== '5') {
      throw new Error(`Unsupported TAR entry type ${JSON.stringify(typeFlag)}: ${normalizedName}`);
    }
    entries.push({
      name: normalizedName,
      // Retain a view into the bounded decompression buffer. Copying every
      // entry would temporarily double memory use for large native runtimes.
      data: unpacked.subarray(dataStart, dataEnd),
      mode: parseTarOctal(header, 100, 8, 'mode') || 0o644,
      type: typeFlag === '5' ? 'directory' : 'file',
    });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!foundEnd) throw new Error('TAR end marker is missing');
  return entries;
}

async function extractTarEntries(entries: TarEntry[], destination: string): Promise<void> {
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  for (const entry of entries.filter(item => item.type === 'directory')) {
    const output = path.join(root, ...entry.name.split('/'));
    await mkdir(output, { recursive: true, mode: entry.mode & 0o777 });
  }
  for (const entry of entries.filter(item => item.type === 'file')) {
    const output = path.join(root, ...entry.name.split('/'));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, entry.data, { mode: entry.mode & 0o777 });
  }
}

function rejectZipLinks(entries: PluginArchiveEntry[]): void {
  const link = entries.find(entry => entry.type === 'symlink');
  if (link) throw new Error(`Runtime archives may not contain links: ${link.name}`);
}

export async function extractManagedRuntimeArtifact(options: {
  archivePath: string;
  archiveFormat: ManagedRuntimeArchiveFormat;
  destination: string;
  executablePath: string;
}): Promise<string> {
  const { archiveFormat, archivePath, destination, executablePath } = options;
  assertSafeRuntimeRelativePath(executablePath, 'executablePath');
  await mkdir(destination, { recursive: true });

  if (archiveFormat === 'raw') {
    const data = await readFile(archivePath);
    if (data.length > MANAGED_RUNTIME_LIMITS.fileSize) {
      throw new Error(`Runtime executable exceeds ${MANAGED_RUNTIME_LIMITS.fileSize} bytes`);
    }
    const output = path.join(destination, ...executablePath.split('/'));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, data, { mode: 0o755 });
  } else if (archiveFormat === 'zip') {
    const entries = await readPluginArchive(archivePath, MANAGED_RUNTIME_LIMITS);
    rejectZipLinks(entries);
    await extractPluginArchive(entries, destination);
  } else {
    const bytes = await readFile(archivePath);
    await extractTarEntries(readTarGzArchive(bytes), destination);
  }

  const resolvedRoot = path.resolve(destination);
  const resolvedExecutable = path.resolve(destination, ...executablePath.split('/'));
  if (
    resolvedExecutable !== resolvedRoot &&
    !resolvedExecutable.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Executable path escapes the runtime directory');
  }
  const details = await lstat(resolvedExecutable).catch(() => undefined);
  if (!details?.isFile() || details.isSymbolicLink()) {
    throw new Error(`Declared executable was not extracted: ${executablePath}`);
  }
  if (process.platform !== 'win32') await chmod(resolvedExecutable, 0o755);
  return resolvedExecutable;
}
