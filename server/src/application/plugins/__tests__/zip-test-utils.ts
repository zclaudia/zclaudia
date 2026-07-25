/**
 * Shared ZIP builder for plugin-package tests. Constructs the deliberately
 * small ZIP subset that package-archive.ts parses (stored/deflated entries,
 * no comments, no extras) and exposes header offsets so corruption tests can
 * patch individual fields. CRCs come from the module under test so the
 * builder can never drift from the parser's integrity check.
 */
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../package-archive.js';

export interface ZipEntrySpec {
  name: string;
  data?: Buffer | string;
  /** Compression method: 0 = stored (default), 8 = deflated. */
  method?: 0 | 8;
  /** High 16 bits of the external attributes (file type + permissions). */
  mode?: number;
  /** GP flags; defaults to 0x0800 (UTF-8 names). */
  flags?: number;
  /** Forge the central directory's local-header offset (overlap tests). */
  localOffsetOverride?: number;
  /** Forge the CRC written to BOTH headers (integrity tests). */
  crcOverride?: number;
}

export interface BuiltZip {
  buffer: Buffer;
  /** Entry name -> offset of its local header. */
  localOffsets: Map<string, number>;
  /** Entry name -> offset of its central-directory record. */
  centralOffsets: Map<string, number>;
  /** Offset of the end-of-central-directory record. */
  eocdOffset: number;
}

export function buildZip(specs: ZipEntrySpec[]): BuiltZip {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  const centralSizes: Array<{ name: string; size: number }> = [];
  const localOffsets = new Map<string, number>();
  const centralOffsets = new Map<string, number>();
  let offset = 0;

  for (const spec of specs) {
    const name = Buffer.from(spec.name, 'utf8');
    const data =
      spec.data === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(spec.data)
          ? spec.data
          : Buffer.from(spec.data, 'utf8');
    const method = spec.method ?? 0;
    const flags = spec.flags ?? 0x0800;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = spec.crcOverride ?? crc32(data);
    const size = data.length;
    const mode = spec.mode ?? 0o100644;

    localOffsets.set(spec.name, offset);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(spec.localOffsetOverride ?? offset, 42);
    centralChunks.push(central, name);
    centralSizes.push({ name: spec.name, size: central.length + name.length });

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const centralOffset = offset;
  let centralCursor = centralOffset;
  for (const { name, size } of centralSizes) {
    centralOffsets.set(name, centralCursor);
    centralCursor += size;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(specs.length, 8);
  end.writeUInt16LE(specs.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);

  return {
    buffer: Buffer.concat([...localChunks, ...centralChunks, end]),
    localOffsets,
    centralOffsets,
    eocdOffset: centralOffset + centralSize,
  };
}

/** Symlink entry convenience: mode 0o120000 with the target as entry data. */
export function symlinkEntry(name: string, target: string): ZipEntrySpec {
  return { name, data: target, mode: 0o120777 };
}
