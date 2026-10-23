import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DesignPanel } from '../DesignPanel';
import { WorkspaceToolProvider } from '../../../components/workspace/WorkspaceToolContext';
import { useComposerStore } from '../../../stores/composerStore';
import { useChatMessageStore } from '../../../stores/chatMessageStore';
import { acquireWorkspaceController } from '../workspace/controller';
import { createWorkspacePorts } from '../workspace/api-adapter';
import * as api from '../api';
import * as preview from '../preview';
import { sha256HexSync } from '../html/hash';
import type { DesignDepsResult } from '../types';

vi.mock('../api', () => ({
  DesignSnapshotError: class extends Error {
    constructor(
      message: string,
      readonly code: string | undefined,
      readonly files: Array<{ path: string; reason?: string }> = []
    ) {
      super(message);
      this.name = 'DesignSnapshotError';
    }
  },
  listDesignFiles: vi.fn(),
  getDesignDocument: vi.fn(),
  getDesignAsset: vi.fn(),
  putDesignDocument: vi.fn(),
  getDesignDeps: vi.fn(),
  listDesignSnapshots: vi.fn(),
  createDesignSnapshot: vi.fn(),
  getDesignSnapshotDetail: vi.fn(),
  getDesignSnapshotFile: vi.fn(),
  restoreDesignSnapshot: vi.fn(),
  exportDesignZip: vi.fn(),
  isDesignHttpError: vi.fn(() => false),
}));
vi.mock('../preview', () => ({ buildDesignPreview: vi.fn(async () => '<html></html>') }));

const openFileMock = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ openFile: openFileMock }) },
}));
const saveBlobToFileMock = vi.fn();
vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: (...args: Parameters<typeof saveBlobToFileMock>) => saveBlobToFileMock(...args),
}));

const SOURCE = '<html><body><h1>Hello</h1></body></html>';
const sha = (source: string): string => sha256HexSync(source);
const pageSource = (text: string): string => `<html><body><h1>${text}</h1></body></html>`;
const depsResultFor = (path: string, mtimeMs: number): DesignDepsResult => ({
  entry: { path, size: 100, mtimeMs: 1 },
  files: [{ path: 'assets/a.css', kind: 'css', size: 10, mtimeMs, missing: false }],
  skipped: [],
});

/** 面板测试共享同一工作区 identity → 复用同一 controller 实例；清空其页面避免串扰。
 *  注意：registry 只认第一次 acquire 的 ports 工厂，这里必须传真实工厂。 */
function resetWorkspace() {
  const lease = acquireWorkspaceController(
    { backendId: 'remote-1', projectId: 'project-1', workingDirectory: '/work' },
    'session-1',
    id => createWorkspacePorts('remote-1', id)
  );
  for (const page of lease.controller.getSnapshot().pages) {
    lease.controller.close(page.path, { discardDraft: true });
  }
  lease.release();
  localStorage.clear();
  useChatMessageStore.setState({ messages: {} });
}

function mount(visible = true) {
  return render(
    <WorkspaceToolProvider
      sessionId="session-1"
      projectId="project-1"
      projectRoot="/work"
      workingDirectory="/work"
      backendId="remote-1"
      toolId="design"
      visible={visible}
    >
      <DesignPanel />
    </WorkspaceToolProvider>
  );
}

async function selectElement(source = SOURCE) {
  await waitFor(() => expect(preview.buildDesignPreview).toHaveBeenCalled());
  const frame = screen.getByTitle('设计预览') as HTMLIFrameElement;
  const calls = vi.mocked(preview.buildDesignPreview).mock.calls;
  const channel = calls[calls.length - 1]?.[3];
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        type: 'zclaudia:design-select',
        channel,
        selection: {
          elementPath: [0],
          tagName: 'h1',
          text: 'Rendered',
          sourceText: source.match(/<h1>(.*?)<\/h1>/)?.[1] ?? 'Hello',
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          base: sha(source),
        },
      },
    })
  );
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '元素文字' })).toBeInTheDocument()
  );
}

/** 通过「打开页面」下拉打开一个未打开的文件并等它的标签出现。 */
async function openPage(path: string) {
  fireEvent.click(screen.getByRole('button', { name: '打开页面' }));
  const option = await screen.findByRole('option', { name: path });
  fireEvent.click(option);
  const name = path.slice(path.lastIndexOf('/') + 1);
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) })).toBeInTheDocument()
  );
}

/** 等活动页预览就绪，发选择消息并应用一个文字编辑。 */
async function editActivePage(fromText: string, toText: string) {
  const source = pageSource(fromText);
  await waitFor(() =>
    expect(
      vi.mocked(preview.buildDesignPreview).mock.calls.some(call => call[0] === source)
    ).toBe(true)
  );
  await selectElement(source);
  fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
    target: { value: toText },
  });
  fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
}

/** 内存磁盘 + 按页写入的 put mock（期望值不匹配时抛 conflict）。 */
const disk = new Map<string, { source: string; revision: string }>();
let savedCounter = 0;

describe('DesignPanel', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetWorkspace();
    disk.clear();
    savedCounter = 0;
    useComposerStore.setState({ drafts: {}, pendingPrefills: {} });
    disk.set('design/index.html', { source: SOURCE, revision: 'revision-1' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: ['design/index.html'] });
    vi.mocked(api.getDesignDocument).mockImplementation((_backendId, _sessionId, path) => {
      const doc = disk.get(path);
      if (!doc) return Promise.reject(new Error(`FILE_NOT_FOUND: ${path}`));
      return Promise.resolve({ path, source: doc.source, revision: doc.revision });
    });
    vi.mocked(api.putDesignDocument).mockImplementation((_backendId, input) => {
      const current = disk.get(input.path);
      if (!current) {
        if (!input.allowCreate || input.expectedRevision !== '') {
          return Promise.reject(new Error(`FILE_NOT_FOUND: ${input.path}`));
        }
      } else if (input.expectedRevision !== current.revision) {
        return Promise.reject(
          new Error(`revision conflict: expected ${input.expectedRevision} but disk has ${current.revision}`)
        );
      }
      const saved = { path: input.path, source: input.source, revision: `saved-${++savedCounter}` };
      disk.set(input.path, saved);
      return Promise.resolve(saved);
    });
    vi.mocked(api.getDesignAsset).mockResolvedValue({ mimeType: 'image/png', data: '' });
    vi.mocked(api.getDesignDeps).mockResolvedValue(depsResultFor('design/index.html', 100));
    vi.mocked(api.createDesignSnapshot).mockResolvedValue({
      id: 'ds-1',
      entryPath: 'design/index.html',
      label: null,
      source: 'save',
      complete: true,
      incompleteReasons: [],
      fileCount: 1,
      totalBytes: SOURCE.length,
      createdAt: 1730000000000,
    });
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the first HTML file and pre-fills the bound composer while preserving its draft', async () => {
    useComposerStore.setState({
      drafts: {
        'session-1': {
          content: 'Existing request',
          attachments: [
            { id: 'a', type: 'file', name: 'notes.txt', data: 'data', mimeType: 'text/plain' },
          ],
        },
      },
      pendingPrefills: {},
    });
    mount();
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        'session-1',
        'design/index.html'
      )
    );
    fireEvent.click(await screen.findByRole('button', { name: '生成页面' }));
    const state = useComposerStore.getState();
    expect(state.pendingPrefills['session-1']?.content).toContain('Existing request');
    expect(state.pendingPrefills['session-1']?.content).toContain('design/index.html');
    expect(state.drafts['session-1']?.attachments).toHaveLength(1);
    expect(await screen.findByText('已填入当前聊天，补充需求后发送。')).toBeInTheDocument();
  });

  it('does not poll while its workspace host is hidden', () => {
    mount(false);
    expect(api.listDesignFiles).not.toHaveBeenCalled();
  });

  it('requires the workspace backend owner explicitly', () => {
    render(
      <WorkspaceToolProvider sessionId="session-1" toolId="design" visible>
        <DesignPanel />
      </WorkspaceToolProvider>
    );
    expect(screen.getByText('请连接当前会话后端，再打开设计面板。')).toBeInTheDocument();
    expect(api.listDesignFiles).not.toHaveBeenCalled();
  });

  it('ignores a pending document response after the workspace owner changes', async () => {
    let resolveOld!: (doc: { path: string; source: string; revision: string }) => void;
    const oldResponse = new Promise<{ path: string; source: string; revision: string }>(resolve => {
      resolveOld = resolve;
    });
    vi.mocked(api.getDesignDocument).mockImplementation((_backendId, sessionId) =>
      sessionId === 'session-old'
        ? oldResponse
        : Promise.resolve({
            path: 'design/index.html',
            source: '<html>new owner</html>',
            revision: 'new',
          })
    );
    const view = (sessionId: string, backendId: string) => (
      <WorkspaceToolProvider
        sessionId={sessionId}
        projectId="project-1"
        backendId={backendId}
        toolId="design"
        visible
      >
        <DesignPanel />
      </WorkspaceToolProvider>
    );
    const result = render(view('session-old', 'backend-old'));
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith(
        'backend-old',
        'session-old',
        'design/index.html'
      )
    );
    result.rerender(view('session-new', 'backend-new'));
    await waitFor(() =>
      expect(preview.buildDesignPreview).toHaveBeenCalledWith(
        '<html>new owner</html>',
        'design/index.html',
        expect.any(Function),
        expect.any(String),
        expect.any(String)
      )
    );
    await act(async () =>
      resolveOld({ path: 'design/index.html', source: '<html>old owner</html>', revision: 'old' })
    );
    expect(
      vi
        .mocked(preview.buildDesignPreview)
        .mock.calls.some(call => call[0] === '<html>old owner</html>')
    ).toBe(false);
  });

  it('keeps the selected element when polling returns an unchanged document', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    expect(await screen.findByRole('textbox', { name: '元素文字' })).toHaveValue('Hello');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 2100));
    });
    expect(screen.getByRole('textbox', { name: '元素文字' })).toHaveValue('Hello');
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
  });

  it('ignores a selection message bound to a stale draft revision', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await waitFor(() => expect(preview.buildDesignPreview).toHaveBeenCalled());
    const frame = screen.getByTitle('设计预览') as HTMLIFrameElement;
    const calls = vi.mocked(preview.buildDesignPreview).mock.calls;
    const channel = calls[calls.length - 1]?.[3];
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'zclaudia:design-select',
          channel,
          selection: {
            elementPath: [0],
            tagName: 'h1',
            text: 'Rendered',
            sourceText: 'Hello',
            base: 'stale-draft-revision',
          },
        },
      })
    );
    await waitFor(() => expect(api.getDesignDocument).toHaveBeenCalled());
    expect(screen.queryByRole('textbox', { name: '元素文字' })).not.toBeInTheDocument();
    expect(screen.getByText(/点击预览中的元素进行编辑/)).toBeInTheDocument();
  });

  it('maps an engine rejection to a hint when the patch is invalid', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '文字颜色' }), {
      target: { value: 'bad-color' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '应用修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('颜色值无效，请输入合法的 CSS 颜色');
  });

  it('reloads an unchanged document when explicitly reverting a dirty draft', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
  });

  it('writes the color onto the draft source and rebuilds the preview', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '文字颜色' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(preview.buildDesignPreview)
          .mock.calls.some(
            call =>
              typeof call[0] === 'string' &&
              call[0].includes('<h1 style="color: #123456">Hello</h1>')
          )
      ).toBe(true)
    );
    expect(vi.mocked(preview.buildDesignPreview)).toHaveBeenLastCalledWith(
      expect.any(String),
      'design/index.html',
      expect.any(Function),
      expect.any(String),
      expect.any(String)
    );
  });

  it('clears the inline text color from the source', async () => {
    const styled =
      '<html><body><h1 style="color: #111111; background-color: #222222">Hello</h1></body></html>';
    disk.set('design/index.html', { source: styled, revision: 'revision-1' });
    mount();
    await screen.findByTitle('设计预览');
    await selectElement(styled);
    fireEvent.click(await screen.findByRole('button', { name: '清除文字颜色' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(preview.buildDesignPreview)
          .mock.calls.some(
            call =>
              typeof call[0] === 'string' &&
              call[0].includes('style=" background-color: #222222"')
          )
      ).toBe(true)
    );
  });

  it('flags an override warning when the computed color differs from the written inline value', async () => {
    mount();
    await screen.findByTitle('设计预览');
    const { frame } = { frame: (await selectElementForFrame()) as HTMLIFrameElement };
    fireEvent.change(screen.getByRole('textbox', { name: '文字颜色' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(preview.buildDesignPreview)
          .mock.calls.some(
            call => typeof call[0] === 'string' && call[0].includes('style="color: #123456"')
          )
      ).toBe(true)
    );
    // The rebuilt preview triggers the verify request on iframe load.
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zclaudia:design-verify', elementPath: [0] }),
      '*'
    );
    const calls = vi.mocked(preview.buildDesignPreview).mock.calls;
    const channel = calls[calls.length - 1]?.[3];
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'zclaudia:design-verify-result',
          channel,
          elementPath: [0],
          color: 'rgb(0, 0, 255)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
        },
      })
    );
    expect(
      await screen.findByText(
        '修改已写入源码，但计算样式仍被外部样式覆盖（如 !important）；已按内联声明写入，未提高优先级。'
      )
    ).toBeInTheDocument();
  });

  it('disables undo and redo until the draft has history', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
  });

  it('auto-selects an HTML file that appears after an initially empty list', async () => {
    vi.mocked(api.listDesignFiles)
      .mockResolvedValueOnce({ files: [] })
      .mockResolvedValue({ files: ['pages/new.html'] });
    disk.set('pages/new.html', { source: SOURCE, revision: 'rev-new' });
    mount();
    await waitFor(() => expect(api.listDesignFiles).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '刷新设计文件' }));
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith('remote-1', 'session-1', 'pages/new.html')
    );
  });

  it('preserves the edited draft and reports a save revision conflict', async () => {
    vi.mocked(api.putDesignDocument).mockRejectedValue(new Error('revision conflict'));
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision conflict');
    expect(screen.getByText(/已在其他位置更新/)).toBeInTheDocument();
    expect(api.putDesignDocument).toHaveBeenCalledWith(
      'remote-1',
      expect.objectContaining({ expectedRevision: 'revision-1' })
    );
  });

  it('clears the external-change flag after a subsequent successful save', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());

    // 第一次保存：磁盘已前进 → 冲突，草稿保留并置 externalChange。
    vi.mocked(api.putDesignDocument).mockRejectedValueOnce(new Error('revision conflict'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision conflict');
    expect(screen.getByText(/已在其他位置更新/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '元素文字' })).toHaveValue('Changed');

    // 第二次保存成功（mock 队列已消费，回到磁盘校验实现）：标志清除。
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(screen.queryByText(/已在其他位置更新/)).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads the version list when the version history section is expanded', async () => {
    mount();
    await screen.findByTitle('设计预览');
    expect(screen.getByRole('button', { name: '版本历史' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(api.listDesignSnapshots).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    await waitFor(() =>
      expect(api.listDesignSnapshots).toHaveBeenCalledWith(
        'remote-1',
        'session-1',
        'design/index.html'
      )
    );
    expect(screen.getByRole('button', { name: '版本历史' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(await screen.findByText(/暂无版本快照/)).toBeInTheDocument();
  });

  it('keeps three pages independent across tab switches and saves each page separately', async () => {
    disk.set('p1.html', { source: pageSource('A'), revision: 'rev-a' });
    disk.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    disk.set('p3.html', { source: pageSource('C'), revision: 'rev-c' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({
      files: ['p1.html', 'p2.html', 'p3.html'],
    });
    mount();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /p1\.html/ })).toBeInTheDocument()
    );
    await openPage('p2.html');
    await openPage('p3.html');

    // 各页分别做一次文字编辑（互不串扰）。
    await editActivePage('C', 'C!');
    fireEvent.click(screen.getByRole('tab', { name: /p1\.html/ }));
    await editActivePage('A', 'A!');
    fireEvent.click(screen.getByRole('tab', { name: /p2\.html/ }));
    await editActivePage('B', 'B!');

    // 切回前两页：草稿各自保留。
    fireEvent.click(screen.getByRole('tab', { name: /p1\.html/ }));
    expect(await screen.findByRole('textbox', { name: '元素文字' })).toHaveValue('A!');
    fireEvent.click(screen.getByRole('tab', { name: /p2\.html/ }));
    expect(await screen.findByRole('textbox', { name: '元素文字' })).toHaveValue('B!');

    // 逐页保存：PUT 按页携带各自的 source 与 expectedRevision。
    fireEvent.click(screen.getByRole('tab', { name: /p1\.html/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.putDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({
          path: 'p1.html',
          source: pageSource('A!'),
          expectedRevision: 'rev-a',
        })
      )
    );
    fireEvent.click(screen.getByRole('tab', { name: /p2\.html/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.putDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({
          path: 'p2.html',
          source: pageSource('B!'),
          expectedRevision: 'rev-b',
        })
      )
    );
    fireEvent.click(screen.getByRole('tab', { name: /p3\.html/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.putDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({
          path: 'p3.html',
          source: pageSource('C!'),
          expectedRevision: 'rev-c',
        })
      )
    );
    expect(api.putDesignDocument).toHaveBeenCalledTimes(3);
    expect(disk.get('p1.html')?.source).toBe(pageSource('A!'));
    expect(disk.get('p2.html')?.source).toBe(pageSource('B!'));
    expect(disk.get('p3.html')?.source).toBe(pageSource('C!'));
  });

  it('rebuilds the preview when dependency stats change without a document change', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getDesignDeps)
        .mockResolvedValueOnce(depsResultFor('design/index.html', 100))
        .mockResolvedValue(depsResultFor('design/index.html', 200));
      mount();
      // RTL 的 waitFor 在 fake timers 下不推进时间，这里全部用显式推进。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
      });
      // 首轮：发现并载入页面，预览构建一次。
      expect(preview.buildDesignPreview).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(0);
      });
      // 第二轮：首次依赖采样只建立基线，不重建预览。
      expect(preview.buildDesignPreview).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(0);
      });
      // 第三轮：CSS mtime 变化 → assetEpoch+1 → 预览重建。
      expect(preview.buildDesignPreview).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes after a chat message fingerprint change with a 400ms debounce', async () => {
    vi.useFakeTimers();
    try {
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsAfterMount = vi.mocked(api.listDesignFiles).mock.calls.length;
      expect(callsAfterMount).toBeGreaterThan(0);
      useChatMessageStore.setState({
        messages: {
          'session-1': [
            { id: 'm1', sessionId: 'session-1', role: 'user', content: 'hi', createdAt: 1 },
          ],
        },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(399);
      });
      expect(vi.mocked(api.listDesignFiles).mock.calls.length).toBe(callsAfterMount);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(vi.mocked(api.listDesignFiles).mock.calls.length).toBeGreaterThan(callsAfterMount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('confirms before closing a dirty page: discarding removes it, saving closes it', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '关闭 design/index.html' }));
    const dialog = screen.getByRole('dialog', { name: '关闭前保存' });
    expect(within(dialog).getByText(/关闭前要保存这些修改吗/)).toBeInTheDocument();

    // 放弃修改：页面直接移除。
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }));
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /design\/index\.html/ })).not.toBeInTheDocument()
    );

    // 重新打开并编辑后关闭：保存成功再关闭。
    await openPage('design/index.html');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed again' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '关闭 design/index.html' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '关闭前保存' })).getByRole('button', {
        name: '保存',
      })
    );
    await waitFor(() =>
      expect(api.putDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({ path: 'design/index.html', source: expect.stringContaining('Changed again') })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /design\/index\.html/ })).not.toBeInTheDocument()
    );
  });

  it('marks a vanished file missing with a banner and rebuilds it via allowCreate on save', async () => {
    mount();
    await screen.findByTitle('设计预览');
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: [] });
    disk.delete('design/index.html');
    fireEvent.click(screen.getByRole('button', { name: '刷新设计文件' }));
    await waitFor(() =>
      expect(screen.getByLabelText('文件缺失 design/index.html')).toBeInTheDocument()
    );
    expect(
      screen.getByText('此文件已从工作区消失；可保存以重建文件，或关闭页面。')
    ).toBeInTheDocument();

    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Rebuilt' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.putDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({
          path: 'design/index.html',
          expectedRevision: '',
          allowCreate: true,
        })
      )
    );
    expect(disk.get('design/index.html')?.source).toContain('Rebuilt');
  });

  it('查看源码：以活动页草稿行号打开文件查看器（projectRoot/backendId 来自面板上下文）', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith('/work', 'design/index.html', 1, 1, 'remote-1');
  });

  it('dirty 页显示行号偏移提示，保存后消失', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    expect(
      screen.queryByText('文件查看器显示已保存版本，行号以草稿计算可能有偏移')
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(
      screen.getByText('文件查看器显示已保存版本，行号以草稿计算可能有偏移')
    ).toBeInTheDocument();
  });

  it('干净页直接以 disk 模式导出并提示已导出；未保存差异按钮禁用', async () => {
    vi.mocked(api.exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'index-20261023.zip',
    });
    saveBlobToFileMock.mockResolvedValue('/Downloads/index-20261023.zip');
    mount();
    await screen.findByTitle('设计预览');
    expect(screen.getByRole('button', { name: '未保存差异' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() =>
      expect(api.exportDesignZip).toHaveBeenCalledWith('remote-1', {
        sessionId: 'session-1',
        path: 'design/index.html',
        mode: 'disk',
        expectedRevision: 'revision-1',
      })
    );
    expect(saveBlobToFileMock).toHaveBeenCalledWith(expect.any(Blob), 'index-20261023.zip');
    expect(await screen.findByText('已导出：index-20261023.zip')).toBeInTheDocument();
  });

  it('dirty 页导出三选：保存并导出先落盘保存再以新修订导出', async () => {
    mount();
    await screen.findByTitle('设计预览');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '未保存差异' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const dialog = await screen.findByRole('dialog', { name: '导出' });
    expect(within(dialog).getByText(/有未保存的修改/)).toBeInTheDocument();
    expect(api.exportDesignZip).not.toHaveBeenCalled();

    vi.mocked(api.exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'saved-export.zip',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存并导出' }));
    await waitFor(() =>
      expect(api.putDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({ path: 'design/index.html', source: expect.stringContaining('Changed') })
      )
    );
    await waitFor(() =>
      expect(api.exportDesignZip).toHaveBeenCalledWith('remote-1', {
        sessionId: 'session-1',
        path: 'design/index.html',
        mode: 'disk',
        expectedRevision: 'saved-1',
      })
    );
    expect(await screen.findByText('已导出：saved-export.zip')).toBeInTheDocument();
  });

  it('未保存差异：dirty 时可打开草稿与磁盘的行级对比，干净页禁用', async () => {
    mount();
    await screen.findByTitle('设计预览');
    expect(screen.getByRole('button', { name: '未保存差异' })).toBeDisabled();

    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: '元素文字' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '未保存差异' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '未保存差异' }));
    const dialog = await screen.findByRole('dialog', { name: '未保存差异' });
    expect(within(dialog).getByText('未保存差异 · index.html')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith('remote-1', 'session-1', 'design/index.html')
    );
    // lineDiff 输出：删除行（磁盘 Hello 版）+ 新增行（草稿 Changed 版）。
    expect(within(dialog).getByText('<html><body><h1>Hello</h1></body></html>')).toBeInTheDocument();
    expect(
      within(dialog).getByText('<html><body><h1>Changed</h1></body></html>')
    ).toBeInTheDocument();
  });
});

/** helper: wait for the preview then return the main preview iframe. */
async function selectElementForFrame() {
  await selectElement();
  return screen.getByTitle('设计预览');
}
