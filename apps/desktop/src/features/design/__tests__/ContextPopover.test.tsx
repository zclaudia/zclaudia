import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ContextSections } from '../agent/ContextSections';
import { ContextPopover } from '../agent/ContextPopover';
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

const PROMPT = '## Workspace\n\n- Working directory: /tmp/demo\n\nCreate or update a page.';

describe('ContextSections / ContextPopover（P3 上下文预览）', () => {
  it('sections 逐项渲染标题与行内容，Brand 原文照展示', () => {
    render(<ContextSections sections={SECTIONS} prompt={PROMPT} />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText(/unsaved local draft/)).toBeInTheDocument();
    const workspaceBlock = screen.getByText('Workspace').parentElement as HTMLElement;
    expect(within(workspaceBlock).getByText('- Working directory: /tmp/demo')).toBeInTheDocument();
    const brandBlock = screen.getByText('Brand rules (design/DESIGN.md)')
      .parentElement as HTMLElement;
    expect(within(brandBlock).getByText(/# 品牌规范/)).toBeInTheDocument();
    expect(within(brandBlock).getByText(/主色 #2563eb/)).toBeInTheDocument();
  });

  it('prompt 全文在「Instruction to be filled into the chat」下可见', () => {
    render(<ContextSections sections={SECTIONS} prompt={PROMPT} />);
    expect(screen.getByText('Instruction to be filled into the chat')).toBeInTheDocument();
    expect(screen.getByText(/## Workspace[\s\S]*Create or update a page\./)).toBeInTheDocument();
  });

  it('ContextPopover open=false 不渲染；open 时以 dialog 呈现 sections 与 prompt', () => {
    const view = render(<ContextPopover open={false} sections={SECTIONS} prompt={PROMPT} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(<ContextPopover open sections={SECTIONS} prompt={PROMPT} />);
    const dialog = screen.getByRole('dialog', { name: 'Agent context' });
    expect(within(dialog).getByText('Pages')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Sent with your instruction — review before sending')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/## Workspace[\s\S]*Create or update a page\./)
    ).toBeInTheDocument();
  });

  it('ContextPopover 只展示，不提供发送按钮（发送语义仍在 AgentBar）', () => {
    render(<ContextPopover open sections={SECTIONS} prompt={PROMPT} />);
    expect(screen.queryByRole('button', { name: 'Fill into chat' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
  });
});
