import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import type { AgentContextSection, AgentContextTask } from '../agent-context';

const TASK_TITLE: Record<AgentContextTask, string> = {
  generate: '生成页面 · 设计上下文',
  modify: '交给 Agent 修改 · 设计上下文',
};

const INTRO_NOTICE = '以下内容将随指令进入当前聊天，可在输入框继续补充。';
const PROMPT_LABEL = '将填入聊天的指令';

export interface AgentContextPreviewProps {
  open: boolean;
  /** 上下文 sections（buildDesignAgentContext 的确定性输出）。 */
  sections: AgentContextSection[];
  /** 将填入聊天的完整英文指令。 */
  prompt: string;
  task: AgentContextTask;
  onClose: () => void;
  /** 「填入聊天」：交由面板执行既有 prefill(prompt)。 */
  onConfirm: () => void;
}

/**
 * 发送前检视模态（P4 §5.2）：列出将随指令进入聊天的全部上下文 sections
 * 与 prompt 全文，用户确认后才「填入聊天」。只做展示，不组装上下文。
 */
export function AgentContextPreview({
  open,
  sections,
  prompt,
  task,
  onClose,
  onConfirm,
}: AgentContextPreviewProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={TASK_TITLE[task]}
      title={TASK_TITLE[task]}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="primary" onClick={onConfirm}>
            填入聊天
          </Button>
          <Button size="sm" onClick={onClose}>
            取消
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        <div className="text-muted-foreground">{INTRO_NOTICE}</div>
        {sections.map(section => (
          <div key={section.title} className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold text-foreground">{section.title}</div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border px-2 py-1.5 font-mono text-[11px] leading-relaxed">
              {section.lines.join('\n')}
            </pre>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold text-foreground">{PROMPT_LABEL}</div>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border px-2 py-1.5 font-mono text-[11px] leading-relaxed">
            {prompt}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
