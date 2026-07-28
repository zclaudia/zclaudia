import {
  useState,
  useMemo,
  useCallback,
  memo,
  useRef,
  useEffect,
  createContext,
  useContext,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Brain,
  ChevronRight,
  Image,
  Copy,
  Check,
  Terminal,
  MoreHorizontal,
  GitFork,
  GitBranch,
  Compass,
  Target,
} from 'lucide-react';
import { ToolCallList } from './tool-call/ToolCallList';
import { FilePushCard } from './FilePushNotification';
import { FilePreviewModal } from './FilePreviewModal';
import { CompactionMarkerCard } from './CompactionMarkerCard';
import { ContextUsageCard } from './ContextUsageCard';
import { ChatLink } from '../browser/ChatLink';
import type { MessageWithToolCalls } from '../../stores/chatMessageStore';
import type { ToolCallState } from '../../stores/runStore';
import type { ContentBlock, ThinkingBlock as ThinkingBlockMeta } from '@zclaudia/shared';
import { useFilePushStore, type FilePushItem } from '../../stores/filePushStore';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { downloadFile } from '../../services/fileUpload';
import type { MessageAttachment } from '@zclaudia/shared';
import {
  extractThinking,
  logSuspiciousMarkdownRender,
  normalizeMarkdownForRender,
  tryParseMessageInput,
} from '../../utils/messageContent';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useServerStore } from '../../stores/serverStore';
import { TextWithFileRefs, MarkdownChildrenWithFileRefs } from './FileReference';
import {
  hasInlineMarkdownIcon,
  TextWithInlineMarkdownIcons,
} from '../../components/markdown/InlineMarkdownIcons';
import { FileLineReference, INLINE_FILE_REF_REGEX } from './FileLineReference';
import { activatePanel } from '../../utils/openPanel';
import { formatMessageTimestamp } from './messageTimestamp';
import { useAnimationFrameThrottle } from '../../hooks/useAnimationFrameThrottle';

interface FileRefContextValue {
  projectRoot?: string;
  backendId?: string | null;
}

const FileRefContext = createContext<FileRefContextValue>({});

/** Number of preview lines shown when collapsed */
const THINKING_PREVIEW_LINES = 2;

/** Collapsible thinking block with purple accent and content preview */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const lineCount = nonEmptyLines.length;

  // Build preview: first N non-empty lines
  const previewLines = nonEmptyLines.slice(0, THINKING_PREVIEW_LINES);
  const previewText = previewLines.join('\n');
  const hasMore = lineCount > THINKING_PREVIEW_LINES;

  return (
    <div className="mb-2 rounded-lg border border-thinking/30 bg-thinking/5 text-xs">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-thinking hover:text-foreground transition-colors"
      >
        <Brain size={14} strokeWidth={1.75} className="flex-shrink-0" />
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          className={`transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">Thinking</span>
        {/* Line count */}
        <span className="text-thinking/50 ml-auto text-[10px]">
          {lineCount} line{lineCount !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Preview (when collapsed) */}
      {!expanded && previewText && (
        <div className="px-3 pb-2 text-muted-foreground italic leading-relaxed line-clamp-2">
          {previewText}
          {hasMore && <span className="text-thinking/40"> ...</span>}
        </div>
      )}

      {/* Full content (when expanded) */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-thinking/10">
          <div className="pt-2 text-muted-foreground whitespace-pre-wrap leading-relaxed italic">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Folded card rendering structured thinking blocks from `message.metadata.thinkingBlocks`
 * (populated by the pi-runtime). Distinct from the in-text `<ThinkingBlock>` above, which
 * parses legacy `<thinking>` tags out of the message content.
 */
function ThinkingBlocksCard({ blocks }: { blocks: ThinkingBlockMeta[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!blocks || blocks.length === 0) return null;

  const count = blocks.length;

  return (
    <div className="mb-2 rounded-lg border border-thinking/30 bg-thinking/5 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-thinking hover:text-foreground transition-colors"
      >
        <Brain size={14} strokeWidth={1.75} className="flex-shrink-0" />
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          className={`transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">Thinking</span>
        <span className="text-thinking/50 ml-auto text-[10px]">
          {count} block{count !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 border-t border-thinking/10">
          <div className="pt-2 space-y-2 text-muted-foreground italic leading-relaxed whitespace-pre-wrap">
            {blocks.map((b, i) => (
              <div key={i}>
                {b.redacted && (
                  <span className="text-warning not-italic mr-1">[Redacted by safety filter]</span>
                )}
                {b.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
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

const VIRTUALIZE_THRESHOLD = 80;
const VIRTUAL_ESTIMATED_HEIGHT = 120;
const VIRTUAL_OVERSCAN_PX = 900;

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
  // Subscribe to filePushStore for download status updates
  const filePushItems = useFilePushStore(state => state.items);
  const [previewItem, setPreviewItem] = useState<FilePushItem | null>(null);
  const [itemHeights, setItemHeights] = useState<ReadonlyMap<number, number>>(() => new Map());
  const itemHeightsRef = useRef<Map<number, number>>(new Map());
  const observersRef = useRef<Map<number, ResizeObserver>>(new Map());
  // Stable per-index ref callbacks so React doesn't tear down and re-attach
  // every visible item's ResizeObserver on each re-render.
  const measureRefsRef = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
  // Coalesce height updates into one state flush per frame instead of one per
  // ResizeObserver callback (the streaming last item fires continuously).
  const heightFlushFrameRef = useRef<number | null>(null);

  // Filter out empty messages (permission approvals, empty inputs, placeholder assistant messages).
  // Compaction markers ride on synthetic system messages with empty content, so they would
  // otherwise be filtered out below — keep them by detecting the metadata sentinel.
  const filteredMessages = useMemo(() => {
    return (messages || []).filter(message => {
      // Compaction markers and /context cards always pass — even though their role is 'system' and content is empty.
      if (message.metadata?.compactionMarker) return true;
      if (message.metadata?.contextUsage) return true;

      // Filter out empty assistant messages (placeholders from run_started that never received content)
      if (message.role === 'assistant') {
        const hasContent = message.content.trim().length > 0;
        const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
        const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0;
        return hasContent || hasToolCalls || hasBlocks;
      }

      // Keep all other non-user messages (system, etc.)
      if (message.role !== 'user') {
        return true;
      }

      const parsed = tryParseMessageInput(message.content);
      const textContent = parsed?.text ?? message.content;
      const hasAttachments =
        (parsed?.attachments?.length ?? 0) > 0 || (message.metadata?.attachments?.length ?? 0) > 0;
      return textContent.trim().length > 0 || hasAttachments;
    });
  }, [messages]);

  const firstMessageId = filteredMessages[0]?.id || '';
  const prevFirstMessageIdRef = useRef(firstMessageId);
  useEffect(() => {
    // Reset measurements when the list head changes (session switch or prepending older history).
    if (prevFirstMessageIdRef.current !== firstMessageId) {
      for (const ro of observersRef.current.values()) {
        ro.disconnect();
      }
      observersRef.current.clear();
      measureRefsRef.current.clear();
      itemHeightsRef.current.clear();
      if (heightFlushFrameRef.current != null) {
        cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = null;
      }
      setItemHeights(new Map());
      prevFirstMessageIdRef.current = firstMessageId;
    }
  }, [firstMessageId]);

  useEffect(() => {
    const observers = observersRef.current;
    return () => {
      for (const ro of observers.values()) {
        ro.disconnect();
      }
      observers.clear();
      if (heightFlushFrameRef.current != null) {
        cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = null;
      }
    };
  }, []);

  const scheduleHeightFlush = useCallback(() => {
    if (heightFlushFrameRef.current != null) return;
    heightFlushFrameRef.current = requestAnimationFrame(() => {
      heightFlushFrameRef.current = null;
      setItemHeights(new Map(itemHeightsRef.current));
    });
  }, []);

  const shouldVirtualize = filteredMessages.length >= VIRTUALIZE_THRESHOLD && viewportHeight > 0;

  const getHeight = useCallback(
    (index: number) => {
      return itemHeights.get(index) ?? VIRTUAL_ESTIMATED_HEIGHT;
    },
    [itemHeights]
  );

  const setMeasuredRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      const existing = observersRef.current.get(index);
      if (existing) {
        existing.disconnect();
        observersRef.current.delete(index);
      }

      if (!element) return;

      const updateHeight = (nextHeight: number) => {
        if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
        const prev = itemHeightsRef.current.get(index);
        if (prev !== nextHeight) {
          itemHeightsRef.current.set(index, nextHeight);
          scheduleHeightFlush();
        }
      };

      updateHeight(Math.ceil(element.getBoundingClientRect().height));

      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          updateHeight(Math.ceil(entry.contentRect.height));
        }
      });
      ro.observe(element);
      observersRef.current.set(index, ro);
    },
    [scheduleHeightFlush]
  );

  // Cache one stable ref callback per index. React only invokes it when the
  // element at that position actually mounts/unmounts, not on every render.
  const getMeasureRef = useCallback(
    (index: number) => {
      let ref = measureRefsRef.current.get(index);
      if (!ref) {
        ref = (element: HTMLDivElement | null) => setMeasuredRef(index, element);
        measureRefsRef.current.set(index, ref);
      }
      return ref;
    },
    [setMeasuredRef]
  );

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

      // Compaction marker dispatch — synthetic system message whose metadata carries the marker payload.
      // The server interleaves these into the messages list (see sessions message-routes.ts) and emits
      // a `compaction_completed` wire event so live sessions can append without a full reload.
      if (message.metadata?.compactionMarker) {
        return (
          <div
            key={message.id}
            data-message-id={message.id}
            className={`max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0 scroll-mt-24 rounded-2xl transition-colors ${isHighlighted ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
          >
            <CompactionMarkerCard marker={message.metadata.compactionMarker} />
          </div>
        );
      }

      // /context card dispatch — synthetic, frontend-only system message.
      if (message.metadata?.contextUsage) {
        return (
          <div
            key={message.id}
            data-message-id={message.id}
            className={`max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0 scroll-mt-24 rounded-2xl transition-colors ${isHighlighted ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
          >
            <ContextUsageCard usage={message.metadata.contextUsage} />
          </div>
        );
      }

      if (message.metadata?.filePush) {
        const fp = message.metadata.filePush;
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
            <FilePushCard item={item} onPreview={setPreviewItem} />
          </div>
        );
      }

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

  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        start: 0,
        end: filteredMessages.length,
        topPadding: 0,
        bottomPadding: 0,
      };
    }

    let totalHeight = 0;
    for (let i = 0; i < filteredMessages.length; i++) {
      totalHeight += getHeight(i);
    }
    const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
    const safeScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);

    let start = 0;
    let y = 0;
    const startOffset = Math.max(0, safeScrollTop - VIRTUAL_OVERSCAN_PX);
    while (start < filteredMessages.length && y + getHeight(start) < startOffset) {
      y += getHeight(start);
      start++;
    }

    let end = start;
    let renderedBottom = y;
    const endOffset = safeScrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;
    while (end < filteredMessages.length && renderedBottom < endOffset) {
      renderedBottom += getHeight(end);
      end++;
    }

    return {
      start,
      end,
      topPadding: y,
      bottomPadding: Math.max(0, totalHeight - renderedBottom),
    };
  }, [filteredMessages.length, getHeight, scrollTop, shouldVirtualize, viewportHeight]);

  if (filteredMessages.length === 0) {
    return null;
  }

  const previewModal = previewItem && (
    <FilePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
  );

  if (!shouldVirtualize) {
    return (
      <FileRefContext.Provider value={fileRefContextValue}>
        <div data-testid="message-list" className="space-y-5 min-w-0 max-w-full">
          {filteredMessages.map((message, index) => renderMessage(message, index))}
        </div>
        {previewModal}
      </FileRefContext.Provider>
    );
  }

  return (
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
        {virtualWindow.bottomPadding > 0 && <div style={{ height: virtualWindow.bottomPadding }} />}
      </div>
      {previewModal}
    </FileRefContext.Provider>
  );
});

const SHELL_LANGUAGES = new Set(['bash', 'shell', 'sh', 'zsh']);

// Memoized so completed code blocks in a streaming message don't re-run Prism
// tokenization on every token — only the block whose code string changed does.
const CodeBlock = memo(function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const { sendMessage } = useConnection();
  const isShell = SHELL_LANGUAGES.has(language.toLowerCase());
  const hasTerminal = isShell && useServerStore.getState().activeServerSupports('remoteTerminal');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunInTerminal = async () => {
    const { selectedSessionId, sessions } = useProjectStore.getState();
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session?.projectId) return;

    const store = useTerminalStore.getState();
    if (!store.getTerminalId(session.projectId)) {
      store.openTerminal(session.projectId);
    }
    store.setDrawerOpen(session.projectId, true);
    activatePanel('terminal');

    const terminalId = useTerminalStore.getState().getTerminalId(session.projectId);
    if (terminalId) {
      await useTerminalStore.getState().waitForReady(terminalId);
      sendMessage({ type: 'terminal_input', terminalId, data: children });
    }
  };

  const codeStyle = isDarkTheme(resolvedTheme) ? oneDark : oneLight;

  return (
    <div className="not-prose rounded-lg overflow-hidden border border-border max-w-full">
      {/* Header bar - like GPT style */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">{language}</span>
        <div className="flex items-center gap-3">
          {isShell && hasTerminal && (
            <button
              onClick={handleRunInTerminal}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Terminal size={16} strokeWidth={1.75} />
              Run in terminal
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`
              flex items-center gap-1.5 text-xs transition-colors
              ${copied ? 'text-success' : 'text-muted-foreground hover:text-foreground'}
            `}
          >
            {copied ? (
              <>
                <Check size={16} strokeWidth={1.75} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} strokeWidth={1.75} />
                Copy code
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code content */}
      <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
        <SyntaxHighlighter
          style={codeStyle}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            padding: '0.75rem',
            fontSize: 'var(--chat-font-code, 0.75rem)',
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

// Attachment display component — lazy load: only download on click
function AttachmentDisplay({ attachment }: { attachment: MessageAttachment }) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImage = useCallback(() => {
    if (loading || imageData) return;
    setLoading(true);
    setError(null);
    downloadFile(attachment.fileId)
      .then(result => {
        setImageData(`data:${result.mimeType};base64,${result.data}`);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load image:', err);
        setError('Failed to load image');
        setLoading(false);
      });
  }, [attachment.fileId, loading, imageData]);

  if (attachment.type === 'image') {
    if (imageData) {
      return (
        <div className="rounded-md overflow-hidden bg-black/20 inline-block max-w-full">
          <img
            src={imageData}
            alt={attachment.name}
            className="block max-w-full h-auto"
            style={{ maxHeight: '300px' }}
          />
          <div className="px-2 py-1 bg-black/20 text-xs text-foreground/70">{attachment.name}</div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="border border-border rounded-md p-4 bg-secondary/50 text-center text-sm text-muted-foreground">
          Loading image...
        </div>
      );
    }

    // Default: show clickable placeholder
    return (
      <div
        className="border border-border rounded-md overflow-hidden bg-secondary/30 cursor-pointer hover:bg-secondary/50 transition-colors"
        onClick={loadImage}
      >
        <div className="flex items-center justify-center h-24 text-muted-foreground">
          <div className="text-center">
            <Image size={32} strokeWidth={1.75} className="mx-auto mb-1 opacity-50" />
            <div className="text-xs">
              {error ? 'Load failed — click to retry' : 'Click to load image'}
            </div>
          </div>
        </div>
        <div className="px-2 py-1 bg-secondary text-xs text-muted-foreground border-t border-border">
          {attachment.name}
        </div>
      </div>
    );
  }

  // Fallback for other file types
  return (
    <div className="px-2 py-1 bg-secondary text-xs rounded-md inline-block">{attachment.name}</div>
  );
}

/** Collapsed intermediate text block — shows first line preview, expandable */
function CollapsedTextBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  // Strip thinking tags for preview
  const { content: cleanContent } = extractThinking(content);
  const firstLine = cleanContent.split('\n').find(l => l.trim().length > 0) || '';
  // Truncate to reasonable preview length
  const preview = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;

  return (
    <div className="mb-2 rounded-lg border border-border/50 bg-muted/30 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          className={`transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="truncate text-left">{preview || '...'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t border-border/30">
          <div className="pt-2">
            <AssistantContent content={cleanContent} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Segmented content renderer — interleaves collapsed text, tool calls, and final text */
const SegmentedContent = memo(function SegmentedContent({
  contentBlocks,
  toolCalls,
  isStreaming,
}: {
  contentBlocks: ContentBlock[];
  toolCalls: ToolCallState[];
  isStreaming: boolean;
}) {
  // Build toolUseId → ToolCallState lookup
  const toolCallMap = useMemo(() => {
    const map = new Map<string, ToolCallState>();
    for (const tc of toolCalls) {
      map.set(tc.id, tc);
    }
    return map;
  }, [toolCalls]);

  // Find last text block index
  const lastTextIndex = useMemo(() => {
    for (let i = contentBlocks.length - 1; i >= 0; i--) {
      if (contentBlocks[i].type === 'text') return i;
    }
    return -1;
  }, [contentBlocks]);

  // Group consecutive tool_use blocks so they share a ToolCallList collapse header
  type Segment =
    | { kind: 'text'; index: number; content: string }
    | { kind: 'tools'; toolCalls: ToolCallState[] };

  const segments = useMemo<Segment[]>(() => {
    const result: Segment[] = [];
    let pendingTools: ToolCallState[] = [];
    const flushTools = () => {
      if (pendingTools.length > 0) {
        result.push({ kind: 'tools', toolCalls: pendingTools });
        pendingTools = [];
      }
    };
    contentBlocks.forEach((block, i) => {
      if (block.type === 'tool_use') {
        const tc = toolCallMap.get(block.toolUseId);
        if (!tc) return;
        pendingTools.push(tc);
      } else {
        flushTools();
        result.push({ kind: 'text', index: i, content: block.content });
      }
    });
    flushTools();
    return result;
  }, [contentBlocks, toolCallMap]);

  return (
    <>
      {segments.map((segment, segIdx) => {
        if (segment.kind === 'tools') {
          // Only the trailing tools group can still receive new tools; once any segment follows
          // (e.g. a new text block), this group is finalized and should auto-collapse.
          const isTrailingTools = segIdx === segments.length - 1;
          return (
            <div
              key={`tools-${segIdx}`}
              className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0"
            >
              <ToolCallList
                toolCalls={segment.toolCalls}
                defaultCollapsed={!isStreaming || !isTrailingTools}
                isStreaming={isStreaming && isTrailingTools}
              />
            </div>
          );
        }

        const i = segment.index;

        // Text block
        if (i === lastTextIndex) {
          // Last text block: render fully with thinking extraction
          const { thinking, content: mainContent } = extractThinking(segment.content);
          return (
            <div key={`text-${i}`} className="w-full max-w-full min-w-0">
              {thinking && (
                <div className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl mb-2 min-w-0">
                  <ThinkingBlock content={thinking} />
                </div>
              )}
              <div className="rounded-2xl px-3 md:px-4 py-2 w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-card text-card-foreground min-w-0">
                <AssistantContent content={mainContent} />
              </div>
            </div>
          );
        }

        // Intermediate text block: collapsed
        return (
          <div
            key={`text-${i}`}
            className="w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl min-w-0"
          >
            <CollapsedTextBlock content={segment.content} />
          </div>
        );
      })}
    </>
  );
});

/**
 * Small floating action menu shown on hover for messages that carry a `treeEntryId`.
 * Provides "Fork into new session" and "Branch from here (rewind)" SP-A actions.
 */
function MessageActionsMenu({
  treeEntryId,
  onFork,
  onBranch,
  anchor = 'right',
  canBranch = true,
}: {
  treeEntryId: string;
  onFork: (treeEntryId: string) => void;
  onBranch: (treeEntryId: string) => void;
  /** Which edge of the trigger the dropdown aligns to. 'left' opens rightward, 'right' opens leftward. */
  anchor?: 'left' | 'right';
  /** False for the current leaf (latest message), where a rewind would be a no-op. */
  canBranch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={e => {
          e.stopPropagation();
          setOpen(v => !v);
        }}
        className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
        title="Message actions"
        aria-label="Message actions"
      >
        <MoreHorizontal size={14} strokeWidth={1.75} />
      </button>

      {open && (
        <div
          className={`absolute ${anchor === 'left' ? 'left-0' : 'right-0'} bottom-7 z-50 min-w-[200px] rounded-lg border border-border bg-popover shadow-md py-1 text-sm`}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
            onClick={e => {
              e.stopPropagation();
              setOpen(false);
              onFork(treeEntryId);
            }}
          >
            <GitFork size={14} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground" />
            <span>Fork into new session</span>
          </button>
          <button
            disabled={!canBranch}
            title={
              canBranch ? undefined : 'Already at the latest point — branch from an earlier message'
            }
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            onClick={e => {
              e.stopPropagation();
              if (!canBranch) return;
              setOpen(false);
              onBranch(treeEntryId);
            }}
          >
            <GitBranch
              size={14}
              strokeWidth={1.75}
              className="flex-shrink-0 text-muted-foreground"
            />
            <span>Branch from here (rewind)</span>
          </button>
        </div>
      )}
    </div>
  );
}

const MessageItem = memo(function MessageItem({
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
            <ThinkingBlocksCard blocks={metadataThinkingBlocks} />
          </div>
        )}
        {shouldRenderFallbackContent && (
          <div className="rounded-2xl px-3 md:px-4 py-2 mb-2 w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-card text-card-foreground min-w-0">
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
          <ThinkingBlocksCard blocks={metadataThinkingBlocks} />
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
            ? 'max-w-[85%] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-muted/60 text-foreground shadow-apple-sm'
            : isSystem
              ? 'max-w-[85%] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-muted text-muted-foreground text-sm'
              : 'w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-card text-card-foreground min-w-0'
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
            className="text-xs px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 disabled:cursor-not-allowed"
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

/** Renders assistant message markdown (thinking blocks already extracted at MessageItem level) */
const AssistantContent = memo(function AssistantContent({ content }: { content: string }) {
  // Throttle the string that drives the (expensive) markdown parse; the raw
  // prop still updates every frame so streaming stays smooth.
  const renderContent = useAnimationFrameThrottle(content);
  const normalizedContent = useMemo(
    () => normalizeMarkdownForRender(renderContent),
    [renderContent]
  );
  const fileRef = useContext(FileRefContext);

  useEffect(() => {
    logSuspiciousMarkdownRender(renderContent, normalizedContent);
  }, [renderContent, normalizedContent]);

  return (
    <>
      <div className="prose dark:prose-invert prose-sm max-w-none min-w-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const codeText = String(children);
              const isInline = !match && !codeText.includes('\n');

              if (isInline) {
                const trimmed = codeText.trim();
                if (INLINE_FILE_REF_REGEX.test(trimmed)) {
                  return (
                    <FileLineReference
                      text={trimmed}
                      projectRoot={fileRef.projectRoot}
                      backendId={fileRef.backendId}
                    />
                  );
                }
                return (
                  <code
                    className="bg-secondary px-1.5 py-0.5 rounded-md text-primary break-all"
                    {...props}
                  >
                    {hasInlineMarkdownIcon(codeText) ? (
                      <TextWithInlineMarkdownIcons text={codeText} />
                    ) : (
                      children
                    )}
                  </code>
                );
              }

              const language = match ? match[1] : 'text';
              const codeString = String(children).replace(/\n$/, '');

              return <CodeBlock language={language}>{codeString}</CodeBlock>;
            },
            pre({ children }) {
              return <>{children}</>;
            },
            a({ href, children }) {
              return <ChatLink href={href}>{children}</ChatLink>;
            },
            table({ children }) {
              return (
                <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch]">
                  <table className="w-max min-w-full border-collapse border border-border">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="border border-border px-3 py-2 bg-secondary text-left align-top whitespace-pre-wrap break-words">
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </th>
              );
            },
            td({ children }) {
              return (
                <td className="border border-border px-3 py-2 align-top whitespace-pre-wrap break-words">
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </td>
              );
            },
            h1({ children }) {
              return (
                <h1>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </h1>
              );
            },
            h2({ children }) {
              return (
                <h2>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </h2>
              );
            },
            h3({ children }) {
              return (
                <h3>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </h3>
              );
            },
            h4({ children }) {
              return (
                <h4>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </h4>
              );
            },
            h5({ children }) {
              return (
                <h5>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </h5>
              );
            },
            h6({ children }) {
              return (
                <h6>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </h6>
              );
            },
            p({ children }) {
              return (
                <p>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </p>
              );
            },
            li({ children }) {
              return (
                <li>
                  <MarkdownChildrenWithFileRefs>{children}</MarkdownChildrenWithFileRefs>
                </li>
              );
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    </>
  );
});
