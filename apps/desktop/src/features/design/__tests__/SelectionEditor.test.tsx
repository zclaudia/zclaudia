import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SelectionEditor } from '../components/SelectionEditor';
import type { SelectionEditorProps } from '../components/SelectionEditor';
import { listDesignAssets } from '../api';
import type { DesignSelection } from '../types';

vi.mock('../api', () => ({
  listDesignAssets: vi.fn(),
}));

const openFileMock = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ openFile: openFileMock }) },
}));

/** h1（elementPath [0,0]）在第 4 行；div（elementPath [0]）跨第 3–5 行且有一个子元素。 */
const DRAFT = [
  '<html>',
  '  <body>',
  '    <div>',
  '      <h1>Hello</h1>',
  '    </div>',
  '  </body>',
  '</html>',
].join('\n');

/** body 下三个同级 section：结构按钮的上移/下移禁用态用真实兄弟关系断言。 */
const MULTI_DRAFT = [
  '<html>',
  '  <body>',
  '    <section id="first">One</section>',
  '    <section id="second">Two</section>',
  '    <section id="third">Three</section>',
  '  </body>',
  '</html>',
].join('\n');

const IMG_DRAFT = '<html><body><img src="old.png" alt="旧图"></body></html>';

const selection: DesignSelection = {
  elementPath: [0],
  tagName: 'div',
  text: 'Hello',
  sourceText: 'Hello',
  base: 'rev-1',
};

const imgSelection: DesignSelection = {
  elementPath: [0],
  tagName: 'img',
  text: '',
  sourceText: '',
  base: 'rev-1',
  attrs: { src: 'old.png', alt: '旧图' },
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
    sessionId: 'session-1',
    onApply: vi.fn(),
    onSelectPath: vi.fn(),
    ...overrides,
  };
  render(<SelectionEditor {...props} />);
  return { onApply: props.onApply, onSelectPath: props.onSelectPath };
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

describe('SelectionEditor 分组渲染（P3 §2.3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('div 选区渲染排版/尺寸/边框组，不渲染图片与链接组', () => {
    mount();
    expect(screen.getByLabelText('字号')).toBeInTheDocument();
    expect(screen.getByLabelText('外边距')).toBeInTheDocument();
    expect(screen.getByLabelText('边框样式')).toBeInTheDocument();
    expect(screen.queryByLabelText('图片地址')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('替代文本')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('链接地址')).not.toBeInTheDocument();
  });

  it('img 选区渲染图片组：src/alt/object-fit 与选择/清除按钮', () => {
    mount({ selection: imgSelection, docSource: IMG_DRAFT });
    expect(screen.getByLabelText('图片地址')).toBeInTheDocument();
    expect(screen.getByLabelText('替代文本')).toBeInTheDocument();
    expect(screen.getByLabelText('显示方式')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择图片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除图片地址' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除替代文本' })).toBeInTheDocument();
    expect(screen.queryByLabelText('链接地址')).not.toBeInTheDocument();
  });

  it('a 选区渲染链接组，不渲染图片组', () => {
    const aSelection: DesignSelection = {
      ...selection,
      tagName: 'a',
      attrs: { href: 'next.html' },
    };
    mount({ selection: aSelection });
    expect(screen.getByLabelText('链接地址')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除链接地址' })).toBeInTheDocument();
    expect(screen.queryByLabelText('图片地址')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('替代文本')).not.toBeInTheDocument();
  });
});

describe('SelectionEditor 初始值与内联徽标（P3 §2.3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('styles/attrs 预填表单', () => {
    const styled: DesignSelection = {
      ...imgSelection,
      styles: { 'font-size': '14px', 'text-align': 'center', width: 'auto' },
      attrs: { src: 'x.png', alt: '替代' },
    };
    mount({ selection: styled, docSource: IMG_DRAFT });
    expect(screen.getByLabelText('字号')).toHaveValue('14px');
    expect(screen.getByLabelText('对齐')).toHaveValue('center');
    expect(screen.getByLabelText('宽度')).toHaveValue('auto');
    expect(screen.getByLabelText('图片地址')).toHaveValue('x.png');
    expect(screen.getByLabelText('替代文本')).toHaveValue('替代');
  });

  it('对齐计算值不在选项内时 select 置空（不修改）', () => {
    const styled: DesignSelection = {
      ...selection,
      styles: { 'text-align': '-webkit-center' },
    };
    mount({ selection: styled });
    expect(screen.getByLabelText('对齐')).toHaveValue('');
  });

  it('inlineStyle 声明的属性带「内联」徽标，其余字段没有', () => {
    mount({ selection: { ...selection, inlineStyle: 'color: red; font-size: 16px' } });
    expect(screen.getByTestId('inline-badge-font-size')).toBeInTheDocument();
    expect(screen.getByTestId('inline-badge-color')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-badge-font-family')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inline-badge-background-color')).not.toBeInTheDocument();
  });
});

describe('SelectionEditor 应用修改（P3 §2.3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('字号+外边距+对齐一次提交三个 style 操作', () => {
    const { onApply } = mount();
    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '18px' } });
    fireEvent.change(screen.getByLabelText('外边距'), { target: { value: '8px 12px' } });
    fireEvent.change(screen.getByLabelText('对齐'), { target: { value: 'center' } });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([
      { kind: 'style', property: 'font-size', value: '18px' },
      { kind: 'style', property: 'text-align', value: 'center' },
      { kind: 'style', property: 'margin', value: '8px 12px' },
    ]);
  });

  it('非法值整单不提交，字段标红并显示「值无效：<label>」', () => {
    const { onApply } = mount();
    fireEvent.change(screen.getByLabelText('外边距'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText('值无效：外边距')).toBeInTheDocument();
    expect(screen.getByLabelText('外边距')).toHaveAttribute('aria-invalid', 'true');
  });

  it('对齐选回空 = 不修改，不生成操作', () => {
    const { onApply } = mount({ selection: { ...selection, styles: { 'text-align': 'center' } } });
    expect(screen.getByLabelText('对齐')).toHaveValue('center');
    fireEvent.change(screen.getByLabelText('对齐'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it('属性值预检失败（src 非法扩展名）同样阻断提交', () => {
    const { onApply } = mount({ selection: imgSelection, docSource: IMG_DRAFT });
    fireEvent.change(screen.getByLabelText('图片地址'), { target: { value: 'assets/a.txt' } });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText('值无效：图片地址')).toBeInTheDocument();
  });
});

describe('SelectionEditor 清除按钮（P3 §2.3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('字号 × 提交 style null 操作', () => {
    const { onApply } = mount({ selection: { ...selection, styles: { 'font-size': '14px' } } });
    fireEvent.click(screen.getByRole('button', { name: '清除字号' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ kind: 'style', property: 'font-size', value: null }]);
  });

  it('src 清除提交 attribute null 操作', () => {
    const { onApply } = mount({ selection: imgSelection, docSource: IMG_DRAFT });
    fireEvent.click(screen.getByRole('button', { name: '清除图片地址' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ kind: 'attribute', name: 'src', value: null }]);
  });
});

describe('SelectionEditor 导航（P3 §6.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('父级按钮提交 slice(0,-1) 路径', () => {
    const { onSelectPath } = mount({ selection: { ...selection, elementPath: [0, 0] } });
    fireEvent.click(screen.getByRole('button', { name: '父级' }));
    expect(onSelectPath).toHaveBeenCalledTimes(1);
    expect(onSelectPath).toHaveBeenCalledWith([0]);
  });

  it('子级按钮提交首子元素路径', () => {
    const { onSelectPath } = mount();
    fireEvent.click(screen.getByRole('button', { name: '子级' }));
    expect(onSelectPath).toHaveBeenCalledTimes(1);
    expect(onSelectPath).toHaveBeenCalledWith([0, 0]);
  });

  it('无子元素时子级禁用', () => {
    mount({ selection: { ...selection, elementPath: [0, 0] } });
    expect(screen.getByRole('button', { name: '子级' })).toBeDisabled();
  });

  it('根元素（body）父级禁用', () => {
    mount({ selection: { ...selection, elementPath: [] } });
    expect(screen.getByRole('button', { name: '父级' })).toBeDisabled();
  });

  it('onSelectPath 缺省时父级/子级都禁用', () => {
    mount({ onSelectPath: undefined });
    expect(screen.getByRole('button', { name: '父级' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '子级' })).toBeDisabled();
  });

  it('docSource 缺省时子级禁用，父级仍可用', () => {
    const { onSelectPath } = mount({ docSource: null, selection: { ...selection, elementPath: [0, 0] } });
    expect(screen.getByRole('button', { name: '子级' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '父级' }));
    expect(onSelectPath).toHaveBeenCalledWith([0]);
  });
});

describe('SelectionEditor 结构操作（P3 §6.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('复制/上移/下移各自提交对应 structure 操作', () => {
    const { onApply } = mount({
      docSource: MULTI_DRAFT,
      selection: { ...selection, elementPath: [1], tagName: 'section' },
    });
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(onApply).toHaveBeenLastCalledWith([{ kind: 'structure', action: 'duplicate' }]);
    fireEvent.click(screen.getByRole('button', { name: '上移' }));
    expect(onApply).toHaveBeenLastCalledWith([{ kind: 'structure', action: 'move-up' }]);
    fireEvent.click(screen.getByRole('button', { name: '下移' }));
    expect(onApply).toHaveBeenLastCalledWith([{ kind: 'structure', action: 'move-down' }]);
    expect(onApply).toHaveBeenCalledTimes(3);
  });

  it('首元素上移禁用、下移可用', () => {
    mount({ docSource: MULTI_DRAFT, selection: { ...selection, elementPath: [0] } });
    expect(screen.getByRole('button', { name: '上移' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移' })).toBeEnabled();
  });

  it('末元素下移禁用、上移可用', () => {
    mount({ docSource: MULTI_DRAFT, selection: { ...selection, elementPath: [2] } });
    expect(screen.getByRole('button', { name: '上移' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下移' })).toBeDisabled();
  });

  it('docSource 缺省时四个结构按钮全禁', () => {
    mount({ docSource: null, selection: { ...selection, elementPath: [1] } });
    for (const name of ['复制', '删除元素', '上移', '下移']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('elementPath 为空（body）时四个结构按钮全禁', () => {
    mount({ docSource: MULTI_DRAFT, selection: { ...selection, elementPath: [] } });
    for (const name of ['复制', '删除元素', '上移', '下移']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('busy 时结构按钮全禁', () => {
    mount({ busy: true, docSource: MULTI_DRAFT, selection: { ...selection, elementPath: [1] } });
    for (const name of ['复制', '删除元素', '上移', '下移']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('删除需再次点击确认：第一次不提交且按钮变化，第二次才提交', () => {
    const { onApply } = mount({
      docSource: MULTI_DRAFT,
      selection: { ...selection, elementPath: [1], tagName: 'section' },
    });
    const deleteButton = screen.getByRole('button', { name: '删除元素' });
    fireEvent.click(deleteButton);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '删除元素' })).toHaveTextContent('再次点击确认删除');
    fireEvent.click(screen.getByRole('button', { name: '删除元素' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ kind: 'structure', action: 'delete' }]);
  });

  it('删除确认 3 秒未再点自动复原', async () => {
    vi.useFakeTimers();
    const { onApply } = mount({
      docSource: MULTI_DRAFT,
      selection: { ...selection, elementPath: [1], tagName: 'section' },
    });
    fireEvent.click(screen.getByRole('button', { name: '删除元素' }));
    expect(screen.getByRole('button', { name: '删除元素' })).toHaveTextContent('再次点击确认删除');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('button', { name: '删除元素' })).toHaveTextContent(/^删除$/);
    fireEvent.click(screen.getByRole('button', { name: '删除元素' }));
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('SelectionEditor 图片选择（P3 §5.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sessionId 缺省时「选择…」禁用', () => {
    mount({ selection: imgSelection, docSource: IMG_DRAFT, sessionId: undefined });
    expect(screen.getByRole('button', { name: '选择图片' })).toBeDisabled();
  });

  it('点选清单项后 src 填入相对文档目录的引用', async () => {
    vi.mocked(listDesignAssets).mockResolvedValue({ files: ['assets/a.png', 'assets/img/b.png'] });
    const { onApply } = mount({ selection: imgSelection, docSource: IMG_DRAFT });
    fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
    expect(await screen.findByTestId('asset-list')).toBeInTheDocument();
    expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 'session-1');
    fireEvent.click(screen.getByRole('button', { name: 'assets/a.png' }));
    expect(screen.getByLabelText('图片地址')).toHaveValue('../assets/a.png');
    expect(screen.queryByTestId('asset-list')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('清单缓存于组件 state：再次打开不重复请求', async () => {
    vi.mocked(listDesignAssets).mockResolvedValue({ files: ['assets/a.png'] });
    mount({ selection: imgSelection, docSource: IMG_DRAFT });
    fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
    expect(await screen.findByRole('button', { name: 'assets/a.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'assets/a.png' }));
    fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
    expect(await screen.findByRole('button', { name: 'assets/a.png' })).toBeInTheDocument();
    expect(listDesignAssets).toHaveBeenCalledTimes(1);
  });

  it('拉取失败显示错误并可重试', async () => {
    vi.mocked(listDesignAssets).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(listDesignAssets).mockResolvedValueOnce({ files: ['assets/a.png'] });
    mount({ selection: imgSelection, docSource: IMG_DRAFT });
    fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('图片清单加载失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: 'assets/a.png' })).toBeInTheDocument();
  });
});
