import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignPanel } from '../DesignPanel';
import { WorkspaceToolProvider } from '../../../components/workspace/WorkspaceToolContext';
import { useComposerStore } from '../../../stores/composerStore';
import * as api from '../api';
import * as preview from '../preview';
import { sha256HexSync } from '../html/hash';

vi.mock('../api', () => ({
  listDesignFiles: vi.fn(),
  getDesignDocument: vi.fn(),
  getDesignAsset: vi.fn(),
  putDesignDocument: vi.fn(),
  listDesignSnapshots: vi.fn(),
  createDesignSnapshot: vi.fn(),
  getDesignSnapshotDetail: vi.fn(),
  getDesignSnapshotFile: vi.fn(),
  restoreDesignSnapshot: vi.fn(),
}));
vi.mock('../preview', () => ({ buildDesignPreview: vi.fn(async () => '<html></html>') }));

const SOURCE = '<html><body><h1>Hello</h1></body></html>';
const sha = (source: string): string => sha256HexSync(source);

function mount(visible = true) {
  return render(
    <WorkspaceToolProvider
      sessionId="session-1"
      projectId="project-1"
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
          sourceText: 'Hello',
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          base: sha(source),
        },
      },
    })
  );
  return { frame, channel };
}

describe('DesignPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useComposerStore.setState({ drafts: {}, pendingPrefills: {} });
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: ['design/index.html'] });
    vi.mocked(api.getDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: SOURCE,
      revision: 'revision-1',
    });
    vi.mocked(api.getDesignAsset).mockResolvedValue({ mimeType: 'image/png', data: '' });
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([]);
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
    const styled = '<html><body><h1 style="color: #111111; background-color: #222222">Hello</h1></body></html>';
    vi.mocked(api.getDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: styled,
      revision: 'revision-1',
    });
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
    const { frame } = await selectElement();
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
              call[0].includes('style="color: #123456"')
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
});
