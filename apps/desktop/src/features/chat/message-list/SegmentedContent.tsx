import { useState, useMemo, memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { ToolCallList } from '../tool-call/ToolCallList';
import type { ContentBlock } from '@zclaudia/shared/core/message';
import type { ToolCallState } from '../../../stores/runStore';
import { extractThinking } from '../../../utils/messageContent';
import { ThinkingBlock } from '@zclaudia/agent-transcript-kit/react';
import { AssistantContent } from './AssistantContent';

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
export const SegmentedContent = memo(function SegmentedContent({
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
              <div className="zc-assistant-bubble rounded-2xl px-3 md:px-4 py-2 w-full max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-card text-card-foreground min-w-0">
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
