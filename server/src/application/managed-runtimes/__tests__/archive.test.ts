import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readTarGzArchive } from '../archive.js';

function writeTarField(header: Buffer, offset: number, length: number, value: string): void {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii');
}

function tarEntry(name: string, type: '0' | '2' = '0', data = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(512);
  writeTarField(header, 0, 100, name);
  writeTarField(header, 100, 8, '0000755\0');
  writeTarField(header, 108, 8, '0000000\0');
  writeTarField(header, 116, 8, '0000000\0');
  writeTarField(header, 124, 12, `${data.length.toString(8).padStart(11, '0')}\0`);
  writeTarField(header, 136, 12, '00000000000\0');
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeTarField(header, 257, 6, 'ustar\0');
  writeTarField(header, 263, 2, '00');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length);
  return Buffer.concat([header, data, padding, Buffer.alloc(1024)]);
}

describe('managed runtime TAR archive validation', () => {
  it('rejects path traversal entries', () => {
    expect(() =>
      readTarGzArchive(gzipSync(tarEntry('../escape', '0', Buffer.from('bad'))))
    ).toThrow(/unsafe/i);
  });

  it('rejects symbolic links before extraction', () => {
    expect(() => readTarGzArchive(gzipSync(tarEntry('bin/fixture', '2')))).toThrow(
      /may not contain links/i
    );
  });
});
