import { createReadStream } from 'fs';
import { StringDecoder } from 'string_decoder';

import type { TextEncoding } from './text-io.js';

export interface LineWindowResult {
  // Lines inside the requested [offset, offset+limit) window, line endings stripped.
  lines: string[];
  // Total line count across the whole file (the window is a slice of this).
  totalLines: number;
  encoding: TextEncoding;
  hasBom: boolean;
  // True when a NUL byte was seen in the leading sample (utf8 files only).
  binary: boolean;
}

const BINARY_SAMPLE_BYTES = 8192;
const STREAM_CHUNK_BYTES = 512 * 1024;

// Streams a file line-by-line and keeps only the requested window in memory,
// counting (but discarding) everything outside it. Lets Read page through files
// far larger than the whole-file fast path without buffering the entire file.
export function readLineWindowStreaming(
  filePath: string,
  offset: number,
  limit: number
): Promise<LineWindowResult> {
  const start = Math.max(0, offset - 1);
  const end = start + Math.max(1, limit);
  return new Promise<LineWindowResult>((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: STREAM_CHUNK_BYTES });

    let decoder: StringDecoder | null = null;
    let encoding: TextEncoding = 'utf8';
    let hasBom = false;
    let firstChunkHandled = false;
    let strippedBom = false;
    let sampledBytes = 0;
    let binary = false;
    let leftover = '';
    let totalLines = 0;
    const collected: string[] = [];

    const pushLine = (raw: string): void => {
      const index = totalLines;
      totalLines += 1;
      if (index >= start && index < end) {
        collected.push(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
      }
    };

    const fail = (err: Error): void => {
      stream.destroy();
      reject(err);
    };

    stream.on('data', (data: string | Buffer) => {
      const chunk = data as Buffer;
      if (!firstChunkHandled) {
        firstChunkHandled = true;
        if (chunk.length >= 2 && chunk[0] === 0xff && chunk[1] === 0xfe) {
          encoding = 'utf16le';
          hasBom = true;
        } else if (
          chunk.length >= 3 &&
          chunk[0] === 0xef &&
          chunk[1] === 0xbb &&
          chunk[2] === 0xbf
        ) {
          encoding = 'utf8';
          hasBom = true;
        }
        decoder = new StringDecoder(encoding);
      }

      // Only sample for binary content on utf8 — utf16 text legitimately
      // carries NUL bytes for ASCII code points and would false-positive.
      if (encoding === 'utf8' && !binary && sampledBytes < BINARY_SAMPLE_BYTES) {
        const slice = chunk.subarray(0, BINARY_SAMPLE_BYTES - sampledBytes);
        if (slice.includes(0)) binary = true;
        sampledBytes += chunk.length;
      }

      let text = decoder!.write(chunk);
      if (!strippedBom && text.length > 0) {
        if (hasBom && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        strippedBom = true;
      }

      leftover += text;
      let nl = leftover.indexOf('\n');
      while (nl !== -1) {
        pushLine(leftover.slice(0, nl));
        leftover = leftover.slice(nl + 1);
        nl = leftover.indexOf('\n');
      }
    });

    stream.on('end', () => {
      if (decoder) leftover += decoder.end();
      // A trailing newline leaves an empty leftover, which is not a real line —
      // mirrors the whole-file path that pops a trailing empty split entry.
      if (leftover.length > 0) pushLine(leftover);
      resolve({ lines: collected, totalLines, encoding, hasBom, binary });
    });

    stream.on('error', fail);
  });
}
