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
  fileStore: ImageFileSource,
): ResolveImagesResult {
  const images: ResolvedImage[] = [];
  const notices: string[] = [];
  for (const att of attachments) {
    if (att.type !== 'image') continue;
    if (images.length >= MAX_IMAGES_PER_MESSAGE) {
      notices.push(`[Image attached: ${att.name} — skipped, max ${MAX_IMAGES_PER_MESSAGE} images per message]`);
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
