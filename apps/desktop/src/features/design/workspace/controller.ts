import { EditHistory } from '../history/edit-history';
import { applyEditTransaction } from '../html/edit-engine';
import { DesignEditError } from '../types';
import type {
  DesignDepsResult,
  DesignDependencyStat,
  DesignDocument,
  DesignEditOperation,
  DesignSelection,
  DesignViewport,
  DesignZoom,
} from '../types';
import type { DesignWorkspacePortsFactory } from './ports';
import {
  loadWorkspaceUiState,
  normalizeUiState,
  normalizeViewport,
  normalizeZoom,
  saveWorkspaceUiState,
} from './storage';
import type { DesignWorkspaceUiState } from './storage';

// ---------------------------------------------------------------------------
// 快照状态（P2 §2.2）
// ---------------------------------------------------------------------------

export type DesignPageStatus = 'loading' | 'clean' | 'dirty';

export interface DesignPageSnapshot {
  path: string;
  status: DesignPageStatus;
  /** 当前草稿全文。 */
  source: string;
  draftRevision: string;
  /** 最近已知磁盘修订；null = 尚未成功载入。 */
  docRevision: string | null;
  selection: DesignSelection | null;
  /** 脏页期间磁盘已变化。 */
  externalChange: boolean;
  /** 文件已从工作区消失（删除/改名）。 */
  missing: boolean;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string;
  /** 最近一轮 deps stat（无变化探测的原始清单）；null = 尚未拉取。P4 素材引用用。 */
  deps: DesignDependencyStat[] | null;
}

export interface DesignWorkspaceSnapshot {
  pages: DesignPageSnapshot[];
  activePath: string | null;
  ui: DesignWorkspaceUiState;
  /** 资源 stat 变化计数；+1 时所有预览需要重建（资产内联自磁盘）。 */
  assetEpoch: number;
}

export const MAX_OPEN_PAGES = 8;

export type ClosePageResult = 'closed' | 'dirty' | 'not-open';
export type OpenPageResult =
  | { ok: true }
  | { ok: false; reason: 'limit' | 'load-failed'; message?: string };

const RECENTS_LIMIT = 12;
const HISTORY_OPTIONS = { limit: 100, maxBytes: 8 * 1024 * 1024, mergeWindowMs: 1500 };
const HISTORY_INVALID_MESSAGE = '编辑历史已失效，已重新载入';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isConflict = (error: unknown): boolean =>
  /conflict|revision|changed/i.test(error instanceof Error ? error.message : String(error));

/** Map an engine rejection code to a user-facing hint (P1 wording, migrated). */
function editErrorMessage(error: unknown): string {
  if (!(error instanceof DesignEditError)) return errorMessage(error);
  switch (error.code) {
    case 'REVISION_MISMATCH':
    case 'TEXT_MISMATCH':
      return '所选元素已变化，请重新选择后再试';
    case 'ELEMENT_NOT_FOUND':
      return '所选元素已不存在，请重新选择后再试';
    case 'TAG_MISMATCH':
      return '所选元素类型已变化，请重新选择后再试';
    case 'NOT_PLAIN_TEXT':
      return '该元素包含子元素，只能修改纯文本元素的文字';
    case 'IMPLICIT_ELEMENT':
      return '该元素在源码中没有明确位置，无法修改';
    case 'DUPLICATE_ATTRIBUTE':
      return '该元素的开始标签存在重复属性，无法安全修改';
    case 'MALFORMED_HTML':
      return '该元素附近的源码无法解析，请先修复后再编辑';
    case 'INVALID_VALUE':
      return '颜色值无效，请输入合法的 CSS 颜色';
    case 'EMPTY_TRANSACTION':
      return '没有需要应用的修改';
    case 'ATTRIBUTE_NOT_ALLOWED':
      return '该元素不支持修改此属性（src/alt 仅图片，href 仅链接）';
    case 'STRUCTURE_NOT_ALLOWED':
      return '该结构操作在此元素上不可用（可能混用了其他修改，或没有可交换的相邻元素）';
    case 'ANCHOR_REFERENCED':
      return '此元素（或其子元素）的 id 被页面锚点引用，删除会断开链接；请先处理引用';
    default:
      return errorMessage(error);
  }
}

interface WorkspacePage {
  path: string;
  /** 最近已知磁盘文档；null = 尚未成功载入（status 'loading'）。 */
  doc: DesignDocument | null;
  draft: string;
  draftRevision: string;
  selection: DesignSelection | null;
  externalChange: boolean;
  missing: boolean;
  busy: boolean;
  error: string;
  history: EditHistory;
  /** 按页单调递增；异步结果仅当仍为最新才生效。 */
  requestId: number;
  /** LRU 淘汰用的访问时钟。 */
  lastAccessed: number;
  /** 该页上次依赖 stat 缓存（null = 尚未采样）。 */
  depsFiles: DesignDependencyStat[] | null;
  /** 每次变更自增，用于快照对象缓存失效。 */
  rev: number;
  snapshotCache: DesignPageSnapshot | null;
  snapshotRev: number;
}

const pageStatus = (page: WorkspacePage): DesignPageStatus => {
  if (page.doc === null) return 'loading';
  return page.draft === page.doc.source ? 'clean' : 'dirty';
};

function depsStatsEqual(a: DesignDependencyStat[], b: DesignDependencyStat[]): boolean {
  if (a.length !== b.length) return false;
  const byPath = new Map(a.map(stat => [stat.path, stat]));
  for (const stat of b) {
    const prev = byPath.get(stat.path);
    if (!prev) return false;
    if (prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs || prev.missing !== stat.missing) {
      return false;
    }
  }
  return true;
}

/**
 * Stable non-cryptographic workspace identity hash (FNV-1a 32-bit, 8 hex).
 * Synchronous on purpose — the async sha256Hex cannot be used here.
 */
export function workspaceIdentityKey(identity: {
  backendId: string;
  projectId?: string;
  workingDirectory?: string;
}): string {
  const canonical = JSON.stringify([
    identity.backendId ?? '',
    identity.projectId ?? null,
    identity.workingDirectory ?? null,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 多页工作台状态机（P2 §2.3）。每页独立 EditHistory 与 requestId；所有异步
 * 动作以活动/目标页为单位做陈旧防护，dispose 后 in-flight 结果一律丢弃。
 */
export class DesignWorkspaceController {
  private readonly getPorts: DesignWorkspacePortsFactory;
  private readonly identityKey: string;
  private sessionId = '';
  private disposed = false;
  private readonly pages = new Map<string, WorkspacePage>();
  private ui: DesignWorkspaceUiState;
  private activePath: string | null;
  private assetEpoch = 0;
  private clock = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: DesignWorkspaceSnapshot;

  constructor(
    identityKey: string,
    getPorts: DesignWorkspacePortsFactory,
    uiState?: DesignWorkspaceUiState
  ) {
    this.identityKey = identityKey;
    this.getPorts = getPorts;
    this.ui = uiState ? normalizeUiState(uiState) : loadWorkspaceUiState(identityKey);
    this.activePath = this.ui.activePath;
    this.snapshot = this.buildSnapshot();
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 引用稳定：仅在变更点更换快照对象；未变更的页保持同一对象引用。 */
  getSnapshot(): DesignWorkspaceSnapshot {
    return this.snapshot;
  }

  /** 同 identity 新面板挂载时更新 sessionId；后续动作经 getPorts 取最新会话的 ports。 */
  rebind(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** 引用计数归零时由 registry 调用；此后 subscribe 回调不再触发，in-flight 结果丢弃。 */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // 页面组织：open / activate / close
  // -------------------------------------------------------------------------

  async open(path: string): Promise<OpenPageResult> {
    if (this.disposed) return { ok: false, reason: 'load-failed', message: '工作台已释放' };
    const existing = this.pages.get(path);
    if (existing) {
      this.activate(path);
      return { ok: true };
    }
    if (this.pages.size >= MAX_OPEN_PAGES) {
      const victim = [...this.pages.values()]
        .filter(page => page.path !== this.activePath && pageStatus(page) === 'clean')
        .sort((a, b) => a.lastAccessed - b.lastAccessed)[0];
      if (!victim) return { ok: false, reason: 'limit' };
      this.removePage(victim.path);
    }
    const page = this.createPage(path);
    this.pages.set(path, page);
    this.emit();
    const request = ++page.requestId;
    let next: DesignDocument;
    try {
      next = await this.getPorts(this.sessionId).getDocument(path);
    } catch (error) {
      if (this.pages.get(path) === page && page.requestId === request) this.removePage(path);
      return { ok: false, reason: 'load-failed', message: errorMessage(error) };
    }
    if (this.disposed || page.requestId !== request || this.pages.get(path) !== page) {
      return { ok: false, reason: 'load-failed', message: '工作台已释放，载入已取消' };
    }
    await this.adoptDocument(page, next);
    if (this.disposed) return { ok: false, reason: 'load-failed', message: '工作台已释放' };
    this.activate(path);
    return { ok: true };
  }

  activate(path: string): void {
    const page = this.pages.get(path);
    if (this.disposed || !page) return;
    const recents = moveToRecentsHead(this.ui.recents, path);
    const changed =
      this.activePath !== path ||
      recents.length !== this.ui.recents.length ||
      recents.some((entry, index) => entry !== this.ui.recents[index]);
    this.activePath = path;
    page.lastAccessed = ++this.clock;
    this.ui = { ...this.ui, activePath: path, recents };
    this.persist();
    if (changed) this.emit();
  }

  close(path: string, opts?: { discardDraft?: boolean }): ClosePageResult {
    if (this.disposed) return 'not-open';
    const page = this.pages.get(path);
    if (!page) return 'not-open';
    if (pageStatus(page) === 'dirty' && !opts?.discardDraft) return 'dirty';
    this.removePage(path);
    this.persist();
    return 'closed';
  }

  // -------------------------------------------------------------------------
  // 逐页编辑（P1 useDesignDocument 不变式迁移）
  // -------------------------------------------------------------------------

  async apply(
    operations: DesignEditOperation[],
    label: string,
    mergeKey?: string
  ): Promise<DesignSelection | null> {
    const page = this.activePage();
    if (!page || page.busy || operations.length === 0 || !page.selection) return null;
    const locator = page.selection;
    const before = page.draft;
    page.busy = true;
    page.error = '';
    const request = ++page.requestId;
    this.touch(page);
    this.emit();
    try {
      const result = await applyEditTransaction(before, {
        baseRevision: page.draftRevision,
        locator,
        operations,
      });
      if (!this.disposed && page.requestId === request) {
        page.draft = result.source;
        page.draftRevision = result.revision;
        page.selection = result.selection;
        page.history.record({ before, after: result.source, label, at: Date.now(), mergeKey });
        this.touch(page);
      }
      return result.selection;
    } catch (error) {
      if (!this.disposed && page.requestId === request) {
        page.error = editErrorMessage(error);
        this.touch(page);
      }
      return null;
    } finally {
      page.busy = false;
      this.touch(page);
      this.emit();
    }
  }

  /**
   * P5 deck 页级源码替换（deck 纯函数变换的提交口）：以原子草稿替换走既有
   * 历史/修订链路。守卫：busy / loading 页 / source 与当前草稿相同 → false
   * （不记录历史）；替换后清 selection，作为一步独立 undo 记录。
   */
  async applySource(source: string, label: string): Promise<boolean> {
    const page = this.activePage();
    if (!page || page.busy || page.doc === null || source === page.draft) return false;
    const before = page.draft;
    page.busy = true;
    page.error = '';
    const request = ++page.requestId;
    this.touch(page);
    this.emit();
    try {
      const revision = await this.getPorts(this.sessionId).sha256(source);
      if (this.disposed || page.requestId !== request) return false;
      page.draft = source;
      page.draftRevision = revision;
      page.selection = null;
      page.history.record({ before, after: source, label, at: Date.now() });
      this.touch(page);
      return true;
    } catch (error) {
      if (!this.disposed && page.requestId === request) {
        page.error = errorMessage(error);
        this.touch(page);
      }
      return false;
    } finally {
      page.busy = false;
      this.touch(page);
      this.emit();
    }
  }

  async undo(): Promise<void> {
    await this.moveHistory('undo');
  }

  async redo(): Promise<void> {
    await this.moveHistory('redo');
  }

  private async moveHistory(direction: 'undo' | 'redo'): Promise<void> {
    const page = this.activePage();
    if (!page || page.busy) return;
    const next =
      direction === 'undo' ? page.history.undo(page.draft) : page.history.redo(page.draft);
    if (next === null) {
      // 基线漂移或空历史：强制 reload 并提示（P1 不变式）。
      const request = ++page.requestId;
      await this.loadPage(page, true, request);
      if (!this.disposed) {
        page.error = HISTORY_INVALID_MESSAGE;
        this.touch(page);
        this.emit();
      }
      return;
    }
    page.busy = true;
    const request = ++page.requestId;
    this.touch(page);
    this.emit();
    try {
      const revision = await this.getPorts(this.sessionId).sha256(next);
      if (!this.disposed && page.requestId === request) {
        page.draft = next;
        page.draftRevision = revision;
        page.selection = null;
        this.touch(page);
      }
    } finally {
      page.busy = false;
      this.touch(page);
      this.emit();
    }
  }

  async save(): Promise<boolean> {
    const page = this.activePage();
    if (!page || page.busy) return false;
    if (!page.doc || page.draft === page.doc.source) return false;
    const missing = page.missing;
    page.busy = true;
    page.error = '';
    // 使 in-flight 文档载入失效（P1 语义）。
    const request = ++page.requestId;
    this.touch(page);
    this.emit();
    try {
      const ports = this.getPorts(this.sessionId);
      const saved = await ports.putDocument({
        path: page.path,
        source: page.draft,
        // 重建保存：missing 页 expectedRevision 为空串并附 allowCreate。
        expectedRevision: missing ? '' : page.doc.revision,
        ...(missing ? { allowCreate: true } : {}),
      });
      if (this.disposed || page.requestId !== request) return false;
      page.doc = saved;
      page.draft = saved.source;
      const revision = await ports.sha256(saved.source);
      if (this.disposed || page.requestId !== request) return false;
      page.draftRevision = revision;
      page.history.markSaved(saved.source);
      page.externalChange = false;
      // 文件重建后由下次 refreshFiles 确认仍存在。
      page.missing = false;
      this.touch(page);
      this.emit();
      // 保存状态已提交；快照失败只是提示，不算保存失败（P1 语义）。
      try {
        await ports.createSnapshot(saved.path, 'save');
      } catch (snapshotError) {
        if (!this.disposed && page.requestId === request) {
          page.error = `保存成功，但快照未创建：${errorMessage(snapshotError)}`;
          this.touch(page);
          this.emit();
        }
      }
      return true;
    } catch (error) {
      if (!this.disposed && page.requestId === request) {
        page.error = errorMessage(error);
        if (isConflict(error)) page.externalChange = true;
        this.touch(page);
      }
      return false;
    } finally {
      page.busy = false;
      this.touch(page);
      this.emit();
    }
  }

  async reload(): Promise<void> {
    const page = this.activePage();
    if (!page || page.busy || !page.doc) return;
    const request = ++page.requestId;
    await this.loadPage(page, true, request);
  }

  /** Preview iframe 的选择消息（base === 当前草稿修订才接受，P1 不变式）。 */
  handleSelectionMessage(next: DesignSelection): void {
    if (this.disposed) return;
    const page = this.activePage();
    if (!page || next.base !== page.draftRevision) return;
    page.selection = next;
    this.touch(page);
    this.emit();
  }

  // -------------------------------------------------------------------------
  // 轮询入口
  // -------------------------------------------------------------------------

  /** 文件清单轮询结果 → missing 检测；改名不自动映射，旧路径页仅标 missing。 */
  refreshFiles(files: string[]): void {
    if (this.disposed) return;
    const present = new Set(files);
    let changed = false;
    for (const page of this.pages.values()) {
      const missing = !present.has(page.path);
      if (page.missing !== missing) {
        page.missing = missing;
        changed = true;
        this.touch(page);
      }
    }
    if (changed) this.emit();
  }

  /** 文档轮询结果：仅当 next.path 为活动页且页非 busy 才处理（P1 checkExternal）。 */
  async handleExternalDoc(next: DesignDocument): Promise<void> {
    const page = this.activePage();
    if (!page || page.busy || !page.doc || next.path !== page.path) return;
    // 使该页 in-flight 载入/保存结果失效：随后到期的旧响应不得覆盖本轮处理。
    page.requestId += 1;
    const unchanged =
      next.revision === page.doc.revision && next.source === page.doc.source;
    if (page.draft !== page.doc.source) {
      // 脏页：保留草稿，磁盘确有变化才置标志。
      if (unchanged) return;
      page.externalChange = true;
      this.touch(page);
      this.emit();
      return;
    }
    if (unchanged) return;
    await this.adoptDocument(page, next);
  }

  /** 依赖 stat 轮询结果：与该页缓存深比较（路径集+size+mtimeMs+missing），有差异 assetEpoch++。 */
  applyDepsStats(result: DesignDepsResult): void {
    if (this.disposed) return;
    const page = this.pages.get(result.entry.path);
    if (!page) return;
    // 首次采样仅建立基线：预览刚按当前磁盘状态构建，无需重建（assetEpoch
    // 不变），但公共快照开始携带 deps，仍需失效缓存并通知订阅者。
    if (page.depsFiles === null) {
      page.depsFiles = result.files.map(file => ({ ...file }));
      this.touch(page);
      this.emit();
      return;
    }
    if (depsStatsEqual(page.depsFiles, result.files)) return;
    page.depsFiles = result.files.map(file => ({ ...file }));
    this.touch(page);
    this.assetEpoch += 1;
    this.emit();
  }

  // -------------------------------------------------------------------------
  // 视口 / 缩放偏好
  // -------------------------------------------------------------------------

  setViewport(viewport: DesignViewport): void {
    if (this.disposed) return;
    const next = normalizeViewport(viewport);
    if (next.preset === this.ui.viewport.preset && next.width === this.ui.viewport.width) return;
    this.ui = { ...this.ui, viewport: next };
    this.persist();
    this.emit();
  }

  setZoom(zoom: DesignZoom): void {
    if (this.disposed) return;
    const next = normalizeZoom(zoom);
    if (next.mode === this.ui.zoom.mode && next.value === this.ui.zoom.value) return;
    this.ui = { ...this.ui, zoom: next };
    this.persist();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private activePage(): WorkspacePage | null {
    if (this.activePath === null) return null;
    return this.pages.get(this.activePath) ?? null;
  }

  private createPage(path: string): WorkspacePage {
    return {
      path,
      doc: null,
      draft: '',
      draftRevision: '',
      selection: null,
      externalChange: false,
      missing: false,
      busy: false,
      error: '',
      history: new EditHistory({ ...HISTORY_OPTIONS }),
      requestId: 0,
      lastAccessed: ++this.clock,
      depsFiles: null,
      rev: 1,
      snapshotCache: null,
      snapshotRev: 0,
    };
  }

  private touch(page: WorkspacePage): void {
    page.rev += 1;
  }

  private emit(): void {
    if (this.disposed) return;
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): DesignWorkspaceSnapshot {
    const pages = [...this.pages.values()].map(page => {
      if (page.snapshotCache && page.snapshotRev === page.rev) return page.snapshotCache;
      const built: DesignPageSnapshot = {
        path: page.path,
        status: pageStatus(page),
        source: page.draft,
        draftRevision: page.draftRevision,
        docRevision: page.doc?.revision ?? null,
        selection: page.selection,
        externalChange: page.externalChange,
        missing: page.missing,
        busy: page.busy,
        canUndo: page.history.canUndo,
        canRedo: page.history.canRedo,
        error: page.error,
        deps: page.depsFiles,
      };
      page.snapshotCache = built;
      page.snapshotRev = page.rev;
      return built;
    });
    return { pages, activePath: this.activePath, ui: this.ui, assetEpoch: this.assetEpoch };
  }

  private persist(): void {
    saveWorkspaceUiState(this.identityKey, this.ui);
  }

  /** 从 pages 移除；若是活动页则激活 recents 中下一个仍打开的页面，否则 null。 */
  private removePage(path: string): void {
    if (!this.pages.delete(path)) return;
    if (this.activePath === path) {
      const next = this.ui.recents.find(candidate => candidate !== path && this.pages.has(candidate)) ?? null;
      this.activePath = next;
      this.ui = { ...this.ui, activePath: next };
    }
    this.emit();
  }

  /** 无条件以新文档接管页面状态（重算草稿修订、rebuild 历史、清 selection）。 */
  private async adoptDocument(page: WorkspacePage, next: DesignDocument): Promise<void> {
    const revision = await this.getPorts(this.sessionId).sha256(next.source);
    if (this.disposed) return;
    page.doc = next;
    page.draft = next.source;
    page.draftRevision = revision;
    page.selection = null;
    page.externalChange = false;
    page.error = '';
    page.history.rebuild(next.source);
    this.touch(page);
    this.emit();
  }

  /** 拉取磁盘文档并按 P1 load 语义采用（busy 期间跳过、未变化跳过、失败写页 error）。 */
  private async loadPage(page: WorkspacePage, force: boolean, request: number): Promise<void> {
    try {
      const next = await this.getPorts(this.sessionId).getDocument(page.path);
      if (
        this.disposed ||
        page.requestId !== request ||
        this.pages.get(page.path) !== page ||
        page.busy
      ) {
        return;
      }
      const current = page.doc;
      if (
        !force &&
        current &&
        current.path === next.path &&
        current.revision === next.revision &&
        current.source === next.source
      ) {
        return;
      }
      await this.adoptDocument(page, next);
    } catch (error) {
      if (!this.disposed && page.requestId === request && this.pages.get(page.path) === page) {
        page.error = errorMessage(error);
        this.touch(page);
        this.emit();
      }
    }
  }
}

function moveToRecentsHead(recents: string[], path: string): string[] {
  return [path, ...recents.filter(entry => entry !== path)].slice(0, RECENTS_LIMIT);
}

// ---------------------------------------------------------------------------
// 注册表（P2 §2.4）：refcount 归零不销毁，再次 acquire 复用原实例
// ---------------------------------------------------------------------------

export interface ControllerLease {
  controller: DesignWorkspaceController;
  release(): void;
}

const registry = new Map<string, { controller: DesignWorkspaceController; refcount: number }>();

export function acquireWorkspaceController(
  identity: { backendId: string; projectId?: string; workingDirectory?: string },
  sessionId: string,
  getPorts: DesignWorkspacePortsFactory
): ControllerLease {
  const key = workspaceIdentityKey(identity);
  let entry = registry.get(key);
  if (!entry) {
    entry = { controller: new DesignWorkspaceController(key, getPorts), refcount: 0 };
    registry.set(key, entry);
  }
  entry.refcount += 1;
  entry.controller.rebind(sessionId);
  const tracked = entry;
  return {
    controller: tracked.controller,
    release: () => {
      tracked.refcount = Math.max(0, tracked.refcount - 1);
    },
  };
}
