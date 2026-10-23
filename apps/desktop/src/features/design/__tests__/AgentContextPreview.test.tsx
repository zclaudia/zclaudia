import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AgentContextPreview } from '../components/AgentContextPreview';
import type { AgentContextPreviewProps } from '../components/AgentContextPreview';
import type { AgentContextSection } from '../agent-context';

const SECTIONS: AgentContextSection[] = [
  { title: 'Workspace', lines: ['- Working directory: /tmp/demo'] },
  {
    title: 'Pages',
    lines: ['- design/index.html (disk rev ba7816bf8f01, unsaved local draft)'],
  },
  {
    title: 'Brand rules (design/DESIGN.md)',
    lines: ['# 品牌规范', '主色 #2563eb，正文使用系统无衬线字体。'],
  },
];

function mount(overrides: Partial<AgentContextPreviewProps> = {}) {
  const props: AgentContextPreviewProps = {
    open: true,
    sections: SECTIONS,
    prompt: '## Workspace\n\n- Working directory: /tmp/demo\n\nCreate or update a page.',
    task: 'generate',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  const harness = render(<AgentContextPreview {...props} />);
  return { onClose: props.onClose, onConfirm: props.onConfirm, unmount: harness.unmount };
}

describe('AgentContextPreview（P4 §5.2 检视模态）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('标题按 task 区分：generate 与 modify', () => {
    const first = mount({ task: 'generate' });
    expect(screen.getByRole('dialog', { name: '生成页面 · 设计上下文' })).toBeInTheDocument();
    first.unmount();
    mount({ task: 'modify' });
    expect(screen.getByRole('dialog', { name: '交给 Agent 修改 · 设计上下文' })).toBeInTheDocument();
  });

  it('顶部说明 + sections 逐项渲染（标题 + 行内容，Brand 原文照展示）', () => {
    mount();
    expect(screen.getByText('以下内容将随指令进入当前聊天，可在输入框继续补充。')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Workspace')).toBeInTheDocument();
    expect(within(dialog).getByText('Pages')).toBeInTheDocument();
    expect(within(dialog).getByText(/unsaved local draft/)).toBeInTheDocument();
    // Workspace section 行内容（限定在该 section 块内，避免与 prompt 全文重复命中）
    const workspaceBlock = within(dialog).getByText('Workspace').parentElement as HTMLElement;
    expect(within(workspaceBlock).getByText('- Working directory: /tmp/demo')).toBeInTheDocument();
    // Brand section 行内容照原文展示
    const brandBlock = within(dialog)
      .getByText('Brand rules (design/DESIGN.md)')
      .parentElement as HTMLElement;
    expect(within(brandBlock).getByText(/# 品牌规范/)).toBeInTheDocument();
    expect(within(brandBlock).getByText(/主色 #2563eb/)).toBeInTheDocument();
  });

  it('prompt 全文在「将填入聊天的指令」区可见', () => {
    mount();
    expect(screen.getByText('将填入聊天的指令')).toBeInTheDocument();
    expect(
      screen.getByText(/## Workspace[\s\S]*Create or update a page\./)
    ).toBeInTheDocument();
  });

  it('「填入聊天」触发 onConfirm，「取消」触发 onClose', () => {
    const { onConfirm, onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: '填入聊天' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('open=false 不渲染', () => {
    mount({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
