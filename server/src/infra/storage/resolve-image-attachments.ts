import type { MessageAttachment } from '@zclaudia/shared/core/message';
import type { StoredFile } from '../../../infra/storage/fileStore.js';

/** Minimal interface consumed by resolveImageAttachments — satisfied by FileStore. */
export interface ImageFileSource {
  getFile(fileId: string): StoredFile | null;
}

/** Anthropic hard limit is 5MB per image; we enforce it server-side as the
 * backstop for clients that skip the desktop downscale path. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 10;

export interface ResolvedImage {
  name: string;
  mimeType: string;
  /** base64 (no data-url prefix), as stored by FileStore. */
  data: string;
}

export interface ResolveImagesResult {
  images: ResolvedImage[];
  /** Human-readable substitutes appended to the prompt text for images that
   * could not be sent (missing, oversize, over the per-message cap). */
  notices: string[];
}

export function resolveImageAttachments(
  attachments: MessageAttachment[],
  fileStore: ImageFileSource
): ResolveImagesResult {
  const images: ResolvedImage[] = [];
  const notices: string[] = [];
  for (const att of attachments) {
    if (att.type !== 'image') continue;
    if (images.length >= MAX_IMAGES_PER_MESSAGE) {
      notices.push(
        `[Image attached: ${att.name} — skipped, max ${MAX_IMAGES_PER_MESSAGE} images per message]`
      );
      continue;
    }
    const file = fileStore.getFile(att.fileId);
    if (!file) {
      notices.push(`[Image attached: ${att.name} — file unavailable]`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notices.push(`[Image attached: ${att.name} — skipped, exceeds 5MB limit]`);
      continue;
    }
    images.push({ name: file.name, mimeType: file.mimeType, data: file.data });
  }
  return { images, notices };
}

/** Non-image attachments above this size are not inlined; the agent gets a
 *  notice instead. 256KB of text is far more than any prompt needs. */
export const MAX_INLINE_TEXT_BYTES = 256 * 1024;

const TEXTUAL_MIME_RE =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|toml|sql|csv))/;
const TEXTUAL_NAME_RE =
  /\.(md|txt|json|ya?ml|toml|csv|log|ts|tsx|js|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|sh|zsh|bash|sql|html?|css|xml|ini|cfg|conf|env)$/i;

function isTextual(mimeType: string, name: string): boolean {
  return TEXTUAL_MIME_RE.test(mimeType) || TEXTUAL_NAME_RE.test(name);
}

export interface ResolvedTextFile {
  name: string;
  mimeType: string;
  content: string;
}

export interface ResolveFilesResult {
  files: ResolvedTextFile[];
  /** Human-readable substitutes appended to the prompt text for file
   *  attachments that could not be inlined (missing, binary, oversize). */
  notices: string[];
}

/**
 * Resolve non-image (`type: 'file'`) attachments. Text-like files are inlined
 * verbatim so the agent actually receives what the user attached; anything
 * else surfaces a descriptive notice instead of being silently dropped.
 */
export function resolveFileAttachments(
  attachments: MessageAttachment[],
  fileStore: ImageFileSource
): ResolveFilesResult {
  const files: ResolvedTextFile[] = [];
  const notices: string[] = [];
  for (const att of attachments) {
    if (att.type !== 'file') continue;
    const file = fileStore.getFile(att.fileId);
    if (!file) {
      notices.push(`[File attached: ${att.name} — file unavailable]`);
      continue;
    }
    if (!isTextual(file.mimeType, file.name)) {
      notices.push(
        `[File attached: ${att.name} — ${file.mimeType}, ${file.size} bytes (binary content not inlined)]`
      );
      continue;
    }
    if (file.size > MAX_INLINE_TEXT_BYTES) {
      notices.push(
        `[File attached: ${att.name} — skipped, ${file.size} bytes exceeds ${MAX_INLINE_TEXT_BYTES}-byte inline limit]`
      );
      continue;
    }
    let content: string;
    try {
      content = Buffer.from(file.data, 'base64').toString('utf-8');
    } catch {
      notices.push(`[File attached: ${att.name} — could not decode content]`);
      continue;
    }
    files.push({ name: file.name, mimeType: file.mimeType, content });
  }
  return { files, notices };
}
