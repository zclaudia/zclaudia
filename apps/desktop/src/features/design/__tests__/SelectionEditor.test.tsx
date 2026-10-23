import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectionEditor } from '../components/SelectionEditor';
import type { SelectionEditorProps } from '../components/SelectionEditor';
import type { DesignSelection } from '../types';

const openFileMock = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ openFile: openFileMock }) },
}));

/** h1（elementPath [0,0]）在第 4 行；div（elementPath [0]）跨第 3–5 行。 */
const DRAFT = [
  '<html>',
  '  <body>',
  '    <div>',
  '      <h1>Hello</h1>',
  '    </div>',
  '  </body>',
  '</html>',
].join('\n');

const selection: DesignSelection = {
  elementPath: [0],
  tagName: 'div',
  text: 'Hello',
  sourceText: 'Hello',
  base: 'rev-1',
};

function mount(overrides: Partial<SelectionEditorProps> = {}) {
  const props: SelectionEditorProps = {
    selection,
    busy: false,
    overrideWarning: false,
    docSource: DRAFT,
    docPath: 'design/index.html',
    dirty: false,
    projectRoot: '/work',
    backendId: 'remote-1',
    onApply: vi.fn(),
    ...overrides,
  };
  render(<SelectionEditor {...props} />);
}

describe('SelectionEditor 查看源码（P2 §5.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有选区时点击查看源码，以草稿计算的行区间调用 openFile', () => {
    mount();
    const button = screen.getByRole('button', { name: '查看源码' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith('/work', 'design/index.html', 3, 5, 'remote-1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('elementLineRange 返回 null 时提示无法定位且不打开查看器', async () => {
    mount({ selection: { ...selection, sourceText: 'Mismatch' } });
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法定位源码位置');
    expect(openFileMock).not.toHaveBeenCalled();
  });

  it('活动页 dirty 时显示行号偏移提示，干净时不显示', () => {
    mount({ dirty: true });
    expect(
      screen.getByText('文件查看器显示已保存版本，行号以草稿计算可能有偏移')
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('干净页不显示偏移提示', () => {
    mount({ dirty: false });
    expect(
      screen.queryByText('文件查看器显示已保存版本，行号以草稿计算可能有偏移')
    ).not.toBeInTheDocument();
  });

  it('没有草稿源码时按钮禁用', () => {
    mount({ docSource: null });
    expect(screen.getByRole('button', { name: '查看源码' })).toBeDisabled();
  });

  it('无选区时不渲染查看源码按钮', () => {
    mount({ selection: null });
    expect(screen.queryByRole('button', { name: '查看源码' })).not.toBeInTheDocument();
  });
});
