import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentBar } from '../agent/AgentBar';
import type { AgentBarProps } from '../agent/AgentBar';
import type { AgentContextPayload } from '../hooks/useAgentHandoff';
import type { DesignSelection } from '../types';

const selection: DesignSelection = {
  elementPath: [0],
  tagName: 'h1',
  text: 'Hello',
  sourceText: 'Hello',
};

function buildContext(request: string): AgentContextPayload {
  return {
    task: 'generate',
    sections: [{ title: 'Pages', lines: ['- design/index.html'] }],
    prompt: request
      ? `## Pages\n\n- design/index.html\n\n## Request\n\n${request}`
      : '## Pages\n\n- design/index.html',
  };
}

function mount(overrides: Partial<AgentBarProps> = {}) {
  const props: AgentBarProps = {
    selection: null,
    dirty: false,
    busy: false,
    runMode: false,
    onSave: vi.fn(),
    onPrefill: vi.fn(),
    buildContext: vi.fn(buildContext),
    ...overrides,
  };
  render(<AgentBar {...props} />);
  return {
    onSave: props.onSave as ReturnType<typeof vi.fn>,
    onPrefill: props.onPrefill as ReturnType<typeof vi.fn>,
    buildContext: props.buildContext as ReturnType<typeof vi.fn>,
  };
}

describe('AgentBar（P3 画布内联交接）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无选区显示 Page chip；有选区显示元素 tag', () => {
    mount();
    expect(screen.getByText('Page')).toBeInTheDocument();
    mount({ selection });
    expect(screen.getByText('<h1>')).toBeInTheDocument();
  });

  it('空输入也允许发送（等价默认提示词），发送后预填并清空输入', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }));
    expect(h.buildContext).toHaveBeenCalledWith('');
    expect(h.onPrefill).toHaveBeenCalledWith('## Pages\n\n- design/index.html');
    expect(screen.getByRole('textbox', { name: 'Ask Agent' })).toHaveValue('');
  });

  it('输入内容进入 request 段，Enter 发送', () => {
    const h = mount({ selection });
    const input = screen.getByRole('textbox', { name: 'Ask Agent' });
    fireEvent.change(input, { target: { value: 'Make it bold' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.buildContext).toHaveBeenCalledWith('Make it bold');
    expect(h.onPrefill).toHaveBeenCalledWith(
      '## Pages\n\n- design/index.html\n\n## Request\n\nMake it bold'
    );
  });

  it('Context 按钮打开/收起 popover，展示 sections 与 prompt', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
    const dialog = screen.getByRole('dialog', { name: 'Agent context' });
    expect(dialog).toHaveTextContent('Pages');
    expect(dialog).toHaveTextContent('## Pages');
    fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
    expect(screen.queryByRole('dialog', { name: 'Agent context' })).not.toBeInTheDocument();
  });

  it('dirty：输入禁用、内联提示保存、就地 Save 可用、不渲染发送按钮', () => {
    const h = mount({ dirty: true, selection });
    expect(screen.getByRole('textbox', { name: 'Ask Agent' })).toBeDisabled();
    expect(screen.getByText('Save first to hand off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to chat' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save before hand off' }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
  });

  it('busy 时禁用发送；运行模式整条隐藏', () => {
    mount({ busy: true });
    expect(screen.getByRole('textbox', { name: 'Ask Agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeDisabled();

    const view = render(
      <AgentBar
        selection={null}
        dirty={false}
        busy={false}
        runMode
        onSave={vi.fn()}
        onPrefill={vi.fn()}
        buildContext={buildContext}
      />
    );
    expect(view.container).toBeEmptyDOMElement();
  });
});
