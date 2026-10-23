import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  type AgentRunDiff,
  type AgentRunFeedbackOptions,
  type DesignWatchState,
  agentRunStatusText,
  diffDesignWatchState,
  useAgentRunFeedback,
} from '../agent-run-watch';
import { createDesignSnapshot, getDesignDocument, listDesignFiles } from '../api';
import type { DesignSnapshotSummary } from '../types';

// —— store / api mock（hook 用例共享；纯函数用例不触碰这些 mock）——
const hookHarness = vi.hoisted(() => {
  const state: {
    runIds: Record<string, string | null>;
    messages: Record<string, { id: string; role: string; content: string }[] | undefined>;
  } = { runIds: {}, messages: {} };
  const listeners = new Set<() => void>();
  return {
    state,
    notify: () => {
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
  };
});

vi.mock('../api', () => ({
  listDesignFiles: vi.fn(),
  getDesignDocument: vi.fn(),
  createDesignSnapshot: vi.fn(),
}));

vi.mock('../../../stores/runStore', () => ({
  useRunStore: {
    getState: () => ({
      getSessionRunId: (sessionId: string) => hookHarness.state.runIds[sessionId] ?? null,
    }),
    subscribe: hookHarness.subscribe,
  },
}));

vi.mock('../../../stores/chatMessageStore', () => ({
  useChatMessageStore: {
    getState: () => ({ messages: hookHarness.state.messages }),
  },
}));

const REV_A = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const REV_B = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const state = (files: string[], openPages: { path: string; docRevision: string }[]): DesignWatchState => ({
  files,
  openPages,
});

describe('diffDesignWatchState（P4 §6.1 磁盘对比）', () => {
  it('新增文件：after.files − before.files，保持 after 顺序', () => {
    const diff = diffDesignWatchState(
      state(['design/index.html', 'design/a.html'], [{ path: 'design/index.html', docRevision: REV_A }]),
      state(
        ['design/index.html', 'design/a.html', 'design/b.html', 'design/c.html'],
        [{ path: 'design/index.html', docRevision: REV_A }]
      )
    );
    expect(diff).toEqual({ addedFiles: ['design/b.html', 'design/c.html'], changedPages: [] });
  });

  it('修订变化：双方都有的打开页且哈希不同才算；before 无该页不算', () => {
    const diff = diffDesignWatchState(
      state(
        ['design/index.html'],
        [
          { path: 'design/index.html', docRevision: REV_A },
          { path: 'design/known.html', docRevision: REV_A },
        ]
      ),
      state(
        ['design/index.html'],
        [
          { path: 'design/index.html', docRevision: REV_B }, // 变了 → 计入
          { path: 'design/new.html', docRevision: REV_A }, // before 无该页 → 不算
          { path: 'design/known.html', docRevision: REV_A }, // 未变 → 不算
        ]
      )
    );
    expect(diff).toEqual({ addedFiles: [], changedPages: ['design/index.html'] });
  });

  it('无变化：addedFiles 与 changedPages 皆为空', () => {
    const before = state(
      ['design/index.html', 'design/a.html'],
      [{ path: 'design/index.html', docRevision: REV_A }]
    );
    expect(diffDesignWatchState(before, before)).toEqual({ addedFiles: [], changedPages: [] });
  });

  it('changedPages 保持 after.openPages 顺序', () => {
    const diff = diffDesignWatchState(
      state([], [
        { path: 'design/z.html', docRevision: REV_A },
        { path: 'design/a.html', docRevision: REV_A },
      ]),
      state([], [
        { path: 'design/z.html', docRevision: REV_B },
        { path: 'design/a.html', docRevision: REV_B },
      ])
    );
    expect(diff.changedPages).toEqual(['design/z.html', 'design/a.html']);
  });
});

describe('agentRunStatusText（P4 §6.1 中文状态文案）', () => {
  const EMPTY: AgentRunDiff = { addedFiles: [], changedPages: [] };
  const CHANGED: AgentRunDiff = {
    addedFiles: ['design/b.html'],
    changedPages: ['design/index.html'],
  };

  it('有变化：Agent 已写入 N 个文件（added + changed 去重计数）', () => {
    expect(agentRunStatusText(CHANGED, false)).toBe('Agent 已写入 2 个文件');
    expect(agentRunStatusText({ addedFiles: ['a', 'b'], changedPages: ['b', 'c'] }, false)).toBe(
      'Agent 已写入 3 个文件'
    );
  });

  it('无变化：未检测到设计文件变化', () => {
    expect(agentRunStatusText(EMPTY, false)).toBe('Agent 运行结束，未检测到设计文件变化');
  });

  it('runErrored=true 追加错误提示', () => {
    expect(agentRunStatusText(CHANGED, true)).toBe('Agent 已写入 2 个文件。运行报告了错误，详情见聊天。');
    expect(agentRunStatusText(EMPTY, true)).toBe('Agent 运行结束，未检测到设计文件变化。运行报告了错误，详情见聊天。');
  });
});

// ---------------------------------------------------------------------------
// useAgentRunFeedback（P4 §6.2 run 结束监视 hook）
// ---------------------------------------------------------------------------

const SUMMARY = {} as DesignSnapshotSummary;

type FeedbackOverrides = Partial<AgentRunFeedbackOptions>;

function mountFeedback(before: DesignWatchState, overrides: FeedbackOverrides = {}) {
  const options: AgentRunFeedbackOptions = {
    sessionId: 's1',
    backendId: 'remote-1',
    enabled: true,
    getWatchState: vi.fn(() => before),
    refreshNow: vi.fn(),
    ...overrides,
  };
  const harness = renderHook(props => useAgentRunFeedback(props), { initialProps: options });
  return {
    result: harness.result,
    rerender: harness.rerender,
    unmount: harness.unmount,
    getWatchState: options.getWatchState,
    refreshNow: options.refreshNow as ReturnType<typeof vi.fn>,
  };
}

function startRun(sessionId: string, runId: string) {
  act(() => {
    hookHarness.state.runIds[sessionId] = runId;
    hookHarness.notify();
  });
}

function endRun(sessionId: string) {
  act(() => {
    hookHarness.state.runIds[sessionId] = null;
    hookHarness.notify();
  });
}

/** 推进防抖计时器并排空评估流程的 promise 链。 */
async function settleDebounce(ms = 500) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAgentRunFeedback（P4 §6.2）', () => {
  const BEFORE: DesignWatchState = {
    files: ['design/index.html'],
    openPages: [{ path: 'design/index.html', docRevision: REV_A }],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hookHarness.state.runIds = {};
    hookHarness.state.messages = {};
    vi.mocked(listDesignFiles).mockReset().mockResolvedValue({ files: ['design/index.html'] });
    vi.mocked(getDesignDocument)
      .mockReset()
      .mockImplementation(async (_backendId: string, _sessionId: string, path: string) => ({
        path,
        source: '<html></html>',
        revision: REV_A,
      }));
    vi.mocked(createDesignSnapshot).mockReset().mockResolvedValue(SUMMARY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runId 非空→空触发完整流程：diff、refreshNow、恢复点快照与错误文案', async () => {
    hookHarness.state.messages['s1'] = [
      { id: 'u1', role: 'user', content: '生成页面' },
      { id: 'a1', role: 'assistant', content: '已写入。**Error:** 写入失败了一半' },
    ];
    vi.mocked(listDesignFiles).mockResolvedValue({
      files: ['design/index.html', 'design/new.html'],
    });
    vi.mocked(getDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: '<html></html>',
      revision: REV_B,
    });
    const { result, getWatchState, refreshNow } = mountFeedback(BEFORE);

    startRun('s1', 'run-1');
    expect(result.current.status).toBeNull();
    endRun('s1');
    expect(getWatchState).toHaveBeenCalledTimes(1); // before 在过渡时即捕获
    expect(listDesignFiles).not.toHaveBeenCalled(); // 防抖窗口内不动磁盘
    await settleDebounce();

    expect(listDesignFiles).toHaveBeenCalledWith('remote-1', 's1');
    expect(getDesignDocument).toHaveBeenCalledWith('remote-1', 's1', 'design/index.html');
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(createDesignSnapshot).toHaveBeenCalledTimes(1);
    expect(createDesignSnapshot).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      path: 'design/index.html',
      label: expect.stringMatching(/^Agent \d{2}-\d{2} \d{2}:\d{2}$/),
      source: 'manual',
    });
    expect(result.current.status).toEqual({
      text: 'Agent 已写入 2 个文件。运行报告了错误，详情见聊天。',
      diff: { addedFiles: ['design/new.html'], changedPages: ['design/index.html'] },
    });

    act(() => result.current.dismiss());
    expect(result.current.status).toBeNull();
  });

  it('无变化与无错误标记：未检测到变化文案，不建快照', async () => {
    hookHarness.state.messages['s1'] = [
      { id: 'a0', role: 'assistant', content: '**Error:** 更早的错误不计入' },
      { id: 'u1', role: 'user', content: '继续' },
      { id: 'a1', role: 'assistant', content: '本轮没有错误标记' },
    ];
    const { result, refreshNow } = mountFeedback(BEFORE);
    startRun('s1', 'run-1');
    endRun('s1');
    await settleDebounce();

    expect(result.current.status).toEqual({
      text: 'Agent 运行结束，未检测到设计文件变化',
      diff: { addedFiles: [], changedPages: [] },
    });
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(createDesignSnapshot).not.toHaveBeenCalled();
  });

  it('changedPages 逐页建快照（参数一致）；单页修订获取失败静默跳过', async () => {
    const before: DesignWatchState = {
      files: ['design/index.html'],
      openPages: [
        { path: 'design/index.html', docRevision: REV_A },
        { path: 'design/broken.html', docRevision: REV_A },
      ],
    };
    vi.mocked(getDesignDocument)
      .mockResolvedValueOnce({ path: 'design/index.html', source: '', revision: REV_B })
      .mockRejectedValueOnce(new Error('disk gone'));
    const { result } = mountFeedback(before);
    startRun('s1', 'run-1');
    endRun('s1');
    await settleDebounce();

    expect(createDesignSnapshot).toHaveBeenCalledTimes(1); // broken 页被跳过
    const call = vi.mocked(createDesignSnapshot).mock.calls[0];
    expect(call[0]).toBe('remote-1');
    expect(call[1]).toMatchObject({ sessionId: 's1', path: 'design/index.html', source: 'manual' });
    expect(call[1].label).toMatch(/^Agent \d{2}-\d{2} \d{2}:\d{2}$/);
    expect(result.current.status?.diff).toEqual({
      addedFiles: [],
      changedPages: ['design/index.html'],
    });
    expect(result.current.status?.text).toBe('Agent 已写入 1 个文件');
  });

  it('任一快照 rejected 时文案追加「（恢复点创建失败）」', async () => {
    const before: DesignWatchState = {
      files: ['design/index.html'],
      openPages: [
        { path: 'design/index.html', docRevision: REV_A },
        { path: 'design/other.html', docRevision: REV_A },
      ],
    };
    vi.mocked(getDesignDocument).mockImplementation(
      async (_backendId: string, _sessionId: string, path: string) => ({
        path,
        source: '',
        revision: REV_B,
      })
    );
    vi.mocked(createDesignSnapshot)
      .mockResolvedValueOnce(SUMMARY)
      .mockRejectedValueOnce(new Error('snapshot failed'));
    const { result } = mountFeedback(before);
    startRun('s1', 'run-1');
    endRun('s1');
    await settleDebounce();

    expect(createDesignSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.status?.text).toBe('Agent 已写入 2 个文件（恢复点创建失败）');
  });

  it('enabled=false 时过渡被忽略且不补触发；之后的新过渡正常触发', async () => {
    const { result, rerender, refreshNow } = mountFeedback(BEFORE, { enabled: false });
    startRun('s1', 'run-1');
    endRun('s1');
    await settleDebounce();
    expect(listDesignFiles).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();

    // 不补触发：启用后没有新过渡就不评估
    rerender({
      sessionId: 's1',
      backendId: 'remote-1',
      enabled: true,
      getWatchState: vi.fn(() => BEFORE),
      refreshNow,
    });
    await settleDebounce();
    expect(listDesignFiles).not.toHaveBeenCalled();

    // 新过渡（run 启动又结束）在 enabled 下正常触发
    startRun('s1', 'run-2');
    endRun('s1');
    await settleDebounce();
    expect(listDesignFiles).toHaveBeenCalledTimes(1);
    expect(result.current.status).not.toBeNull();
  });

  it('500ms 内二次过渡只评估一次（计时器重置，before 取最后一次捕获）', async () => {
    const getWatchState = vi
      .fn()
      .mockReturnValueOnce(BEFORE)
      .mockReturnValueOnce({ files: ['design/index.html'], openPages: [] });
    const { result } = mountFeedback(BEFORE, { getWatchState });
    startRun('s1', 'run-1');
    endRun('s1');
    await settleDebounce(200); // 仍在防抖窗口内
    expect(listDesignFiles).not.toHaveBeenCalled();
    startRun('s1', 'run-2');
    endRun('s1'); // 二次过渡：重置计时器与捕获值
    await settleDebounce();

    expect(getWatchState).toHaveBeenCalledTimes(2);
    expect(listDesignFiles).toHaveBeenCalledTimes(1);
    expect(getDesignDocument).not.toHaveBeenCalled(); // 第二次 before 无打开页
    expect(result.current.status?.diff).toEqual({
      addedFiles: [],
      changedPages: [],
    });
  });

  it('清单拉取失败：整轮放弃，保持初始等待态', async () => {
    vi.mocked(listDesignFiles).mockRejectedValue(new Error('offline'));
    const { result, refreshNow } = mountFeedback(BEFORE);
    startRun('s1', 'run-1');
    endRun('s1');
    await settleDebounce();

    expect(refreshNow).not.toHaveBeenCalled();
    expect(createDesignSnapshot).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it('卸载清理：订阅移除、防抖计时器不再触发 API', async () => {
    const { unmount } = mountFeedback(BEFORE);
    startRun('s1', 'run-1');
    unmount();
    expect(hookHarness.listenerCount()).toBe(0);
    endRun('s1'); // 无订阅，不产生任何通知
    await settleDebounce();
    expect(listDesignFiles).not.toHaveBeenCalled();
  });

  it('sessionId 切换：清 status、清挂起计时器并重置基线', async () => {
    const { result, rerender } = mountFeedback(BEFORE);
    startRun('s1', 'run-1');
    endRun('s1'); // 防抖计时器挂起
    rerender({
      sessionId: 's2',
      backendId: 'remote-1',
      enabled: true,
      getWatchState: vi.fn(() => BEFORE),
      refreshNow: vi.fn(),
    });
    await settleDebounce(); // 计时器已被清掉，s1 的评估不得执行
    expect(listDesignFiles).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();

    // s2 基线重置：s2 的 run 结束才会触发
    startRun('s2', 'run-2');
    endRun('s2');
    await settleDebounce();
    expect(listDesignFiles).toHaveBeenCalledWith('remote-1', 's2');
  });
});
