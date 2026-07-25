import { inflateRawSync } from 'node:zlib';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PLUGIN_PACKAGE_LIMITS = Object.freeze({
  archiveSize: 128 * 1024 * 1024,
  fileCount: 20_000,
  fileSize: 32 * 1024 * 1024,
  unpackedSize: 256 * 1024 * 1024,
});

export interface PluginArchiveEntry {
  name: string;
  data: Buffer;
  mode: number;
  size: number;
  target?: string;
  type: 'file' | 'symlink';
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

export function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Start-offset-sorted list of already-claimed data ranges. Entries arrive in
 * central-directory order (not offset order), so each insert binary-searches
 * its position and checks only the predecessor/successor — for disjoint
 * ranges sorted by start, those are the only possible overlap partners.
 * O(log n) per entry instead of a full O(n) scan (matters at the 20k-entry
 * limit, where a scan-per-entry costs ~200M comparisons).
 */
type OccupiedRanges = Array<[number, number]>;

function assertRangeUnclaimed(ranges: OccupiedRanges, start: number, end: number, name: string): void {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid][0] < start) lo = mid + 1;
    else hi = mid;
  }
  const predecessor = ranges[lo - 1];
  if (predecessor && start < predecessor[1]) {
    throw new Error(`Overlapping ZIP entry data found for ${name}`);
  }
  const successor = ranges[lo];
  if (successor && end > successor[0]) {
    throw new Error(`Overlapping ZIP entry data found for ${name}`);
  }
  ranges.splice(lo, 0, [start, end]);
}

export function assertSafeArchivePath(name: string): string {
  if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name)) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  }
  const components = name.split('/');
  if (components.some(component => component === '' || component === '.' || component === '..')) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  }
  if (/^[A-Za-z]:/.test(components[0])) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  }
  return name;
}

export function resolveSafeLinkTarget(entryName: string, target: string): string {
  if (!target || target.includes('\0') || target.includes('\\') || path.posix.isAbsolute(target)) {
    throw new Error(`Unsafe symlink ${entryName} -> ${JSON.stringify(target)}`);
  }

  // dirname of a root-level entry is '.', which must not count as a directory
  // level — otherwise resolved targets gain a bogus './' prefix (failing the
  // archive's target-exists check) and '../' escapes look one level shallower
  // than they are.
  const stack = path.posix
    .dirname(entryName)
    .split('/')
    .filter(component => component !== '' && component !== '.');
  for (const component of target.split('/')) {
    if (!component || component === '.') continue;
    if (component === '..') {
      if (stack.length === 0) {
        throw new Error(`Symlink escapes the plugin root: ${entryName} -> ${target}`);
      }
      stack.pop();
    } else {
      stack.push(component);
    }
  }
  if (stack.length === 0) {
    throw new Error(`Symlink ${entryName} resolves to the plugin root`);
  }
  return stack.join('/');
}

function findEndRecord(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid ZIP: end-of-central-directory record is missing');
}

/**
 * Read and fully verify the deliberately small ZIP subset used by `.zplugin`.
 * Keeping this parser here makes path, overlap, CRC, symlink, and expansion-limit
 * checks part of the host trust boundary instead of delegating them to a shell.
 */
export async function readPluginArchive(
  archivePath: string,
  limits = PLUGIN_PACKAGE_LIMITS
): Promise<PluginArchiveEntry[]> {
  const archive = await readFile(archivePath);
  if (archive.length > limits.archiveSize) {
    throw new Error(`Archive exceeds the ${limits.archiveSize}-byte size limit`);
  }

  const endOffset = findEndRecord(archive);
  const disk = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntries = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const commentLength = archive.readUInt16LE(endOffset + 20);

  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new Error('Multi-disk ZIP archives are not supported');
  }
  if (entryCount > limits.fileCount) {
    throw new Error(`Archive exceeds the ${limits.fileCount}-entry limit`);
  }
  if (endOffset + 22 + commentLength !== archive.length) {
    throw new Error('Invalid ZIP: trailing data or a truncated comment was found');
  }
  if (centralOffset + centralSize !== endOffset || centralOffset > archive.length) {
    throw new Error('Invalid ZIP central-directory bounds');
  }

  const entries: PluginArchiveEntry[] = [];
  const names = new Set<string>();
  const occupiedRanges: OccupiedRanges = [];
  let cursor = centralOffset;
  let unpackedSize = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Invalid ZIP central-directory entry');
    }

    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + entryCommentLength;

    if (recordEnd > endOffset) throw new Error('Truncated ZIP central-directory entry');
    if (flags & 0x0001) throw new Error('Encrypted ZIP entries are not supported');
    if (flags & ~0x0800) throw new Error(`Unsupported ZIP flags 0x${flags.toString(16)}`);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP method ${method}`);
    if (size > limits.fileSize) {
      throw new Error(`ZIP entry exceeds the ${limits.fileSize}-byte limit`);
    }
    unpackedSize += size;
    if (unpackedSize > limits.unpackedSize) {
      throw new Error(`Archive exceeds the ${limits.unpackedSize}-byte unpacked-size limit`);
    }

    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assertSafeArchivePath(name);
    if (names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    names.add(name);

    if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid local ZIP header for ${name}`);
    }
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localSize = archive.readUInt32LE(localOffset + 22);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new Error(`Truncated ZIP entry: ${name}`);

    const localName = archive
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString('utf8');
    if (
      localName !== name ||
      localFlags !== flags ||
      localMethod !== method ||
      localChecksum !== checksum ||
      localCompressedSize !== compressedSize ||
      localSize !== size
    ) {
      throw new Error(`Local and central ZIP headers disagree for ${name}`);
    }
    assertRangeUnclaimed(occupiedRanges, localOffset, dataEnd, name);

    const compressed = archive.subarray(dataStart, dataEnd);
    const data =
      method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: limits.fileSize });
    if (data.length !== size || crc32(data) !== checksum) {
      throw new Error(`ZIP integrity check failed for ${name}`);
    }

    const mode = externalAttributes >>> 16;
    const typeBits = mode & 0o170000;
    if (typeBits !== 0 && typeBits !== 0o100000 && typeBits !== 0o120000) {
      throw new Error(`Unsupported special filesystem entry: ${name}`);
    }
    const type = typeBits === 0o120000 ? 'symlink' : 'file';
    const target = type === 'symlink' ? data.toString('utf8') : undefined;
    if (target !== undefined) resolveSafeLinkTarget(name, target);
    entries.push({ name, data, mode: mode || 0o100644, size, target, type });
    cursor = recordEnd;
  }

  if (cursor !== endOffset) throw new Error('Invalid ZIP central-directory size');
  return entries;
}

export async function extractPluginArchive(
  entries: PluginArchiveEntry[],
  destination: string
): Promise<void> {
  const symlinkNames = new Set(
    entries.filter(entry => entry.type === 'symlink').map(entry => entry.name)
  );
  for (const entry of entries) {
    for (const symlinkName of symlinkNames) {
      if (entry.name.startsWith(`${symlinkName}/`)) {
        throw new Error(`ZIP entry ${entry.name} is nested below symlink ${symlinkName}`);
      }
    }
  }

  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  for (const entry of entries.filter(candidate => candidate.type === 'file')) {
    const output = path.join(root, ...entry.name.split('/'));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, entry.data, { mode: entry.mode & 0o777 });
  }
  for (const entry of entries.filter(candidate => candidate.type === 'symlink')) {
    const output = path.join(root, ...entry.name.split('/'));
    await mkdir(path.dirname(output), { recursive: true });
    if (entry.target === undefined) throw new Error(`Symlink target is missing: ${entry.name}`);
    await symlink(entry.target, output);
  }
}
