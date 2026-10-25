import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaGenView } from '../rail/MediaGenView';
import type { MediaGenViewProps } from '../rail/MediaGenView';
import {
  cancelDesignMediaTask,
  createDesignMediaTask,
  downloadDesignMediaTaskResult,
  getDesignAsset,
  listDesignAssets,
  listDesignMediaProviders,
  listDesignMediaTasks,
} from '../api';
import type { DesignMediaTask } from '../api';

vi.mock('../api', () => ({
  listDesignMediaProviders: vi.fn(),
  listDesignAssets: vi.fn(),
  getDesignAsset: vi.fn(),
  downloadDesignMediaTaskResult: vi.fn(),
  createDesignMediaTask: vi.fn(),
  listDesignMediaTasks: vi.fn(),
  cancelDesignMediaTask: vi.fn(),
  DesignHttpError: class DesignHttpError extends Error {},
}));

vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: vi.fn(),
}));

function makeTask(overrides: Partial<DesignMediaTask> = {}): DesignMediaTask {
  return {
    id: 't1',
    kind: 'image-generate',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    provider: null,
    params: { type: 'image-generate', prompt: '海报' },
    progress: null,
    result: null,
    error: null,
    ...overrides,
  };
}

function mount(overrides: Partial<MediaGenViewProps> = {}) {
  const props: MediaGenViewProps = {
    active: true,
    backendId: 'remote-1',
    sessionId: 's1',
    activeDocPath: 'design/index.html',
    imageSelectionReady: false,
    onReplaceSelectionSrc: vi.fn(),
    onAssetImported: vi.fn(),
    ...overrides,
  };
  const utils = render(<MediaGenView {...props} />);
  return {
    props,
    rerender: (next: Partial<MediaGenViewProps> = {}) =>
      utils.rerender(<MediaGenView {...props} {...next} />),
  };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('MediaGenView（P4c 内嵌语义）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDesignMediaProviders).mockResolvedValue({
      providers: [],
      profiles: [{ id: 'p1', name: 'BigModel', providerType: 'openai', hasCredential: true }],
    });
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(listDesignAssets).mockResolvedValue({ files: ['design/assets/a.png'] });
    vi.mocked(getDesignAsset).mockResolvedValue({ mimeType: 'image/png', data: 'QUJD' });
    vi.mocked(downloadDesignMediaTaskResult).mockResolvedValue({
      blob: new Blob(['mp4-bytes'], { type: 'video/mp4' }),
      filename: 'render.mp4',
    });
    vi.mocked(createDesignMediaTask).mockResolvedValue(makeTask({ id: 't-new' }));
    vi.mocked(cancelDesignMediaTask).mockResolvedValue(makeTask({ id: 't1' }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('未激活不渲染且不请求服务/任务；激活后轮询，隐藏即暂停，再显示恢复', async () => {
    vi.useFakeTimers();
    const { rerender } = mount({ active: false });
    expect(screen.queryByTestId('media-view')).not.toBeInTheDocument();
    expect(listDesignMediaProviders).not.toHaveBeenCalled();
    expect(listDesignMediaTasks).not.toHaveBeenCalled();

    rerender({ active: true });
    await flush();
    expect(screen.getByTestId('media-view')).toBeInTheDocument();
    expect(listDesignMediaProviders).toHaveBeenCalledTimes(1);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    expect(screen.queryByTestId('media-view')).not.toBeInTheDocument();
    await flush(12000);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    await flush();
    expect(screen.getByTestId('media-view')).toBeInTheDocument();
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
  });

  it('隐藏/再显示保留 tab 与表单草稿（含视频参数），不重置活动页入口', async () => {
    vi.useRealTimers();
    const { rerender } = mount();
    expect(await screen.findByText('BigModel')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '海报' } });
    fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'cogview-4' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Motion video' }));
    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '640' } });

    rerender({ active: false });
    expect(screen.queryByTestId('media-view')).not.toBeInTheDocument();

    rerender({ active: true });
    expect(screen.getByTestId('media-view')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Motion video' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByLabelText('Viewport width')).toHaveValue(640);
    expect(screen.getByLabelText('Video entry path')).toHaveValue('design/index.html');

    fireEvent.click(screen.getByRole('tab', { name: 'Image generation' }));
    expect(screen.getByLabelText('Prompt')).toHaveValue('海报');
    expect(screen.getByLabelText('Model name')).toHaveValue('cogview-4');
  });

  it('活动页变化会跟随新的视频默认入口', async () => {
    vi.useRealTimers();
    const { rerender } = mount();
    await screen.findByText('BigModel');
    fireEvent.click(screen.getByRole('tab', { name: 'Motion video' }));
    fireEvent.change(screen.getByLabelText('Video entry path'), {
      target: { value: 'design/custom.html' },
    });

    rerender({ activeDocPath: 'design/other.html' });
    await waitFor(() =>
      expect(screen.getByLabelText('Video entry path')).toHaveValue('design/other.html')
    );
  });
});
