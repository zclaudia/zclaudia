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
    expect(mediaPhaseLabel('submitting')).toBe('提交中');
    expect(mediaPhaseLabel('generating')).toBe('生成中');
    expect(mediaPhaseLabel('downloading')).toBe('下载中');
    expect(mediaPhaseLabel('saving')).toBe('保存中');
    expect(mediaPhaseLabel('launching')).toBe('启动渲染');
    expect(mediaPhaseLabel('rendering')).toBe('渲染中');
    expect(mediaPhaseLabel('rendering', 42)).toBe('渲染中（42 帧）');
    expect(mediaPhaseLabel('encoding')).toBe('编码中');
  });

  it('mediaStatusBadge / mediaKindLabel：全枚举中文', () => {
    expect(mediaStatusBadge('queued')).toBe('排队中');
    expect(mediaStatusBadge('running')).toBe('进行中');
    expect(mediaStatusBadge('completed')).toBe('已完成');
    expect(mediaStatusBadge('failed')).toBe('失败');
    expect(mediaStatusBadge('cancelled')).toBe('已取消');
    expect(mediaKindLabel('image-generate')).toBe('图片生成');
    expect(mediaKindLabel('image-edit')).toBe('图片编辑');
    expect(mediaKindLabel('video-render')).toBe('动效视频');
  });

  it('mediaUsageLabel：null/无键 → 费用未知；cost 优先；tokens 次之', () => {
    expect(mediaUsageLabel(null)).toBe('费用未知（服务未返回用量）');
    expect(mediaUsageLabel({})).toBe('费用未知（服务未返回用量）');
    expect(mediaUsageLabel({ totalCostUsd: 0.012345 })).toBe('费用 $0.0123');
    expect(mediaUsageLabel({ inputTokens: 12, outputTokens: 34 })).toBe(
      '用量：输入 12 / 输出 34 tokens'
    );
    expect(mediaUsageLabel({ inputTokens: 12 })).toBe('用量：输入 12 / 输出 0 tokens');
    expect(mediaUsageLabel({ inputTokens: 1, outputTokens: 2, totalCostUsd: 1 })).toBe(
      '费用 $1.0000'
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
      error: '请输入生成描述',
    });
    expect(
      buildImageCreateInput({ kind: 'image-generate', provider, prompt: '长'.repeat(4001) })
    ).toEqual({ error: '生成描述不能超过 4000 字符' });
    expect(
      buildImageCreateInput({ kind: 'image-generate', provider: null, prompt: '海报' })
    ).toEqual({ error: '请选择图片服务' });
    expect(
      buildImageCreateInput({
        kind: 'image-generate',
        provider: { profileId: 'p1', model: '  ' },
        prompt: '海报',
      })
    ).toEqual({ error: '请输入模型名称' });
    expect(
      buildImageCreateInput({
        kind: 'image-generate',
        provider,
        prompt: '海报',
        size: '1024X1024',
      })
    ).toEqual({ error: '尺寸格式应为 宽x高（如 1024x1024）' });
    expect(buildImageCreateInput({ kind: 'image-edit', provider, prompt: '海报' })).toEqual({
      error: '请选择源图片',
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
    ).toEqual({ error: '请填写视频入口 HTML 路径' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '319',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: '宽需在 320–1920 之间' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1921',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: '宽需在 320–1920 之间' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '321',
        height: '720',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: '宽需为偶数' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: 'abc',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: '请输入高（整数像素）' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '321',
        fps: '30',
        durationSeconds: '5',
      })
    ).toEqual({ error: '高需为偶数' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '7',
        durationSeconds: '5',
      })
    ).toEqual({ error: '帧率需在 8–60 之间' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '29.5',
        durationSeconds: '5',
      })
    ).toEqual({ error: '请输入帧率（整数）' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '30',
        durationSeconds: '0.4',
      })
    ).toEqual({ error: '时长需在 0.5–60 秒之间' });
    expect(
      buildVideoCreateInput({
        entryPath: 'a.html',
        width: '1280',
        height: '720',
        fps: '30',
        durationSeconds: '60.1',
      })
    ).toEqual({ error: '时长需在 0.5–60 秒之间' });
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
    expect(conflict).toEqual({ error: '已有相同任务在进行中' });

    vi.mocked(createDesignMediaTask).mockRejectedValueOnce(
      new DesignHttpError('服务配置不存在', 'MEDIA_VALIDATION')
    );
    let invalid: unknown;
    await act(async () => {
      invalid = await result.current.submit(IMAGE_INPUT);
    });
    expect(invalid).toEqual({ error: '服务配置不存在' });

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
