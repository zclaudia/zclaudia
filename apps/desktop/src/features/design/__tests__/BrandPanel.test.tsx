import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrandPanel } from '../components/BrandPanel';
import type { BrandPanelProps } from '../components/BrandPanel';
import { DesignHttpError, getDesignBrand, listDesignAssets, putDesignBrand } from '../api';
import type { DesignBrand } from '../api';
import { relativeAssetRef } from '../asset-ref';
import { renderDesignMd, renderTokensCss } from '../brand';
import type { BrandSpec } from '../brand';

vi.mock('../api', () => {
  class DesignHttpError extends Error {
    constructor(
      message: string,
      readonly code: string | undefined,
      readonly files: string[] = []
    ) {
      super(message);
      this.name = 'DesignHttpError';
    }
  }
  return {
    DesignHttpError,
    getDesignBrand: vi.fn(),
    putDesignBrand: vi.fn(),
    listDesignAssets: vi.fn(),
    // 与实现一致：按类实例判别，让 REVISION_CONFLICT 分流可测。
    isDesignHttpError: (error: unknown): error is DesignHttpError =>
      error instanceof DesignHttpError,
  };
});

const EMPTY_BRAND: DesignBrand = {
  designMd: null,
  tokensCss: null,
  designMdRevision: null,
  tokensCssRevision: null,
};

const EXISTING_BRAND: DesignBrand = {
  designMd: '# 品牌与设计系统\n\n（磁盘内容）\n',
  tokensCss: ':root {\n  --color-primary: #4f46e5;\n}\n',
  designMdRevision: 'rev-md',
  tokensCssRevision: 'rev-css',
};

/** 测试里逐项填入的规格（与组件默认值解耦，专测表单 → 渲染 → PUT 接线）。 */
const SPEC: BrandSpec = {
  primary: '#2563eb',
  secondary: '#0ea5e9',
  background: '#f8fafc',
  text: '#111827',
  fontBody: 'Inter, sans-serif',
  fontHeading: 'Georgia, serif',
  spacingUnit: '4px',
  radius: 'lg',
  logoPath: '',
  notes: '保持克制。',
};

const COLOR_LABELS = { primary: '主色', secondary: '辅色', background: '背景', text: '文字' } as const;

function fillSpec(overrides: Partial<BrandSpec> = {}) {
  const spec = { ...SPEC, ...overrides };
  for (const key of ['primary', 'secondary', 'background', 'text'] as const) {
    fireEvent.change(screen.getByLabelText(COLOR_LABELS[key]), {
      target: { value: spec[key] },
    });
  }
  fireEvent.change(screen.getByLabelText('正文字体'), { target: { value: spec.fontBody } });
  fireEvent.change(screen.getByLabelText('标题字体'), { target: { value: spec.fontHeading } });
  fireEvent.change(screen.getByLabelText('间距基准'), { target: { value: spec.spacingUnit } });
  fireEvent.change(screen.getByLabelText('圆角'), { target: { value: spec.radius } });
  fireEvent.change(screen.getByLabelText('使用规则'), { target: { value: spec.notes } });
  return spec;
}

function mount(overrides: Partial<BrandPanelProps> = {}) {
  const props: BrandPanelProps = {
    open: true,
    backendId: 'remote-1',
    sessionId: 's1',
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  render(<BrandPanel {...props} />);
  return {
    onClose: props.onClose as ReturnType<typeof vi.fn>,
    onSaved: props.onSaved as ReturnType<typeof vi.fn>,
  };
}

describe('BrandPanel（P4 §3.4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDesignBrand).mockResolvedValue(EMPTY_BRAND);
    vi.mocked(putDesignBrand).mockResolvedValue({
      designMdRevision: 'new-md-rev',
      tokensCssRevision: 'new-css-rev',
    });
    vi.mocked(listDesignAssets).mockResolvedValue({ files: [] });
  });

  it('两文件都缺失时进入表单模式，加载中显示状态文案', async () => {
    let resolveBrand!: (value: DesignBrand) => void;
    vi.mocked(getDesignBrand).mockImplementation(
      () => new Promise(resolve => (resolveBrand = resolve))
    );
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('正在加载品牌文件…');
    await act(async () => {
      resolveBrand(EMPTY_BRAND);
    });
    expect(await screen.findByText('生成 design/DESIGN.md 与 design/tokens.css 两个品牌文件；Agent 修改页面时会读取它们。')).toBeInTheDocument();
    expect(screen.getByLabelText('主色')).toBeInTheDocument();
    expect(screen.getByLabelText('标题字体')).toBeInTheDocument();
    expect(screen.getByLabelText('圆角')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成品牌文件' })).toBeInTheDocument();
    expect(screen.queryByLabelText('DESIGN.md 内容')).not.toBeInTheDocument();
    expect(getDesignBrand).toHaveBeenCalledWith('remote-1', 's1');
  });

  it('任一文件存在时进入文本模式，textarea 以 GET 内容初始化', async () => {
    vi.mocked(getDesignBrand).mockResolvedValue(EXISTING_BRAND);
    const { onSaved } = mount();
    expect(await screen.findByText('直接编辑品牌文件；保存前会校验文件未被外部修改。')).toBeInTheDocument();
    expect(screen.getByLabelText('DESIGN.md 内容')).toHaveValue(EXISTING_BRAND.designMd);
    expect(screen.getByLabelText('tokens.css 内容')).toHaveValue(EXISTING_BRAND.tokensCss);
    expect(screen.queryByLabelText('主色')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成品牌文件' })).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('表单校验失败：逐条显示中文错误，不发起 PUT', async () => {
    mount();
    await screen.findByLabelText('主色');
    fillSpec({ primary: 'not a color!!' });
    fireEvent.click(screen.getByRole('button', { name: '生成品牌文件' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('主色不是合法的 CSS 颜色');
    expect(putDesignBrand).not.toHaveBeenCalled();
  });

  it('表单成功创建：PUT 携带渲染结果与空修订，显示成功文案并触发 onSaved', async () => {
    const { onSaved } = mount();
    await screen.findByLabelText('主色');
    const spec = fillSpec();
    fireEvent.click(screen.getByRole('button', { name: '生成品牌文件' }));
    await waitFor(() =>
      expect(putDesignBrand).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        designMd: renderDesignMd(spec),
        designMdRevision: '',
        tokensCss: renderTokensCss(spec),
        tokensCssRevision: '',
      })
    );
    expect(
      await screen.findByText('品牌文件已创建：design/DESIGN.md、design/tokens.css')
    ).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('文本模式保存：只提交该文件键 + GET 修订，成功显示已保存并触发 onSaved', async () => {
    vi.mocked(getDesignBrand).mockResolvedValue(EXISTING_BRAND);
    const { onSaved } = mount();
    await screen.findByLabelText('tokens.css 内容');
    fireEvent.change(screen.getByLabelText('tokens.css 内容'), {
      target: { value: ':root {\n  --color-primary: #000000;\n}\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 tokens.css' }));
    await waitFor(() => expect(putDesignBrand).toHaveBeenCalledTimes(1));
    expect(putDesignBrand).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      tokensCss: ':root {\n  --color-primary: #000000;\n}\n',
      tokensCssRevision: 'rev-css',
    });
    const payload = vi.mocked(putDesignBrand).mock.calls[0][1];
    expect(payload).not.toHaveProperty('designMd');
    expect(payload).not.toHaveProperty('designMdRevision');
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('文本保存 REVISION_CONFLICT：提示重新加载，重拉后内容复位', async () => {
    vi.mocked(getDesignBrand).mockResolvedValue(EXISTING_BRAND);
    vi.mocked(putDesignBrand).mockRejectedValue(
      new DesignHttpError('修订不匹配', 'REVISION_CONFLICT')
    );
    mount();
    await screen.findByLabelText('DESIGN.md 内容');
    fireEvent.change(screen.getByLabelText('DESIGN.md 内容'), {
      target: { value: '# 改过的新内容\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 DESIGN.md' }));
    expect(await screen.findByText('文件已在其他位置更新，请重新加载')).toBeInTheDocument();
    expect(getDesignBrand).toHaveBeenCalledTimes(1);
    vi.mocked(getDesignBrand).mockResolvedValue({
      ...EXISTING_BRAND,
      designMd: '# 其他位置的更新\n',
    });
    fireEvent.click(screen.getByRole('button', { name: '重新加载 DESIGN.md' }));
    await waitFor(() => expect(getDesignBrand).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('DESIGN.md 内容')).toHaveValue('# 其他位置的更新\n');
  });

  it('Logo 从素材库选择：all 清单、以 design/ 为基准换算相对引用', async () => {
    vi.mocked(listDesignAssets).mockResolvedValue({
      files: ['design/assets/logo.svg', 'assets/logo.png'],
    });
    mount();
    await screen.findByLabelText('Logo 路径');
    fireEvent.click(screen.getByRole('button', { name: '从素材库选择…' }));
    expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'all');
    fireEvent.click(await screen.findByText('design/assets/logo.svg'));
    expect(screen.getByLabelText('Logo 路径')).toHaveValue(
      relativeAssetRef('design/index.html', 'design/assets/logo.svg')
    );
    expect(screen.getByLabelText('Logo 路径')).toHaveValue('assets/logo.svg');
    // 清单收起后再次打开；选择工作区其它目录的素材得到 ../ 前缀引用
    fireEvent.click(screen.getByRole('button', { name: '从素材库选择…' }));
    fireEvent.click(await screen.findByText('assets/logo.png'));
    expect(screen.getByLabelText('Logo 路径')).toHaveValue('../assets/logo.png');
  });

  it('素材清单为空显示空态；加载失败可重试', async () => {
    mount();
    await screen.findByLabelText('Logo 路径');
    vi.mocked(listDesignAssets).mockRejectedValueOnce(new Error('网络中断'));
    fireEvent.click(screen.getByRole('button', { name: '从素材库选择…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('素材清单加载失败');
    vi.mocked(listDesignAssets).mockResolvedValue({ files: [] });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('工作区暂无素材')).toBeInTheDocument();
    expect(listDesignAssets).toHaveBeenCalledTimes(2);
  });
});
