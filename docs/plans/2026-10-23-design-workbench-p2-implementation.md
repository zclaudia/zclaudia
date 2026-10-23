# P2 完整静态工作台 — 实现设计

日期：2026-10-23。状态：P2 全部实现并通过主代理验收（同日，见 §10）；真实 Agent/Tauri 冒烟与远端 backend 验证待 M1 前补做。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P2 章节；P1 基线见 [P1 实现设计](2026-10-23-design-workbench-p1-implementation.md)。

本文档把 P2（P2.1 页面组织 / P2.2 画布视口 / P2.3 资源变化传播 / P2.4 源码与预览联动 / P2.5 基础导出）细化为可直接实施的模块、契约、算法与测试清单。实施分四波：T0 主代理预落共享契约 → Wave 1（L6 服务端 ‖ L7 客户端核心，并行）→ Wave 2（L8 面板重构）→ Wave 3（L9 联动与导出 UI）。每波由主代理负责契约与验收，flash 子代理（luna）按任务卡实现。

## 0. 已定决策（主代理勘察，2026-10-23）

1. **不新增 WebSocket 消息类型、不接线服务端 watcher。** 勘察事实：服务端→客户端唯一通道是集中定义的 `ServerMessage` WebSocket 联合（`shared/src/wire/messages/index.ts:72`）；pi-runtime 的 `FileChangeNotifier` 扩展点（`server/src/infra/providers/pi-runtime/file-change-notifier.ts`）生产代码未接线；仓库内无任何 ZIP 库。P2.3 的「宿主写入事件优先，按需 watcher 或哈希轮询兜底」落地为三层：
   - **宿主自身写入**（面板保存）本地已知；
   - **外部 Agent 插件写入**（codex/cursor 附带 `file_change` effect，落在 `chatMessageStore`）由面板订阅 store 变化即时触发刷新（去抖 400ms）；
   - **兜底**：面板可见时每 2s stat 轮询 `GET /api/design/deps`（mtime/size，不哈希）+ 既有文档 revision 轮询。pi-runtime 内置工具写入与任意外部编辑器由此覆盖（≤2s 延迟）。
   WS 推送事件与 `FileChangeNotifier` 接线记为后续优化，不阻塞 P2 验收。
2. **多页状态用模块级 controller（纯 TS，非 React state）。** 按工作区 identity 注册 + 引用计数；同一工作区多个聊天共享同一 controller（草稿互通，「相同工作区的多个聊天可以看到同一作品」）；页面草稿在应用进程内跨会话切换存活，仅 UI 元数据（最近打开、活动页、视口/缩放偏好）持久化 localStorage（key 按工作区 identity 隔离）。不持久化草稿本身（localStorage 容量不可靠，2 MiB 文档会超限）。
3. **视口与缩放严格分离。** 视口 = iframe 的布局宽度（设备预设或自定义，媒体查询按它生效）；缩放 = 外层容器 CSS `transform: scale()`，仅影响显示，不写任何 CSS、不改变 iframe 布局宽度。
4. **ZIP 库选 jszip `^3.10.1`**（MIT、纯 JS、自带类型、`generateAsync('nodebuffer')`）。规模上限沿用 P1 快照（≤200 引用、单文件 ≤10 MiB、总计 ≤50 MiB），内存内打包可行，不需要流式。
5. **导出固定明确版本。** `disk` 模式请求携带 `expectedRevision`（磁盘哈希），不符即 `REVISION_CONFLICT`；`draft` 模式显式携带 `draftSource` 字符串。资源缺失默认 `EXPORT_INCOMPLETE` 拒绝；`confirmIncomplete: true` 才继续，且 ZIP 内必含 `zclaudia-export.json` 清单（含 missing 列表），不生成「看似完整」的包。
6. **文件查看器始终显示磁盘内容；设计面板是唯一草稿持有者。** 现有 `FileViewerPanel` 为只读查看；P2.4 的源码跳转基于已保存版本，草稿脏时界面明示差异归属，避免两份草稿互相覆盖。
7. **桌面保存复用 `services/fileDownload.ts` 的 Tauri 落盘通路**（`saveFileTauri` 写 Downloads + 去重；web/Android 走浏览器下载）。导出按钮通过新增的导出封装触发，不重复造下载逻辑。

## 1. 共享契约（T0 主代理预落，子代理不得改动这些文件的本节内容）

### 1.1 `apps/desktop/src/features/design/types.ts` 追加

```ts
// ---- P2 完整静态工作台 ----

export type DesignViewportPreset = 'fill' | 'desktop' | 'tablet' | 'mobile' | 'custom';

/** fill = 跟随可用宽度（默认）；custom 必须带 width。 */
export interface DesignViewport {
  preset: DesignViewportPreset;
  /** 240–3840；preset === 'fill' 时为 null。 */
  width: number | null;
}

/** mode 'fit' 自动适应；manual value 0.25–2。 */
export interface DesignZoom {
  mode: 'fit' | 'manual';
  value: number;
}

export type DesignDependencyKind = 'css' | 'image' | 'font' | 'other';

export interface DesignDependencyStat {
  /** 工作区相对路径。 */
  path: string;
  kind: DesignDependencyKind;
  size: number | null;
  mtimeMs: number | null;
  missing: boolean;
}

export interface DesignDepsResult {
  entry: { path: string; size: number; mtimeMs: number };
  files: DesignDependencyStat[];
  skipped: { raw: string; reason: string }[];
}

export type DesignExportMode = 'disk' | 'draft';

export interface DesignExportRequest {
  sessionId: string;
  /** 入口 HTML 工作区相对路径。 */
  path: string;
  mode: DesignExportMode;
  /** disk 模式：当前磁盘哈希；不符 → REVISION_CONFLICT。 */
  expectedRevision?: string;
  /** draft 模式必填；≤ 2 MiB。 */
  draftSource?: string;
  /** 缺资源仍导出（清单记录 missing）。 */
  confirmIncomplete?: boolean;
}
```

### 1.2 `apps/desktop/src/features/design/api.ts` 追加/扩展

```ts
export interface DesignHttpError extends Error {  // 导出/依赖类服务端错误
  code: string;                                    // EXPORT_INCOMPLETE / EXPORT_LIMIT_EXCEEDED / REVISION_CONFLICT / ...
  files?: string[];                                // EXPORT_INCOMPLETE 时的缺失清单
}
export function isDesignHttpError(e: unknown): e is DesignHttpError;

export async function getDesignDeps(backendId: string, sessionId: string, path: string): Promise<DesignDepsResult>;
// GET /api/design/deps?sessionId=&path=

// putDesignDocument 的请求体追加可选 allowCreate?: boolean（文件被删除后重建保存）。

export async function exportDesignZip(
  backendId: string,
  request: DesignExportRequest
): Promise<{ blob: Blob; filename: string }>;
// POST /api/design/export。响应为 application/zip 时解析 Content-Disposition 的 filename 返回 blob；
// 响应为 JSON 错误时抛 DesignHttpError（含 code / files）。
```

### 1.3 `apps/desktop/src/features/design/workspace/ports.ts`（新文件，T0 落库）

```ts
import type { DesignDepsResult, DesignDocument } from '../types';

/** 控制器对宿主能力的全部依赖（测试注入 fake）。绑定单个 backendId+sessionId。 */
export interface DesignWorkspacePorts {
  getDocument(path: string): Promise<DesignDocument>;
  putDocument(req: {
    path: string;
    source: string;
    expectedRevision: string;   // 重建保存时为 ''
    allowCreate?: boolean;
  }): Promise<DesignDocument>;
  listDeps(path: string): Promise<DesignDepsResult>;
  createSnapshot(path: string, source: 'save' | 'manual'): Promise<unknown>;
  sha256(source: string): Promise<string>;
}

export type DesignWorkspacePortsFactory = (sessionId: string) => DesignWorkspacePorts;
```

### 1.4 服务端错误码（新增）

| code | status | 场景 |
|---|---|---|
| `EXPORT_INCOMPLETE` | 409 | 引用的本地资源缺失；`details.files` 为缺失相对路径列表；`confirmIncomplete` 后放行 |
| `EXPORT_LIMIT_EXCEEDED` | 413 | 引用数 >200 / 单文件 >10 MiB / 总计 >50 MiB / draftSource >2 MiB / CSS @import 深度 >4（深度超限抛 413 而非静默截断：静默截断会产出离线打不开的包——Wave 1 验收确认） |

既有 `REVISION_CONFLICT`（disk 模式版本钉死失败）、`FILE_NOT_FOUND`、`PATH_FORBIDDEN`、`SESSION_NOT_FOUND`、`WORKSPACE_UNAVAILABLE`、`FILE_TOO_LARGE`、`UNSUPPORTED_FILE` 原样复用。

### 1.5 HTTP 契约（挂现有 `/api/design` 认证路由）

```
GET  /api/design/deps?sessionId=&path=        → DesignDepsResult
POST /api/design/export                        → application/zip 二进制（错误时 JSON，同现有 handleError 形态）
PUT  /api/document 扩展：body 追加 allowCreate?: boolean（见 §6.3）
```

## 2. 多页工作台核心（P2.1）

### 2.1 模块与文件

| 文件 | 职责 |
|---|---|
| `workspace/controller.ts` | `DesignWorkspaceController`：多页状态机（打开/激活/关闭/编辑/撤销/保存/外部变更/缺失检测）+ registry |
| `workspace/storage.ts` | UI 元数据持久化（localStorage，版本化，损坏容错回默认） |
| `workspace/api-adapter.ts` | `createWorkspacePorts(backendId, sessionId): DesignWorkspacePorts`，包装 api.ts |
| `workspace/source-lines.ts` | 选区 → 源码行号（P2.4 用，见 §5.1） |
| `__tests__/workspace/*` | 上述测试 |

### 2.2 状态与快照

```ts
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
  externalChange: boolean;    // 脏页期间磁盘已变化
  missing: boolean;           // 文件已从工作区消失（删除/改名）
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string;
}

export interface DesignWorkspaceUiState {
  version: 1;
  activePath: string | null;  // 上次活动页（重新打开面板时恢复）
  recents: string[];          // 最近打开，去重，上限 12
  viewport: DesignViewport;   // 默认 { preset: 'fill', width: null }
  zoom: DesignZoom;           // 默认 { mode: 'fit', value: 1 }
}

export interface DesignWorkspaceSnapshot {
  pages: DesignPageSnapshot[];
  activePath: string | null;
  ui: DesignWorkspaceUiState;
  /** 资源 stat 变化计数；+1 时所有预览需要重建（资产内联自磁盘）。 */
  assetEpoch: number;
}
```

### 2.3 控制器

```ts
export const MAX_OPEN_PAGES = 8;

export type ClosePageResult = 'closed' | 'dirty' | 'not-open';
export type OpenPageResult =
  | { ok: true }
  | { ok: false; reason: 'limit' | 'load-failed'; message?: string };

export class DesignWorkspaceController {
  /** identityKey 见 workspaceIdentityKey；getPorts 每次动作时以最新 sessionId 取 ports（支持 rebind）。 */
  constructor(identityKey: string, getPorts: DesignWorkspacePortsFactory, uiState?: DesignWorkspaceUiState);
  subscribe(listener: () => void): () => void;
  getSnapshot(): DesignWorkspaceSnapshot;      // 引用稳定：仅在变更点更换快照对象
  rebind(sessionId: string): void;

  open(path: string): Promise<OpenPageResult>;
  activate(path: string): void;
  close(path: string, opts?: { discardDraft?: boolean }): ClosePageResult;

  apply(operations: DesignEditOperation[], label: string, mergeKey?: string): Promise<DesignSelection | null>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  save(): Promise<boolean>;
  reload(): Promise<void>;

  refreshFiles(files: string[]): void;             // 文件清单轮询结果 → missing 检测
  handleExternalDoc(next: DesignDocument): Promise<void>;  // 仅当 next.path 为活动页
  applyDepsStats(result: DesignDepsResult): void;  // stat 变化 → assetEpoch++

  setViewport(viewport: DesignViewport): void;
  setZoom(zoom: DesignZoom): void;

  dispose(): void;   // 仅由上层显式调用；registry 在引用计数归零时不销毁实例（§2.4）
}

// Wave 1 落地补充（L8 面板需要）：
// - handleSelectionMessage(next: DesignSelection): void —— P1『iframe 选择消息 base === 当前草稿
//   修订才接受』的不变式迁入控制器（活动页维度）。
// - applyDepsStats 首次采样只建立基线、不增 assetEpoch（无上次缓存即无差异，避免面板打开后
//   预览无谓重建一次）。
// - §2.2 的 DesignPageStatus/DesignPageSnapshot/DesignWorkspaceSnapshot 导出自
//   workspace/controller.ts；DesignWorkspaceUiState 导出自 workspace/storage.ts。
// - undo/redo 空历史与基线漂移同样走 reload + 提示（P1 行为原样）。

export function workspaceIdentityKey(identity: {
  backendId: string;
  projectId?: string;
  workingDirectory?: string;
}): string;  // 稳定非加密哈希（FNV-1a，8 hex）——identity key 需同步计算，sha256Hex 为异步不可用

export interface ControllerLease { controller: DesignWorkspaceController; release(): void; }
export function acquireWorkspaceController(
  identity: { backendId: string; projectId?: string; workingDirectory?: string },
  sessionId: string,
  getPorts: DesignWorkspacePortsFactory
): ControllerLease;
```

行为规格（每条都是测试断言点）：

- **每页独立 `EditHistory`**：`limit=100`、`maxBytes=8 MiB`、`mergeWindowMs=1500`。撤销/重做/保存语义逐页沿用 P1（`useDesignDocument` 的行为不变式全部迁移）：保存后可继续撤销为新草稿；`undo/redo` 基线漂移 → 该页强制 reload + 错误提示「编辑历史已失效，已重新载入」；新编辑清空 redo；连续输入按 mergeKey 合并。
- **open**：已打开 → 仅 activate，返回 ok。达到 `MAX_OPEN_PAGES` → 先淘汰最久未访问的**干净且非活动**页面（状态直接丢弃）；无可淘汰 → `{ok:false, reason:'limit'}`（UI 提示「先关闭未保存的页面」）。载入失败（FILE_NOT_FOUND 等）→ `{ok:false, reason:'load-failed', message}`，不添加页面。成功 → 页面 status 'clean'，加入 recents 头部（去重、截 12），持久化 activePath。
- **close**：页面 dirty 且未传 `discardDraft: true` → 返回 'dirty'（UI 弹确认：保存 / 放弃修改 / 取消；放弃时再调 `close(path, {discardDraft: true})`）。关闭即从 pages 移除；若是活动页 → 激活 recents 中下一个仍打开的页面，否则 null。**missing 页面关闭同样走 dirty 确认**（草稿仍可保留在内存直至确认丢弃）。
- **save**：dirty 页才动作。`expectedRevision = docRevision`；`missing === true` 时附 `allowCreate: true` 且 `expectedRevision = ''`（重建文件）。成功 → 更新 doc 基线、`markSaved`、清 externalChange/missing（文件重建后由下次 `refreshFiles` 确认仍存在）、触发 `createSnapshot(path,'save')`（快照失败仅写页 error「保存成功，但快照未创建：…」，不算保存失败，P1 语义）。`REVISION_CONFLICT` → 置 externalChange，保留草稿。**保存范围仅活动页**（多页保存按页进行，无批量事务）。
- **refreshFiles**：对每个打开页，`missing = !files.includes(path)`；由 clean 变 missing 或反向变化时触发快照更新。**改名不自动映射**：旧路径页标 missing（⚠ + 可关闭/可保存重建），新路径由用户从文件下拉打开；不做猜测匹配。
- **handleExternalDoc**（文档轮询结果）：`next.path` 必须等于活动页路径且页非 busy，否则忽略（迟到响应防护）。脏页 → revision/source 有别于基线才置 externalChange；干净页 → 有变化即 adopt（重算 draftRevision、`history.rebuild`、清 selection）。同 P1 `checkExternal`。
- **applyDepsStats**：与该页上次缓存 stat 逐项比较（路径集合 + size + mtimeMs + missing）。任一差异 → `assetEpoch++` 并更新缓存。entry 的变化不需要在这里处理（文档轮询负责）。
- **请求陈旧防护**：所有异步动作带单调递增 requestId（按页）；结果仅当 requestId 仍为该页最新且控制器未 dispose 才生效。dispose 后所有 subscribe 停止、in-flight 结果丢弃——切换会话/backend 得到不同 identityKey → 不同 controller 实例，旧实例的迟到响应不可能写入新实例（验收项）。
- **rebind**：同 identity 新面板挂载时更新 sessionId；后续动作经 `getPorts(sessionId)` 取绑定新会话的 ports。旧会话 in-flight 响应因 requestId/dispose 规则不会污染。
- **storage**（`storage.ts`）：key `zclaudia-design-ws-${identityKey}`。load：JSON 解析失败/版本不符/字段非法 → 返回默认值；字段级校验（recents 为 string[] 截 12、viewport.width 越界回 null 等）。save：每次 open/close/activate/setViewport/setZoom 同步写。**不存草稿、不存打开页列表**——面板挂载只恢复 activePath（不存在则走现有发现流程：design/index.html 优先）。

### 2.4 注册表

`acquireWorkspaceController` 维护模块级 `Map<identityKey, {controller, refcount}>`。refcount 0 时**不销毁**（草稿跨面板开关存活到应用退出），仅当同 identity 全部 release 后再 acquire 时复用原实例。控制器数量不设上限（受 MAX_OPEN_PAGES 与用户行为约束；每页草稿 ≤2 MiB + 历史 ≤8 MiB，8 页上限 → 单工作区最坏 ~80 MiB，可接受）。

## 3. 画布视口（P2.2）

组件（L8）：

| 文件 | 职责 |
|---|---|
| `components/ViewportControls.tsx` | 预设选择（充满 / 桌面 1280 / 平板 768 / 手机 390 / 自定义）、自定义宽度输入（240–3840 整数，非法回退）、缩放 −/+（步进 10%，夹在 25%–200%）、百分比显示、「适应」切换 fit/manual、双击百分比回 100% |
| `components/PreviewCanvas.tsx` | 受缩放 iframe 容器 |

`PreviewCanvas` 结构与不变式：

```
<div ref={containerRef} data-testid="design-canvas" class="…overflow-auto…">   // 滚动容器 + ResizeObserver（jsdom 缺失时跳过）
  <div style={{ width: frameW*scale, height: frameH*scale }}>                 // 占位尺寸，避免 transform 后留白/溢出
    <iframe style={{ width: frameW, height: frameH, transform: `scale(${scale})`, transformOrigin: 'top left' }} … />
```

- `frameW`：preset 'fill' → `'100%'`（scale 恒 1，禁用缩放控件）；否则 `${viewport.width}px`。`frameH`：容器内容高度（fill）或固定 `100%`。**iframe 布局宽度只由视口决定**；`scale` 永远是显示变换（fit 模式 = `min(1, containerW / frameWpx)`，容器尺寸变化经 ResizeObserver 重算）。
- iframe 其余行为沿用现状：`sandbox="allow-scripts"`、srcDoc 预览串、onLoad 发 verify、message 事件校验 `event.source === iframe.contentWindow`（多 iframe 并存时按 source 区分，总览缩略图的桥接消息天然被忽略）。
- 视口/缩放偏好经 controller.setViewport/setZoom 持久化（per 工作区）。
- 测试断言点：width=390 + zoom manual 0.5 → iframe `style.width === '390px'` 且 `transform` 含 `scale(0.5)`（设备宽度与缩放独立的验收映射）。

## 4. 资源变化传播（P2.3）

### 4.1 服务端 `GET /api/design/deps`（L6）

`server/src/application/design/deps-service.ts`：

```ts
export class DepsService {
  constructor(db: Database.Database);           // 组合 DesignService（workspace 解析 + 文件 resolve）
  async stat(sessionId: unknown, entryPath: unknown): Promise<DesignDepsResult>;
}
```

1. workspace 解析（现有规则）+ 入口路径校验（`/\.html?$/i`，走 `DesignService.resolveFile`，见 §6.3）。
2. 读入口（≤2 MiB，`readBoundedFile`），取 stat size/mtimeMs。
3. 资源图 BFS（复用 `resource-graph.ts` 的 `collectHtmlResourceRefs` / `collectCssResourceRefs`）：CSS 引用递归展开（深度 ≤4），总引用 ≤200，超出截断并以 `{raw: path, reason: 'resource-limit'}` 记入 skipped。协议 URL/绝对路径/越界 → skipped（原因沿用 resolveReference 的 'external-url' 等）。
4. 逐引用 `fs.stat`：ENOENT → `missing: true, size/mtimeMs null`；存在 → size+mtimeMs。symlink 经 realpath 逃出 workspace 根 → 记 skipped 'outside-workspace'（对齐 snapshot-service 的处理）；引用路径中含点开头的私有组件（如 `.private/x.png`）→ skipped 'private-path'（对齐 workspace list/resolve 的私有目录排除，stat 它们会泄露私有文件元数据——Wave 1 验收确认）。**不做内容哈希**（2s 轮询成本约束）。
5. 返回 `DesignDepsResult`。任何文件读取异常不抛 500：入口读失败才抛既有错误码（FILE_NOT_FOUND/FILE_TOO_LARGE 等）。

### 4.2 客户端轮询与刷新（L8，`useDesignWorkspace.ts`）

- 面板可见时每 `POLL_MS=2000`：现有文件清单轮询 → `controller.refreshFiles(files)`；活动页文档轮询（getDesignDocument → `handleExternalDoc`）+ 依赖轮询（getDesignDeps → `applyDepsStats`）。三者在同一 tick 顺序发起，各自带请求陈旧防护（沿用现有 requestRef 模式）。面板隐藏/卸载即停（「关闭面板释放监听」）。
- **`assetEpoch` 变化 → 预览重建**：面板预览 effect 的依赖键为 `(activePath, draftRevision, assetEpoch)`；CSS/图片 mtime 变化不需要文档变化即触发重建（预览构建时资产重新内联）——这是 P0 遗留限制 #4 的修复。
- **宿主写入即时刷新**：订阅 `useChatMessageStore`，对 `messages[sessionId]` 计算指纹（消息数 + 最后一条消息 id），变化 → 400ms 去抖触发一次「清单+文档+依赖」立即刷新（外部 agent 插件的 file_change effect 落库后 ≤0.4s 生效）。pi-runtime 工具写入靠轮询兜底（≤2s）。
- 非活动页不轮询；激活时若距上次检查 >POLL_MS 立即补一次文档+依赖检查。

## 5. 源码与预览联动（P2.4）

### 5.1 选区源码行号（L7，`workspace/source-lines.ts`）

```ts
/** 计算选区元素在草稿源码中的 1-based 行区间；定位失败返回 null（绝不猜测）。 */
export function elementLineRange(
  source: string,
  elementPath: number[],
  tagName: string,
  sourceText?: string
): { startLine: number; endLine: number } | null;
```

- parse5 `parseDocument(source)`（复用 `html/parse.ts`）→ `findElement(doc.body, elementPath)`；找不到 / tagName 不符（大小写不敏感）/ 无 `sourceCodeLocation` / 提供 sourceText 且 textContent trim 不等 → null。
- `startLine` = source[0..startOffset) 中 `\n` 数 +1；`endLine` = startLine + 区间内 `\n` 数。**基于草稿计算**（行号属于草稿；磁盘版行号可能不同，见下）。

### 5.2 UI（L9）

- **SelectionEditor 增加「查看源码」按钮**（有选区时可用）：调 `elementLineRange(draft, …)` → null 则提示「无法定位源码位置」；成功 → `useFileViewerStore.openFile(projectRoot, docPath, startLine, endLine, backendId)`（现有唯一文件查看入口，`apps/desktop/src/stores/fileViewerStore.ts:58`）。**页面 dirty 时按钮旁提示「文件查看器显示已保存版本，行号以草稿计算可能有偏移」**——草稿唯一持有者是设计面板，file-viewer 永远读磁盘，不存在两份可写草稿。
- **跳转文件**：页面总览中每页的「在查看器中打开」（相对路径 + 无行号，Wave 2 已交付）。独立「依赖资源列表」UI 不在本批范围（deps stat 由控制器内部消费驱动 assetEpoch，快照未暴露依赖清单；后续批次如需展示再扩展快照）——Wave 2 验收裁决。
- **差异预览**：工具栏「未保存差异」（dirty 时可用）复用 `diff.ts` 的 `lineDiff` 对比 `doc.source`（已保存）与草稿，展示组件复用/抽取 `VersionDiff.tsx` 的表格（允许小幅重构，保持其现有测试语义）。版本差异（P1 VersionHistory）不变。

## 6. 基础导出（P2.5）

### 6.1 `server/src/application/design/export-service.ts`（L6）

```ts
export interface ExportInvocation {
  sessionId: unknown;
  path: unknown;
  mode: 'disk' | 'draft';
  expectedRevision?: unknown;
  draftSource?: unknown;
  confirmIncomplete?: unknown;
}
export interface ExportResult { buffer: Buffer; filename: string; manifest: DesignExportManifestShape; }

export class ExportService {
  constructor(db: Database.Database);
  async exportZip(inv: ExportInvocation): Promise<ExportResult>;
}
```

算法：

1. workspace/入口校验同 §4.1。
2. `disk`：读入口 ≤2 MiB → 哈希；`expectedRevision` 提供且 ≠ 磁盘哈希 → `REVISION_CONFLICT`。`draft`：`draftSource` 必填且 ≤2 MiB → 否则 `EXPORT_LIMIT_EXCEEDED`/`VALIDATION_ERROR`；入口字节 = draftSource。
3. 资源图 BFS 同 §4.1 第 3 步（超限 → `EXPORT_LIMIT_EXCEEDED`）。
4. 逐引用读取：单文件 ≤10 MiB、总计 ≤50 MiB → 超限 `EXPORT_LIMIT_EXCEEDED`；不存在 → 记入 missing（继续收集完清单）。
5. `missing.length > 0 && confirmIncomplete !== true` → `DesignError(409, 'EXPORT_INCOMPLETE', details { files: missing })`。
6. jszip 打包：每个文件按**工作区相对路径**原位写入（入口也在其相对路径，解压后相对引用直接可用，离线可打开）；根附加 `zclaudia-export.json`：

```json
{
  "version": 1,
  "mode": "disk" | "draft",
  "entryPath": "design/index.html",
  "exportedAt": 1760000000000,
  "files": [{ "path": "…", "sha256": "…", "bytes": 123, "kind": "entry|css|image|font|other" }],
  "missing": ["assets/gone.png"],
  "skipped": [{ "raw": "https://…", "reason": "external-url" }]
}
```

7. `generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })`。
8. `filename = <入口去扩展名>-<YYYYMMDD-HHmmss>.zip`（服务器本地时间；入口 basename 先做文件名净化：非 `[A-Za-z0-9._-]` 字符替换 `_`）。

### 6.2 HTTP（L6，`interfaces/http/design.ts`）

`POST /export`：JSON body → `exportService.exportZip` → 成功 `Content-Type: application/zip` + `Content-Disposition: attachment; filename="<name>"` + `Content-Length` + `res.send(buffer)`；`DesignError` 走现有 `handleError`（JSON）。`GET /deps` 同 §4.1。body 上限沿用全局 `express.json({ limit: '15mb' })`（`server/src/server.ts:170`），draftSource ≤2 MiB 无压力。

### 6.3 写入边界扩展：`allowCreate`（L6）

- `safe-file-write.ts` 的 `SafeWriteOptions` 追加 `createIfMissing?: boolean`：目标不存在时要求 `expectedRevision` 为空串或 undefined（否则 `REVISION_MISMATCH`），随后走同一「临时文件 + 终检（lstat/哈希/单飞）+ rename」路径；目标存在时行为不变（不传该标志完全向后兼容，既有测试不动）。
- `DesignService.writeDocument(sessionId, path, source, expectedRevision, allowCreate?)` 透传；HTTP `PUT /document` body 追加可选 `allowCreate`。语义仅供「页面文件被删除后保存重建」；不允许作为任意建文件接口（路径仍受现有 resolve/扩展校验约束）。

### 6.4 客户端导出流程（L9，`components/ExportDialog.tsx`）

1. 活动页 dirty → 三选：「保存并导出」（先 save 成功再 disk 模式）/「导出草稿」（draft 模式 + draftSource）/「取消」；干净页直接 disk 模式。
2. 调 `exportDesignZip`；`EXPORT_INCOMPLETE` → 对话框列出缺失文件，提供「仍要导出（包内清单会标注缺失）」`confirmIncomplete: true` 重试 /「取消」；`REVISION_CONFLICT` → 提示「文件已变化，正在刷新」，触发一次立即刷新；其余错误显示 message。
3. 成功 → `saveBlobToFile(blob, filename)`（`services/fileDownload.ts` 新增导出：Tauri 写 Downloads（复用 `saveFileTauri` 的去重逻辑，将其重构为可复用私有函数），web/Android 走 `triggerBrowserDownload`），显示「已导出：`<filename>`」。
4. 进行中禁用按钮并显示状态；**任何失败路径都不落盘半成品文件**（buffer 一次性生成后才保存；保存失败显示错误并保留对话框可重试）。

## 7. 面板集成（P2.1/P2.2/P2.3 UI，L8）

| 文件 | 职责 |
|---|---|
| `useDesignWorkspace.ts` | acquire lease + `useSyncExternalStore` 订阅 + 可见门控轮询（清单/文档/依赖）+ chatMessageStore 指纹订阅 + 动作包装 |
| `components/PageTabs.tsx` | 标签条：basename 标签、脏点 •、缺失 ⚠、关闭 ×（dirty 先走确认）、点击激活；文件下拉「打开页面」列出未打开文件 |
| `components/PageOverview.tsx` | 页面总览（缩略图）：打开页网格，每格 mini iframe（360×240 布局，`transform scale` 到显示尺寸，pointer-events:none）+ basename + 脏/缺失徽标 + 点击激活 + 「在查看器中打开」；预览串用面板级缓存 `Map<path, {key: path+draftRevision+assetEpoch, html}>`（≤8 条），非活动页在总览打开时惰性构建 |
| `components/DesignToolbar.tsx` | 改造：去掉文件 Select（由标签条承担）；保留刷新/撤销/重做/生成/交给 Agent/保存/重新载入；新增 导出、总览、未保存差异（dirty 时可用）按钮 |
| `DesignPanel.tsx` | 重写组合：工具栏 + 视口控件 + 画布（PreviewCanvas 包现有 iframe 行为：message 校验、verify、预览构建）+ 标签条 + SelectionEditor/VersionHistory（绑定活动页）+ 各对话框挂载；`useDesignDocument.ts` 删除，其行为由 controller 承担（测试迁移） |
| 空态/发现 | 保持现有逻辑（design/index.html 优先、生成等待、prefill 通道不变）；存储 activePath 存在则直接恢复该页 |

保持不变的既有行为（回归点）：iframe 选择消息 `base === 当前草稿修订` 校验；verify 回路；生成/交给 Agent 的 prefill；版本历史按活动页；P1 错误文案映射沿用（迁入 controller 或面板层 util）。

## 8. 验收对照（对上游计划 P2 验收条目）

| 计划验收项 | 覆盖证据 |
|---|---|
| 同一会话管理三页作品，分别编辑与保存 | L7 controller 测试：三页 open/apply/save 互不串扰，磁盘按页写入；L8 面板测试：三标签切换草稿保留 |
| 仅 CSS 或图片变化也会刷新 | L6 deps 测试（stat 汇总正确）；L7 applyDepsStats 测试（mtime 变化 → assetEpoch++）；L8 预览 effect 依赖 assetEpoch 的组件测试 |
| 切换会话/backend 旧请求不污染当前页 | L7 测试：两个 identity 的 controller，慢响应后到不写入新实例；dispose 后 in-flight 丢弃 |
| 设备宽度与缩放独立 | L8 PreviewCanvas 测试：width 390 + scale 0.5 断言互不干预；fit 模式随容器宽计算 |
| 导出包离线可打开且资源齐全 | L6 export 测试：HTML+CSS+图片+字体工作区 → 解包断言相对路径原位、清单一致、入口引用全部在包内；缺失资源默认 409，confirm 后清单含 missing；draft 模式用 draftSource 字节 |
| 文件删除/改名/关闭未保存明确处理 | L7 测试：refreshFiles 标 missing；dirty close 返回 'dirty'；allowCreate 保存重建（L6 safe-file-write 测试：createIfMissing 路径 + expectedRevision 非空拒绝） |
| 状态按工作区隔离 | L7 storage 测试：不同 identityKey 不同 key；UI 元数据字段校验 |
| 宿主写入事件优先 + 轮询兜底 | L8：chatMessageStore 指纹变化 → 去抖刷新测试；可见门控轮询测试（隐藏即停） |

## 9. 测试与任务卡

### 9.1 命令（各卡钉死）

```sh
# desktop（L7 / L8 / L9）
cd apps/desktop && bash ../../scripts/with-project-node.sh pnpm exec vitest run --config vitest.ui.config.ts src/features/design
# server（L6）
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts src/application/design/__tests__ src/infra/fs/__tests__/safe-file-write.test.ts
# 类型/静态
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
```

### 9.2 T0（主代理，派发前）

本设计文档；`types.ts` §1.1 全量追加；`api.ts` §1.2（getDesignDeps / exportDesignZip / DesignHttpError / putDesignDocument allowCreate 参数）；`workspace/ports.ts` §1.3；`pnpm --filter @zclaudia/server add jszip@^3.10.1`（锁文件由主代理一次性变更，子代理禁碰 package.json/lockfile）。

### 9.3 Wave 1（并行）

- **L6 服务端**（`deps-service.ts`+测试、`export-service.ts`+测试、`design-service.ts`（resolveFile 导出 + writeDocument allowCreate）、`safe-file-write.ts`（createIfMissing）、`interfaces/http/design.ts`（/deps /export /allowCreate）、`__tests__` 扩展）。实现 §4.1/§6.1–6.3 + §1.5。禁改：desktop 目录、snapshot/restore 服务。
- **L7 客户端核心**（`workspace/controller.ts`、`workspace/storage.ts`、`workspace/api-adapter.ts`、`workspace/source-lines.ts`、`__tests__/workspace/*`）。实现 §2/§5.1。禁改：types.ts、api.ts、ports.ts、DesignPanel 及组件、html/ 引擎、history（只读复用）。

### 9.4 Wave 2（L6/L7 验收后）

- **L8 面板重构**（`useDesignWorkspace.ts`、`components/PageTabs.tsx`、`components/ViewportControls.tsx`、`components/PreviewCanvas.tsx`、`components/PageOverview.tsx`、`DesignToolbar.tsx` 改造、`DesignPanel.tsx` 重写、删除 `useDesignDocument.ts`、测试迁移/新增）。实现 §3/§4.2/§7。禁改：workspace/controller.ts 与 storage.ts（bug 报回主代理）、服务端。

### 9.5 Wave 3（L8 验收后）

- **L9 联动与导出 UI**（`SelectionEditor.tsx` 查看源码、`VersionDiff.tsx` 抽取复用 + 草稿差异入口、`components/ExportDialog.tsx`、`services/fileDownload.ts` 增加 saveBlobToFile 导出、`DesignToolbar.tsx`/`DesignPanel.tsx` 增量接线、测试）。实现 §5.2/§6.4。禁改：workspace 核心、服务端。

### 9.6 门禁基线

以 main 既有失败为基线（docs/reports/2026-10-18-open-items-ledger.md）；本批不允许引入新失败。react-lifecycle 与 radius 约束检查沿用 P1 流程。真实 macOS Tauri 冒烟（含 Tauri Downloads 落盘、三页作品、离线 ZIP 解包）与远端 backend 验证在 M1 前由用户配合完成，本轮以自动化测试为准并记录待办。

## 10. 验收记录（2026-10-23，主代理）

T0 契约与 L6–L9 由主代理 + GLM-5.3-Flash 子代理（三轮 workflow，含门禁自动修复回路与两次升级裁决）实现，主代理逐波验收：

- **测试**：desktop 设计模块 220 用例（20 文件，含 controller 19、storage 9、source-lines 8、重写 DesignPanel 21、PageTabs 6、ViewportControls 5、PreviewCanvas 5、PageOverview 5、ExportDialog/SelectionEditor/草稿差异/工具栏接线、api 契约 5）+ fileDownload 30 用例；server 设计/写入/快照 69 用例（含新增 deps-service 8、export-service 8、safe-file-write +3、HTTP +4）。双端 `tsc --noEmit` 干净；eslint 0 错误（desktop 27 警告沿袭既有 react-hooks 规则族基线）；`check-react-lifecycle-invariants` 与 `check-radius-conventions` 均 OK。
- **验收裁决与修正（主代理）**：① Wave 1 接受 L6 四项偏差（export CSS 深度超限抛 413、deps 私有点路径 skipped `private-path`、非普通文件计入 missing、allowCreate+非空修订→REVISION_CONFLICT）与 L7 七项判断（快照类型落 controller/storage、新增 handleSelectionMessage、applyDepsStats 首采样仅建基线、registry 永不 dispose 等），均已回写本文档相应章节；② 直接修码：controller.activate 非空断言重构（消除唯一新增 eslint 警告）；③ L9 为绕过任务卡中 eslint 路径笔误创建的 `apps/desktop/services → src/services` 符号链接已删除（以正确路径复跑证实文件集一致）；④ 补 T0 契约测试 `__tests__/api-p2.test.ts` 5 例（deps 查询、allowCreate 透传、导出 filename 解析、EXPORT_INCOMPLETE 分流、非 JSON 错误回退）。
- **已知事项**：desktop 27 条 eslint 警告为基线规则族（含 L8 新文件 16 条），按 0 error 门禁口径放行，未清零以免改行为；VersionHistory 的 currentSource 传活动页草稿（dirty 页差异基线为草稿而非磁盘）；独立「依赖资源列表」UI 裁决不做（§5.2）。
- **待补验证（M1 门槛）**：真实 Agent + macOS Tauri 冒烟（含 ZIP 落盘 Downloads、三页作品全流程、设备视口实机）、浏览器与远端 backend 验证、e2e 导出链路扩展。
- **执行注记**：workflow 的 `world.run` 沿用主代理会话 shell 的持久 cwd——主代理验收时 `cd apps/desktop` 导致后续 wave 的相对路径门禁全部落空（两次升级后定位）；门禁命令一律使用绝对路径。子代理按卡不得改锁文件与运行器配置，遇此情形应升级而非自建变通（symlink 事件）。
