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
  designMd: '# Brand & Design System\n\n(disk content)\n',
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

const COLOR_LABELS = { primary: 'Primary', secondary: 'Secondary', background: 'Background', text: 'Text' } as const;

function fillSpec(overrides: Partial<BrandSpec> = {}) {
  const spec = { ...SPEC, ...overrides };
  for (const key of ['primary', 'secondary', 'background', 'text'] as const) {
    fireEvent.change(screen.getByLabelText(COLOR_LABELS[key]), {
      target: { value: spec[key] },
    });
  }
  fireEvent.change(screen.getByLabelText('Body font'), { target: { value: spec.fontBody } });
  fireEvent.change(screen.getByLabelText('Heading font'), { target: { value: spec.fontHeading } });
  fireEvent.change(screen.getByLabelText('Spacing base'), { target: { value: spec.spacingUnit } });
  fireEvent.change(screen.getByLabelText('Corner radius'), { target: { value: spec.radius } });
  fireEvent.change(screen.getByLabelText('Usage rules'), { target: { value: spec.notes } });
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
    expect(screen.getByRole('status')).toHaveTextContent('Loading brand files…');
    await act(async () => {
      resolveBrand(EMPTY_BRAND);
    });
    expect(
      await screen.findByText(
        'Generates two brand files, design/DESIGN.md and design/tokens.css; the Agent reads them when editing pages.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Primary')).toBeInTheDocument();
    expect(screen.getByLabelText('Heading font')).toBeInTheDocument();
    expect(screen.getByLabelText('Corner radius')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate brand files' })).toBeInTheDocument();
    expect(screen.queryByLabelText('DESIGN.md content')).not.toBeInTheDocument();
    expect(getDesignBrand).toHaveBeenCalledWith('remote-1', 's1');
  });

  it('任一文件存在时进入文本模式，textarea 以 GET 内容初始化', async () => {
    vi.mocked(getDesignBrand).mockResolvedValue(EXISTING_BRAND);
    const { onSaved } = mount();
    expect(
      await screen.findByText(
        'Edit the brand files directly; saving checks that they were not modified externally.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('DESIGN.md content')).toHaveValue(EXISTING_BRAND.designMd);
    expect(screen.getByLabelText('tokens.css content')).toHaveValue(EXISTING_BRAND.tokensCss);
    expect(screen.queryByLabelText('Primary')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate brand files' })).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('表单校验失败：逐条显示中文错误，不发起 PUT', async () => {
    mount();
    await screen.findByLabelText('Primary');
    fillSpec({ primary: 'not a color!!' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate brand files' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Primary is not a valid CSS color');
    expect(putDesignBrand).not.toHaveBeenCalled();
  });

  it('表单成功创建：PUT 携带渲染结果与空修订，显示成功文案并触发 onSaved', async () => {
    const { onSaved } = mount();
    await screen.findByLabelText('Primary');
    const spec = fillSpec();
    fireEvent.click(screen.getByRole('button', { name: 'Generate brand files' }));
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
      await screen.findByText('Brand files created: design/DESIGN.md, design/tokens.css')
    ).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('文本模式保存：只提交该文件键 + GET 修订，成功显示已保存并触发 onSaved', async () => {
    vi.mocked(getDesignBrand).mockResolvedValue(EXISTING_BRAND);
    const { onSaved } = mount();
    await screen.findByLabelText('tokens.css content');
    fireEvent.change(screen.getByLabelText('tokens.css content'), {
      target: { value: ':root {\n  --color-primary: #000000;\n}\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tokens.css' }));
    await waitFor(() => expect(putDesignBrand).toHaveBeenCalledTimes(1));
    expect(putDesignBrand).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      tokensCss: ':root {\n  --color-primary: #000000;\n}\n',
      tokensCssRevision: 'rev-css',
    });
    const payload = vi.mocked(putDesignBrand).mock.calls[0][1];
    expect(payload).not.toHaveProperty('designMd');
    expect(payload).not.toHaveProperty('designMdRevision');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('文本保存 REVISION_CONFLICT：提示重新加载，重拉后内容复位', async () => {
    vi.mocked(getDesignBrand).mockResolvedValue(EXISTING_BRAND);
    vi.mocked(putDesignBrand).mockRejectedValue(
      new DesignHttpError('修订不匹配', 'REVISION_CONFLICT')
    );
    mount();
    await screen.findByLabelText('DESIGN.md content');
    fireEvent.change(screen.getByLabelText('DESIGN.md content'), {
      target: { value: '# 改过的新内容\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save DESIGN.md' }));
    expect(await screen.findByText('The file was updated elsewhere; reload it')).toBeInTheDocument();
    expect(getDesignBrand).toHaveBeenCalledTimes(1);
    vi.mocked(getDesignBrand).mockResolvedValue({
      ...EXISTING_BRAND,
      designMd: '# 其他位置的更新\n',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reload DESIGN.md' }));
    await waitFor(() => expect(getDesignBrand).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('DESIGN.md content')).toHaveValue('# 其他位置的更新\n');
  });

  it('Logo 从素材库选择：all 清单、以 design/ 为基准换算相对引用', async () => {
    vi.mocked(listDesignAssets).mockResolvedValue({
      files: ['design/assets/logo.svg', 'assets/logo.png'],
    });
    mount();
    await screen.findByLabelText('Logo path');
    fireEvent.click(screen.getByRole('button', { name: 'Choose from asset library…' }));
    expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'all');
    fireEvent.click(await screen.findByText('design/assets/logo.svg'));
    expect(screen.getByLabelText('Logo path')).toHaveValue(
      relativeAssetRef('design/index.html', 'design/assets/logo.svg')
    );
    expect(screen.getByLabelText('Logo path')).toHaveValue('assets/logo.svg');
    // 清单收起后再次打开；选择工作区其它目录的素材得到 ../ 前缀引用
    fireEvent.click(screen.getByRole('button', { name: 'Choose from asset library…' }));
    fireEvent.click(await screen.findByText('assets/logo.png'));
    expect(screen.getByLabelText('Logo path')).toHaveValue('../assets/logo.png');
  });

  it('素材清单为空显示空态；加载失败可重试', async () => {
    mount();
    await screen.findByLabelText('Logo path');
    vi.mocked(listDesignAssets).mockRejectedValueOnce(new Error('网络中断'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose from asset library…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the asset list');
    vi.mocked(listDesignAssets).mockResolvedValue({ files: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No assets in the workspace yet')).toBeInTheDocument();
    expect(listDesignAssets).toHaveBeenCalledTimes(2);
  });
});
