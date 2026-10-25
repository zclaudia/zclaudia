import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Inspector } from '../inspector/Inspector';
import type { InspectorProps } from '../inspector/Inspector';
import type { DesignSelection } from '../types';

const SOURCE =
  '<html><body><main class="hero"><h1 id="t" class="title">Hello</h1></main></body></html>';
const SELECTION: DesignSelection = {
  elementPath: [0, 0],
  tagName: 'h1',
  text: 'Hello',
  sourceText: 'Hello',
};

function mount(overrides: Partial<InspectorProps> = {}) {
  const props: InspectorProps = {
    selection: SELECTION,
    docSource: SOURCE,
    rightTab: 'design',
    onRightTabChange: vi.fn(),
    onSelectPath: vi.fn(),
    collapsedSections: {},
    onToggleSection: vi.fn(),
    dirty: false,
    runMode: false,
    design: <div data-testid="pane-design">design pane</div>,
    styles: <div data-testid="pane-styles">styles pane</div>,
    history: <div data-testid="pane-history">history pane</div>,
    ...overrides,
  };
  render(<Inspector {...props} />);
  return {
    onRightTabChange: props.onRightTabChange as ReturnType<typeof vi.fn>,
    onSelectPath: props.onSelectPath as ReturnType<typeof vi.fn>,
  };
}

describe('Inspector（P2 检查器骨架）', () => {
  it('面包屑展示 body → main.hero → h1#t.title，点击段发 selectPath(prefix)', () => {
    const h = mount();
    expect(screen.getByRole('button', { name: 'Select body' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select main.hero' })).toBeInTheDocument();
    const current = screen.getByRole('button', { name: 'Select h1#t.title' });
    expect(current).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Select main.hero' }));
    expect(h.onSelectPath).toHaveBeenCalledWith([0]);
  });

  it('无选区时头部为 Inspector，Design 页签仍可渲染', () => {
    mount({ selection: null, docSource: null });
    expect(screen.getByText('Inspector')).toBeInTheDocument();
    expect(screen.getByTestId('pane-design')).toBeInTheDocument();
  });

  it('页签切换只隐藏非当前页签（内容保持挂载）', () => {
    const h = mount();
    expect(screen.getByTestId('pane-design')).toBeVisible();
    expect(screen.getByTestId('pane-styles')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Styles' }));
    expect(h.onRightTabChange).toHaveBeenCalledWith('styles');
  });

  it('History 页签首次访问后才挂载版本内容；dirty 时页签带状态点', () => {
    const view = render(
      <Inspector
        selection={null}
        docSource={null}
        rightTab="design"
        onRightTabChange={vi.fn()}
        onSelectPath={vi.fn()}
        collapsedSections={{}}
        onToggleSection={vi.fn()}
        dirty
        runMode={false}
        design={<div />}
        styles={<div />}
        history={<div data-testid="pane-history">history pane</div>}
      />
    );
    expect(screen.queryByTestId('pane-history')).not.toBeInTheDocument();
    view.rerender(
      <Inspector
        selection={null}
        docSource={null}
        rightTab="history"
        onRightTabChange={vi.fn()}
        onSelectPath={vi.fn()}
        collapsedSections={{}}
        onToggleSection={vi.fn()}
        dirty
        runMode={false}
        design={<div />}
        styles={<div />}
        history={<div data-testid="pane-history">history pane</div>}
      />
    );
    expect(screen.getByTestId('pane-history')).toBeInTheDocument();
    expect(screen.getByTestId('pane-history')).toBeVisible();
  });

  it('运行模式只显示只读说明，隐藏页签', () => {
    mount({ runMode: true });
    expect(screen.getByText('Run mode')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Inspector tabs' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('pane-design')).not.toBeInTheDocument();
  });

  it('窄档折叠为 peek，点击 Expand 上抛展开', () => {
    const onToggleCollapsed = vi.fn();
    mount({ narrow: true, collapsed: true, onToggleCollapsed });
    fireEvent.click(screen.getByRole('button', { name: 'Expand inspector' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
