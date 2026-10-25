import type { AgentContextSection } from '../agent-context';
import { ContextSections } from './ContextSections';

export interface ContextPopoverProps {
  open: boolean;
  sections: AgentContextSection[];
  prompt: string;
}

/**
 * Agent 输入条上方的上下文预览（P3 §4.7，取代原 AgentContextPreview Modal）：
 * 发送前可检查将随指令进入聊天的 sections 与 prompt 全文；仍只预填、不发送。
 */
export function ContextPopover({ open, sections, prompt }: ContextPopoverProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Agent context"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-[min(60vh,260px)] overflow-y-auto rounded-xl border border-border/60 bg-popover/95 p-3 shadow-apple-lg glass"
    >
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">
        Sent with your instruction — review before sending
      </div>
      <ContextSections sections={sections} prompt={prompt} compact />
    </div>
  );
}
