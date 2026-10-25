import type { AgentContextSection } from '../agent-context';

export interface ContextSectionsProps {
  sections: AgentContextSection[];
  /** 将填入聊天的完整指令；省略时只展示 sections。 */
  prompt?: string;
  compact?: boolean;
}

/**
 * 上下文展示（P3）：Agent 输入条 popover 与原检视 Modal 共用的 sections 渲染。
 * 只做展示，不组装上下文；prompt 全文用等宽 pre 保持可检查性。
 */
export function ContextSections({ sections, prompt, compact = false }: ContextSectionsProps) {
  const maxHeight = compact ? 'max-h-24' : 'max-h-40';
  return (
    <div className="flex flex-col gap-2 text-xs">
      {sections.map(section => (
        <div key={section.title} className="flex flex-col gap-1">
          <div className="text-[11px] font-medium text-foreground">{section.title}</div>
          <pre
            className={`${maxHeight} overflow-y-auto whitespace-pre-wrap rounded-md border border-border px-2 py-1.5 font-mono text-[11px] leading-relaxed`}
          >
            {section.lines.join('\n')}
          </pre>
        </div>
      ))}
      {prompt !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-medium text-foreground">
            Instruction to be filled into the chat
          </div>
          <pre
            className={`${compact ? 'max-h-32' : 'max-h-72'} overflow-y-auto whitespace-pre-wrap rounded-md border border-border px-2 py-1.5 font-mono text-[11px] leading-relaxed`}
          >
            {prompt}
          </pre>
        </div>
      )}
    </div>
  );
}
