import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SharePanel } from '../components/SharePanel';
import type { SharePanelProps } from '../components/SharePanel';
import {
  createDesignShare,
  getDesignSnapshotFile,
  listDesignShareComments,
  listDesignShares,
  listDesignSnapshots,
  revokeDesignShare,
  setDesignShareCommentResolved,
} from '../api';
import type {
  DesignShareComment,
  DesignShareSummary,
  DesignSnapshotSummary,
} from '../api';

vi.mock('../api', () => ({
  createDesignShare: vi.fn(),
  listDesignShares: vi.fn(),
  revokeDesignShare: vi.fn(),
  listDesignShareComments: vi.fn(),
  setDesignShareCommentResolved: vi.fn(),
  listDesignSnapshots: vi.fn(),
  getDesignSnapshotFile: vi.fn(),
}));

// shareUrl 推导依赖 base url（store 读取）；桩为确定值。
vi.mock('../../../services/api/base', () => ({
  getBaseUrlForBackend: vi.fn(() => 'http://127.0.0.1:4123'),
}));

const SERVER_BASE = 'http://127.0.0.1:4123';
const REVOKE_CONFIRM_TEXT = '撤销后链接立即失效且不可恢复，确认撤销？';

function makeShare(overrides: Partial<DesignShareSummary> = {}): DesignShareSummary {
  return {
    id: 'sh-1',
    token: 'tok-1',
    snapshotId: 'ds-1',
    entryPath: 'design/index.html',
    title: '首发审阅',
    scope: 'link',
    createdAt: new Date('2026-10-23T10:00:00').getTime(),
    expiresAt: null,
    revokedAt: null,
    commentCount: 2,
    lastAccessAt: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DesignSnapshotSummary> = {}): DesignSnapshotSummary {
  return {
    id: 'ds-1',
    entryPath: 'design/index.html',
    label: null,
    source: 'save',
    complete: true,
    incompleteReasons: [],
    fileCount: 1,
    totalBytes: 100,
    createdAt: new Date('2026-10-23T10:00:00').getTime(),
    ...overrides,
  };
}

function makeComment(overrides: Partial<DesignShareComment> = {}): DesignShareComment {
  return {
    id: 'c1',
    author: '审阅人',
    body: '这里的标题文案不对',
    target: null,
    createdAt: new Date('2026-10-23T11:00:00').getTime(),
    resolvedAt: null,
    ...overrides,
  };
}

/** 当前磁盘入口源码：<h1>标题文本</h1> + <p>段落一</p>。 */
const CURRENT_SOURCE = '<html><body><h1>标题文本</h1><p>段落一</p></body></html>';

/** UTF-8 安全的 base64（btoa 直接编码中文会抛 InvalidCharacterError）。 */
function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function mount(overrides: Partial<SharePanelProps> = {}) {
  const props: SharePanelProps = {
    open: true,
    onClose: vi.fn(),
    backendId: 'remote-1',
    sessionId: 's1',
    docPath: 'design/index.html',
    currentSource: CURRENT_SOURCE,
    onHandoff: vi.fn(),
    ...overrides,
  };
  const utils = render(<SharePanel {...props} />);
  return {
    props,
    rerender: (next: Partial<SharePanelProps> = {}) =>
      utils.rerender(<SharePanel {...props} {...next} />),
  };
}

/** 自定义 Select（listbox）：点开触发器后按文案点选项。 */
async function pickOption(triggerLabel: string, optionLabel: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
  fireEvent.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('SharePanel（P7 §7.1）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDesignSnapshots).mockResolvedValue([
      makeSnapshot({ id: 'ds-2', label: 'V2', createdAt: new Date('2026-10-23T12:00:00').getTime() }),
      makeSnapshot({ id: 'ds-1' }),
    ]);
    // 缺省一条进行中的分享：审阅评论 tab 依赖它提供下拉缺省选中项。
    vi.mocked(listDesignShares).mockResolvedValue({ shares: [makeShare()] });
    vi.mocked(listDesignShareComments).mockResolvedValue({ comments: [] });
    vi.mocked(createDesignShare).mockResolvedValue({
      share: makeShare({ id: 'sh-new', token: 'tok-new' }),
      shareUrl: `${SERVER_BASE}/s/tok-new`,
      lanUrls: [`${SERVER_BASE}/s/tok-new`],
    });
    vi.mocked(revokeDesignShare).mockResolvedValue({
      share: makeShare({ revokedAt: new Date('2026-10-24T12:00:00').getTime() }),
    });
    vi.mocked(setDesignShareCommentResolved).mockResolvedValue({ comment: makeComment() });
    vi.mocked(getDesignSnapshotFile).mockResolvedValue({
      path: 'design/index.html',
      data: toBase64Utf8(CURRENT_SOURCE),
    });
  });

  it('空态：无活动页 / 无会话只显示提示，不发任何请求；open=false 不渲染也不发请求', async () => {
    const { rerender } = mount({ docPath: null });
    expect(screen.getByText('先打开一个页面再管理分享')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(listDesignSnapshots).not.toHaveBeenCalled();
    expect(listDesignShares).not.toHaveBeenCalled();

    rerender({ docPath: 'design/index.html', sessionId: null });
    expect(screen.getByText('先打开一个页面再管理分享')).toBeInTheDocument();
    expect(listDesignSnapshots).not.toHaveBeenCalled();

    rerender({ open: false, sessionId: 's1', docPath: 'design/index.html' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(listDesignSnapshots).not.toHaveBeenCalled());
    expect(listDesignShares).not.toHaveBeenCalled();
  });

  it('Tab1 初始渲染：版本下拉缺省最新一条；分享行状态 chip 三态 + 链接/访问信息', async () => {
    vi.mocked(listDesignShares).mockResolvedValue({
      shares: [
        makeShare({ id: 'sh-1' }),
        makeShare({ id: 'sh-2', token: 'tok-2', revokedAt: new Date('2026-10-23T12:00:00').getTime() }),
        makeShare({
          id: 'sh-3',
          token: 'tok-3',
          title: null,
          expiresAt: Date.now() - 1000,
          lastAccessAt: new Date('2026-10-23T13:00:00').getTime(),
        }),
      ],
    });
    mount();

    // 版本下拉缺省最新（newest first 的第一条，有 label 显示 label）。
    const versionTrigger = await screen.findByRole('button', { name: '分享版本' });
    expect(versionTrigger).toHaveTextContent('V2');

    const activeRow = await screen.findByTestId('share-row-sh-1');
    expect(within(activeRow).getByText('进行中')).toBeInTheDocument();
    expect(within(activeRow).getByText('首发审阅')).toBeInTheDocument();
    expect(within(activeRow).getByText(`${SERVER_BASE}/s/tok-1`)).toBeInTheDocument();
    expect(within(activeRow).getByText('2 条评论 · 未访问')).toBeInTheDocument();
    const openLink = within(activeRow).getByRole('link', { name: '打开分享 sh-1' });
    expect(openLink).toHaveAttribute('href', `${SERVER_BASE}/s/tok-1`);
    expect(openLink).toHaveAttribute('target', '_blank');
    expect(openLink).toHaveAttribute('rel', 'noreferrer');
    expect(within(activeRow).getByRole('button', { name: '复制链接 sh-1' })).toBeInTheDocument();

    const revokedRow = screen.getByTestId('share-row-sh-2');
    expect(within(revokedRow).getByText('已撤销')).toBeInTheDocument();
    expect(
      within(revokedRow).queryByRole('button', { name: '撤销分享 sh-2' })
    ).not.toBeInTheDocument();

    const expiredRow = screen.getByTestId('share-row-sh-3');
    expect(within(expiredRow).getByText('已过期')).toBeInTheDocument();
    expect(within(expiredRow).getByText('（未命名分享）')).toBeInTheDocument();
    expect(within(expiredRow).getByText(/最近访问 /)).toBeInTheDocument();
  });

  it('复制按钮：clipboard 成功显示「已复制」；失败退回 window.prompt', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    vi.mocked(listDesignShares).mockResolvedValue({ shares: [makeShare()] });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: '复制链接 sh-1' }));
    await waitFor(() => expect(promptSpy).toHaveBeenCalledWith('复制失败，请手动复制该链接', `${SERVER_BASE}/s/tok-1`));
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制链接 sh-1' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${SERVER_BASE}/s/tok-1`));
    expect(await screen.findByText('已复制')).toBeInTheDocument();
    promptSpy.mockRestore();
  });

  it('创建流程：表单参数上抛（scope/expiresInDays/title）→ 成功展示链接结果区并刷新列表', async () => {
    vi.mocked(listDesignShares)
      .mockResolvedValueOnce({ shares: [makeShare()] })
      .mockResolvedValueOnce({
        shares: [makeShare({ id: 'sh-new', token: 'tok-new', commentCount: 0 }), makeShare()],
      });
    mount();
    await screen.findByTestId('share-row-sh-1');

    fireEvent.change(screen.getByLabelText('分享标题'), { target: { value: '  首发版本  ' } });
    await pickOption('访问范围', '仅本机');
    await pickOption('有效期', '7 天');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));

    await waitFor(() =>
      expect(createDesignShare).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        snapshotId: 'ds-2',
        scope: 'local',
        expiresInDays: 7,
        title: '首发版本',
      })
    );
    const result = await screen.findByTestId('share-created-result');
    expect(within(result).getByText('分享链接已创建：')).toBeInTheDocument();
    expect(within(result).getByText(`${SERVER_BASE}/s/tok-new`)).toBeInTheDocument();
    expect(within(result).getByRole('button', { name: '复制新分享链接' })).toBeInTheDocument();
    expect(within(result).getByText(/局域网地址（需服务端开启 LAN 监听）/)).toBeInTheDocument();
    await screen.findByTestId('share-row-sh-new');
    expect(listDesignShares).toHaveBeenCalledTimes(2);

    // 改回缺省组合：scope=link、永久、无标题 → null/缺省映射。
    await pickOption('访问范围', '任何持有链接的人');
    await pickOption('有效期', '永久');
    fireEvent.change(screen.getByLabelText('分享标题'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    await waitFor(() =>
      expect(createDesignShare).toHaveBeenLastCalledWith('remote-1', {
        sessionId: 's1',
        snapshotId: 'ds-2',
        scope: 'link',
        expiresInDays: null,
        title: null,
      })
    );
  });

  it('撤销确认：confirm 取消不调用；确认后调用 revoke 并刷新列表', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(listDesignShares)
      .mockResolvedValueOnce({ shares: [makeShare()] })
      .mockResolvedValueOnce({
        shares: [makeShare({ revokedAt: new Date('2026-10-24T12:00:00').getTime() })],
      });
    mount();
    const row = await screen.findByTestId('share-row-sh-1');

    fireEvent.click(within(row).getByRole('button', { name: '撤销分享 sh-1' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(REVOKE_CONFIRM_TEXT));
    expect(revokeDesignShare).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(within(row).getByRole('button', { name: '撤销分享 sh-1' }));
    await waitFor(() =>
      expect(revokeDesignShare).toHaveBeenCalledWith('remote-1', { sessionId: 's1', shareId: 'sh-1' })
    );
    await waitFor(() => expect(listDesignShares).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('已撤销')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('Tab2 评论渲染：下拉只列未撤销分享；定位 chip / 整页评论 / 失效徽章 / 已解决徽章', async () => {
    vi.mocked(listDesignShares).mockResolvedValue({
      shares: [
        makeShare({ id: 'sh-1' }),
        makeShare({ id: 'sh-2', token: 'tok-2', title: '已撤销的分享', revokedAt: 1 }),
      ],
    });
    vi.mocked(listDesignShareComments).mockResolvedValue({
      comments: [
        makeComment({
          id: 'c-ok',
          target: { elementPath: [0], tagName: 'h1', text: '标题文本' },
        }),
        makeComment({
          id: 'c-path',
          body: '这个元素没了',
          target: { elementPath: [9], tagName: 'p', text: '不存在' },
        }),
        makeComment({
          id: 'c-text',
          body: '段落文案已改',
          target: { elementPath: [1], tagName: 'p', text: '段落二' },
        }),
        makeComment({ id: 'c-page', resolvedAt: new Date('2026-10-23T12:00:00').getTime() }),
      ],
    });
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: '审阅评论' }));

    await screen.findByTestId('share-comment-c-ok');
    expect(listDesignShareComments).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      shareId: 'sh-1',
    });

    // 下拉只含未撤销分享。
    fireEvent.click(screen.getByRole('button', { name: '选择分享' }));
    expect(screen.getByRole('option', { name: /首发审阅 ·/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /已撤销的分享 ·/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    const okRow = screen.getByTestId('share-comment-c-ok');
    expect(within(okRow).getByText('定位：h1 标题文本')).toBeInTheDocument();
    expect(within(okRow).queryByText(/定位失效/)).not.toBeInTheDocument();

    const pathRow = screen.getByTestId('share-comment-c-path');
    expect(within(pathRow).getByText('定位失效：路径越界')).toBeInTheDocument();

    const textRow = screen.getByTestId('share-comment-c-text');
    expect(within(textRow).getByText('定位失效：文本已变化')).toBeInTheDocument();

    const pageRow = screen.getByTestId('share-comment-c-page');
    expect(within(pageRow).getByText('整页评论')).toBeInTheDocument();
    expect(within(pageRow).getByText('已解决')).toBeInTheDocument();
    expect(within(pageRow).getByRole('button', { name: '取消解决 c-page' })).toBeInTheDocument();
    expect(
      within(pageRow).queryByRole('button', { name: '交给 Agent 修改 c-page' })
    ).not.toBeInTheDocument();
    expect(
      within(okRow).getByRole('button', { name: '交给 Agent 修改 c-ok' })
    ).toBeInTheDocument();
  });

  it('解决切换：标记解决 / 取消解决调用参数正确并刷新评论', async () => {
    vi.mocked(listDesignShareComments)
      .mockResolvedValueOnce({ comments: [makeComment({ id: 'c1' })] })
      .mockResolvedValueOnce({
        comments: [makeComment({ id: 'c1', resolvedAt: new Date('2026-10-24T12:00:00').getTime() })],
      });
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: '审阅评论' }));
    const row = await screen.findByTestId('share-comment-c1');

    fireEvent.click(within(row).getByRole('button', { name: '标记解决 c1' }));
    await waitFor(() =>
      expect(setDesignShareCommentResolved).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        shareId: 'sh-1',
        commentId: 'c1',
        resolved: true,
      })
    );
    await waitFor(() => expect(listDesignShareComments).toHaveBeenCalledTimes(2));

    const resolvedRow = await screen.findByTestId('share-comment-c1');
    fireEvent.click(within(resolvedRow).getByRole('button', { name: '取消解决 c1' }));
    await waitFor(() =>
      expect(setDesignShareCommentResolved).toHaveBeenLastCalledWith('remote-1', {
        sessionId: 's1',
        shareId: 'sh-1',
        commentId: 'c1',
        resolved: false,
      })
    );
  });

  it('交接：快照源码 base64 解码后组 buildReviewHandoff，onHandoff 收到含评论正文与「任务指令」的 prompt', async () => {
    // 分享指向 ds-2（有 label V2）：交接段应带上 Tab1 快照列表里的元数据。
    vi.mocked(listDesignShares).mockResolvedValue({
      shares: [makeShare({ snapshotId: 'ds-2' })],
    });
    vi.mocked(listDesignShareComments).mockResolvedValue({
      comments: [
        makeComment({
          id: 'c1',
          body: '请把标题改成「新品上市」',
          target: { elementPath: [0], tagName: 'h1', text: '标题文本' },
        }),
      ],
    });
    const { props } = mount();
    fireEvent.click(await screen.findByRole('tab', { name: '审阅评论' }));
    const row = await screen.findByTestId('share-comment-c1');

    fireEvent.click(within(row).getByRole('button', { name: '交给 Agent 修改 c1' }));
    expect(getDesignSnapshotFile).toHaveBeenCalledWith('remote-1', 's1', 'ds-2', 'design/index.html');
    await waitFor(() => expect(props.onHandoff).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(props.onHandoff).mock.calls[0][0];
    expect(prompt).toContain('请把标题改成「新品上市」');
    expect(prompt).toContain('任务指令');
    expect(prompt).toContain('修改当前页面 design/index.html');
    // 快照元数据取自 Tab1 加载的快照列表（最新一条 label）。
    expect(prompt).toContain('V2');
  });

  it('交接容错：快照源码读取失败仍调用 onHandoff，prompt 标注「快照源码不可用」', async () => {
    vi.mocked(getDesignSnapshotFile).mockRejectedValue(new Error('snapshot gone'));
    vi.mocked(listDesignShareComments).mockResolvedValue({
      comments: [makeComment({ id: 'c1', body: '请检查排版' })],
    });
    const { props } = mount();
    fireEvent.click(await screen.findByRole('tab', { name: '审阅评论' }));
    const row = await screen.findByTestId('share-comment-c1');

    fireEvent.click(within(row).getByRole('button', { name: '交给 Agent 修改 c1' }));
    await waitFor(() => expect(props.onHandoff).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(props.onHandoff).mock.calls[0][0];
    expect(prompt).toContain('请检查排版');
    expect(prompt).toContain('快照源码不可用');
  });
});
