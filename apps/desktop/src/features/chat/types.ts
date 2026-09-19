/**
 * Shared chat/composer types.
 *
 * `Attachment` historically lived in (and is still re-exported from)
 * MessageInput.tsx; the canonical definition moved here so composer hooks and
 * sibling components can reference it without importing the component itself.
 */
export interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string; // base64 data URL
  mimeType: string;
}
