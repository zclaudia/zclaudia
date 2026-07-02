import { chmod, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const TOOL_RESULT_CONTENT_LIMIT = 80_000;

export type LineEndingStyle = 'CRLF' | 'LF';
export type TextEncoding = 'utf8' | 'utf16le';

export interface TextFileMetadata {
  content: string;
  encoding: TextEncoding;
  hasBom: boolean;
  mode?: number;
}

export interface ContentDetailFields {
  originalContent: string | null;
  updatedContent: string;
  contentTruncated?: {
    originalContent?: boolean;
    updatedContent?: boolean;
  };
}

export function lineEndingFor(content: string): LineEndingStyle {
  return content.includes('\r\n') ? 'CRLF' : 'LF';
}

export function applyLineEndingStyle(content: string, style: LineEndingStyle): string {
  const normalized = content.replace(/\r\n/g, '\n');
  return style === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

export function decodeTextBuffer(buffer: Buffer): TextFileMetadata {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const content = buffer.toString('utf16le');
    return {
      content: content.startsWith('\ufeff') ? content.slice(1) : content,
      encoding: 'utf16le',
      hasBom: true,
    };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      content: buffer.subarray(3).toString('utf8'),
      encoding: 'utf8',
      hasBom: true,
    };
  }
  return {
    content: buffer.toString('utf8'),
    encoding: 'utf8',
    hasBom: false,
  };
}

function encodeTextContent(
  content: string,
  encoding: TextEncoding,
  hasBom: boolean
): Buffer | string {
  if (encoding === 'utf16le') {
    const withBom = hasBom ? `\ufeff${content}` : content;
    return Buffer.from(withBom, 'utf16le');
  }
  return hasBom ? `\ufeff${content}` : content;
}

export async function readTextFileWithMetadata(filePath: string): Promise<TextFileMetadata> {
  const [buffer, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    ...decodeTextBuffer(buffer),
    mode: fileStat.mode & 0o7777,
  };
}

export async function writeTextFileAtomic(
  filePath: string,
  content: string,
  metadata?: Pick<TextFileMetadata, 'encoding' | 'hasBom' | 'mode'>
): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  const encoded = encodeTextContent(
    content,
    metadata?.encoding ?? 'utf8',
    metadata?.hasBom ?? false
  );
  try {
    await writeFile(
      tempPath,
      encoded,
      metadata?.mode !== undefined ? { mode: metadata.mode } : undefined
    );
    if (metadata?.mode !== undefined) await chmod(tempPath, metadata.mode);
    await rename(tempPath, filePath);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }
}

// Files written with a `#!` shebang are almost always meant to be run directly.
// Add execute bits (best-effort) so the model doesn't have to follow up with a
// separate chmod. Returns true only when the mode actually changed; any failure
// (read-only mount, Windows ACL) is swallowed — making the file executable is a
// convenience, not a contract.
export async function maybeMarkExecutableForShebang(
  filePath: string,
  content: string
): Promise<boolean> {
  if (!content.startsWith('#!')) return false;
  try {
    const fileStat = await stat(filePath);
    const current = fileStat.mode & 0o7777;
    const desired = current | 0o111;
    if (desired === current) return false;
    await chmod(filePath, desired);
    return true;
  } catch {
    return false;
  }
}

export function truncateToolResultContent(
  content: string,
  limit = TOOL_RESULT_CONTENT_LIMIT
): { content: string; truncated: boolean } {
  if (content.length <= limit) return { content, truncated: false };
  return {
    content: `${content.slice(0, limit)}\n... [truncated ${content.length - limit} chars]`,
    truncated: true,
  };
}

export function buildContentDetailFields(
  originalContent: string | null,
  updatedContent: string
): ContentDetailFields {
  const updated = truncateToolResultContent(updatedContent);
  const original =
    originalContent === null
      ? { content: null, truncated: false }
      : truncateToolResultContent(originalContent);
  const contentTruncated = {
    ...(original.truncated ? { originalContent: true } : {}),
    ...(updated.truncated ? { updatedContent: true } : {}),
  };
  return {
    originalContent: original.content,
    updatedContent: updated.content,
    ...(Object.keys(contentTruncated).length > 0 ? { contentTruncated } : {}),
  };
}
