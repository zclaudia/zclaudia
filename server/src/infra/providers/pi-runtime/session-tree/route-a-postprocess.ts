import type { Message } from '@earendil-works/pi-ai';
import type { MessageAttachment } from '@zclaudia/shared/core/message';
import { estimateTokens } from '../../context-snapshot.js';

const IMAGE_TOKEN_ESTIMATE = 1500;

export function estimateMessageTokens(msg: Message): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (msg as any).content;
  if (typeof content === 'string') return estimateTokens(content);
  if (!Array.isArray(content)) return 0;
  let text = '';
  let images = 0;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    else if (block.type === 'thinking' && typeof block.thinking === 'string') text += block.thinking;
    else if (block.type === 'toolCall') text += JSON.stringify(block.arguments ?? {});
    else if (block.type === 'image') images += 1;
  }
  return estimateTokens(text) + images * IMAGE_TOKEN_ESTIMATE;
}

/**
 * Trim a rebuilt `Message[]` (from buildContext) to fit `budget` tokens,
 * dropping from the OLDEST end. Always keeps the newest message; never starts
 * the kept slice on an orphaned `toolResult`.
 */
export function trimMessagesToBudget(messages: Message[], budget: number): Message[] {
  if (!(budget > 0) || messages.length === 0) return messages;
  let acc = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(messages[i]);
    if (acc + t > budget && i + 1 < messages.length) { cut = i + 1; break; }
    acc += t;
    cut = i;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  while (cut > 0 && (messages[cut] as any)?.role === 'toolResult') cut--;
  return messages.slice(cut);
}

export interface ImageResolver {
  /** Resolve attachment refs to sendable images (+ notices for failures / no-vision). */
  resolve: (attachments: MessageAttachment[]) => {
    images: Array<{ name?: string; mimeType: string; data: string }>;
    notices: string[];
  };
}

/**
 * Read-time Route A postprocessor: replace ref-carrying image blocks in user
 * messages (`{ type: 'image', attachmentRef }`) with resolved image bytes, or
 * with notice text when no images come back (e.g. non-vision model). Messages
 * without image refs pass through untouched.
 */
export function resolveImagesInMessages(messages: Message[], resolver: ImageResolver): Message[] {
  return messages.map((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mm = m as any;
    if (mm.role !== 'user' || !Array.isArray(mm.content)) return m;
    const refs = mm.content
      .filter((b: any) => b?.type === 'image' && b.attachmentRef)
      .map((b: any) => b.attachmentRef as MessageAttachment);
    if (refs.length === 0) return m;
    const { images, notices } = resolver.resolve(refs);
    const baseText = mm.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n');
    const text = notices.length ? `${baseText}\n\n${notices.join('\n')}` : baseText;
    if (images.length > 0) {
      return { ...mm, content: [{ type: 'text', text }, ...images.map((img) => ({ type: 'image', data: img.data, mimeType: img.mimeType }))] };
    }
    return { ...mm, content: text };
  });
}
