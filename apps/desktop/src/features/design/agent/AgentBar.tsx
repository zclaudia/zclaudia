import { useState } from 'react';
import { ArrowUp, ChevronDown, MousePointer2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { ContextPopover } from './ContextPopover';
import type { AgentContextPayload } from '../hooks/useAgentHandoff';
import type { DesignSelection } from '../types';

export interface AgentBarProps {
  selection: DesignSelection | null;
  /** `tag.class` when a class is known; otherwise the tag, or `Page`. */
  chipLabel?: string;
  dirty: boolean;
  busy: boolean;
  runMode: boolean;
  /** 窄档：贴底并占满可用宽度（mockup narrow）。 */
  compact?: boolean;
  /** 就地保存（dirty 时的安全出口）。 */
  onSave: () => void;
  /** 预填到当前聊天（保留发送前可检查的语义）。 */
  onPrefill: (prompt: string) => void;
  /** 组装上下文；request 为空时输出与既有快照逐字节一致。 */
  buildContext: (request: string) => AgentContextPayload;
}

/**
 * 画布底部 Agent 输入条（P3 §4.7）：选区 chip + 输入框 + Context popover +
 * 发送。有选区 → modify；无选区 → generate，有活动页时指向该页、空白工作台
 * 才回退 design/index.html。dirty 时禁用并就地提示保存；运行模式整条隐藏。
 * 空输入允许发送（页面指令）；仍然只预填、不自动发送。
 */
export function AgentBar({
  selection,
  chipLabel,
  dirty,
  busy,
  runMode,
  compact = false,
  onSave,
  onPrefill,
  buildContext,
}: AgentBarProps) {
  const [input, setInput] = useState('');
  const [contextOpen, setContextOpen] = useState(false);

  if (runMode) return null;

  const disabled = dirty || busy;
  const preview = contextOpen ? buildContext(input) : null;

  const submit = () => {
    if (disabled) return;
    const payload = buildContext(input);
    onPrefill(payload.prompt);
    setInput('');
    setContextOpen(false);
  };

  return (
    <div
      data-testid="design-agent-bar"
      className={`absolute left-1/2 z-dropdown -translate-x-1/2 ${
        compact ? 'bottom-2 w-[calc(100%-16px)]' : 'bottom-4 w-[min(560px,calc(100%-32px))]'
      }`}
    >
      <div className="relative">
        <ContextPopover
          open={contextOpen && preview !== null}
          sections={preview?.sections ?? []}
          prompt={preview?.prompt ?? ''}
        />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl border border-border/60 bg-popover/95 p-1.5 pl-2 shadow-apple-lg glass">
        <Tooltip content={selection ? 'Selected element' : 'Whole page'}>
          <span
            className={`inline-flex h-6 shrink-0 items-center gap-1 truncate rounded-md bg-secondary px-2 font-mono text-[11px] text-foreground ${
              compact ? 'max-w-[90px]' : 'max-w-[150px]'
            }`}
          >
            <MousePointer2 size={11} strokeWidth={1.75} className="shrink-0" />
            {chipLabel ?? (selection ? selection.tagName.toLowerCase() : 'Page')}
          </span>
        </Tooltip>
        <input
          aria-label="Ask Agent"
          value={input}
          disabled={disabled}
          placeholder={
            selection ? 'Describe how to change this element…' : 'Describe what to build or change…'
          }
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="h-6 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        {dirty ? (
          <>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Save first to hand off
            </span>
            <Button
              size="sm"
              variant="outline"
              aria-label="Save before hand off"
              className="shrink-0"
              onClick={onSave}
              disabled={busy}
            >
              Save
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              aria-label="Preview context"
              aria-expanded={contextOpen}
              className="shrink-0 text-muted-foreground"
              onClick={() => setContextOpen(open => !open)}
            >
              Context
              <ChevronDown size={11} strokeWidth={1.75} />
            </Button>
            <Tooltip content="Prefill into chat">
              <Button
                size="sm"
                variant="primary"
                aria-label="Send to chat"
                className="h-7 w-7 shrink-0 px-0"
                onClick={submit}
                disabled={busy}
              >
                <ArrowUp size={14} strokeWidth={1.75} />
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
