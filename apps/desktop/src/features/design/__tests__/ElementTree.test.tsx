import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ElementTree } from '../components/ElementTree';
import { buildElementTree, type ElementTreeNode } from '../element-tree';

// buildElementTree 换成可注入的透传 mock：默认走真实实现，仅截断用例注入迷你树
// （真实截断需要 1 万节点，逐行渲染代价过高——树的构建已由 element-tree.test.ts 锁死）。
vi.mock('../element-tree', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    buildElementTree: vi.fn(actual.buildElementTree as typeof buildElementTree),
  };
});

const onSelect = vi.fn();

const TREE_SOURCE = `<html><body>
  <main id="root" class="layout wide extra fourth">
    <h1>Hello tree</h1>
    <p class="intro">This preview text is longer than forty characters in total.</p>
  </main>
  <svg viewBox="0 0 10 10"><g><text>hi</text></g></svg>
</body></html>`;

const NESTED_SOURCE =
  '<body><div id="a"><div id="b"><div id="c"><p id="d">deep text</p></div></div></div></body>';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ElementTree', () => {
  it('renders rows with tag, id, up to three classes and the truncated text preview', () => {
    render(<ElementTree source={TREE_SOURCE} selectionPath={null} onSelectPath={onSelect} />);
    expect(screen.getByText('结构树由页面源码构建；伪元素与脚本生成的内容不会出现在这里。')).toBeInTheDocument();
    expect(screen.getByText('<main>')).toBeInTheDocument();
    expect(screen.getByText('#root')).toBeInTheDocument();
    expect(screen.getByText('.layout')).toBeInTheDocument();
    expect(screen.getByText('.wide')).toBeInTheDocument();
    expect(screen.getByText('.extra')).toBeInTheDocument();
    // class 超出 3 个被省略。
    expect(screen.queryByText('.fourth')).not.toBeInTheDocument();
    expect(screen.getByText('Hello tree')).toBeInTheDocument();
    // textPreview 截到 40 字符。
    expect(screen.getByText('This preview text is longer than forty c')).toBeInTheDocument();
  });

  it('clicking a row calls onSelectPath with the node path', () => {
    render(<ElementTree source={TREE_SOURCE} selectionPath={null} onSelectPath={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '选中 main 0' }));
    expect(onSelect).toHaveBeenCalledWith([0]);
    fireEvent.click(screen.getByRole('button', { name: '选中 h1 0.0' }));
    expect(onSelect).toHaveBeenCalledWith([0, 0]);
  });

  it('highlights the row whose path deeply equals the selection path', () => {
    render(<ElementTree source={TREE_SOURCE} selectionPath={[0, 0]} onSelectPath={onSelect} />);
    expect(screen.getByRole('button', { name: '选中 h1 0.0' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: '选中 main 0' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '选中 p 0.1' })).not.toHaveAttribute('aria-current');
  });

  it('renders the svg-subtree reason for svg rows', () => {
    render(<ElementTree source={TREE_SOURCE} selectionPath={null} onSelectPath={onSelect} />);
    const svgRow = screen.getByRole('button', { name: '选中 svg 1' });
    expect(within(svgRow).getByText('SVG 内容仅支持文字、样式与结构调整')).toBeInTheDocument();
    // svg 子树内的行照常展开渲染（g 是 svg 行的兄弟行）。
    expect(screen.getByText('<g>')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选中 g 1.0' })).toBeInTheDocument();
  });

  it('renders the implicit reason for parse5-implied rows', () => {
    render(
      <ElementTree source="<body><table><tr><td>cell</td></tr></table></body>" selectionPath={null} onSelectPath={onSelect} />
    );
    const tbodyRow = screen.getByRole('button', { name: '选中 tbody 0.0' });
    expect(within(tbodyRow).getByText('源码中无显式标签')).toBeInTheDocument();
  });

  it('renders the deep reason on the row at the bridge depth limit', () => {
    const source = `<body>${'<div>'.repeat(64)}leaf${'</div>'.repeat(64)}</body>`;
    render(<ElementTree source={source} selectionPath={null} onSelectPath={onSelect} />);
    // 默认只展开前两层：逐层展开到第 64 层。
    for (let depth = 3; depth <= 63; depth += 1) {
      fireEvent.click(screen.getByRole('button', { name: `展开 ${Array(depth).fill(0).join('.')}` }));
    }
    const deepRow = screen.getByRole('button', {
      name: `选中 div ${Array(64).fill(0).join('.')}`,
    });
    expect(within(deepRow).getByText('层级超出预览桥接上限')).toBeInTheDocument();
    // deep 子树不再展开：没有第 65 层的行。
    expect(
      screen.queryByRole('button', { name: `选中 div ${Array(65).fill(0).join('.')}` })
    ).not.toBeInTheDocument();
  });

  it('collapses and expands nodes with the default first two layers expanded', () => {
    render(<ElementTree source={NESTED_SOURCE} selectionPath={null} onSelectPath={onSelect} />);
    // 前两层节点默认展开（第三层可见）；第三层节点默认收起（第四层不可见）。
    expect(screen.getByRole('button', { name: '选中 div 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选中 div 0.0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选中 div 0.0.0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选中 p 0.0.0.0' })).not.toBeInTheDocument();

    // 收起第一层：整棵子树隐藏。
    fireEvent.click(screen.getByRole('button', { name: '收起 0' }));
    expect(screen.queryByRole('button', { name: '选中 div 0.0' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选中 div 0.0.0' })).not.toBeInTheDocument();
    // 再展开恢复。
    fireEvent.click(screen.getByRole('button', { name: '展开 0' }));
    expect(screen.getByRole('button', { name: '选中 div 0.0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选中 div 0.0.0' })).toBeInTheDocument();

    // 展开第三层节点后第四层可见，点击上抛路径。
    fireEvent.click(screen.getByRole('button', { name: '展开 0.0.0' }));
    expect(screen.getByRole('button', { name: '选中 p 0.0.0.0' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选中 p 0.0.0.0' }));
    expect(onSelect).toHaveBeenCalledWith([0, 0, 0, 0]);
  });

  it('marks a truncated node with the truncation label', () => {
    const truncatedNode: ElementTreeNode = {
      path: [0],
      tagName: 'section',
      id: null,
      classes: [],
      textPreview: '',
      capability: 'editable',
      children: [],
      truncated: true,
    };
    vi.mocked(buildElementTree).mockImplementationOnce(() => [truncatedNode]);
    render(<ElementTree source="<body><section></section></body>" selectionPath={null} onSelectPath={onSelect} />);
    const sectionRow = screen.getByRole('button', { name: '选中 section 0' });
    expect(within(sectionRow).getByText('…（已截断）')).toBeInTheDocument();
  });
});
