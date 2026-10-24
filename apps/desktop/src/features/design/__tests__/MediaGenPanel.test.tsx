import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MediaGenPanel } from '../components/MediaGenPanel';
import type { MediaGenPanelProps } from '../components/MediaGenPanel';
import {
  DesignHttpError,
  createDesignMediaTask,
  listDesignAssets,
  listDesignMediaProviders,
  listDesignMediaTasks,
  cancelDesignMediaTask,
  downloadDesignMediaTaskResult,
  getDesignAsset,
} from '../api';
import type { DesignMediaTask } from '../api';
import { saveBlobToFile } from '../../../services/fileDownload';

vi.mock('../api', () => ({
  listDesignMediaProviders: vi.fn(),
  listDesignAssets: vi.fn(),
  getDesignAsset: vi.fn(),
  downloadDesignMediaTaskResult: vi.fn(),
  createDesignMediaTask: vi.fn(),
  listDesignMediaTasks: vi.fn(),
  cancelDesignMediaTask: vi.fn(),
  DesignHttpError: class DesignHttpError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
      this.name = 'DesignHttpError';
    }
  },
}));

vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: vi.fn(),
}));

const createObjectURL = vi.fn(() => 'blob:mock-url');
const revokeObjectURL = vi.fn();

function makeTask(overrides: Partial<DesignMediaTask> = {}): DesignMediaTask {
  return {
    id: 't1',
    kind: 'image-generate',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    provider: {
      providerId: 'openai-images',
      profileId: 'p1',
      profileName: 'BigModel',
      model: 'cogview-4',
    },
    params: { type: 'image-generate', prompt: '海报' },
    progress: null,
    result: null,
    error: null,
    ...overrides,
  };
}

const DONE_IMAGE = makeTask({
  id: 't-done',
  status: 'completed',
  result: {
    path: 'design/assets/gen-1.png',
    bytes: 1024,
    mime: 'image/png',
    usage: { inputTokens: 10, outputTokens: 20 },
  },
});

function mount(overrides: Partial<MediaGenPanelProps> = {}) {
  const props: MediaGenPanelProps = {
    open: true,
    onClose: vi.fn(),
    backendId: 'remote-1',
    sessionId: 's1',
    activeDocPath: 'design/index.html',
    imageSelectionReady: false,
    onReplaceSelectionSrc: vi.fn(),
    onAssetImported: vi.fn(),
    ...overrides,
  };
  const utils = render(<MediaGenPanel {...props} />);
  return {
    props,
    rerender: (next: Partial<MediaGenPanelProps> = {}) =>
      utils.rerender(<MediaGenPanel {...props} {...next} />),
  };
}

/** 等服务清单就绪并填好图片表单到可提交状态。 */
async function fillImageForm() {
  await screen.findByText('BigModel');
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '海报' } });
  fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'cogview-4' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
}

describe('MediaGenPanel（P6 §8.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });
    vi.mocked(listDesignMediaProviders).mockResolvedValue({
      providers: [
        { id: 'openai-images', label: 'OpenAI 兼容图片服务', capabilities: ['generate', 'edit'] },
      ],
      profiles: [
        { id: 'p1', name: 'BigModel', providerType: 'openai', hasCredential: true },
        { id: 'p2', name: '缺密钥', providerType: 'openai', hasCredential: false },
      ],
    });
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(listDesignAssets).mockResolvedValue({ files: ['design/assets/a.png'] });
    vi.mocked(getDesignAsset).mockResolvedValue({ mimeType: 'image/png', data: 'QUJD' });
    vi.mocked(downloadDesignMediaTaskResult).mockResolvedValue({
      blob: new Blob(['mp4-bytes'], { type: 'video/mp4' }),
      filename: 'render.mp4',
    });
    vi.mocked(saveBlobToFile).mockResolvedValue('/Downloads/render.mp4');
    vi.mocked(createDesignMediaTask).mockResolvedValue(makeTask({ id: 't-new' }));
  });

  it('三 tab 切换：默认图片生成；视频 tab 缺省活动页入口且校验错误就地显示', async () => {
    mount();
    expect(screen.getByRole('tab', { name: 'Image generation', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('BigModel')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toHaveValue('');
    expect(screen.getByText('Enter a prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '海报' } });
    expect(screen.getByText('Enter a model name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'cogview-4' } });
    expect(screen.queryByText('Enter a model name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Motion video' }));
    expect(screen.getByLabelText('Video entry path')).toHaveValue('design/index.html');
    expect(screen.getByLabelText('Viewport width')).toHaveValue(1280);
    expect(screen.getByLabelText('Viewport height')).toHaveValue(720);
    expect(screen.getByLabelText('Frame rate')).toHaveValue(30);
    expect(screen.getByLabelText('Duration (s)')).toHaveValue(5);
    expect(screen.getByRole('button', { name: 'Start rendering' })).toBeEnabled();
    expect(screen.getByText(/near-real-time capture/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '100' } });
    expect(screen.getByText('Viewport width must be between 320 and 1920')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start rendering' })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Image edit' }));
    await waitFor(() => expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'image'));
    expect(screen.getByLabelText('Source image')).toBeInTheDocument();
  });

  it('无活动页时视频提交禁用；入口可编辑', async () => {
    mount({ activeDocPath: null });
    fireEvent.click(screen.getByRole('tab', { name: 'Motion video' }));
    expect(screen.getByLabelText('Video entry path')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Start rendering' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Video entry path'), {
      target: { value: 'design/anim.html' },
    });
    expect(screen.getByRole('button', { name: 'Start rendering' })).toBeEnabled();
  });

  it('无可用 profile：显示配置提示并禁用提交', async () => {
    vi.mocked(listDesignMediaProviders).mockResolvedValue({
      providers: [],
      profiles: [{ id: 'p2', name: '缺密钥', providerType: 'openai', hasCredential: false }],
    });
    mount();
    expect(await screen.findByText('Configure an OpenAI-compatible service in Settings first')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '海报' } });
    fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'cogview-4' } });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(createDesignMediaTask).not.toHaveBeenCalled();
  });

  it('提交成功：createDesignMediaTask 携当前会话、清空表单、任务行出现并通知 onAssetImported', async () => {
    vi.mocked(listDesignMediaTasks)
      .mockResolvedValueOnce({ tasks: [] })
      .mockResolvedValue({ tasks: [DONE_IMAGE] });
    const { props } = mount();
    await fillImageForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(createDesignMediaTask).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        kind: 'image-generate',
        provider: { profileId: 'p1', model: 'cogview-4' },
        prompt: '海报',
      })
    );
    expect(await screen.findByTestId('media-task-t-done')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue(''));
    expect(screen.getByLabelText('Model name')).toHaveValue('cogview-4');
    expect(await screen.findByText('Service: BigModel · cogview-4')).toBeInTheDocument();
    expect(screen.getByText('Usage: 10 input / 20 output tokens')).toBeInTheDocument();
    await waitFor(() =>
      expect(props.onAssetImported).toHaveBeenCalledWith('design/assets/gen-1.png')
    );
  });

  it('409 去重错误以页内 alert 显示中文文案', async () => {
    vi.mocked(createDesignMediaTask).mockRejectedValue(
      new DesignHttpError('重复', 'MEDIA_TASK_ACTIVE_EXISTS')
    );
    mount();
    await fillImageForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An identical task is already in progress');
    expect(screen.getByLabelText('Prompt')).toHaveValue('海报');
  });

  it('进行中任务可取消：cancelDesignMediaTask 后刷新', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [makeTask({ id: 't-run' })] });
    vi.mocked(cancelDesignMediaTask).mockResolvedValue(makeTask({ id: 't-run' }));
    mount();
    const row = await screen.findByTestId('media-task-t-run');
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel Image generation task' }));
    await waitFor(() =>
      expect(cancelDesignMediaTask).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        taskId: 't-run',
      })
    );
    await waitFor(() => expect(listDesignMediaTasks).toHaveBeenCalledTimes(2));
  });

  it('失败任务重试需确认：取消不提交；确认后以 params+provider 重建（视频参数）', async () => {
    const failedVideo = makeTask({
      id: 't-failed',
      kind: 'video-render',
      status: 'failed',
      provider: null,
      params: {
        type: 'video-render',
        entryPath: 'design/index.html',
        width: 1280,
        height: 720,
        fps: 30,
        durationMs: 5500,
      },
      error: { code: 'RENDER_FAILED', message: '页面没有产生任何画面帧' },
    });
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [failedVideo] });
    vi.mocked(createDesignMediaTask).mockResolvedValue(makeTask({ id: 't-retry' }));
    mount();
    const row = await screen.findByTestId('media-task-t-failed');
    expect(within(row).getByRole('alert')).toHaveTextContent('页面没有产生任何画面帧');
    fireEvent.click(within(row).getByRole('button', { name: 'Retry Motion video task' }));
    await screen.findByText('This will resubmit the generation request and may incur costs. Continue?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByText('This will resubmit the generation request and may incur costs. Continue?')
    ).not.toBeInTheDocument();
    expect(createDesignMediaTask).not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button', { name: 'Retry Motion video task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm retry' }));
    await waitFor(() =>
      expect(createDesignMediaTask).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        kind: 'video-render',
        entryPath: 'design/index.html',
        width: 1280,
        height: 720,
        fps: 30,
        durationMs: 5500,
      })
    );
    await waitFor(() => expect(listDesignMediaTasks).toHaveBeenCalledTimes(2)); // 重试后 refresh
  });

  it('图片结果卡：base64 缩略图 + 替换按钮两态 + 上抛产物路径', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [DONE_IMAGE] });
    const { props, rerender } = mount();
    rerender({ imageSelectionReady: false });
    const row = await screen.findByTestId('media-task-t-done');
    await waitFor(() =>
      expect(row.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,QUJD')
    );
    expect(getDesignAsset).toHaveBeenCalledWith('remote-1', 's1', 'design/assets/gen-1.png');
    const replace = within(row).getByRole('button', {
      name: 'Replace selected image design/assets/gen-1.png',
    });
    expect(replace).toBeDisabled();
    expect(replace).toHaveAttribute('title', 'Select an image element in the preview first');

    rerender({ imageSelectionReady: true });
    const enabled = await screen.findByRole('button', {
      name: 'Replace selected image design/assets/gen-1.png',
    });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    expect(props.onReplaceSelectionSrc).toHaveBeenCalledWith('design/assets/gen-1.png');
  });

  it('视频结果卡：预览经 blob URL 内嵌 video，收起撤销对象 URL；下载走 saveBlobToFile', async () => {
    const videoTask = makeTask({
      id: 't-video',
      kind: 'video-render',
      status: 'completed',
      provider: null,
      result: {
        path: 'design/assets/render.mp4',
        bytes: 2048,
        mime: 'video/mp4',
        usage: null,
      },
    });
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [videoTask] });
    mount();
    const row = await screen.findByTestId('media-task-t-video');
    expect(within(row).getByText('Cost unknown (service returned no usage)')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Preview design/assets/render.mp4' }));
    const video = await screen.findByTestId('media-video-preview');
    expect(video).toHaveAttribute('src', 'blob:mock-url');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row).getByRole('button', { name: 'Preview design/assets/render.mp4' }));
    await waitFor(() =>
      expect(screen.queryByTestId('media-video-preview')).not.toBeInTheDocument()
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    fireEvent.click(screen.getByRole('button', { name: 'Download design/assets/render.mp4' }));
    await waitFor(() => expect(saveBlobToFile).toHaveBeenCalledTimes(1));
    expect(downloadDesignMediaTaskResult).toHaveBeenCalledWith('remote-1', 's1', 't-video');
    const [blob, filename] = vi.mocked(saveBlobToFile).mock.calls[0];
    expect(filename).toBe('render.mp4');
    expect(blob.type).toBe('video/mp4');
  });

  it('onAssetImported 每个任务只通知一次（轮询重复看到同一任务不重复通知）', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [DONE_IMAGE] });
    const { props } = mount();
    expect(await screen.findByTestId('media-task-t-done')).toBeInTheDocument();
    await waitFor(() => expect(props.onAssetImported).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }));
    await waitFor(() => expect(listDesignMediaTasks).toHaveBeenCalledTimes(2));
    expect(props.onAssetImported).toHaveBeenCalledTimes(1);
    expect(props.onAssetImported).toHaveBeenCalledWith('design/assets/gen-1.png');
  });
});
