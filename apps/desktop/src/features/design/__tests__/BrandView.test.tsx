import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrandView } from '../rail/BrandView';
import type { BrandViewProps } from '../rail/BrandView';
import { getDesignBrand, listDesignAssets, putDesignBrand } from '../api';
import type { DesignBrand } from '../api';

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

function mount(overrides: Partial<BrandViewProps> = {}) {
  const props: BrandViewProps = {
    active: false,
    backendId: 'remote-1',
    sessionId: 's1',
    onSaved: vi.fn(),
    ...overrides,
  };
  const utils = render(<BrandView {...props} />);
  return {
    props,
    rerender: (next: Partial<BrandViewProps> = {}) =>
      utils.rerender(<BrandView {...props} {...next} />),
  };
}

describe('BrandView（P4c 内嵌语义）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDesignBrand).mockResolvedValue(EMPTY_BRAND);
    vi.mocked(putDesignBrand).mockResolvedValue({
      designMdRevision: 'new-md-rev',
      tokensCssRevision: 'new-css-rev',
    });
    vi.mocked(listDesignAssets).mockResolvedValue({ files: [] });
  });

  it('未激活不加载；首次激活只拉一次；隐藏/再显示保留表单草稿且不重拉', async () => {
    const { rerender } = mount();
    expect(screen.queryByTestId('brand-view')).not.toBeInTheDocument();
    expect(getDesignBrand).not.toHaveBeenCalled();

    rerender({ active: true });
    await screen.findByLabelText('Primary');
    expect(screen.getByTestId('brand-view')).toBeInTheDocument();
    expect(getDesignBrand).toHaveBeenCalledTimes(1);
    expect(getDesignBrand).toHaveBeenCalledWith('remote-1', 's1');

    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: '#2563eb' } });
    fireEvent.change(screen.getByLabelText('Usage rules'), { target: { value: '保持克制。' } });

    rerender({ active: false });
    expect(screen.queryByTestId('brand-view')).not.toBeInTheDocument();
    expect(getDesignBrand).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    expect(screen.getByLabelText('Primary')).toHaveValue('#2563eb');
    expect(screen.getByLabelText('Usage rules')).toHaveValue('保持克制。');
    expect(getDesignBrand).toHaveBeenCalledTimes(1);
  });

  it('backend/session 变化会复位并重新拉取', async () => {
    const { rerender } = mount({ active: true });
    await screen.findByLabelText('Primary');
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: '#2563eb' } });

    rerender({ backendId: 'remote-2', sessionId: 's2' });
    await waitFor(() => expect(getDesignBrand).toHaveBeenCalledWith('remote-2', 's2'));
    expect(await screen.findByLabelText('Primary')).toHaveValue('#4f46e5');
    expect(getDesignBrand).toHaveBeenCalledTimes(2);
  });

  it('resetOnHide（Modal 壳语义）在隐藏后复位草稿，再显示重新拉取', async () => {
    const { rerender } = mount({ active: true, resetOnHide: true });
    await screen.findByLabelText('Primary');
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: '#2563eb' } });

    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(getDesignBrand).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Primary')).toHaveValue('#4f46e5');
  });
});
