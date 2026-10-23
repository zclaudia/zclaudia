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
  fireEvent.change(screen.getByLabelText('生成描述'), { target: { value: '海报' } });
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'cogview-4' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '提交生成' })).toBeEnabled());
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
    expect(screen.getByRole('tab', { name: '图片生成', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('BigModel')).toBeInTheDocument();
    expect(screen.getByLabelText('生成描述')).toHaveValue('');
    expect(screen.getByText('请输入生成描述')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交生成' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('生成描述'), { target: { value: '海报' } });
    expect(screen.getByText('请输入模型名称')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交生成' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'cogview-4' } });
    expect(screen.queryByText('请输入模型名称')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交生成' })).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: '动效视频' }));
    expect(screen.getByLabelText('视频入口路径')).toHaveValue('design/index.html');
    expect(screen.getByLabelText('视口宽度')).toHaveValue(1280);
    expect(screen.getByLabelText('视口高度')).toHaveValue(720);
    expect(screen.getByLabelText('帧率')).toHaveValue(30);
    expect(screen.getByLabelText('时长（秒）')).toHaveValue(5);
    expect(screen.getByRole('button', { name: '开始渲染' })).toBeEnabled();
    expect(screen.getByText(/近似实时采集/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('视口宽度'), { target: { value: '100' } });
    expect(screen.getByText('宽需在 320–1920 之间')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始渲染' })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: '图片编辑' }));
    await waitFor(() => expect(listDesignAssets).toHaveBeenCalledWith('remote-1', 's1', 'image'));
    expect(screen.getByLabelText('源图片')).toBeInTheDocument();
  });

  it('无活动页时视频提交禁用；入口可编辑', async () => {
    mount({ activeDocPath: null });
    fireEvent.click(screen.getByRole('tab', { name: '动效视频' }));
    expect(screen.getByLabelText('视频入口路径')).toHaveValue('');
    expect(screen.getByRole('button', { name: '开始渲染' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('视频入口路径'), {
      target: { value: 'design/anim.html' },
    });
    expect(screen.getByRole('button', { name: '开始渲染' })).toBeEnabled();
  });

  it('无可用 profile：显示配置提示并禁用提交', async () => {
    vi.mocked(listDesignMediaProviders).mockResolvedValue({
      providers: [],
      profiles: [{ id: 'p2', name: '缺密钥', providerType: 'openai', hasCredential: false }],
    });
    mount();
    expect(await screen.findByText('先在设置中配置 OpenAI 兼容服务')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('生成描述'), { target: { value: '海报' } });
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'cogview-4' } });
    expect(screen.getByRole('button', { name: '提交生成' })).toBeDisabled();
    expect(createDesignMediaTask).not.toHaveBeenCalled();
  });

  it('提交成功：createDesignMediaTask 携当前会话、清空表单、任务行出现并通知 onAssetImported', async () => {
    vi.mocked(listDesignMediaTasks)
      .mockResolvedValueOnce({ tasks: [] })
      .mockResolvedValue({ tasks: [DONE_IMAGE] });
    const { props } = mount();
    await fillImageForm();
    fireEvent.click(screen.getByRole('button', { name: '提交生成' }));
    await waitFor(() =>
      expect(createDesignMediaTask).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        kind: 'image-generate',
        provider: { profileId: 'p1', model: 'cogview-4' },
        prompt: '海报',
      })
    );
    expect(await screen.findByTestId('media-task-t-done')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('生成描述')).toHaveValue(''));
    expect(screen.getByLabelText('模型名称')).toHaveValue('cogview-4');
    expect(await screen.findByText('服务：BigModel · cogview-4')).toBeInTheDocument();
    expect(screen.getByText('用量：输入 10 / 输出 20 tokens')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: '提交生成' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已有相同任务在进行中');
    expect(screen.getByLabelText('生成描述')).toHaveValue('海报');
  });

  it('进行中任务可取消：cancelDesignMediaTask 后刷新', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [makeTask({ id: 't-run' })] });
    vi.mocked(cancelDesignMediaTask).mockResolvedValue(makeTask({ id: 't-run' }));
    mount();
    const row = await screen.findByTestId('media-task-t-run');
    fireEvent.click(within(row).getByRole('button', { name: '取消图片生成任务' }));
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
    fireEvent.click(within(row).getByRole('button', { name: '重试动效视频任务' }));
    await screen.findByText('将重新提交生成请求，可能产生费用。继续？');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('将重新提交生成请求，可能产生费用。继续？')).not.toBeInTheDocument();
    expect(createDesignMediaTask).not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button', { name: '重试动效视频任务' }));
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }));
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
      name: '替换选中图片 design/assets/gen-1.png',
    });
    expect(replace).toBeDisabled();
    expect(replace).toHaveAttribute('title', '需要先在预览中选中一个图片元素');

    rerender({ imageSelectionReady: true });
    const enabled = await screen.findByRole('button', {
      name: '替换选中图片 design/assets/gen-1.png',
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
    expect(within(row).getByText('费用未知（服务未返回用量）')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '预览 design/assets/render.mp4' }));
    const video = await screen.findByTestId('media-video-preview');
    expect(video).toHaveAttribute('src', 'blob:mock-url');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row).getByRole('button', { name: '预览 design/assets/render.mp4' }));
    await waitFor(() =>
      expect(screen.queryByTestId('media-video-preview')).not.toBeInTheDocument()
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    fireEvent.click(screen.getByRole('button', { name: '下载 design/assets/render.mp4' }));
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
    fireEvent.click(screen.getByRole('button', { name: '刷新任务' }));
    await waitFor(() => expect(listDesignMediaTasks).toHaveBeenCalledTimes(2));
    expect(props.onAssetImported).toHaveBeenCalledTimes(1);
    expect(props.onAssetImported).toHaveBeenCalledWith('design/assets/gen-1.png');
  });
});
