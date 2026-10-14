import { memo, useMemo } from 'react';
import { Compass, Target } from 'lucide-react';
import { ToolCallList } from '../tool-call/ToolCallList';
import type { ContentBlock, MessageAttachment } from '@zclaudia/shared/core/message';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../stores/runStore';
import { extractThinking, tryParseMessageInput } from '../../../utils/messageContent';
import { TextWithFileRefs } from '../FileReference';
import { ThinkingBlock } from '@zclaudia/agent-transcript-kit/react';
import { formatMessageTimestamp } from '../messageTimestamp';
import { AttachmentDisplay } from './AttachmentDisplay';
import { AssistantContent } from './AssistantContent';
import { MessageActionsMenu } from './MessageActionsMenu';
import { SegmentedContent } from './SegmentedContent';

export const MessageItem = memo(function MessageItem({
  message,
  streamingContentBlocks,
  streamingToolCalls,
  showResend,
  onResend,
  resendDisabled,
  onFork,
  onBranch,
  isLeaf,
}: {
  message: MessageWithToolCalls;
  streamingContentBlocks?: ContentBlock[];
  streamingToolCalls?: ToolCallState[];
  showResend?: boolean;
  onResend?: () => void;
  resendDisabled?: boolean;
  onFork?: (treeEntryId: string) => void;
  onBranch?: (treeEntryId: string) => void;
  /** True when this is the latest message (current leaf) — a rewind here is a no-op. */
  isLeaf?: boolean;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const streamingHasTextBlocks = Boolean(
    streamingContentBlocks?.some(block => block.type === 'text' && block.content.trim().length > 0)
  );
  // Use segmented rendering: completed messages OR active streaming with blocks
  const hasStreamingBlocks =
    streamingContentBlocks &&
    streamingContentBlocks.length > 0 &&
    streamingToolCalls &&
    streamingToolCalls.length > 0;
  const useSegmented =
    !isUser && !isSystem && ((hasContentBlocks && hasToolCalls) || hasStreamingBlocks);

  const parsedInput = tryParseMessageInput(message.content);
  const textContent: string = parsedInput?.text ?? message.content;
  // New-format rows store plain text in content and attachment refs in metadata.attachments.
  // Legacy rows store a JSON MessageInput envelope in content. Fall back to metadata when
  // no legacy envelope is present so thumbnails survive a session reload.
  const attachments: MessageAttachment[] =
    parsedInput?.attachments ?? message.metadata?.attachments ?? [];

  // Extract thinking blocks for assistant messages (rendered outside bubble for consistent width)
  const { thinking, content: mainContent } = useMemo(
    () =>
      !isUser && !isSystem
        ? extractThinking(message.content)
        : { thinking: '', content: message.content },
    [message.content, isUser, isSystem]
  );

  // Structured thinking blocks from message metadata (populated by pi-runtime).
  // Distinct from the inline `<thinking>` tag content extracted above.
  const metadataThinkingBlocks =
    !isUser && !isSystem ? (message.metadata?.thinkingBlocks ?? []) : [];
  const hasMetadataThinking = metadataThinkingBlocks.length > 0;

  // Show the actions menu when the message has a treeEntryId and callbacks are provided.
  // Rendered unconditionally (not hover-gated) so it doesn't reflow the timestamp row
  // on hover — the trigger is a low-contrast icon that only fills in on hover.
  const messageActions =
    message.treeEntryId && onFork && onBranch
      ? { treeEntryId: message.treeEntryId, onFork, onBranch }
      : null;

  if (useSegmented) {
    // Segmented rendering: streaming blocks take priority over finalized blocks
    const blocks = streamingContentBlocks ?? message.contentBlocks ?? [];
    const toolCalls = streamingToolCalls ?? message.toolCalls ?? [];
    const shouldRenderFallbackContent = Boolean(
      streamingContentBlocks && !streamingHasTextBlocks && mainContent.trim().length > 0
    );
    return (
      <div
        data-role={message.role}
        className="relative flex flex-col items-start min-w-0 max-w-full group/msgitem"
      >
        {hasMetadataThinking && (
          <div className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0">
            <ThinkingBlock content={metadataThinkingBlocks} />
          </div>
        )}
        {shouldRenderFallbackContent && (
          <div className="zc-assistant-bubble rounded-2xl px-3 md:px-4 py-2 mb-2 w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-card text-card-foreground min-w-0">
            <AssistantContent content={mainContent} />
          </div>
        )}
        <SegmentedContent
          contentBlocks={blocks}
          toolCalls={toolCalls}
          isStreaming={Boolean(streamingContentBlocks)}
        />
        <div className="mt-1 flex items-center gap-2 px-3">
          <span className="text-xs text-muted-foreground">
            {formatMessageTimestamp(message.createdAt)}
          </span>
          {messageActions && (
            <MessageActionsMenu
              treeEntryId={messageActions.treeEntryId}
              onFork={messageActions.onFork}
              onBranch={messageActions.onBranch}
              anchor="left"
              canBranch={!isLeaf}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-role={message.role}
      className={`relative flex flex-col min-w-0 ${isUser ? 'items-end' : 'items-start'} ${
        isSystem ? 'opacity-60' : ''
      }`}
    >
      {/* Structured thinking blocks from metadata (pi-runtime) */}
      {hasMetadataThinking && (
        <div className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0">
          <ThinkingBlock content={metadataThinkingBlocks} />
        </div>
      )}

      {/* Tool calls section (shown before the message content for assistant) — legacy rendering */}
      {!isUser && hasToolCalls && (
        <div className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl mb-2 min-w-0">
          <ToolCallList toolCalls={message.toolCalls ?? []} defaultCollapsed />
        </div>
      )}

      {/* Thinking block (same level as tool calls for consistent width) */}
      {!isUser && thinking && (
        <div className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl mb-2 min-w-0">
          <ThinkingBlock content={thinking} />
        </div>
      )}

      <div
        className={`rounded-2xl px-3 md:px-4 py-2 ${
          isUser
            ? 'zc-user-bubble max-w-[85%] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-muted/60 text-foreground shadow-apple-sm'
            : isSystem
              ? 'max-w-[85%] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-muted text-muted-foreground text-sm'
              : 'zc-assistant-bubble w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-card text-card-foreground min-w-0'
        }`}
      >
        {isUser ? (
          <div className="text-sm">
            {/* Goal-auto badge: shown when the GoalCoordinator injected this message */}
            {message.metadata?.source === 'goal-auto' && (
              <span
                className="mr-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground align-middle"
                aria-label="auto goal turn"
                title="Auto-continued by goal"
              >
                <Target size={10} className="flex-shrink-0" />
                Goal
              </span>
            )}
            {/* Steered badge: this user message was injected mid-run via steering */}
            {message.metadata?.steered && (
              <span
                className="mr-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground align-middle"
                aria-label="steered mid-run"
                title="Injected mid-run (delivered next turn)"
              >
                <Compass size={10} className="flex-shrink-0" />
                Steered
              </span>
            )}
            {/* Display attachments */}
            {attachments.length > 0 && (
              <div className="space-y-2 mb-2">
                {attachments.map(att => (
                  <AttachmentDisplay key={att.fileId} attachment={att} />
                ))}
              </div>
            )}
            {/* Display text */}
            <p className="whitespace-pre-wrap leading-relaxed">
              <TextWithFileRefs text={textContent} variant="user" />
            </p>
          </div>
        ) : (
          <AssistantContent content={mainContent} />
        )}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatMessageTimestamp(message.createdAt)}
          </span>
          {messageActions && (
            <MessageActionsMenu
              treeEntryId={messageActions.treeEntryId}
              onFork={messageActions.onFork}
              onBranch={messageActions.onBranch}
              anchor={isUser ? 'right' : 'left'}
              canBranch={!isLeaf}
            />
          )}
        </div>
      </div>
      {isUser && showResend && onResend && (
        <div className="mt-1">
          <button
            onClick={onResend}
            disabled={resendDisabled}
            className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              resendDisabled ? 'This message cannot be resent as plain text' : 'Resend this message'
            }
          >
            Resend
          </button>
        </div>
      )}
    </div>
  );
});
