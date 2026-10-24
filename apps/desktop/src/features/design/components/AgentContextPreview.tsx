import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import type { AgentContextSection, AgentContextTask } from '../agent-context';

const TASK_TITLE: Record<AgentContextTask, string> = {
  generate: 'Generate page · design context',
  modify: 'Hand off to Agent · design context',
};

const INTRO_NOTICE =
  'The following content will be sent with your instruction in the current chat; you can add more in the input box.';
const PROMPT_LABEL = 'Instruction to be filled into the chat';

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
            Fill into chat
          </Button>
          <Button size="sm" onClick={onClose}>
            Cancel
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
