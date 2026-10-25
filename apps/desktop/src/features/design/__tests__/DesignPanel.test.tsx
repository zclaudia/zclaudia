import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DesignPanel, isValidRulesMessage } from '../DesignPanel';
import { WorkspaceToolProvider } from '../../../components/workspace/WorkspaceToolContext';
import { useComposerStore } from '../../../stores/composerStore';
import { useDesignLayoutStore } from '../stores/designLayoutStore';
import { useChatMessageStore } from '../../../stores/chatMessageStore';
import { ApiError } from '../../../services/api/unwrap';
import { acquireWorkspaceController } from '../workspace/controller';
import { createWorkspacePorts } from '../workspace/api-adapter';
import { discardAllCssDrafts } from '../css-drafts';
import * as api from '../api';
import * as preview from '../preview';
import * as interactive from '../interactive';
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
  listDesignAssets: vi.fn(),
  putDesignDocument: vi.fn(),
  getDesignDeps: vi.fn(),
  listDesignSnapshots: vi.fn(),
  createDesignSnapshot: vi.fn(),
  getDesignSnapshotDetail: vi.fn(),
  getDesignSnapshotFile: vi.fn(),
  restoreDesignSnapshot: vi.fn(),
  exportDesignZip: vi.fn(),
  isDesignHttpError: vi.fn(() => false),
  listDesignTemplates: vi.fn(),
  installDesignTemplate: vi.fn(),
  getDesignBrand: vi.fn(),
  putDesignBrand: vi.fn(),
  importDesignAsset: vi.fn(),
  createDesignMediaTask: vi.fn(),
  listDesignMediaTasks: vi.fn(),
  cancelDesignMediaTask: vi.fn(),
  listDesignMediaProviders: vi.fn(),
  downloadDesignMediaTaskResult: vi.fn(),
  createDesignShare: vi.fn(),
  listDesignShares: vi.fn(),
  revokeDesignShare: vi.fn(),
  listDesignShareComments: vi.fn(),
  setDesignShareCommentResolved: vi.fn(),
}));
vi.mock('../preview', () => ({ buildDesignPreview: vi.fn(async () => '<html></html>') }));
vi.mock('../interactive', () => ({
  buildDesignRunPreview: vi.fn(
    async () => ({ html: '<html></html>', blocked: { scripts: 0, links: 0 } })
  ),
}));

/** run 反馈 hook 的受控返回值（横幅用例直接改 status + rerender）。 */
const runFeedbackMock = vi.hoisted(() => ({
  status: null as {
    text: string;
    diff: { addedFiles: string[]; changedPages: string[] };
  } | null,
  dismiss: vi.fn(),
}));
vi.mock('../agent-run-watch', () => ({
  useAgentRunFeedback: vi.fn(() => runFeedbackMock),
}));

/** L17 三个对话框按既有 mock 风格打桩：只验证接线（open/回调），内部行为有专属测试文件。 */
vi.mock('../components/TemplateDialog', () => ({
  TemplateDialog: (props: { open: boolean; onClose: () => void; onInstalled: (entry: string) => void }) =>
    props.open ? (
      <div data-testid="template-dialog">
        <button type="button" onClick={() => props.onInstalled('design/landing/index.html')}>
          mock-install and open entry
        </button>
        <button type="button" onClick={props.onClose}>mock-close templates</button>
      </div>
    ) : null,
}));
vi.mock('../components/BrandPanel', () => ({
  BrandPanel: (props: { open: boolean; onClose: () => void; onSaved: () => void }) =>
    props.open ? (
      <div data-testid="brand-panel">
        <button type="button" onClick={props.onSaved}>mock-save brand</button>
        <button type="button" onClick={props.onClose}>mock-close brand</button>
      </div>
    ) : null,
}));
vi.mock('../components/AssetLibrary', () => ({
  AssetLibrary: (props: { open: boolean; onClose: () => void; onImported: (path: string) => void }) =>
    props.open ? (
      <div data-testid="asset-library">
        <button type="button" onClick={() => props.onImported('assets/logo.png')}>
          mock-import asset
        </button>
        <button type="button" onClick={props.onClose}>mock-close assets</button>
      </div>
    ) : null,
}));

/** P5 三组件（L23/L24）按既有 mock 风格打桩：只断言挂载与回调连线（专属测试文件覆盖内部行为）。 */
vi.mock('../components/DeckPanel', () => ({
  DeckPanel: (props: {
    open: boolean;
    page: { path: string; source: string; busy: boolean } | null;
    previewHtml: string | null;
    deck: { slides: unknown[]; ratio: string } | null;
    onCommit: (source: string, label: string) => Promise<boolean>;
    onPresent: (index: number) => void;
    onClose: () => void;
  }) =>
    props.open ? (
      <div data-testid="deck-panel">
        <span data-testid="deck-panel-page">{props.page?.path ?? ''}</span>
        <span data-testid="deck-panel-slides">
          {props.deck ? props.deck.slides.length : 'none'}
        </span>
        <span data-testid="deck-panel-ratio">{props.deck?.ratio ?? 'none'}</span>
        <span data-testid="deck-panel-preview">
          {props.previewHtml === null ? 'building' : 'ready'}
        </span>
        <button
          type="button"
          onClick={() =>
            void props.onCommit(
              '<html><body><section data-zclaudia-slide data-title="改">X</section></body></html>',
              '测试提交'
            )
          }
        >
          mock-commit slides
        </button>
        <button type="button" onClick={() => props.onPresent(1)}>mock-present</button>
        <button type="button" onClick={props.onClose}>mock-close slides</button>
      </div>
    ) : null,
}));
vi.mock('../components/DeckPresenter', () => ({
  DeckPresenter: (props: {
    slides: unknown[];
    ratio: string;
    previewHtml: string | null;
    startIndex: number;
    onClose: () => void;
  }) => (
    <div data-testid="deck-presenter">
      <span data-testid="deck-presenter-start">{props.startIndex}</span>
      <span data-testid="deck-presenter-slides">{props.slides.length}</span>
      <span data-testid="deck-presenter-ratio">{props.ratio}</span>
      <button type="button" onClick={props.onClose}>mock-close presenter</button>
    </div>
  ),
}));
vi.mock('../components/RenderExportDialog', () => ({
  RenderExportDialog: (props: {
    open: boolean;
    entryPath: string;
    previewHtml: string | null;
    deck: { slides: unknown[]; ratio: string } | null;
    viewport: { preset: string; width: number | null };
    onClose: () => void;
  }) =>
    props.open ? (
      <div data-testid="render-export-dialog">
        <span data-testid="render-export-entry">{props.entryPath}</span>
        <span data-testid="render-export-deck">
          {props.deck ? `${props.deck.slides.length}:${props.deck.ratio}` : 'none'}
        </span>
        <span data-testid="render-export-viewport">
          {`${props.viewport.preset}:${props.viewport.width === null ? 'null' : props.viewport.width}`}
        </span>
        <button type="button" onClick={props.onClose}>mock-close render export</button>
      </div>
    ) : null,
}));
vi.mock('../components/MediaGenPanel', () => ({
  MediaGenPanel: (props: {
    open: boolean;
    sessionId: string | null;
    activeDocPath: string | null;
    imageSelectionReady: boolean;
    onReplaceSelectionSrc: (assetPath: string) => void;
    onAssetImported: (path: string) => void;
    onClose: () => void;
  }) =>
    props.open ? (
      <div data-testid="media-gen-panel">
        <span data-testid="media-gen-session">{props.sessionId ?? 'none'}</span>
        <span data-testid="media-gen-active-doc">{props.activeDocPath ?? 'none'}</span>
        <span data-testid="media-gen-image-ready">{props.imageSelectionReady ? 'yes' : 'no'}</span>
        <button type="button" onClick={() => props.onReplaceSelectionSrc('assets/gen-1.png')}>
          mock-replace selected image
        </button>
        <button type="button" onClick={() => props.onAssetImported('assets/gen-1.png')}>
          mock-import generated asset
        </button>
        <button type="button" onClick={props.onClose}>mock-close media</button>
      </div>
    ) : null,
}));

const openFileMock = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ openFile: openFileMock }) },
}));
const saveBlobToFileMock = vi.fn();
vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: (...args: Parameters<typeof saveBlobToFileMock>) => saveBlobToFileMock(...args),
}));

const SOURCE = '<html><body><h1>Hello</h1></body></html>';
const DECK_SOURCE =
  '<html><body><section data-zclaudia-slide data-title="第一页"><h2>A</h2></section>' +
  '<section data-zclaudia-slide data-title="第二页"><h2>B</h2></section></body></html>';
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
  // P3.5 第二批：CSS 草稿表按同一 identity 进程内存活，测试间一并清空。
  discardAllCssDrafts();
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
  const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
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
    expect(screen.getByRole('textbox', { name: 'Element text' })).toBeInTheDocument()
  );
}

/** 顶栏 `⋯` 菜单：打开后点条目（P1 起低频动作从工具栏移入）。 */
async function openMoreMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

/** 只取菜单条目（用于断言 disabled，不点击）。 */
async function moreMenuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('menuitem', { name });
}

/** 检查器页签。 */
function openInspectorTab(name: 'Design' | 'Styles' | 'History') {
  fireEvent.click(screen.getByRole('tab', { name }));
}

/** Agent 输入条：发送（空输入等价原 Generate page 的默认提示词）。 */
async function askAgent(request = '') {
  const input = screen.getByRole('textbox', { name: 'Ask Agent' });
  if (request) fireEvent.change(input, { target: { value: request } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }));
}

/** Agent 输入条：打开上下文 popover。 */
async function openAgentContext(request = '') {
  const input = screen.getByRole('textbox', { name: 'Ask Agent' });
  if (request) fireEvent.change(input, { target: { value: request } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
  return screen.findByRole('dialog', { name: 'Agent context' });
}

/** 通过 `+` 菜单打开一个未打开的文件并等它的标签出现。 */
async function openPage(path: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: path }));
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
    target: { value: toText },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
}

/** 内存磁盘 + 按页写入的 put mock（期望值不匹配时抛 conflict）。 */
const disk = new Map<string, { source: string; revision: string }>();
let savedCounter = 0;

describe('DesignPanel', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetWorkspace();
    // 布局偏好是全局持久化 store：每个用例复位，避免页签/折叠状态跨用例泄漏。
    localStorage.clear();
    useDesignLayoutStore.setState({
      leftOpen: true,
      leftTab: 'pages',
      libraryTab: 'assets',
      leftWidth: 240,
      rightOpen: true,
      rightTab: 'design',
      collapsedSections: {},
    });
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
    vi.mocked(api.getDesignBrand).mockResolvedValue({
      designMd: null,
      tokensCss: null,
      designMdRevision: null,
      tokensCssRevision: null,
    });
    // P6 媒体端点：面板本体不消费（MediaGenPanel 打桩），补缺省返回保持 mock 全量。
    vi.mocked(api.listDesignMediaProviders).mockResolvedValue({ providers: [], profiles: [] });
    vi.mocked(api.listDesignMediaTasks).mockResolvedValue({ tasks: [] });
    // P7 分享端点：分享面板（真实挂载）打开即拉列表；缺省空列表保持 mock 全量。
    vi.mocked(api.listDesignShares).mockResolvedValue({ shares: [] });
    vi.mocked(api.listDesignShareComments).mockResolvedValue({ comments: [] });
    runFeedbackMock.status = null;
    // clearAllMocks 不还原实现：显式恢复运行预览构建器的缺省返回（blocked 全 0）。
    vi.mocked(interactive.buildDesignRunPreview).mockResolvedValue({
      html: '<html></html>',
      blocked: { scripts: 0, links: 0 },
    });
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
    // P3：Agent 输入条发送后才预填（仍不自动发送）。
    await askAgent();
    const state = useComposerStore.getState();
    expect(state.pendingPrefills['session-1']?.content).toContain('Existing request');
    expect(state.pendingPrefills['session-1']?.content).toContain('design/index.html');
    expect(state.drafts['session-1']?.attachments).toHaveLength(1);
    expect(await screen.findByText('Prefilled into the current chat — add your requirements and send.')).toBeInTheDocument();
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
    expect(screen.getByText('Connect the session backend before opening the design panel.')).toBeInTheDocument();
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
    await screen.findByTitle('Design preview');
    await selectElement();
    expect(await screen.findByRole('textbox', { name: 'Element text' })).toHaveValue('Hello');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 2100));
    });
    expect(screen.getByRole('textbox', { name: 'Element text' })).toHaveValue('Hello');
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
  });

  it('ignores a selection message bound to a stale draft revision', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await waitFor(() => expect(preview.buildDesignPreview).toHaveBeenCalled());
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
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
    expect(screen.queryByRole('textbox', { name: 'Element text' })).not.toBeInTheDocument();
    expect(screen.getByText(/Click an element in the preview to edit it/)).toBeInTheDocument();
  });

  it('maps an engine rejection to a hint when the patch is invalid', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text color' }), {
      target: { value: 'bad-color' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid color value; enter a valid CSS color');
  });

  it('reloads an unchanged document when explicitly reverting a dirty draft', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    await openMoreMenu('Reload');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
  });

  it('writes the color onto the draft source and rebuilds the preview', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text color' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
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
    await screen.findByTitle('Design preview');
    await selectElement(styled);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear text color' }));
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
    await screen.findByTitle('Design preview');
    const { frame } = { frame: (await selectElementForFrame()) as HTMLIFrameElement };
    fireEvent.change(screen.getByRole('textbox', { name: 'Text color' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
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
        'Changes were written to the source, but the computed style is overridden by external styles (e.g. !important); written as an inline declaration without raising specificity.'
      )
    ).toBeInTheDocument();
  });

  it('disables undo and redo until the draft has history', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('auto-selects an HTML file that appears after an initially empty list', async () => {
    vi.mocked(api.listDesignFiles)
      .mockResolvedValueOnce({ files: [] })
      .mockResolvedValue({ files: ['pages/new.html'] });
    disk.set('pages/new.html', { source: SOURCE, revision: 'rev-new' });
    mount();
    await waitFor(() => expect(api.listDesignFiles).toHaveBeenCalledTimes(1));
    await openMoreMenu('Refresh design files');
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith('remote-1', 'session-1', 'pages/new.html')
    );
  });

  it('preserves the edited draft and reports a save revision conflict', async () => {
    vi.mocked(api.putDesignDocument).mockRejectedValue(new Error('revision conflict'));
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision conflict');
    expect(screen.getByText(/updated elsewhere/)).toBeInTheDocument();
    expect(api.putDesignDocument).toHaveBeenCalledWith(
      'remote-1',
      expect.objectContaining({ expectedRevision: 'revision-1' })
    );
  });

  it('clears the external-change flag after a subsequent successful save', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    // 第一次保存：磁盘已前进 → 冲突，草稿保留并置 externalChange。
    vi.mocked(api.putDesignDocument).mockRejectedValueOnce(new Error('revision conflict'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision conflict');
    expect(screen.getByText(/updated elsewhere/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Element text' })).toHaveValue('Changed');

    // 第二次保存成功（mock 队列已消费，回到磁盘校验实现）：标志清除。
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByText(/updated elsewhere/)).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads the version list when the version history section is expanded', async () => {
    mount();
    await screen.findByTitle('Design preview');
    expect(api.listDesignSnapshots).not.toHaveBeenCalled();
    openInspectorTab('History');
    await waitFor(() =>
      expect(api.listDesignSnapshots).toHaveBeenCalledWith(
        'remote-1',
        'session-1',
        'design/index.html'
      )
    );
    expect(await screen.findByText(/No version snapshots yet/)).toBeInTheDocument();
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
    expect(await screen.findByRole('textbox', { name: 'Element text' })).toHaveValue('A!');
    fireEvent.click(screen.getByRole('tab', { name: /p2\.html/ }));
    expect(await screen.findByRole('textbox', { name: 'Element text' })).toHaveValue('B!');

    // 逐页保存：PUT 按页携带各自的 source 与 expectedRevision。
    fireEvent.click(screen.getByRole('tab', { name: /p1\.html/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Close design/index.html' }));
    const dialog = screen.getByRole('dialog', { name: 'Save before closing' });
    expect(within(dialog).getByText(/has unsaved changes\. Save them before closing\?/)).toBeInTheDocument();

    // 放弃修改：页面直接移除。
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /design\/index\.html/ })).not.toBeInTheDocument()
    );

    // 重新打开并编辑后关闭：保存成功再关闭。
    await openPage('design/index.html');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed again' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Close design/index.html' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Save before closing' })).getByRole('button', {
        name: 'Save',
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
    await screen.findByTitle('Design preview');
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: [] });
    disk.delete('design/index.html');
    await openMoreMenu('Refresh design files');
    await waitFor(() =>
      expect(screen.getByLabelText('Missing file design/index.html')).toBeInTheDocument()
    );
    expect(
      screen.getByText('This file no longer exists in the workspace; save to recreate it, or close the page.')
    ).toBeInTheDocument();

    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Rebuilt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith('/work', 'design/index.html', 1, 1, 'remote-1');
  });

  it('dirty 页显示行号偏移提示，保存后消失', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    expect(
      screen.queryByText('The file viewer shows the saved version; line numbers may be offset relative to the draft')
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(
      screen.getByText('The file viewer shows the saved version; line numbers may be offset relative to the draft')
    ).toBeInTheDocument();
  });

  it('干净页直接以 disk 模式导出并提示已导出；未保存差异按钮禁用', async () => {
    vi.mocked(api.exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'index-20261023.zip',
    });
    saveBlobToFileMock.mockResolvedValue('/Downloads/index-20261023.zip');
    mount();
    await screen.findByTitle('Design preview');
    expect(screen.queryByRole('button', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await openMoreMenu('Export');
    await waitFor(() =>
      expect(api.exportDesignZip).toHaveBeenCalledWith('remote-1', {
        sessionId: 'session-1',
        path: 'design/index.html',
        mode: 'disk',
        expectedRevision: 'revision-1',
      })
    );
    expect(saveBlobToFileMock).toHaveBeenCalledWith(expect.any(Blob), 'index-20261023.zip');
    expect(await screen.findByText('Exported: index-20261023.zip')).toBeInTheDocument();
  });

  it('dirty 页导出三选：保存并导出先落盘保存再以新修订导出', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Unsaved changes' })).toBeEnabled();

    await openMoreMenu('Export');
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    expect(within(dialog).getByText(/has unsaved changes/)).toBeInTheDocument();
    expect(api.exportDesignZip).not.toHaveBeenCalled();

    vi.mocked(api.exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'saved-export.zip',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and export' }));
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
    expect(await screen.findByText('Exported: saved-export.zip')).toBeInTheDocument();
  });

  it('未保存差异：dirty 时可打开草稿与磁盘的行级对比，干净页禁用', async () => {
    mount();
    await screen.findByTitle('Design preview');
    expect(screen.queryByRole('button', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();

    await selectElement();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unsaved changes' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Unsaved changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(within(dialog).getByText('Unsaved changes · index.html')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith('remote-1', 'session-1', 'design/index.html')
    );
    // lineDiff 输出：删除行（磁盘 Hello 版）+ 新增行（草稿 Changed 版）。
    expect(within(dialog).getByText('<html><body><h1>Hello</h1></body></html>')).toBeInTheDocument();
    expect(
      within(dialog).getByText('<html><body><h1>Changed</h1></body></html>')
    ).toBeInTheDocument();
  });

  it('accepts a select message carrying styles, attrs and inlineStyle payloads', async () => {
    const source = '<html><body><a href="index.html">Home</a></body></html>';
    disk.set('design/index.html', { source, revision: 'revision-1' });
    mount();
    const frame = (await screen.findByTitle('Design preview')) as HTMLIFrameElement;
    await sendSelection(frame, {
      elementPath: [0],
      tagName: 'a',
      text: 'Home',
      sourceText: 'Home',
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(source),
      styles: { 'font-size': '14px', 'text-align': 'center' },
      attrs: { href: 'index.html' },
      inlineStyle: 'font-size: 14px',
    });
    await screen.findByRole('textbox', { name: 'Element text' });
    // 计算样式作为编辑器初始值。
    expect(screen.getByRole('textbox', { name: 'Font size' })).toHaveValue('14px');
    expect(screen.getByRole('combobox', { name: 'Align' })).toHaveValue('center');
    // attrs 与「内联」徽标。
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toHaveValue('index.html');
    expect(screen.getByTestId('inline-badge-font-size')).toBeInTheDocument();
  });

  it('posts zclaudia:design-select-path to the iframe when navigating to a child', async () => {
    const source = '<html><body><div id="wrap"><p>child</p></div></body></html>';
    disk.set('design/index.html', { source, revision: 'revision-1' });
    mount();
    const frame = (await screen.findByTitle('Design preview')) as HTMLIFrameElement;
    await sendSelection(frame, {
      elementPath: [0],
      tagName: 'div',
      text: 'child',
      sourceText: '<p>child</p>',
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(source),
    });
    await screen.findByRole('textbox', { name: 'Element text' });
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'zclaudia:design-select-path', channel: latestChannel(), elementPath: [0, 0] },
      '*'
    );
  });

  it('reselects after a font-size apply and compares computed styles on the reply', async () => {
    mount();
    const frame = await selectElementForFrame();
    fireEvent.change(screen.getByRole('textbox', { name: 'Font size' }), {
      target: { value: '20px' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    const styled = '<html><body><h1 style="font-size: 20px">Hello</h1></body></html>';
    await waitFor(() =>
      expect(
        vi.mocked(preview.buildDesignPreview).mock.calls.some(call => call[0] === styled)
      ).toBe(true)
    );
    // 帧重建后补发 select-path（不是颜色 verify）。
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zclaudia:design-select-path', elementPath: [0] }),
      '*'
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zclaudia:design-verify' }),
      '*'
    );
    const reply = (styles: Record<string, string>) => {
      fireEvent(
        window,
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {
            type: 'zclaudia:design-select',
            channel: latestChannel(),
            selection: {
              elementPath: [0],
              tagName: 'h1',
              text: 'Rendered',
              sourceText: 'Hello',
              color: 'rgb(0, 0, 0)',
              backgroundColor: 'rgba(0, 0, 0, 0)',
              base: sha(styled),
              styles,
            },
          },
        })
      );
    };
    // 计算值失配 → override 告警显示。
    reply({ 'font-size': '32px' });
    expect(await screen.findByText(OVERRIDE_WARNING_TEXT)).toBeInTheDocument();
    // 计算值匹配 → 告警隐藏。
    reply({ 'font-size': '20px' });
    await waitFor(() =>
      expect(screen.queryByText(OVERRIDE_WARNING_TEXT)).not.toBeInTheDocument()
    );
  });

  it('compares top-level color fields on the reselect reply for mixed color+style applies', async () => {
    mount();
    const frame = await selectElementForFrame();
    fireEvent.change(screen.getByRole('textbox', { name: 'Font size' }), {
      target: { value: '20px' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Text color' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    const styled =
      '<html><body><h1 style="color: #123456; font-size: 20px">Hello</h1></body></html>';
    await waitFor(() =>
      expect(vi.mocked(preview.buildDesignPreview).mock.calls.some(call => call[0] === styled)).toBe(
        true
      )
    );
    fireEvent.load(frame);
    const reply = (color: string) => {
      fireEvent(
        window,
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {
            type: 'zclaudia:design-select',
            channel: latestChannel(),
            selection: {
              elementPath: [0],
              tagName: 'h1',
              text: 'Rendered',
              sourceText: 'Hello',
              color,
              backgroundColor: 'rgba(0, 0, 0, 0)',
              base: sha(styled),
              styles: { 'font-size': '20px' },
            },
          },
        })
      );
    };
    // 字号匹配但顶层颜色失配（styles 映射里没有 color 键）→ 告警仍要显示。
    reply('rgb(0, 0, 0)');
    expect(await screen.findByText(OVERRIDE_WARNING_TEXT)).toBeInTheDocument();
    // 等价颜色（#123456 = rgb(18, 52, 86)）→ 不再告警。
    reply('rgb(18, 52, 86)');
    await waitFor(() =>
      expect(screen.queryByText(OVERRIDE_WARNING_TEXT)).not.toBeInTheDocument()
    );
  });

  it('a pure color edit keeps the legacy verify loop and never sends select-path', async () => {
    mount();
    const frame = await selectElementForFrame();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text color' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
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
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zclaudia:design-verify', elementPath: [0] }),
      '*'
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zclaudia:design-select-path' }),
      '*'
    );
  });

  it('handles zclaudia:design-select-failed quietly and drops the pending reselect', async () => {
    mount();
    const frame = await selectElementForFrame();
    fireEvent.change(screen.getByRole('textbox', { name: 'Font size' }), {
      target: { value: '20px' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    const styled = '<html><body><h1 style="font-size: 20px">Hello</h1></body></html>';
    await waitFor(() =>
      expect(
        vi.mocked(preview.buildDesignPreview).mock.calls.some(call => call[0] === styled)
      ).toBe(true)
    );
    const channel = latestChannel();
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'zclaudia:design-select-failed', channel, reason: 'not-found' },
      })
    );
    // 重选已被清除：随后同路径的失配 select 不再触发 override 告警，也不崩溃。
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
            base: sha(styled),
            styles: { 'font-size': '32px' },
          },
        },
      })
    );
    await screen.findByRole('textbox', { name: 'Element text' });
    expect(screen.queryByText(OVERRIDE_WARNING_TEXT)).not.toBeInTheDocument();
  });

  it('toggles the element tree and selects a tree node through the bridge', async () => {
    mount();
    await screen.findByTitle('Design preview');
    fireEvent.click(screen.getByRole('button', { name: 'Layers panel' }));
    fireEvent.focus(screen.getByRole('button', { name: 'Layers help' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Built from the page source; pseudo-elements and script-generated content do not appear here.'
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.click(screen.getByRole('button', { name: 'Select h1 0' }));
    const channel = latestChannel();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'zclaudia:design-select-path', channel, elementPath: [0] },
      '*'
    );
    // 桥接回发 select → 树行高亮、编辑器出现，树保持挂载。
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
            base: sha(SOURCE),
          },
        },
      })
    );
    await screen.findByRole('textbox', { name: 'Element text' });
    expect(screen.getByRole('button', { name: 'Select h1 0' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  // ---- P4（L19）面板接线：三对话框 / 上下文检视 / run 反馈横幅 ----

  it('工具栏模板/品牌/素材按钮打开对应对话框并可关闭', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Templates');
    expect(screen.getByTestId('template-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mock-close templates' }));
    expect(screen.queryByTestId('template-dialog')).not.toBeInTheDocument();

    await openMoreMenu('Brand');
    expect(screen.getByTestId('brand-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mock-close brand' }));
    expect(screen.queryByTestId('brand-panel')).not.toBeInTheDocument();

    await openMoreMenu('Assets');
    expect(screen.getByTestId('asset-library')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mock-close assets' }));
    expect(screen.queryByTestId('asset-library')).not.toBeInTheDocument();
  });

  it('generate：上下文 popover 可检查，发送后填入聊天（含工作区路径与品牌遵循句）', async () => {
    mount();
    await screen.findByTitle('Design preview');
    const dialog = await openAgentContext();
    expect(useComposerStore.getState().pendingPrefills['session-1']).toBeUndefined();
    const promptEl = within(dialog).getByText(/Create or update a polished static HTML/);
    expect(promptEl.textContent).toContain('Working directory: /work');
    expect(promptEl.textContent).toContain('Follow the brand rules and tokens above when present');
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }));
    const content = useComposerStore.getState().pendingPrefills['session-1']?.content ?? '';
    expect(content).toContain('design/index.html');
    expect(content).toContain('Follow the brand rules and tokens above when present');
    expect(await screen.findByText('Prefilled into the current chat — add your requirements and send.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Agent context' })).not.toBeInTheDocument();
  });

  it('generate：上下文 popover 收起则不填入聊天', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await openAgentContext();
    fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
    expect(useComposerStore.getState().pendingPrefills['session-1']).toBeUndefined();
    expect(screen.queryByRole('dialog', { name: 'Agent context' })).not.toBeInTheDocument();
    expect(screen.queryByText('Prefilled into the current chat — add your requirements and send.')).not.toBeInTheDocument();
  });

  it('handoff：上下文 prompt 含选中元素 tag/path，发送后填入聊天', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    const dialog = await openAgentContext('Make it bold');
    const promptEl = within(dialog).getByText(/Modify the selected element in design\/index\.html/);
    expect(promptEl.textContent).toContain('Element: <h1>');
    expect(promptEl.textContent).toContain('element path: 0');
    expect(promptEl.textContent).toContain('## Request\n\nMake it bold');
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }));
    const content = useComposerStore.getState().pendingPrefills['session-1']?.content ?? '';
    expect(content).toContain('Modify the selected element in design/index.html');
    expect(content).toContain('<h1>');
    expect(content).toContain('Follow the brand rules and tokens above when present');
    expect(content).toContain('Make it bold');
  });

  it('dirty 页禁用 Agent 交接并就地提示保存（既有禁用态不变）', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    expect(screen.getByRole('textbox', { name: 'Ask Agent' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Element text' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByText('Save first to hand off')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ask Agent' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send to chat' })).not.toBeInTheDocument();
  });

  it('品牌缓存进入上下文：检视 prompt 含 DESIGN.md 与 tokens.css 内容', async () => {
    vi.mocked(api.getDesignBrand).mockResolvedValue({
      designMd: '# 品牌\n\nBrand voice: calm and precise',
      tokensCss: ':root { --color-primary: #123456; }',
      designMdRevision: 'rev-md',
      tokensCssRevision: 'rev-css',
    });
    mount();
    await screen.findByTitle('Design preview');
    await waitFor(() => expect(api.getDesignBrand).toHaveBeenCalledWith('remote-1', 'session-1'));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const dialog = await openAgentContext();
    expect(dialog.textContent).toContain('Brand rules (design/DESIGN.md)');
    expect(dialog.textContent).toContain('Brand voice: calm and precise');
    expect(dialog.textContent).toContain('Brand tokens (design/tokens.css)');
    expect(dialog.textContent).toContain('--color-primary: #123456');
  });

  it('run 反馈横幅：渲染文案与文件 chip，点击 chip 打开页面，× 触发 dismiss', async () => {
    disk.set('design/new.html', { source: SOURCE, revision: 'rev-new' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({
      files: ['design/index.html', 'design/new.html'],
    });
    runFeedbackMock.status = {
      text: 'Agent wrote 2 files',
      diff: { addedFiles: ['design/new.html'], changedPages: ['design/index.html'] },
    };
    const renderTree = () => (
      <WorkspaceToolProvider
        sessionId="session-1"
        projectId="project-1"
        projectRoot="/work"
        workingDirectory="/work"
        backendId="remote-1"
        toolId="design"
        visible
      >
        <DesignPanel />
      </WorkspaceToolProvider>
    );
    const view = render(renderTree());
    expect(await screen.findByText('Agent wrote 2 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'design/new.html' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'design/index.html' })).toBeInTheDocument();

    // chip 点击 → controller.open(path)：新页签出现。
    fireEvent.click(screen.getByRole('button', { name: 'design/new.html' }));
    expect(await screen.findByRole('tab', { name: /new\.html/ })).toBeInTheDocument();

    // × 关闭走 hook 的 dismiss；status 清空 + rerender 后横幅消失。
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Agent wrote 2 files' }));
    expect(runFeedbackMock.dismiss).toHaveBeenCalledTimes(1);
    runFeedbackMock.status = null;
    view.rerender(renderTree());
    expect(screen.queryByText('Agent wrote 2 files')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'design/new.html' })).not.toBeInTheDocument();
  });

  it('素材导入回调：导入路径进入下一次生成的上下文', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Assets');
    expect(screen.getByTestId('asset-library')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mock-import asset' }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-close assets' }));
    expect(screen.queryByTestId('asset-library')).not.toBeInTheDocument();
    const dialog = await openAgentContext();
    expect(dialog.textContent).toContain('assets/logo.png (imported recently)');
    // 活动页 deps 只有 css（kind 过滤只留 image/font），不出现在素材 section。
    expect(dialog.textContent).not.toContain('assets/a.css');
  });

  it('品牌保存成功后面板重拉品牌缓存', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await waitFor(() => expect(api.getDesignBrand).toHaveBeenCalledTimes(1));
    await openMoreMenu('Brand');
    fireEvent.click(screen.getByRole('button', { name: 'mock-save brand' }));
    await waitFor(() => expect(api.getDesignBrand).toHaveBeenCalledTimes(2));
  });

  it('模板安装回调：刷新清单、打开入口页并关闭对话框', async () => {
    disk.set('design/landing/index.html', { source: SOURCE, revision: 'rev-landing' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({
      files: ['design/index.html', 'design/landing/index.html'],
    });
    mount();
    await screen.findByTitle('Design preview');
    const callsBefore = vi.mocked(api.listDesignFiles).mock.calls.length;
    await openMoreMenu('Templates');
    fireEvent.click(screen.getByRole('button', { name: 'mock-install and open entry' }));
    await waitFor(() =>
      expect(vi.mocked(api.listDesignFiles).mock.calls.length).toBeGreaterThan(callsBefore)
    );
    await waitFor(() =>
      expect(api.getDesignDocument).toHaveBeenCalledWith(
        'remote-1',
        'session-1',
        'design/landing/index.html'
      )
    );
    // 入口页与初始页 basename 同名（index.html）→ 出现两个同名页签。
    await waitFor(() =>
      expect(screen.getAllByRole('tab', { name: /index\.html/ })).toHaveLength(2)
    );
    expect(screen.queryByTestId('template-dialog')).not.toBeInTheDocument();
  });

  // ---- P5（L25）面板接线：模式切换 / 运行桥接消息 / deck 三组件 / 渲染导出 ----

  it('P5：工具栏提供编辑/运行分段按钮（aria-pressed），非 deck 页幻灯片禁用', async () => {
    mount();
    await screen.findByTitle('Design preview');
    const edit = screen.getByRole('button', { name: 'Edit mode' });
    const run = screen.getByRole('button', { name: 'Run mode' });
    expect(edit).toHaveAttribute('aria-pressed', 'true');
    expect(run).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(run);
    expect(screen.getByRole('button', { name: 'Edit mode' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Run mode' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Edit mode' }));
    expect(screen.getByRole('button', { name: 'Edit mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Slides' })).toBeDisabled();
    expect(await moreMenuItem('Render export')).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  it('P5：切运行模式后隐藏编辑区、显示状态条与 blocked 计数，预览构建分叉且缓存键含模式', async () => {
    vi.mocked(interactive.buildDesignRunPreview).mockResolvedValue({
      html: '<html><body>run</body></html>',
      blocked: { scripts: 2, links: 1 },
    });
    mount();
    await screen.findByTitle('Design preview');
    await selectElement();
    expect(screen.getByRole('textbox', { name: 'Ask Agent' })).toBeEnabled();
    expect(preview.buildDesignPreview).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Run mode: interaction only')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run mode' }));
    await waitFor(() => expect(interactive.buildDesignRunPreview).toHaveBeenCalledTimes(1));
    const options = vi.mocked(interactive.buildDesignRunPreview).mock.calls[0][0];
    expect(options.source).toBe(SOURCE);
    expect(options.filePath).toBe('design/index.html');
    expect(typeof options.channel).toBe('string');
    // 缓存键分叉：本页未再走静态构建器。
    expect(preview.buildDesignPreview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox', { name: 'Element text' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Click an element in the preview to edit it/)).not.toBeInTheDocument();
    expect(screen.getByText('Run mode: interaction only')).toBeInTheDocument();
    expect(screen.getByText('Removed 2 external script(s) and 1 external link(s)')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Ask Agent' })).not.toBeInTheDocument();

    // 切回编辑模式：状态条消失，静态预览按新模式键重建（缓存按 path 单槽替换），编辑区恢复。
    fireEvent.click(screen.getByRole('button', { name: 'Edit mode' }));
    expect(
      screen.queryByText('Run mode: interaction only — switch back to Edit mode to make changes')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Removed 2 external script(s) and 1 external link(s)')).not.toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Element text' })).toBeInTheDocument();
    expect(preview.buildDesignPreview).toHaveBeenCalledTimes(2);
    expect(interactive.buildDesignRunPreview).toHaveBeenCalledTimes(1);
  });

  it('P5：运行模式 design-navigate——清单内路径开页并提示，清单外仅提示', async () => {
    disk.set('design/new.html', { source: SOURCE, revision: 'rev-new' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({
      files: ['design/index.html', 'design/new.html'],
    });
    mount();
    await screen.findByTitle('Design preview');
    fireEvent.click(screen.getByRole('button', { name: 'Run mode' }));
    await waitFor(() => expect(interactive.buildDesignRunPreview).toHaveBeenCalled());
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    const channel = vi.mocked(interactive.buildDesignRunPreview).mock.calls.at(-1)![0].channel;

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'zclaudia:design-navigate', channel, path: 'design/new.html' },
      })
    );
    expect(await screen.findByText('Opened design/new.html')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /new\.html/ })).toBeInTheDocument()
    );
    // 新活动页在运行模式下同样走运行构建器。
    await waitFor(() => {
      const calls = vi.mocked(interactive.buildDesignRunPreview).mock.calls;
      expect(calls.at(-1)![0].filePath).toBe('design/new.html');
    });

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'zclaudia:design-navigate', channel, path: 'design/elsewhere.html' },
      })
    );
    expect(
      await screen.findByText('Target page is not in the workspace: design/elsewhere.html')
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /elsewhere/ })).not.toBeInTheDocument();
  });

  it('P5：运行模式 design-nav-blocked 按 reason 提示且可手动关闭', async () => {
    mount();
    await screen.findByTitle('Design preview');
    fireEvent.click(screen.getByRole('button', { name: 'Run mode' }));
    await waitFor(() => expect(interactive.buildDesignRunPreview).toHaveBeenCalled());
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    const channel = vi.mocked(interactive.buildDesignRunPreview).mock.calls.at(-1)![0].channel;

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'zclaudia:design-nav-blocked',
          channel,
          reason: 'external',
          href: 'https://example.com',
        },
      })
    );
    expect(await screen.findByText('Blocked opening an external link')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Blocked opening an external link' }));
    expect(screen.queryByText('Blocked opening an external link')).not.toBeInTheDocument();

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'zclaudia:design-nav-blocked',
          channel,
          reason: 'unsupported',
          href: 'assets/a.css',
        },
      })
    );
    expect(
      await screen.findByText('Blocked a non-page link (only in-workspace HTML navigation is supported)')
    ).toBeInTheDocument();
  });

  it('P5：deck 页幻灯片可用，DeckPanel 挂载且 onCommit 走 controller.applySource；切页关闭', async () => {
    disk.set('design/index.html', { source: DECK_SOURCE, revision: 'revision-1' });
    disk.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({
      files: ['design/index.html', 'p2.html'],
    });
    mount();
    await screen.findByTitle('Design preview');
    const deckButton = screen.getByRole('button', { name: 'Slides' });
    expect(deckButton).toBeEnabled();
    fireEvent.click(deckButton);
    expect(screen.getByTestId('deck-panel')).toBeInTheDocument();
    expect(screen.getByTestId('deck-panel-page')).toHaveTextContent('design/index.html');
    expect(screen.getByTestId('deck-panel-slides')).toHaveTextContent('2');
    expect(screen.getByTestId('deck-panel-ratio')).toHaveTextContent('16:9');
    expect(screen.getByTestId('deck-panel-preview')).toHaveTextContent('ready');

    fireEvent.click(screen.getByRole('button', { name: 'mock-commit slides' }));
    // applySource 生效：草稿变化 → 保存/撤销可用。
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    // 切页：面板/播放器/渲染导出对话框一并关闭，避免陈旧 deck 展示。
    await openPage('p2.html');
    expect(screen.queryByTestId('deck-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('deck-presenter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('render-export-dialog')).not.toBeInTheDocument();
  });

  it('P5：DeckPanel onPresent 挂载 DeckPresenter（起始页/页数/比例），onClose 关闭', async () => {
    disk.set('design/index.html', { source: DECK_SOURCE, revision: 'revision-1' });
    mount();
    await screen.findByTitle('Design preview');
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-present' }));
    expect(screen.getByTestId('deck-presenter')).toBeInTheDocument();
    expect(screen.getByTestId('deck-presenter-start')).toHaveTextContent('1');
    expect(screen.getByTestId('deck-presenter-slides')).toHaveTextContent('2');
    expect(screen.getByTestId('deck-presenter-ratio')).toHaveTextContent('16:9');
    fireEvent.click(screen.getByRole('button', { name: 'mock-close presenter' }));
    expect(screen.queryByTestId('deck-presenter')).not.toBeInTheDocument();
  });

  it('P5：deck 页渲染导出对话框携带 entryPath/deck/viewport', async () => {
    disk.set('design/index.html', { source: DECK_SOURCE, revision: 'revision-1' });
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Render export');
    expect(screen.getByTestId('render-export-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('render-export-entry')).toHaveTextContent('design/index.html');
    expect(screen.getByTestId('render-export-deck')).toHaveTextContent('2:16:9');
    expect(screen.getByTestId('render-export-viewport')).toHaveTextContent('fill:null');
    fireEvent.click(screen.getByRole('button', { name: 'mock-close render export' }));
    expect(screen.queryByTestId('render-export-dialog')).not.toBeInTheDocument();
  });

  it('P5：非 deck 页渲染导出 deck=null（仅 PNG 视口区域模式）', async () => {
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Render export');
    expect(screen.getByTestId('render-export-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('render-export-entry')).toHaveTextContent('design/index.html');
    expect(screen.getByTestId('render-export-deck')).toHaveTextContent('none');
    expect(screen.getByTestId('render-export-viewport')).toHaveTextContent('fill:null');
  });

  // ---- P6（L36）面板接线：媒体生成面板打开/props 透传/替换事务/落库刷新/切页关闭 ----

  it('P6：媒体按钮打开媒体生成面板并透传会话与活动页，无选区时 imageSelectionReady 为否', async () => {
    mount();
    await screen.findByTitle('Design preview');
    expect(screen.queryByTestId('media-gen-panel')).not.toBeInTheDocument();
    await openMoreMenu('Media');
    expect(screen.getByTestId('media-gen-panel')).toBeInTheDocument();
    expect(screen.getByTestId('media-gen-session')).toHaveTextContent('session-1');
    expect(screen.getByTestId('media-gen-active-doc')).toHaveTextContent('design/index.html');
    expect(screen.getByTestId('media-gen-image-ready')).toHaveTextContent('no');
    fireEvent.click(screen.getByRole('button', { name: 'mock-close media' }));
    expect(screen.queryByTestId('media-gen-panel')).not.toBeInTheDocument();
  });

  it('P6：img 选区 imageSelectionReady 为真，替换回调触发 src attribute 事务（相对引用换算）', async () => {
    const source = '<html><body><img src="assets/a.png" alt="预览图"></body></html>';
    disk.set('design/index.html', { source, revision: 'revision-1' });
    mount();
    const frame = (await screen.findByTitle('Design preview')) as HTMLIFrameElement;
    await sendSelection(frame, {
      elementPath: [0],
      tagName: 'img',
      text: '',
      sourceText: '',
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(source),
    });
    await screen.findByRole('textbox', { name: 'Image URL' });
    await openMoreMenu('Media');
    expect(screen.getByTestId('media-gen-image-ready')).toHaveTextContent('yes');

    fireEvent.click(screen.getByRole('button', { name: 'mock-replace selected image' }));
    // asset-ref 换算：design/index.html + assets/gen-1.png → ../assets/gen-1.png。
    await waitFor(() =>
      expect(
        vi
          .mocked(preview.buildDesignPreview)
          .mock.calls.some(
            call => typeof call[0] === 'string' && call[0].includes('src="../assets/gen-1.png"')
          )
      ).toBe(true)
    );
  });

  it('P6：媒体产物落库回调触发工作区刷新（refreshNow 重新拉取文件清单）', async () => {
    mount();
    await screen.findByTitle('Design preview');
    const callsBefore = vi.mocked(api.listDesignFiles).mock.calls.length;
    await openMoreMenu('Media');
    fireEvent.click(screen.getByRole('button', { name: 'mock-import generated asset' }));
    await waitFor(() =>
      expect(vi.mocked(api.listDesignFiles).mock.calls.length).toBeGreaterThan(callsBefore)
    );
  });

  it('P6：切页时媒体生成面板一并关闭（deckOpen/renderExportOpen 同款 effect）', async () => {
    disk.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: ['design/index.html', 'p2.html'] });
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Media');
    expect(screen.getByTestId('media-gen-panel')).toBeInTheDocument();
    await openPage('p2.html');
    expect(screen.queryByTestId('media-gen-panel')).not.toBeInTheDocument();
  });

  // ---- P7（S7）面板接线：分享按钮 / 真实 SharePanel 挂载 / 交接 prefill / 切页关闭 ----

  it('P7：分享按钮无活动页禁用，有活动页可打开分享面板（分享链接 tab）', async () => {
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: [] });
    const empty = mount();
    await waitFor(() => expect(api.listDesignFiles).toHaveBeenCalled());
    const disabledShare = await moreMenuItem('Share');
    expect(disabledShare).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    empty.unmount();

    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: ['design/index.html'] });
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Share');
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    expect(within(dialog).getByRole('tab', { name: 'Share links' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // SharePanel 挂载即拉版本与分享列表（活动页作为 entryPath）。
    await waitFor(() =>
      expect(api.listDesignShares).toHaveBeenCalledWith(
        'remote-1',
        'session-1',
        'design/index.html'
      )
    );
    // Modal 右上角 X 与页脚按钮都叫 "Close"，页脚按钮带可见文本，按此区分。
    fireEvent.click(
      within(dialog)
        .getAllByRole('button', { name: 'Close' })
        .find(button => button.textContent?.trim() === 'Close')!
    );
    expect(screen.queryByRole('dialog', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('P7：审阅评论「交给 Agent 修改」把含评论正文的 prompt 填入聊天并关闭面板', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([
      {
        id: 'ds-1',
        entryPath: 'design/index.html',
        label: 'v1',
        source: 'save',
        complete: true,
        incompleteReasons: [],
        fileCount: 1,
        totalBytes: SOURCE.length,
        createdAt: 1730000000000,
      },
    ]);
    vi.mocked(api.listDesignShares).mockResolvedValue({
      shares: [
        {
          id: 'sh-1',
          token: 'tok-1',
          snapshotId: 'ds-1',
          entryPath: 'design/index.html',
          title: null,
          scope: 'link',
          createdAt: 1730000000000,
          expiresAt: null,
          revokedAt: null,
          commentCount: 1,
          lastAccessAt: null,
        },
      ],
    });
    const comment = {
      id: 'sc-1',
      author: '审阅者',
      body: '标题改成蓝色更好',
      target: null,
      createdAt: 1730000100000,
      resolvedAt: null,
    };
    vi.mocked(api.listDesignShareComments).mockResolvedValue({ comments: [comment] });
    vi.mocked(api.getDesignSnapshotFile).mockResolvedValue({
      mime: 'text/html',
      data: btoa(SOURCE),
    });
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Share');
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Review comments' }));
    const handoffButton = await within(dialog).findByRole('button', {
      name: 'Hand off to Agent sc-1',
    });
    expect(useComposerStore.getState().pendingPrefills['session-1']).toBeUndefined();
    fireEvent.click(handoffButton);

    await waitFor(() => {
      const content = useComposerStore.getState().pendingPrefills['session-1']?.content ?? '';
      expect(content).toContain('标题改成蓝色更好');
    });
    const content = useComposerStore.getState().pendingPrefills['session-1']?.content ?? '';
    expect(content).toContain('Please update the current page design/index.html based on the review feedback above');
    expect(await screen.findByText('Prefilled into the current chat — add your requirements and send.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('P7：切页时分享面板一并关闭（deck/media 同款 effect）', async () => {
    disk.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({ files: ['design/index.html', 'p2.html'] });
    mount();
    await screen.findByTitle('Design preview');
    await openMoreMenu('Share');
    expect(await screen.findByRole('dialog', { name: 'Share' })).toBeInTheDocument();
    await openPage('p2.html');
    expect(screen.queryByRole('dialog', { name: 'Share' })).not.toBeInTheDocument();
  });

  // ---- P3.5（C1）样式来源桥接：rules-request 发送 / design-rules 校验与存入 ----

  it('P3.5：选区消息到达后向 iframe 发送 zclaudia:design-rules-request（elementPath 取当前选区）', async () => {
    mount();
    const frame = (await screen.findByTitle('Design preview')) as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    await selectElement();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'zclaudia:design-rules-request', channel: latestChannel(), elementPath: [0] },
      '*'
    );
  });

  it('P3.5：design-rules 与当前选区一致的载荷不告警不崩溃；迟到路径与形状违规静默丢弃', async () => {
    mount();
    const frame = await selectElementForFrame();
    const validRule = {
      origin: '@inline/0',
      rulePath: [0],
      selectorText: 'h1',
      specificity: [0, 0, 1],
      importantProps: [],
    };
    const send = (payload: Record<string, unknown>) =>
      fireEvent(
        window,
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { type: 'zclaudia:design-rules', channel: latestChannel(), ...payload },
        })
      );
    // 校验通过且路径与当前选区一致：静默存入（C4 才渲染），选区编辑器不受影响。
    send({ elementPath: [0], rules: [validRule] });
    expect(screen.getByRole('textbox', { name: 'Element text' })).toBeInTheDocument();
    // 迟到/错位路径（与当前选区不一致）静默丢弃。
    send({ elementPath: [1, 2], rules: [validRule] });
    // 形状违规（选择器超 STYLE_RULE_SELECTOR_MAX）整体丢弃。
    send({ elementPath: [0], rules: [{ ...validRule, selectorText: 'x'.repeat(301) }] });
    // 规则条数超上限同样丢弃。
    send({ elementPath: [0], rules: Array.from({ length: 201 }, () => validRule) });
    expect(screen.getByRole('textbox', { name: 'Element text' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ---- P3.5（C4）样式来源面板接线：渲染 / onApply→handleApply / reselect 刷新 / runMode 隐藏 / 切页清空 ----

  const STYLE_SOURCE_PAGE =
    '<html><head><style>h1 { color: #ff0000; }</style></head><body><h1>Hello</h1></body></html>';
  const H1_RULE = {
    origin: '@inline/0',
    rulePath: [0],
    selectorText: 'h1',
    specificity: [0, 0, 1],
    importantProps: [],
  };
  const EMPTY_NOTICE =
    'No matching stylesheet rules for this element; inline styles can be edited in the panel above.';

  /** 打开带 `<style>` 块的页面并让选区落地（computed color 与源码值等值 → Active 徽标）。 */
  async function mountStyleSourcePage() {
    disk.set('design/index.html', { source: STYLE_SOURCE_PAGE, revision: 'revision-1' });
    mount();
    const frame = (await screen.findByTitle('Design preview')) as HTMLIFrameElement;
    await sendSelection(frame, {
      elementPath: [0],
      tagName: 'h1',
      text: 'Rendered',
      sourceText: 'Hello',
      color: 'rgb(255, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(STYLE_SOURCE_PAGE),
    });
    await screen.findByRole('textbox', { name: 'Element text' });
    openInspectorTab('Styles');
    return frame;
  }

  /** 以最新构建的 channel 从预览 iframe 发 design-rules 载荷。 */
  const sendRules = (frame: HTMLIFrameElement, rules: unknown, extra: Record<string, unknown> = {}) =>
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'zclaudia:design-rules', channel: latestChannel(), elementPath: [0], rules, ...extra },
      })
    );

  it('P3.5 C4：选区 + design-rules 到达后样式来源区渲染规则卡（来源徽标/声明/Active）', async () => {
    const frame = await mountStyleSourcePage();
    sendRules(frame, [H1_RULE]);
    expect(await screen.findByTestId('rule-@inline/0-0')).toBeInTheDocument();
    expect(screen.getByText('Style block #0')).toBeInTheDocument();
    const card = screen.getByTestId('rule-@inline/0-0');
    expect(within(card).getByText('h1')).toBeInTheDocument();
    expect(within(card).getByTestId('declaration-color')).toHaveTextContent('#ff0000');
    // computed color rgb(255,0,0) 与源码 #ff0000 等值 → 生效徽标 Active。
    expect(within(card).getByTestId('winning-color')).toHaveTextContent('Active');
  });

  it('P3.5 C4：来源区改值经 handleApply 提交事务（controller.apply 落草稿、保存/撤销可用、预览重建）', async () => {
    const frame = await mountStyleSourcePage();
    sendRules(frame, [H1_RULE]);
    await screen.findByTestId('rule-@inline/0-0');
    fireEvent.change(screen.getByRole('textbox', { name: 'Value for color' }), {
      target: { value: '#00ff00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await waitFor(() =>
      expect(
        vi
          .mocked(preview.buildDesignPreview)
          .mock.calls.some(
            call => typeof call[0] === 'string' && call[0].includes('color: #00ff00')
          )
      ).toBe(true)
    );
  });

  it('P3.5 C4：应用后 reselect 刷新链路——帧载入补发 select-path、新选区重发 rules-request、新规则重渲染', async () => {
    const frame = await mountStyleSourcePage();
    sendRules(frame, [H1_RULE]);
    await screen.findByTestId('rule-@inline/0-0');
    fireEvent.change(screen.getByRole('textbox', { name: 'Value for color' }), {
      target: { value: '#00ff00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
    const styled = STYLE_SOURCE_PAGE.replace('#ff0000', '#00ff00');
    await waitFor(() =>
      expect(vi.mocked(preview.buildDesignPreview).mock.calls.some(call => call[0] === styled)).toBe(
        true
      )
    );
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'zclaudia:design-select-path', elementPath: [0] }),
      '*'
    );
    await sendSelection(frame, {
      elementPath: [0],
      tagName: 'h1',
      text: 'Rendered',
      sourceText: 'Hello',
      color: 'rgb(0, 255, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(styled),
    });
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'zclaudia:design-rules-request', channel: latestChannel(), elementPath: [0] },
      '*'
    );
    sendRules(frame, [H1_RULE]);
    expect(await screen.findByText('#00ff00')).toBeInTheDocument();
  });

  it('P3.5 C4：运行模式整体隐藏编辑区，样式来源区一并隐藏', async () => {
    const frame = await mountStyleSourcePage();
    sendRules(frame, [H1_RULE]);
    expect(await screen.findByTestId('rule-@inline/0-0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run mode' }));
    await waitFor(() => expect(interactive.buildDesignRunPreview).toHaveBeenCalled());
    expect(screen.queryByTestId('rule-@inline/0-0')).not.toBeInTheDocument();
    expect(screen.queryByText('Style sources')).not.toBeInTheDocument();
  });

  it('P3.5 C4：切页后样式来源区清空（旧规则卡不渲染，回到空态）', async () => {
    disk.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    vi.mocked(api.listDesignFiles).mockResolvedValue({
      files: ['design/index.html', 'p2.html'],
    });
    const frame = await mountStyleSourcePage();
    sendRules(frame, [H1_RULE]);
    expect(await screen.findByTestId('rule-@inline/0-0')).toBeInTheDocument();
    await openPage('p2.html');
    expect(screen.queryByTestId('rule-@inline/0-0')).not.toBeInTheDocument();
    expect(screen.getByText(EMPTY_NOTICE)).toBeInTheDocument();
  });

  // ---- P3.5 第二批（C6）外部 .css：草稿编辑 / 预览内联 / 保存与冲突 / 导出提示 ----

  const CSS_FILE = 'h1 {\n  color: #ff0000;\n}';
  const LINK_PAGE =
    '<html><head><link rel="stylesheet" href="css/main.css"></head><body><h1>Hello</h1></body></html>';
  const CSS_RULE = {
    origin: 'design/css/main.css',
    rulePath: [0],
    selectorText: 'h1',
    specificity: [0, 0, 1],
    importantProps: [],
  };
  const EXPORT_NOTICE =
    'Unsaved style changes are not included in exports — save styles first.';

  /** 打开引用外部 css 的页面并让选区落地（computed color 与磁盘 css 源值等值）。 */
  async function mountExternalStylePage() {
    disk.set('design/index.html', { source: LINK_PAGE, revision: 'revision-1' });
    disk.set('design/css/main.css', { source: CSS_FILE, revision: 'rev-css-1' });
    mount();
    const frame = (await screen.findByTitle('Design preview')) as HTMLIFrameElement;
    await sendSelection(frame, {
      elementPath: [0],
      tagName: 'h1',
      text: 'Rendered',
      sourceText: 'Hello',
      color: 'rgb(255, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(LINK_PAGE),
    });
    await screen.findByRole('textbox', { name: 'Element text' });
    openInspectorTab('Styles');
    return frame;
  }

  /** 发外部规则载荷并等来源区出现可编辑声明行（磁盘 css 取回并打开草稿后）。 */
  async function openExternalRuleRow(frame: HTMLIFrameElement) {
    sendRules(frame, [CSS_RULE]);
    await screen.findByTestId('rule-design/css/main.css-0');
    const input = await screen.findByRole('textbox', { name: 'Value for color' });
    expect(input).toHaveValue('#ff0000');
    return input;
  }

  const applyExternalValue = (input: HTMLInputElement, value: string) => {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
  };

  it('P3.5 第二批：外部 origin 行可编辑，改值入 CSS 草稿（不发 styleBlock 事务、页面不脏）', async () => {
    const frame = await mountExternalStylePage();
    const input = await openExternalRuleRow(frame);
    // 来源区不再显示第一批只读文案。
    expect(screen.queryByText('External stylesheet editing arrives in a later batch')).not.toBeInTheDocument();
    applyExternalValue(input, '#00ff00');
    // 草稿优先进 cssSources：来源区行立即显示新值。
    expect(await screen.findByText('#00ff00')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled());
    // CSS 草稿不脏 HTML 页面草稿：工具栏页面保存保持禁用，也无 putDesignDocument 调用。
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(api.putDesignDocument).not.toHaveBeenCalled();
  });

  it('P3.5 第二批：CSS 草稿变更触发预览重建，loadAsset 对草稿路径返回草稿文本（拦截在 getDesignAsset 之前）', async () => {
    const frame = await mountExternalStylePage();
    await openExternalRuleRow(frame);
    const callsBefore = vi.mocked(preview.buildDesignPreview).mock.calls.length;
    applyExternalValue(screen.getByRole('textbox', { name: 'Value for color' }), '#00ff00');
    // draftRevision/assetEpoch/mode 均未变，仅 cssDraftEpoch 变化即触发重建（缓存键含它）。
    await waitFor(() =>
      expect(vi.mocked(preview.buildDesignPreview).mock.calls.length).toBeGreaterThan(callsBefore)
    );
    const lastCall = vi.mocked(preview.buildDesignPreview).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(LINK_PAGE); // 页面草稿未变
    const loader = lastCall[2];
    // 草稿路径：草稿文本 utf8 → base64，mime text/css；磁盘 asset 端点未被调用。
    await expect(loader('design/css/main.css')).resolves.toEqual({
      mimeType: 'text/css',
      data: btoa(CSS_FILE.replace('#ff0000', '#00ff00')),
    });
    expect(
      vi.mocked(api.getDesignAsset).mock.calls.some(call => call[2] === 'design/css/main.css')
    ).toBe(false);
    // 非草稿路径仍走 getDesignAsset。
    await expect(loader('assets/logo.png')).resolves.toEqual({ mimeType: 'image/png', data: '' });
    expect(
      vi.mocked(api.getDesignAsset).mock.calls.some(call => call[2] === 'assets/logo.png')
    ).toBe(true);
  });

  it('P3.5 第二批：Save styles 逐文件提交（expectedRevision=草稿基线），成功后清 dirty', async () => {
    const frame = await mountExternalStylePage();
    await openExternalRuleRow(frame);
    applyExternalValue(screen.getByRole('textbox', { name: 'Value for color' }), '#00ff00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));
    await waitFor(() => expect(api.putDesignDocument).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.putDesignDocument).mock.calls[0]?.[1]).toMatchObject({
      path: 'design/css/main.css',
      source: CSS_FILE.replace('#ff0000', '#00ff00'),
      expectedRevision: 'rev-css-1',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save styles' })).toBeDisabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('P3.5 第二批：保存 409 → 冲突横幅两动作（Keep draft 保留 / Reload from disk 确认后丢弃重取）', async () => {
    const frame = await mountExternalStylePage();
    const input = await openExternalRuleRow(frame);
    // 外部已改文件：磁盘修订前进，保存必 409。
    disk.set('design/css/main.css', { source: CSS_FILE, revision: 'rev-css-2' });
    const rejectConflictOnce = () =>
      vi
        .mocked(api.putDesignDocument)
        .mockImplementationOnce((_backendId, put) =>
          Promise.reject(new ApiError(`revision conflict on ${put.path}`, 'REVISION_CONFLICT'))
        );
    rejectConflictOnce();
    applyExternalValue(input, '#00ff00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A style file was changed outside the panel'
    );
    // Reload from disk：确认对话框防误丢；Cancel 后草稿保留、横幅仍在。
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk design/css/main.css' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reload style file' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reload style file' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('alert')).toHaveTextContent('A style file was changed outside the panel');
    expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled();
    // Keep draft：横幅收起，草稿保留（之后重试仍会 409，可重新载入解决）。
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled();
    // 重试保存再次 409 → Reload from disk 确认后：草稿丢弃、磁盘新修订取回并重开干净草稿。
    rejectConflictOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A style file was changed outside the panel'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk design/css/main.css' }));
    const dialog2 = await screen.findByRole('dialog', { name: 'Reload style file' });
    fireEvent.click(within(dialog2).getByRole('button', { name: 'Reload' }));
    // 丢弃草稿 → 重取磁盘 rev-css-2 → 重开干净草稿：行按磁盘源重新对齐，Save styles 禁用。
    await waitFor(() => {
      const reloaded = screen.getByTestId('rule-design/css/main.css-0');
      expect(within(reloaded).getByTestId('declaration-color')).toHaveTextContent('#ff0000');
    });
    expect(screen.getByRole('button', { name: 'Save styles' })).toBeDisabled();
  });

  it('P3.5 第二批：保存非 409 失败显示服务端 message，不出现冲突横幅', async () => {
    const frame = await mountExternalStylePage();
    const input = await openExternalRuleRow(frame);
    vi.mocked(api.putDesignDocument).mockImplementationOnce(() =>
      Promise.reject(new ApiError('disk on fire', 'IO_ERROR'))
    );
    applyExternalValue(input, '#00ff00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire');
    expect(screen.queryByText('A style file was changed outside the panel')).not.toBeInTheDocument();
    // 草稿保留：Save styles 仍可用。
    expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled();
  });

  it('P3.5 第二批：导出对话框——存在 CSS 脏草稿时提示未保存样式不入导出，无草稿零差异', async () => {
    vi.mocked(api.exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'export.zip',
    });
    const frame = await mountExternalStylePage();
    await openExternalRuleRow(frame);
    // 无 CSS 草稿：打开导出对话框无该提示。
    await openMoreMenu('Export');
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    expect(within(dialog).queryByText(EXPORT_NOTICE)).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('Exported: export.zip')).toBeInTheDocument());
    // Modal 自带 X（aria-label Close）与 footer Close 同名：点 footer 的（最后一个）。
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export' })).not.toBeInTheDocument());
    // 产生 CSS 脏草稿后：顶部提示出现。
    applyExternalValue(screen.getByRole('textbox', { name: 'Value for color' }), '#00ff00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save styles' })).toBeEnabled());
    await openMoreMenu('Export');
    const dialog2 = await screen.findByRole('dialog', { name: 'Export' });
    expect(within(dialog2).getByText(EXPORT_NOTICE)).toBeInTheDocument();
  });
});

// ---- P3.5 §2：design-rules 载荷校验矩阵（isValidRulesMessage） ----

describe('isValidRulesMessage', () => {
  const validRule = {
    origin: '@inline/0',
    rulePath: [0],
    selectorText: 'h1',
    specificity: [0, 0, 1],
    importantProps: [],
  };
  const valid = { elementPath: [0], rules: [validRule] };

  it('接受合法载荷（空规则、truncated、恰好 200 条）', () => {
    expect(isValidRulesMessage(valid)).toBe(true);
    expect(isValidRulesMessage({ ...valid, truncated: true })).toBe(true);
    expect(isValidRulesMessage({ elementPath: [], rules: [] })).toBe(true);
    expect(
      isValidRulesMessage({ elementPath: [0], rules: Array.from({ length: 200 }, () => validRule) })
    ).toBe(true);
  });

  it('拒绝非对象载荷与形状/上限违规（整体丢弃口径）', () => {
    expect(isValidRulesMessage(null)).toBe(false);
    expect(isValidRulesMessage('x')).toBe(false);
    expect(isValidRulesMessage([])).toBe(false);
    expect(isValidRulesMessage({ ...valid, elementPath: '0' })).toBe(false);
    expect(isValidRulesMessage({ ...valid, elementPath: [-1] })).toBe(false);
    expect(isValidRulesMessage({ ...valid, elementPath: [0.5] })).toBe(false);
    expect(isValidRulesMessage({ ...valid, rules: 'x' })).toBe(false);
    expect(isValidRulesMessage({ ...valid, truncated: 'yes' })).toBe(false);
    expect(
      isValidRulesMessage({ elementPath: [0], rules: Array.from({ length: 201 }, () => validRule) })
    ).toBe(false);
  });

  it('拒绝单条规则的字段违规（origin/rulePath/selectorText/specificity/importantProps）', () => {
    expect(isValidRulesMessage({ ...valid, rules: [{ ...validRule, origin: '' }] })).toBe(false);
    expect(isValidRulesMessage({ ...valid, rules: [{ ...validRule, origin: 1 }] })).toBe(false);
    expect(isValidRulesMessage({ ...valid, rules: [{ ...validRule, rulePath: [] }] })).toBe(false);
    expect(isValidRulesMessage({ ...valid, rules: [{ ...validRule, rulePath: [1.5] }] })).toBe(false);
    expect(
      isValidRulesMessage({ ...valid, rules: [{ ...validRule, selectorText: '' }] })
    ).toBe(false);
    expect(
      isValidRulesMessage({ ...valid, rules: [{ ...validRule, selectorText: 'x'.repeat(301) }] })
    ).toBe(false);
    expect(
      isValidRulesMessage({ ...valid, rules: [{ ...validRule, specificity: [0, 0] }] })
    ).toBe(false);
    expect(
      isValidRulesMessage({ ...valid, rules: [{ ...validRule, specificity: [0, 0, 10000] }] })
    ).toBe(false);
    expect(
      isValidRulesMessage({ ...valid, rules: [{ ...validRule, importantProps: [''] }] })
    ).toBe(false);
    expect(
      isValidRulesMessage({
        ...valid,
        rules: [{ ...validRule, importantProps: Array.from({ length: 65 }, () => 'color') }],
      })
    ).toBe(false);
  });
});

/** helper: wait for the preview then return the main preview iframe. */
async function selectElementForFrame() {
  await selectElement();
  return screen.getByTitle('Design preview');
}

/** helper: latest preview build's bridge channel. */
function latestChannel(): string {
  const calls = vi.mocked(preview.buildDesignPreview).mock.calls;
  return calls[calls.length - 1]?.[3] as string;
}

/** helper: send a select message from the preview iframe (extended payloads allowed). */
async function sendSelection(frame: HTMLIFrameElement, selection: Record<string, unknown>) {
  await waitFor(() => expect(preview.buildDesignPreview).toHaveBeenCalled());
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'zclaudia:design-select', channel: latestChannel(), selection },
    })
  );
}

const OVERRIDE_WARNING_TEXT =
  'Changes were written to the source, but the computed style is overridden by external styles (e.g. !important); written as an inline declaration without raising specificity.';
