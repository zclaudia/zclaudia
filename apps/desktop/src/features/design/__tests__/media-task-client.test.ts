import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../../../services/api/unwrap';
import {
  buildImageCreateInput,
  buildVideoCreateInput,
  mediaKindLabel,
  mediaPhaseLabel,
  mediaStatusBadge,
  mediaUsageLabel,
  useMediaTasks,
} from '../media-task-client';
import type { UseMediaTasksOptions } from '../media-task-client';
import { DesignHttpError } from '../api';
import { createDesignMediaTask, listDesignMediaTasks, cancelDesignMediaTask } from '../api';
import type { DesignMediaTask } from '../api';

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createDesignMediaTask: vi.fn(),
    listDesignMediaTasks: vi.fn(),
    cancelDesignMediaTask: vi.fn(),
  };
});

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

const IMAGE_INPUT = {
  sessionId: 's1',
  kind: 'image-generate' as const,
  provider: { profileId: 'p1', model: 'cogview-4' },
  prompt: '海报',
};

function mountTasks(overrides: Partial<UseMediaTasksOptions> = {}) {
  const props: UseMediaTasksOptions = {
    backendId: 'remote-1',
    sessionId: 's1',
    enabled: true,
    ...overrides,
  };
  return renderHook(() => useMediaTasks(props));
}

/** 推进假计时器并排空轮询 promise 链（agent-run-watch.test 同款）。 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('媒体文案与输入校验纯函数（P6 §8.1）', () => {
  it('mediaPhaseLabel：全阶段中文；rendering 可带帧数', () => {
    expect(mediaPhaseLabel('submitting')).toBe('Submitting');
    expect(mediaPhaseLabel('generating')).toBe('Generating');
    expect(mediaPhaseLabel('downloading')).toBe('Downloading');
    expect(mediaPhaseLabel('saving')).toBe('Saving');
    expect(mediaPhaseLabel('launching')).toBe('Starting render');
    expect(mediaPhaseLabel('rendering')).toBe('Rendering');
    expect(mediaPhaseLabel('rendering', 42)).toBe('Rendering (42 frames)');
    expect(mediaPhaseLabel('encoding')).toBe('Encoding');
  });

  it('mediaStatusBadge / mediaKindLabel：全枚举中文', () => {
    expect(mediaStatusBadge('queued')).toBe('Queued');
    expect(mediaStatusBadge('running')).toBe('In progress');
    expect(mediaStatusBadge('completed')).toBe('Completed');
    expect(mediaStatusBadge('failed')).toBe('Failed');
    expect(mediaStatusBadge('cancelled')).toBe('Canceled');
    expect(mediaKindLabel('image-generate')).toBe('Image generation');
    expect(mediaKindLabel('image-edit')).toBe('Image edit');
    expect(mediaKindLabel('video-render')).toBe('Motion video');
  });

  it('mediaUsageLabel：null/无键 → 费用未知；cost 优先；tokens 次之', () => {
    expect(mediaUsageLabel(null)).toBe('Cost unknown (service returned no usage)');
    expect(mediaUsageLabel({})).toBe('Cost unknown (service returned no usage)');
    expect(mediaUsageLabel({ totalCostUsd: 0.012345 })).toBe('Cost $0.0123');
    expect(mediaUsageLabel({ inputTokens: 12, outputTokens: 34 })).toBe(
      'Usage: 12 input / 34 output tokens'
    );
    expect(mediaUsageLabel({ inputTokens: 12 })).toBe('Usage: 12 input / 0 output tokens');
    expect(mediaUsageLabel({ inputTokens: 1, outputTokens: 2, totalCostUsd: 1 })).toBe(
      'Cost $1.0000'
    );
  });

  it('buildImageCreateInput：校验矩阵（prompt/model/服务/size/源图）', () => {
    const provider = { profileId: 'p1', model: ' cogview-4 ' };
    expect(buildImageCreateInput({ kind: 'image-generate', provider, prompt: '  海报  ' })).toEqual(
      {
        sessionId: '',
        kind: 'image-generate',
        provider: { profileId: 'p1', model: 'cogview-4' },
        prompt: '海报',
      }
    );
    expect(
      buildImageCreateInput({
        kind: 'image-generate',
        provider,
        prompt: '海报',
        size: ' 1024x1024 ',
      })
    ).toEqual({
      sessionId: '',
      kind: 'image-generate',
      provider: { profileId: 'p1', model: 'cogview-4' },
      prompt: '海报',
      size: '1024x1024',
    });
    expect(buildImageCreateInput({ kind: 'image-generate', provider, prompt: '   ' })).toEqual({
      error: 'Enter a prompt',
    });
    expect(
      buildImageCreateInput({ kind: 'image-generate', provider, prompt: '长'.repeat(4001) })
    ).toEqual({ error: 'Prompt must be at most 4000 characters' });
    expect(
      buildImageCreateInput({ kind: 'image-generate', provider: null, prompt: '海报' })
    ).toEqual({ error: 'Choose an image service' });
    expect(
      buildImageCreateInput({
        kind: 'image-generate',
        provider: { profileId: 'p1', model: '  ' },
        prompt: '海报',
      })
    ).toEqual({ error: 'Enter a model name' });
    expect(
      buildImageCreateInput({
        kind: 'image-generate',
        provider,
        prompt: '海报',
        size: '1024X1024',
      })
    ).toEqual({ error: 'Size must be width x height (e.g. 1024x1024)' });
    expect(buildImageCreateInput({ kind: 'image-edit', provider, prompt: '海报' })).toEqual({
      error: 'Choose a source image',
    });
    expect(
      buildImageCreateInput({
        kind: 'image-edit',
        provider,
        prompt: '海报',
        sourcePath: 'design/assets/a.png',
      })
    ).toEqual({
      sessionId: '',
      kind: 'image-edit',
      provider: { profileId: 'p1', model: 'cogview-4' },
      prompt: '海报',
      sourcePath: 'design/assets/a.png',
    });
  });

  it('buildVideoCreateInput：校验矩阵（入口/尺寸/帧率/时长）', () => {
    expect(
      buildVideoCreateInput({
        entryPath: ' design/index.html ',
        width: '1280',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({
      sessionId: '',
      kind: 'video-render',
      entryPath: 'design/index.html',
      width: 1280,
      height: 720,
      fps: 30,
      durationMs: 5000,
    });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '60',
        durationSeconds: '0.75',
      })
    ).toMatchObject({ durationMs: 750 });
    expect(
      buildVideoCreateInput({
        entryPath: null,
        width: '1280',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Enter the video entry HTML path' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '319',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Viewport width must be between 320 and 1920' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1921',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Viewport width must be between 320 and 1920' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '321',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Viewport width must be even' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: 'abc',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Enter Viewport height (integer pixels)' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '321',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Viewport height must be even' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '7',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Frame rate must be between 8 and 60' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '29.5',
        durationSeconds: '5',
      })
    ).toEqual({ error: 'Enter a frame rate (integer)' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '30',
        durationSeconds: '0.4',
      })
    ).toEqual({ error: 'Duration must be between 0.5 and 60 seconds' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '30',
        durationSeconds: '60.1',
      })
    ).toEqual({ error: 'Duration must be between 0.5 and 60 seconds' });
  });
});

describe('useMediaTasks（P6 §8.1 轮询/提交/取消）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(listDesignMediaTasks).mockReset().mockResolvedValue({ tasks: [] });
    vi.mocked(createDesignMediaTask).mockReset();
    vi.mocked(cancelDesignMediaTask).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('启用时立即刷新一次；disabled / sessionId 为空不请求', async () => {
    const { result } = mountTasks();
    await act(async () => {});
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    expect(listDesignMediaTasks).toHaveBeenCalledWith('remote-1', 's1');
    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    const disabled = mountTasks({ enabled: false });
    await act(async () => {});
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    expect(disabled.result.current.tasks).toEqual([]);

    const noSession = mountTasks({ sessionId: null });
    await act(async () => {});
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    expect(noSession.result.current.tasks).toEqual([]);
  });

  it('有 active 任务时 2s 轮询', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [makeTask()] });
    const { result } = mountTasks();
    await act(async () => {});
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(3);
    expect(result.current.tasks).toHaveLength(1);
  });

  it('无 active 任务时 5s 轮询', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({
      tasks: [makeTask({ status: 'completed' })],
    });
    mountTasks();
    await act(async () => {});
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    await advance(2800);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
  });

  it('active 标志翻转时切换轮询间隔（2s → 5s）', async () => {
    vi.mocked(listDesignMediaTasks)
      .mockResolvedValueOnce({ tasks: [makeTask({ status: 'queued' })] })
      .mockResolvedValue({ tasks: [makeTask({ status: 'completed' })] });
    mountTasks();
    await act(async () => {});
    await advance(2000); // 首轮见 queued → 2s 间隔触发第二次刷新
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
    await advance(2000); // 第二轮见 completed → 间隔切 5s，此处不触发
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
    await advance(3000); // 距第二轮 5s → 触发
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(3);
  });

  it('卸载后清理定时器：不再轮询', async () => {
    vi.mocked(listDesignMediaTasks).mockResolvedValue({ tasks: [makeTask()] });
    const { unmount } = mountTasks();
    await act(async () => {});
    await advance(2000);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
    unmount();
    await advance(10000);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
  });

  it('刷新失败记 error 且不清空任务', async () => {
    vi.mocked(listDesignMediaTasks)
      .mockResolvedValueOnce({ tasks: [makeTask()] })
      .mockRejectedValueOnce(new Error('网络故障'));
    const { result } = mountTasks();
    await act(async () => {});
    expect(result.current.tasks).toHaveLength(1);
    await advance(2000);
    expect(result.current.error).toBe('网络故障');
    expect(result.current.tasks).toHaveLength(1);
  });

  it('submit 成功：调 createDesignMediaTask 后立即刷新并返回任务', async () => {
    const task = makeTask({ id: 't9' });
    vi.mocked(createDesignMediaTask).mockResolvedValue(task);
    const { result } = mountTasks();
    await act(async () => {});
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit(IMAGE_INPUT);
    });
    expect(outcome).toEqual(task);
    expect(createDesignMediaTask).toHaveBeenCalledWith('remote-1', IMAGE_INPUT);
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2); // 初次刷新 + submit 后 refresh
  });

  it('submit 409 MEDIA_TASK_ACTIVE_EXISTS 映射中文；其余错误沿用 message', async () => {
    const { result } = mountTasks();
    await act(async () => {});
    vi.mocked(createDesignMediaTask).mockRejectedValueOnce(
      new DesignHttpError('重复', 'MEDIA_TASK_ACTIVE_EXISTS')
    );
    let conflict: unknown;
    await act(async () => {
      conflict = await result.current.submit(IMAGE_INPUT);
    });
    expect(conflict).toEqual({ error: 'An identical task is already in progress' });

    vi.mocked(createDesignMediaTask).mockRejectedValueOnce(
      new DesignHttpError('The specified service profile does not exist', 'MEDIA_VALIDATION')
    );
    let invalid: unknown;
    await act(async () => {
      invalid = await result.current.submit(IMAGE_INPUT);
    });
    expect(invalid).toEqual({ error: 'The specified service profile does not exist' });

    vi.mocked(createDesignMediaTask).mockRejectedValueOnce(new ApiError('没有权限', 'FORBIDDEN'));
    let apiErr: unknown;
    await act(async () => {
      apiErr = await result.current.submit(IMAGE_INPUT);
    });
    expect(apiErr).toEqual({ error: '没有权限' });
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(1); // 失败不触发 refresh
  });

  it('cancel：调 cancelDesignMediaTask 后 refresh；失败记 error', async () => {
    vi.mocked(cancelDesignMediaTask).mockResolvedValue(makeTask({ status: 'cancelled' }));
    const { result } = mountTasks();
    await act(async () => {});
    await act(async () => {
      await result.current.cancel('t1');
    });
    expect(cancelDesignMediaTask).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      taskId: 't1',
    });
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);

    vi.mocked(cancelDesignMediaTask).mockRejectedValueOnce(new Error('终态不可取消'));
    await act(async () => {
      await result.current.cancel('t1');
    });
    expect(result.current.error).toBe('终态不可取消');
  });

  it('refresh 手动触发重新拉取', async () => {
    const { result } = mountTasks();
    await act(async () => {});
    await act(async () => {
      await result.current.refresh();
    });
    expect(listDesignMediaTasks).toHaveBeenCalledTimes(2);
  });
});
