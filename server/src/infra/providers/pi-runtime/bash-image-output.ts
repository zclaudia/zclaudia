import { readFile, stat } from 'fs/promises';
import * as path from 'path';

import { compressImageToLimit } from './rich-read.js';

/**
 * Structured image output for Bash results.
 *
 * When a command produces an image — a stdout data URL (the ZCode
 * bash-image-output.ts contract, Apache-2.0, used as the semantic reference),
 * an iTerm2 inline-image escape sequence, or image files whose paths the
 * command printed — the image is attached to the tool result as an image
 * content block (same block shape Read returns) instead of being dropped as
 * binary noise. Everything is decoded in memory: no temp files are created,
 * so there is nothing to clean up. Terminal sequences are stripped from the
 * visible output and replaced with short placeholders; sixel streams are
 * detected and reported but not converted (no sixel decoder in the runtime).
 */

// Limits mirror read-tool.ts image handling: MAX_IMAGE_BYTES per block (with
// automatic downscale past it) and MAX_IMAGE_FILE_BYTES as the hard file ceiling.
const MAX_IMAGE_BLOCKS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Magic-byte sniffing: a payload that does not start with a known image
 * signature never becomes a provider image block (providers reject invalid
 * images, which would turn a best-effort enhancement into a failed tool call).
 */
export function detectImageMimeType(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

export interface BashExtractedImage {
  data: Buffer;
  mimeType: string;
  /** Where the image came from (data URL, iTerm2 sequence, or file path). */
  source: string;
}

export interface BashImageExtraction {
  /** Cleaned output: terminal sequences and full data URLs replaced by short notes. */
  output: string;
  images: BashExtractedImage[];
  notes: string[];
}

// Whole-output data URL (ZCode parses stdout as one data URL with optional
// whitespace; same contract here).
const DATA_URL_RE = /^\s*data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\s*$/i;
// iTerm2 inline images: ESC ] 1337 ; File=<k=v;...>:<base64 payload> BEL|ESC \
// eslint-disable-next-line no-control-regex -- ESC/BEL are exactly the terminal control bytes being matched
const ITERM2_FILE_RE = /\x1b\]1337;File=[^\x07\x1b]*?:([A-Za-z0-9+/=]+)(?:\x07|\x1b\\)/g;
// Sixel: DCS ESC P <params> q ... ESC \ (7-bit form).
// eslint-disable-next-line no-control-regex -- ESC is exactly the terminal control byte being matched
const SIXEL_RE = /\x1bP[^q]{0,32}q[\s\S]*?\x1b\\/g;
const MAX_NOTES = 10;

function pushNote(notes: string[], note: string): void {
  if (notes.length < MAX_NOTES) notes.push(note);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

/** Downscale past the block limit (re-encoded JPEG, as Read does); undefined when undecodable. */
async function toBlockSized(
  data: Buffer,
  mimeType: string,
  notes: string[],
  source: string
): Promise<BashExtractedImage | undefined> {
  if (data.length <= MAX_IMAGE_BYTES) return { data, mimeType, source };
  const compressed = await compressImageToLimit(data, MAX_IMAGE_BYTES);
  if (!compressed) {
    pushNote(
      notes,
      `[Image from ${source} (${formatBytes(data.length)}) exceeds the 5MB block limit and could not be downscaled — not attached.]`
    );
    return undefined;
  }
  return { data: compressed.data, mimeType: compressed.mimeType, source };
}

function extractImageFilePaths(output: string, runCwd: string, limit: number): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    // Tokens are path-ish words; trailing punctuation from prose is stripped
    // ("saved to out.png." / "wrote chart.png:"). Existence is checked by the
    // caller, so false-positive tokens cost one stat each at most.
    for (const rawToken of line.split(/[\s"'`|]+/)) {
      const token = rawToken.replace(/[.,;:!?)\]}>'"]+$/, '').replace(/^[<('"]+/, '');
      if (!token || token.length > 1024) continue;
      const ext = path.extname(token).toLowerCase();
      if (!IMAGE_MIME_BY_EXT[ext]) continue;
      const resolved = path.isAbsolute(token) ? token : path.resolve(runCwd, token);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      found.push(resolved);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/**
 * Detect and convert image output in a successful Bash result. Call this only
 * for foreground results that were not handed off to the background (a handed
 * off child streams its output into the task log, not here).
 */
export async function extractBashImageOutput(input: {
  output: string;
  runCwd: string;
  supportsVision: boolean;
}): Promise<BashImageExtraction> {
  const { output, runCwd, supportsVision } = input;
  const images: BashExtractedImage[] = [];
  const notes: string[] = [];
  let capacity = MAX_IMAGE_BLOCKS;

  // 1) Whole-output data URL: the command printed exactly one image.
  const dataUrlMatch = DATA_URL_RE.exec(output);
  if (dataUrlMatch) {
    const data = Buffer.from(dataUrlMatch[2].replace(/\s/g, ''), 'base64');
    const sniffed = data.length > 0 ? detectImageMimeType(data) : undefined;
    let attached: BashExtractedImage | undefined;
    if (data.length > MAX_IMAGE_FILE_BYTES) {
      pushNote(
        notes,
        `[Command stdout was an image data URL (${formatBytes(data.length)}) that exceeds the ${formatBytes(MAX_IMAGE_FILE_BYTES)} file limit — not attached.]`
      );
    } else if (sniffed && supportsVision) {
      attached = await toBlockSized(data, sniffed, notes, 'stdout data URL');
      // No `capacity -= 1` here: the whole-output data-URL branch returns
      // immediately below, so remaining capacity is never consulted again.
      if (attached) {
        images.push(attached);
      }
    }
    const mimeType = sniffed ?? dataUrlMatch[1].toLowerCase();
    const suffix = attached
      ? 'attached as an image block below'
      : supportsVision
        ? 'not attached (undecodable image data)'
        : 'the current model has no vision, so it is not attached';
    return {
      output: `[Command stdout was an image (data URL, ${mimeType}, ${formatBytes(data.length)}) — ${suffix}.]`,
      images,
      notes,
    };
  }

  // 2) iTerm2 inline-image escape sequences in the output stream. Payloads are
  // processed first (they may need async downscaling), then replaced in one pass.
  let cleaned = output;
  const iterm2Matches = [...cleaned.matchAll(ITERM2_FILE_RE)];
  const iterm2Replacements = new Map<string, string>();
  for (const match of iterm2Matches) {
    const payload = match[1];
    if (iterm2Replacements.has(match[0])) continue;
    const data = Buffer.from(payload, 'base64');
    const sniffed = data.length > 0 ? detectImageMimeType(data) : undefined;
    if (!sniffed || data.length > MAX_IMAGE_FILE_BYTES) {
      pushNote(
        notes,
        '[An iTerm2 inline-image escape sequence was removed from the output; its payload could not be attached as an image.]'
      );
      iterm2Replacements.set(match[0], '[iTerm2 inline image]');
      continue;
    }
    if (supportsVision && capacity > 0) {
      const block = await toBlockSized(data, sniffed, notes, 'iTerm2 inline image');
      if (block) {
        images.push(block);
        capacity -= 1;
      }
      iterm2Replacements.set(match[0], '[iTerm2 inline image — attached below]');
      continue;
    }
    iterm2Replacements.set(match[0], '[iTerm2 inline image]');
  }
  if (iterm2Replacements.size > 0) {
    cleaned = cleaned.replace(ITERM2_FILE_RE, match => iterm2Replacements.get(match) ?? match[0]);
  }

  // 3) Sixel streams: detected and surfaced, but there is no sixel decoder in
  // the runtime, so the pixels cannot become an image block here.
  cleaned = cleaned.replace(SIXEL_RE, sequence => {
    pushNote(
      notes,
      `[Sixel image data (${formatBytes(sequence.length)}) was detected in the output and cannot be rendered as a model image — if the command also saved a file, Read that file.]`
    );
    return '[sixel image]';
  });
  // 4) Image files whose paths the command printed. Only read when the model
  // can actually receive image blocks.
  if (supportsVision && capacity > 0) {
    const candidates = extractImageFilePaths(cleaned, runCwd, capacity + 1);
    if (candidates.length > capacity) {
      pushNote(
        notes,
        `[Additional image files in the output were not attached (max ${MAX_IMAGE_BLOCKS}).]`
      );
    }
    for (const candidate of candidates.slice(0, capacity)) {
      try {
        const fileStat = await stat(candidate);
        if (!fileStat.isFile()) continue;
        if (fileStat.size > MAX_IMAGE_FILE_BYTES) {
          pushNote(
            notes,
            `[Image file ${candidate} (${formatBytes(fileStat.size)}) exceeds the ${formatBytes(MAX_IMAGE_FILE_BYTES)} file limit — not attached.]`
          );
          continue;
        }
        const data = await readFile(candidate);
        const sniffed = detectImageMimeType(data);
        if (!sniffed) continue;
        const block = await toBlockSized(data, sniffed, notes, candidate);
        if (block) images.push(block);
      } catch {
        // Path mentioned in output but unreadable: leave it as plain text.
      }
    }
  }

  return { output: cleaned, images, notes };
}
