import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetLibrary } from '../components/AssetLibrary';
import type { AssetLibraryProps } from '../components/AssetLibrary';
import { AssetLibraryView } from '../rail/AssetLibraryView';
import type { AssetLibraryViewProps } from '../rail/AssetLibraryView';
import { getDesignAsset, importDesignAsset, listDesignAssets } from '../api';
import { readFileAsBase64 } from '../../../services/fileUpload';
import { relativeAssetRef } from '../asset-ref';

vi.mock('../api', () => ({
  listDesignAssets: vi.fn(),
  getDesignAsset: vi.fn(),
  importDesignAsset: vi.fn(),
}));

vi.mock('../../../services/fileUpload', () => ({
  readFileAsBase64: vi.fn(),
}));

const IMAGES = ['assets/logo.png', 'design/assets/hero.svg'];

function mount(overrides: Partial<AssetLibraryProps> = {}) {
  const props: AssetLibraryProps = {
    open: true,
    backendId: 'remote-1',
    sessionId: 's1',
    openPages: [],
    referencedAssets: [],
    activeDocPath: null,
    selection: null,
    onApply: vi.fn(),
    onImported: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<AssetLibrary {...props} />);
  return {
    onApply: props.onApply as ReturnType<typeof vi.fn>,
    onImported: props.onImported as ReturnType<typeof vi.fn>,
    onClose: props.onClose as ReturnType<typeof vi.fn>,
  };
}

describe('AssetLibrary（P4 §4.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDesignAssets).mockResolvedValue({ files: IMAGES });
    vi.mocked(getDesignAsset).mockResolvedValue({ mimeType: 'image/png', data: 'QUJD' });
    vi.mocked(importDesignAsset).mockResolvedValue({ path: 'design/assets/logo.png' });
    vi.mocked(readFileAsBase64).mockResolvedValue('QUJD');
  });

  it('默认图片 tab 以 kinds=image 拉清单；切字体 tab 重拉 kinds=font 且 accept 随之切换', async () => {
    mount();
    await waitFor(() => expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'image'));
    expect(await screen.findByText('assets/logo.png')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose asset files to import')).toHaveAttribute(
      'accept',
      '.png,.jpg,.jpeg,.gif,.webp,.svg,.ico,.avif'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Font' }));
    await waitFor(() => expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'font'));
    expect(await screen.findByText('design/assets/hero.svg')).toBeInTheDocument();
    expect(screen.getAllByText('Fonts cannot be previewed')).toHaveLength(2);
    expect(screen.getByLabelText('Choose asset files to import')).toHaveAttribute(
      'accept',
      '.woff,.woff2,.ttf,.otf'
    );
    expect(listDesignAssets).toHaveBeenCalledTimes(2);
  });

  it('图片项加载缩略图 data URL；字体项不请求预览', async () => {
    mount();
    await waitFor(() =>
      expect(document.querySelectorAll('img[src="data:image/png;base64,QUJD"]')).toHaveLength(
        IMAGES.length
      )
    );
    expect(getDesignAsset).toHaveBeenCalledWith('remote-1', 's1', 'assets/logo.png');
    fireEvent.click(screen.getByRole('tab', { name: 'Font' }));
    expect(await screen.findAllByText('Fonts cannot be previewed')).toHaveLength(2);
    expect(getDesignAsset).toHaveBeenCalledTimes(IMAGES.length);
  });

  it('被引用徽标：素材 ∈ referencedAssets 或出现在任一打开页源码的相对引用中', async () => {
    mount({
      referencedAssets: ['assets/logo.png'],
      openPages: [
        {
          path: 'design/index.html',
          source: `<img src="${relativeAssetRef('design/index.html', 'design/assets/hero.svg')}">`,
        },
      ],
    });
    const badges = await screen.findAllByText('In use');
    expect(badges).toHaveLength(2);
  });

  it('清单超过 50 项只渲染前 50 项并显示截断提示', async () => {
    const many = Array.from({ length: 55 }, (_, index) => `assets/a-${index + 1}.png`);
    vi.mocked(listDesignAssets).mockResolvedValue({ files: many });
    mount();
    expect(await screen.findByText('assets/a-50.png')).toBeInTheDocument();
    expect(screen.queryByText('assets/a-51.png')).not.toBeInTheDocument();
    expect(screen.getByText('… (first 50 shown)')).toBeInTheDocument();
    await waitFor(() => expect(getDesignAsset).toHaveBeenCalledTimes(50));
  });

  it('「替换选中图片」未选中 img 时禁用并带说明 title', async () => {
    mount({ activeDocPath: 'design/index.html', selection: null });
    const button = await screen.findByRole('button', { name: 'Replace selected image logo.png' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Select an image element in the preview first');
  });

  it('「替换选中图片」无活动页时禁用并带说明 title', async () => {
    mount({ activeDocPath: null, selection: { tagName: 'img' } });
    const button = await screen.findByRole('button', { name: 'Replace selected image logo.png' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'No active page');
  });

  it('「替换选中图片」可用时上抛 attribute 操作（相对活动页的引用）且弹窗保持打开', async () => {
    const { onApply, onClose } = mount({
      activeDocPath: 'design/index.html',
      selection: { tagName: 'img' },
    });
    const enabled = await screen.findByRole('button', { name: 'Replace selected image logo.png' });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    expect(onApply).toHaveBeenCalledWith([
      {
        kind: 'attribute',
        name: 'src',
        value: relativeAssetRef('design/index.html', 'assets/logo.png'),
      },
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('导入成功：逐个 readFileAsBase64 → importDesignAsset；重名改名有提示并刷新清单、逐个 onImported', async () => {
    vi.mocked(importDesignAsset)
      .mockResolvedValueOnce({ path: 'design/assets/logo-2.png' })
      .mockResolvedValueOnce({ path: 'design/assets/banner.png' });
    const { onImported } = mount();
    await screen.findByText('assets/logo.png');
    const logo = new File(['bytes'], 'logo.png', { type: 'image/png' });
    const banner = new File(['bytes'], 'banner.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose asset files to import'), {
      target: { files: [logo, banner] },
    });
    await waitFor(() => expect(readFileAsBase64).toHaveBeenCalledTimes(2));
    expect(readFileAsBase64).toHaveBeenCalledWith(logo);
    await waitFor(() => expect(importDesignAsset).toHaveBeenCalledTimes(2));
    expect(importDesignAsset).toHaveBeenNthCalledWith(1, 'remote-1', {
      sessionId: 's1',
      fileName: 'logo.png',
      dataBase64: 'QUJD',
    });
    expect(await screen.findByText('logo.png saved as logo-2.png')).toBeInTheDocument();
    expect(screen.queryByText('banner.png saved as banner.png')).not.toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(2);
    expect(onImported).toHaveBeenNthCalledWith(1, 'design/assets/logo-2.png');
    expect(onImported).toHaveBeenNthCalledWith(2, 'design/assets/banner.png');
    await waitFor(() => expect(listDesignAssets).toHaveBeenCalledTimes(2));
  });

  it('导入单个失败：显示错误不中断其余，成功项照常 onImported', async () => {
    vi.mocked(importDesignAsset)
      .mockRejectedValueOnce(new Error('扩展名不在白名单'))
      .mockResolvedValueOnce({ path: 'design/assets/b.png' });
    const { onImported } = mount();
    await screen.findByText('assets/logo.png');
    fireEvent.change(screen.getByLabelText('Choose asset files to import'), {
      target: {
        files: [
          new File(['x'], 'bad.exe', { type: 'application/octet-stream' }),
          new File(['x'], 'b.png', { type: 'image/png' }),
        ],
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'bad.exe failed to import: 扩展名不在白名单'
    );
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith('design/assets/b.png');
    expect(importDesignAsset).toHaveBeenCalledTimes(2);
  });

  it('清单为空显示空态；加载失败可重试', async () => {
    vi.mocked(listDesignAssets).mockRejectedValueOnce(new Error('网络中断'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    vi.mocked(listDesignAssets).mockResolvedValue({ files: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No assets in the workspace yet')).toBeInTheDocument();
    expect(listDesignAssets).toHaveBeenCalledTimes(2);
  });

  it('视频 tab 以 kinds=video 拉清单：行显示体积，无缩略图、无替换与导入按钮（P6 §5.3）', async () => {
    const videos = ['design/assets/clip.mp4', 'media/demo.webm'];
    vi.mocked(listDesignAssets).mockResolvedValue({ files: videos });
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    await waitFor(() => expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'video'));
    expect(await screen.findByText('design/assets/clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('media/demo.webm')).toBeInTheDocument();
    // 体积经 asset 接口 base64 长度换算（QUJD → 3 B）。
    await waitFor(() =>
      expect(getDesignAsset).toHaveBeenCalledWith('remote-1', 's1', 'design/assets/clip.mp4')
    );
    expect((await screen.findAllByText('3 B')).length).toBe(2);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Replace selected image/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Choose asset files to import')).not.toBeInTheDocument();
    expect(screen.getByText('Videos come from media generation tasks and cannot be imported')).toBeInTheDocument();
    // 切回图片 tab：导入与替换按钮照常回归。
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    expect(await screen.findByRole('button', { name: 'Import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace selected image clip.mp4' })).toBeInTheDocument();
  });

  it('视频体积读取失败（如 >10 MiB）显示「体积未知」', async () => {
    vi.mocked(listDesignAssets).mockResolvedValue({ files: ['media/big.mp4'] });
    vi.mocked(getDesignAsset).mockRejectedValue(new Error('FILE_TOO_LARGE'));
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    expect(await screen.findByText('media/big.mp4')).toBeInTheDocument();
    expect(await screen.findByText('Unknown size')).toBeInTheDocument();
  });

  it('P4b：内嵌视图仅在可见时加载，隐藏后不保留列表内容', async () => {
    const props: AssetLibraryViewProps = {
      active: false,
      compact: true,
      backendId: 'remote-1',
      sessionId: 's1',
      openPages: [],
      referencedAssets: [],
      activeDocPath: null,
      selection: null,
      onApply: vi.fn(),
      onImported: vi.fn(),
    };
    const view = render(<AssetLibraryView {...props} />);
    expect(listDesignAssets).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(<AssetLibraryView {...props} active />);
    expect(await screen.findByText('assets/logo.png')).toBeInTheDocument();
    expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'image');

    view.rerender(<AssetLibraryView {...props} active={false} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(listDesignAssets).toHaveBeenCalledTimes(1);
  });
});
