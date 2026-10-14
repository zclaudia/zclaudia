import type { ReactNode } from 'react';
import { CompactionMarkerCard } from '../CompactionMarkerCard';
import { ContextUsageCard } from '../ContextUsageCard';
import { FilePushCard } from '../FilePushNotification';
import type { FilePushItem } from '../../../stores/filePushStore';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import { classifyMessage } from './classifyMessage';

export interface SpecialCardContext {
  isHighlighted: boolean;
  filePushItems: FilePushItem[];
  onPreview: (item: FilePushItem) => void;
}

/**
 * Render the protocol-sentinel cards (compaction marker, /context usage,
 * file push) for a message row, or null when the row is a regular message.
 * Each card is wrapped in the same highlightable container the regular
 * message rows use.
 */
export function renderSpecialCard(
  message: MessageWithToolCalls,
  { isHighlighted, filePushItems, onPreview }: SpecialCardContext
): ReactNode | null {
  const classification = classifyMessage(message);

  // Compaction marker dispatch — synthetic system message whose metadata carries the marker payload.
  // The server interleaves these into the messages list (see sessions message-routes.ts) and emits
  // a `compaction_completed` wire event so live sessions can append without a full reload.
  if (classification.kind === 'compactionMarker') {
    return (
      <div
        key={message.id}
        data-message-id={message.id}
        className={`max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0 scroll-mt-24 rounded-2xl transition-colors ${isHighlighted ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
      >
        <CompactionMarkerCard marker={classification.marker} />
      </div>
    );
  }

  // /context card dispatch — synthetic, frontend-only system message.
  if (classification.kind === 'contextUsage') {
    return (
      <div
        key={message.id}
        data-message-id={message.id}
        className={`max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0 scroll-mt-24 rounded-2xl transition-colors ${isHighlighted ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
      >
        <ContextUsageCard usage={classification.usage} />
      </div>
    );
  }

  if (classification.kind === 'filePush') {
    const fp = classification.filePush;
    const storeItem = filePushItems.find(i => i.fileId === fp.fileId);
    const item: FilePushItem = {
      fileId: fp.fileId,
      fileName: fp.fileName,
      mimeType: fp.mimeType,
      fileSize: fp.fileSize,
      sessionId: message.sessionId,
      description: fp.description,
      autoDownload: fp.autoDownload,
      status: storeItem?.status ?? 'pending',
      downloadProgress: storeItem?.downloadProgress ?? 0,
      savedPath: storeItem?.savedPath,
      privatePath: storeItem?.privatePath,
      error: storeItem?.error,
      serverId: storeItem?.serverId,
      createdAt: message.createdAt,
    };
    return (
      <div
        key={message.id}
        data-message-id={message.id}
        className={`max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0 scroll-mt-24 rounded-2xl transition-colors ${isHighlighted ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
      >
        <FilePushCard item={item} onPreview={onPreview} />
      </div>
    );
  }

  return null;
}
