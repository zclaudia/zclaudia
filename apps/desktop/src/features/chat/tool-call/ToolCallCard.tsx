import { memo } from 'react';
import type { ToolCallView } from '@zclaudia/agent-transcript-kit';
import { ToolCallCard as KitToolCallCard } from '@zclaudia/agent-transcript-kit/react';
import { ToolExpandedContent } from './ToolExpandedContent';
import { toolCallEffect } from './toolCallView';

export interface ToolCallCardProps {
  toolCall: ToolCallView;
  /**
   * Host capability: move this running command to the background. Present ⇒
   * a running Bash card offers "Send to background".
   */
  onSendToBackground?: () => void;
  /** Host capability: paste a command into the terminal (expanded Bash view). */
  runInTerminal?: (command: string) => void;
}

/**
 * The shared card, with this app's expanded body.
 *
 * The kit owns the header, status, and collapse behavior; what stays here is
 * what is genuinely this app's — the tool-specific bodies (diffs, terminal
 * output, images, plugin-registered renderers) and the ToolEffect that rides
 * the kit's `ext` slot. The body is passed as a render prop so it is built
 * only when the card is open.
 */
export const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  onSendToBackground,
  runInTerminal,
}: ToolCallCardProps) {
  return (
    <KitToolCallCard
      toolCall={toolCall}
      onSendToBackground={onSendToBackground}
      renderExpanded={() => (
        <ToolExpandedContent
          toolName={toolCall.name}
          toolInput={toolCall.input}
          status={toolCall.status === 'running' ? 'running' : 'completed'}
          result={toolCall.result}
          isError={toolCall.status === 'error' || toolCall.status === 'cancelled'}
          semantic={toolCall.semantic}
          effect={toolCallEffect(toolCall)}
          runInTerminal={runInTerminal}
        />
      )}
    />
  );
});
