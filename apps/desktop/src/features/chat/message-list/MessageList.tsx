import { useState, useMemo, useCallback, memo } from 'react';
import type { ContentBlock } from '@zclaudia/shared/core/message';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../stores/runStore';
import { useFilePushStore, type FilePushItem } from '../../../stores/filePushStore';
import { FilePreviewModal } from '../FilePreviewModal';
import {
  TranscriptCapabilitiesProvider,
  type TranscriptCapabilities,
} from '@zclaudia/agent-transcript-kit/react';
import { useRunInTerminal } from '../tool-call/useRunInTerminal';
import { highlightCode } from '../CodeBlock';
import { toolIcon } from '../tool-call/toolIcon';
import { MessageItem } from './MessageItem';
import { filterRenderableMessages } from './classifyMessage';
import { renderSpecialCard } from './specialCards';
import { useItemVirtualizer } from './useItemVirtualizer';
import { FileRefContext, type FileRefContextValue } from './fileRefContext';

export interface MessageListProps {
  messages: MessageWithToolCalls[];
  streamingContentBlocks?: ContentBlock[];
  streamingToolCalls?: ToolCallState[];
  scrollTop?: number;
  viewportHeight?: number;
  resendTargetMessageId?: string;
  highlightedMessageId?: string | null;
  onResendTarget?: () => void;
  resendDisabled?: boolean;
  /** Project root used to resolve `filename.ext:line` references in messages. */
  fileReferenceRoot?: string;
  /** Backend that owns the project root — used for cross-gateway file lookups. */
  fileReferenceBackendId?: string | null;
  /**
   * SP-A fork/branch callbacks. Both are gated on `message.treeEntryId` being set.
   * onFork: copy history up to this message into a new session.
   * onBranch: rewind this session to this message (replaces timeline).
   */
  onFork?: (treeEntryId: string) => void;
  onBranch?: (treeEntryId: string) => void;
}

export const MessageList = memo(function MessageList({
  messages,
  streamingContentBlocks,
  streamingToolCalls,
  scrollTop = 0,
  viewportHeight = 0,
  resendTargetMessageId,
  highlightedMessageId,
  onResendTarget,
  resendDisabled = false,
  fileReferenceRoot,
  fileReferenceBackendId,
  onFork,
  onBranch,
}: MessageListProps) {
  const fileRefContextValue = useMemo<FileRefContextValue>(
    () => ({ projectRoot: fileReferenceRoot, backendId: fileReferenceBackendId }),
    [fileReferenceRoot, fileReferenceBackendId]
  );
  // Host capabilities are resolved once here, at the container boundary, and
  // handed to the renderers by context — they never reach into stores.
  const runInTerminal = useRunInTerminal();
  const capabilities = useMemo<TranscriptCapabilities>(
    () => ({ runInTerminal, highlightCode, toolIcon }),
    [runInTerminal]
  );
  // Subscribe to filePushStore for download status updates
  const filePushItems = useFilePushStore(state => state.items);
  const [previewItem, setPreviewItem] = useState<FilePushItem | null>(null);

  const filteredMessages = useMemo(() => filterRenderableMessages(messages), [messages]);

  const firstMessageId = filteredMessages[0]?.id || '';
  const { shouldVirtualize, virtualWindow, getMeasureRef } = useItemVirtualizer({
    itemCount: filteredMessages.length,
    scrollTop,
    viewportHeight,
    resetKey: firstMessageId,
  });

  // Precompute the index of the last assistant message for streaming block assignment
  const lastAssistantIndex = useMemo(() => {
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
      if (filteredMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [filteredMessages]);

  const renderMessage = useCallback(
    (message: MessageWithToolCalls, index: number) => {
      const isHighlighted = highlightedMessageId === message.id;

      const specialCard = renderSpecialCard(message, {
        isHighlighted,
        filePushItems,
        onPreview: setPreviewItem,
      });
      if (specialCard) return specialCard;

      // Pass streaming blocks to the last assistant message (not necessarily the absolute
      // last message — system messages like task_notification can be appended after it).
      const isLastAssistant = Boolean(streamingContentBlocks && index === lastAssistantIndex);

      return (
        <div
          key={message.id}
          data-message-id={message.id}
          className={`scroll-mt-24 rounded-2xl transition-colors min-w-0 max-w-full ${isHighlighted ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
        >
          <MessageItem
            message={message}
            streamingContentBlocks={isLastAssistant ? streamingContentBlocks : undefined}
            streamingToolCalls={isLastAssistant ? streamingToolCalls : undefined}
            showResend={message.id === resendTargetMessageId}
            onResend={message.id === resendTargetMessageId ? onResendTarget : undefined}
            resendDisabled={resendDisabled}
            onFork={onFork}
            onBranch={onBranch}
            isLeaf={index === filteredMessages.length - 1}
          />
        </div>
      );
    },
    [
      filePushItems,
      filteredMessages.length,
      highlightedMessageId,
      lastAssistantIndex,
      streamingContentBlocks,
      streamingToolCalls,
      resendTargetMessageId,
      onResendTarget,
      resendDisabled,
      onFork,
      onBranch,
    ]
  );

  if (filteredMessages.length === 0) {
    return null;
  }

  const previewModal = previewItem && (
    <FilePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
  );

  if (!shouldVirtualize) {
    return (
      <TranscriptCapabilitiesProvider value={capabilities}>
        <FileRefContext.Provider value={fileRefContextValue}>
          <div data-testid="message-list" className="space-y-5 min-w-0 max-w-full">
            {filteredMessages.map((message, index) => renderMessage(message, index))}
          </div>
          {previewModal}
        </FileRefContext.Provider>
      </TranscriptCapabilitiesProvider>
    );
  }

  return (
    <TranscriptCapabilitiesProvider value={capabilities}>
      <FileRefContext.Provider value={fileRefContextValue}>
        <div data-testid="message-list" className="min-w-0 max-w-full">
          {virtualWindow.topPadding > 0 && <div style={{ height: virtualWindow.topPadding }} />}
          {filteredMessages.slice(virtualWindow.start, virtualWindow.end).map((message, idx) => {
            const absoluteIndex = virtualWindow.start + idx;
            return (
              <div
                key={message.id}
                ref={getMeasureRef(absoluteIndex)}
                className="mb-4 min-w-0 max-w-full"
              >
                {renderMessage(message, absoluteIndex)}
              </div>
            );
          })}
          {virtualWindow.bottomPadding > 0 && (
            <div style={{ height: virtualWindow.bottomPadding }} />
          )}
        </div>
        {previewModal}
      </FileRefContext.Provider>
    </TranscriptCapabilitiesProvider>
  );
});
