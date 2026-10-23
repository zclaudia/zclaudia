# P1 编辑与恢复基础 — 实现设计

日期：2026-10-23。状态：P1a 与 P1b 均已实现并通过主代理验收（同日）；真实 Agent/Tauri 冒烟与远端 backend 验证待补。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P1 章节；P0 基线见 [设计工作台原型](../design-workbench.md)。

本文档把 P1（P1a 精确编辑 + P1b 持久历史）细化为可直接实施的模块、契约、算法与测试清单。实施分两波：Wave 1 = P1a（T1–T5 + P1.8），Wave 2 = P1b（P1.6/P1.7）。每波由主代理负责契约与验收，flash 子代理按任务卡实现。

## 0. 已定决策（主代理原型验证，2026-10-23）

1. **HTML 解析器选 parse5 `^8.0.1`**。原型验证事实（脚本见 §8.6）：
   - 开启 `sourceCodeLocationInfo` 后，元素与文本节点都带 `[startOffset, endOffset)` 偏移，指向原始源码；实体（如 `&eacute;`）覆盖其原始字节范围。
   - 属性位置在 `element.sourceCodeLocation.startTag.attrs[name]`，只有**全跨度**（含引号的 `name="value"` 整段），没有 value 子区间；解码后的值在 `element.attrs` 里。因此样式编辑采用「整段重写属性」策略。
   - 隐式节点（如未书写的 `<tbody>`、`<html>`）没有 `sourceCodeLocation`，可据此拒绝修改。
   - 重复属性产生 `duplicate-attribute` 解析错误并带偏移，可据此拒绝。
   - parse5 v8 为纯 ESM JavaScript、自带类型，可同时用于 desktop（vite 打包）与 server。
2. **编辑引擎在客户端**（`apps/desktop/src/features/design/html/`）。理由：撤销/重做与预览草稿编辑必须作用在草稿字符串上；服务端保持「修订校验 + 原子写入」职责，不理解编辑语义。
3. **撤销实现为快照式有界历史**（每条目存 before/after 全量字符串，限额淘汰）。不用反向补丁：偏移随编辑漂移，反向补丁脆弱；文档上限 2 MiB，快照成本可接受。
4. **写入边界抽取为 `server/src/infra/fs/safe-file-write.ts`**，设计保存改用它；pi-runtime 写工具**本轮不迁移**（避免扰动 agent 运行时），模块设计兼容后续接入。
5. **快照存储**：清单存 SQLite（migration `050_design_snapshots`），内容寻址 blob 存 `<数据目录>/design-snapshots/blobs/`；数据目录沿用 `ZCLAUDIA_DATA_DIR ?? ~/.zclaudia`（见 `server/src/infra/storage/db.ts`）。
6. 选区定位沿用「elementPath 查找 + 文本指纹校验」并新增**草稿修订绑定**；DOM 路径只用于查找，校验失败一律拒绝，绝不搜索其他节点。

## 1. 文档契约（P1.1）

### 1.1 身份与修订

- **工作区身份**：服务端解析的 workspace 根目录 `realpath`（现有 `DesignService.workspace()`）。session 只用于授权与关联，不参与快照归属；同一根目录的两个聊天看到同一份历史，不同 worktree（不同根目录）天然隔离。
- **磁盘修订 `revision`**：文件字节的 SHA-256 hex（现状不变），写入时必须匹配。
- **草稿修订 `draftRevision`**：草稿字符串的 SHA-256 hex，客户端用 `crypto.subtle` 计算。预览 bridge、选区消息与编辑事务都携带它；不匹配即拒绝（迟到 iframe 消息防护）。

### 1.2 类型（全部放 `apps/desktop/src/features/design/types.ts`，Wave 1 由主代理一次性落库，子代理不得改动该文件）

```ts
export interface DesignDocument { path: string; source: string; revision: string; }  // 现状保留

export interface DesignSelection {
  elementPath: number[];        // body 起的子元素序号，仅用于查找
  tagName: string;
  text: string;                 // 预览计算文本（展示用）
  sourceText?: string;          // 源码 textContent（解码、trim 后），校验指纹
  color?: string;
  backgroundColor?: string;
  base?: string;                // 构建预览时的 draftRevision
}

export type DesignStyleProperty = 'color' | 'background-color';

export type DesignEditOperation =
  | { kind: 'text'; value: string }
  | { kind: 'style'; property: DesignStyleProperty; value: string | null }; // null = 清除该声明

export interface DesignEditTransaction {
  baseRevision: string;         // 必须 === 当前草稿修订
  locator: DesignSelection;
  operations: DesignEditOperation[];
}

export interface DesignEditResult {
  source: string;
  revision: string;             // 新草稿修订
  selection: DesignSelection;   // 更新后的定位（sourceText/base 跟随新草稿）
}

export type DesignEditErrorCode =
  | 'REVISION_MISMATCH'      // 事务 baseRevision ≠ 当前草稿修订（迟到消息/并发编辑）
  | 'ELEMENT_NOT_FOUND'      // 路径走不到
  | 'TAG_MISMATCH'           // 标签名与定位不符
  | 'TEXT_MISMATCH'          // 文本指纹不符（重复节点/兄弟插入/源码已变）
  | 'NOT_PLAIN_TEXT'         // 含子元素，不能改文字
  | 'IMPLICIT_ELEMENT'       // 目标或所需标签无源码位置（隐式节点）
  | 'DUPLICATE_ATTRIBUTE'    // 目标开始标签内存在重复属性
  | 'MALFORMED_HTML'         // 目标元素跨度内存在其他解析错误
  | 'INVALID_VALUE'          // 颜色值非法
  | 'EMPTY_TRANSACTION';     // 没有可应用操作
```

### 1.3 服务端错误码（新增）

现有 `VALIDATION_ERROR / SESSION_NOT_FOUND / WORKSPACE_UNAVAILABLE / FILE_NOT_FOUND / PATH_FORBIDDEN / UNSUPPORTED_FILE / FILE_TOO_LARGE / REVISION_CONFLICT / UNSUPPORTED_ASSET` 保留，快照相关新增：

`SNAPSHOT_NOT_FOUND`（404）、`SNAPSHOT_INCOMPLETE`（409，恢复不完整快照前需确认）、`WORKSPACE_MISMATCH`（409）、`RESTORE_CONFLICT`（409，附 `files` 明细）、`RESTORE_FAILED`（500，附已恢复/失败/未执行清单）、`SNAPSHOT_LIMIT_EXCEEDED`（413，捕获超出资源上限——此时仍返回 incomplete 快照而非此错误；此错误仅用于清单数量超限的创建）。

## 2. 精确源码修改引擎（P1.2 / P1.3 / P1.8）

目录 `apps/desktop/src/features/design/html/`，全部纯函数，无 React 依赖：

| 文件 | 职责 |
|---|---|
| `parse.ts` | `parseDocument(source)`：parse5 解析 + 收集解析错误（`onParseError` 记 `code` 与 `startOffset`）；`findElement(doc, path)`；`childElements(node)`；`tagSpan(el)`/`textSpan(el)` 等区间助手 |
| `values.ts` | `safeColor(value): string \| null`（从现 `editing.ts` 迁移规则）；`escapeText`、`escapeAttr` |
| `style-declarations.ts` | 内联 style 声明编辑：`setDeclaration(styleValue, property, value): string`（见 §2.2） |
| `hash.ts` | **主代理随 T1 提供，子代理直接使用**：`sha256Hex(source)`（WebCrypto 优先，jsdom 无 subtle 时走已验证的纯 JS 回退 `sha256HexSync`） |
| `edit-engine.ts` | `applyEditTransaction(source, txn): Promise<DesignEditResult>`，抛 `DesignEditError(code)` |

### 2.1 引擎算法

单次事务对**基源码只解析一次**，收集若干互不重叠的 splice `{start, end, replacement}`，按 start 降序应用。流程：

1. `sha256Hex(source)` ≠ `txn.baseRevision` → `REVISION_MISMATCH`。
2. 解析；`findElement(doc.body, locator.elementPath)` 找不到 → `ELEMENT_NOT_FOUND`；`tagName` 不符（大小写不敏感）→ `TAG_MISMATCH`。
3. 目标无 `sourceCodeLocation?.startTag` → `IMPLICIT_ELEMENT`。
4. `duplicate-attribute` 错误落在 `[startTag.startOffset, startTag.endOffset)` → `DUPLICATE_ATTRIBUTE`；其他解析错误落在目标元素 `[startOffset, endOffset)` 内 → `MALFORMED_HTML`。
5. 逐操作生成 splice（见下）；`operations` 全部为空或无变化 → `EMPTY_TRANSACTION`。
6. 降序拼接返回新源码；新 `selection`：`sourceText` 更新为 text 操作后的值（trim），`base` 更新为新修订；`text/color/backgroundColor` 反映已应用值。

**text 操作**：
- 目标 childNodes 必须全为单一文本节点或为空（无子节点）。含元素或其他节点 → `NOT_PLAIN_TEXT`。
- 有文本节点时：其解码值 trim 后 ≠ `locator.sourceText`（当提供）→ `TEXT_MISMATCH`。splice 区间 = 文本节点 `sourceCodeLocation`；替换为 `escapeText(value)`（`&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`）。
- 无子节点（空元素）：若 `sourceText` 提供且非空 → `TEXT_MISMATCH`；否则在 `startTag.endOffset` 处零宽插入转义文本（紧随开始标签之后；在 `>` 之前插入会拼进标签名产生坏标签，自闭合 `/>` 后的文本按 HTML 规则也归属该元素）。

**style 操作**：
- `value !== null` 时先 `safeColor` 校验 → 失败 `INVALID_VALUE`。
- 元素 `attrs` 有 `style`：取解码值 `v`，`next = setDeclaration(v, property, value)`；`next === v`（清除不存在的声明）→ 该操作跳过；否则替换 `startTag.attrs.style` 全跨度为 `style="${escapeAttr(next)}"`（`&`→`&amp;`、`"`→`&quot;`）。
- 无 `style`：`value === null` → 跳过；否则插入 ` style="property: value"`：位置在有属性时取 `startTag.attrs` 各全跨度最大 endOffset 之后，无属性时在开始标签 `>`（或 `/>` 的 `/`）之前。

**拒绝即安全**：任何校验失败抛错，不产生部分修改；同一事务多个操作要么全部体现在返回源码，要么异常。

### 2.2 `setDeclaration` 规格

输入是 style 属性解码值，如 `color: red; margin : 0`。按 `;` 拆段（跳过引号内与括号内的分号；`/* */` 注视如遇到整体保留不拆）。每段取 `:` 前部分 trim、小写后与 `property` 比较：

- 命中**最后一条**同名声明（内联级联后者生效）：`value !== null` 时用 `${原名token}: ${value}` 替换该段（保留原属性名大小写）；`value === null` 时删除该段并吃掉一个相邻分隔符（非首段删其前的 `;`，首段删其后的 `;`），保持其余字节不变。
- 未命中且 `value !== null`：原值 trim 后非空且不以 `;` 结尾则补 `; `，再追加 `${property}: ${value}`。
- 未命中且 `value === null`：返回原值（无变化）。
- 其余声明（含同名更早声明、注释、空白）**逐字节保留**。

### 2.3 选区定位与防误改（P1.3）

- `elementPath` 只用于在当前草稿解析树中查找；找到后必须通过 `tagName` + `sourceText` 指纹双重校验才可修改。
- 重复文本、重复 id、Agent 在目标前插入兄弟节点等情形：路径指向的节点文本与指纹不符时**拒绝**（`TEXT_MISMATCH`/`ELEMENT_NOT_FOUND`），不做任何近似搜索。
- 预览标记（`data-zclaudia-path` 等）只存在于预览构建产物，引擎输入是草稿源码，天然不会写入作品。
- 选区消息绑定 `base` 草稿修订；面板丢弃 `base` ≠ 当前草稿修订的选择消息（迟到 iframe 防护）。

## 3. 撤销与重做（P1.4）

`apps/desktop/src/features/design/history/edit-history.ts`：

```ts
export interface EditHistoryEntry { before: string; after: string; label: string; at: number; }
export interface EditHistoryOptions { limit?: number; maxBytes?: number; mergeWindowMs?: number; }
export class EditHistory {
  constructor(options?: EditHistoryOptions);            // limit=100, maxBytes=32MiB, mergeWindowMs=1500
  record(entry: EditHistory & { mergeKey?: string }): void;
      // mergeKey 与栈顶相同且 now-at < mergeWindowMs → 只替换栈顶 after（保留原 before/at），否则压栈；
      // 压栈清空 redo；超 limit 或累计字节(所有 entry 的 before+after 长度和)超 maxBytes 时淘汰最旧并调整保存标记。
  undo(current: string): string | null;
      // 无可撤销返回 null；防御：current !== 栈顶 after → 视为外部改动，rebuild(current) 后返回 null。
  redo(current: string): string | null;                 // 对称：current !== redo 目标 before → rebuild 后 null。
  markSaved(source: string): void;                      // 记录保存基线（不清历史：保存后仍可撤销为新草稿）。
  rebuild(source: string): void;                        // 外部接管/重新载入/恢复后重建基线并清空历史。
  get canUndo(): boolean; get canRedo(): boolean; get savedSource(): string | null;
}
```

- `savedSource` 参与脏判定（`draft !== savedSource` 即脏）；`record` 的 `mergeKey` 形如 `path.join('.')+':'+kind+':'+property`，实现「连续输入可合并」。
- 撤销产生的新草稿走正常保存流程，服务端修订校验不被绕过。

## 4. 面板集成（P1.4 / P1.8 UI）

`DesignPanel.tsx` 拆分（只拆本阶段需要的部分）：

| 文件 | 职责 |
|---|---|
| `useDesignDocument.ts` | 文档状态机：load/draft/revision、history、selection、apply/undo/redo/save/reload、外部变更与冲突标志 |
| `components/DesignToolbar.tsx` | 文件选择、刷新、生成、交给 Agent、撤销/重做、保存、重新载入 |
| `components/SelectionEditor.tsx` | 选中元素表单 + **清除文字颜色/清除背景颜色**按钮（`value: null` 操作）+ 覆盖警告条 |
| `DesignPanel.tsx` | 组合与布局，保持现有空态/轮询/发现逻辑 |

状态机要点：

- `apply(ops)`：构造事务（`baseRevision` = 当前草稿修订、locator = 当前 selection）→ `applyEditTransaction` → 成功后 setDraft/setSelection(结果)、`history.record({before, after, label, mergeKey})`；失败按错误码提示（`REVISION_MISMATCH`/`TEXT_MISMATCH` → 提示重新选择）。
- `undo()/redo()`：调用 history；`null` 返回（基线漂移）→ 重新载入并提示；成功则 setDraft、setSelection(null)（撤销后需重新选择）。
- 保存成功：`history.markSaved(saved.source)`、更新 doc/revision；外部变更检测保持现状（revision/source 变化 → externalChange 提示，草稿保留）。
- iframe 选择消息校验 `base === 当前草稿修订`，不符直接忽略。
- **P1.8 验证回路**：`preview.ts` 的 bridge 增加 `zclaudia:design-verify` 请求/响应（父窗口 → iframe：`{channel, elementPath}`；iframe → 父：`{type:'zclaudia:design-verify-result', channel, color, backgroundColor}`，取 `getComputedStyle`）。应用 style 操作后异步验证：计算色 ≠ 所写 inline 值 → SelectionEditor 显示「修改已写入源码，但被外部样式覆盖（如 `!important`）；已按内联声明写入，未提高优先级」。文本操作不触发。

## 5. 统一宿主写入边界（P1.5）

`server/src/infra/fs/safe-file-write.ts`（新模块，不 import pi-runtime 任何内容）：

```ts
export interface SafeWriteOptions {
  maxBytes: number;
  expectedRevision: string;                 // 当前内容 sha256，必须匹配
  backup?: (bytes: Buffer, stat: fs.Stats) => Promise<void>; // 可选写前备份钩子（由调用方决定存放）
}
export async function safeWriteFile(absolutePath: string, next: Buffer, o: SafeWriteOptions): Promise<{ revision: string }>;
export async function readBoundedFile(filePath: string, maxBytes: number, description: string): Promise<{ bytes: Buffer; stat: fs.Stats }>; // 从 design-service 迁出并导出，语义不变
```

行为：模块级按文件 promise 链互斥（移植 `file-write-lock.ts` 模式，独立 Map）→ `readBoundedFile` → 修订校验 → 可选备份 → `wx` 写同目录临时文件并保留 mode → **同步**终检（lstat 非 symlink、realpath 仍在根内由调用方校验、stat dev+ino 一致、内容哈希仍为 expectedRevision）→ `renameSync` → finally 清理临时文件。

`DesignService.writeDocument` 重构为调用 `safeWriteFile`（HTTP 契约与既有测试不变；`DesignError` 在 service 层包装）。设计保存接 `backup` 钩子：备份字节写入 `<数据目录>/design-write-backups/<sha256(绝对路径)前16hex>/<15位时间戳>-<uuid>`（名字单调可排序），同文件保留最近 5 份（`createRollingBackupKeeper`，目录名按绝对路径哈希隔离）。pi-runtime 工具迁移另立 PR，本文档只保证模块可被其复用（无 pi 依赖、路径绝对、锁按绝对路径）。实现附注：safe-file-write 抛模块内 `SafeFileWriteError(code)`，由调用方映射为既有 status/code；保存路径下磁盘文件已超限时错误消息文本为通用 "File exceeds the size limit"（status/code 不变）；终检含 lstat/`dev+ino`/内容哈希，realpath 越界复检由调用方 `resolve()` 在写入前完成。样式值按用户输入原样写入（不再做 CSSOM 颜色归一化，如 `#123abc` 不再转 `rgb(...)`）。

## 6. 持久快照（P1.6）

### 6.1 存储

- Migration `050_design_snapshots.ts`：

```sql
CREATE TABLE design_snapshots (
  id TEXT PRIMARY KEY,                -- 'ds' + randomUUID
  workspace_root TEXT NOT NULL,       -- 捕获时 workspace realpath
  session_id TEXT,                    -- 发起会话（信息性）
  entry_path TEXT NOT NULL,           -- 工作区相对入口 HTML
  label TEXT,
  source TEXT NOT NULL,               -- 'save' | 'manual' | 'pre-restore' | 'restore'
  run_id TEXT,                        -- 可确认 run（P4 前留空）
  complete INTEGER NOT NULL,
  incomplete_reasons TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_design_snapshots_ws ON design_snapshots(workspace_root, entry_path, created_at);
CREATE TABLE design_snapshot_files (
  snapshot_id TEXT NOT NULL,
  path TEXT NOT NULL,                 -- 工作区相对路径
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- 'entry' | 'css' | 'image' | 'font' | 'other'
  mime TEXT,
  PRIMARY KEY (snapshot_id, path)
);
CREATE TABLE design_restore_log (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, session_id TEXT,
  started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL,  -- running|succeeded|failed|conflict
  report TEXT NOT NULL DEFAULT '{}'   -- JSON {restored:[],failed:[{path,error}],pending:[]}
);
```

- Blob：`server/src/infra/design/blob-store.ts`，根 `<dataDir>/design-snapshots/blobs`，`blobs/<sha[0:2]>/<sha>`；`writeBlob` 内容寻址去重（存在且同大小则跳过，不一致抛错）；`readBlob(sha)`、`hasBlob`。`resolveDataDir()` 从 `db.ts` 导出（重构现有 DEFAULT_DB_DIR 逻辑，不改行为）。
- 数量上限：每 workspace（按 workspace_root）500 条，超出删最旧（含其文件行）；随后清理无引用 blob（对剩余快照做反查）。

### 6.2 资源图 `server/src/application/design/resource-graph.ts`

- `collectHtmlResourceRefs(html, entryPath)`：parse5 解析，收集 `link[rel~="stylesheet"][href]`（css）、`img[src]`、`img/source[srcset]` 各候选、`source[src]`、`style` 元素内与任意 `style` 属性内 `url()`（css/image/font 按扩展名定 kind）。相对路径按引用文件目录归一（复用 preview.ts 的归一思路，服务端实现）；绝对路径/协议 URL/`..` 越界 → 记入 `skipped`（含原因），不当资源。
- `collectCssResourceRefs(css, cssPath)`：`url()` 提取（含 `@font-face`、`@import` 的本地 css 递归由调用方做，深度 ≤ 4）。
- 调用方 BFS：入口 HTML → 引用集，去重（visited by path），上限 200 条引用；超出记 incomplete 原因 `resource-limit`。

### 6.3 捕获算法（`snapshot-service.ts`）

`capture(sessionId, entryPath, label?, source)`：

1. 解析 workspace（现有规则）与入口路径（仅 `.html?`）；入口读取 ≤ 2 MiB，读时记 `stat(size, mtimeMs)` 与哈希。
2. 资源图 BFS 收集引用；逐个读取（单文件 ≤ 10 MiB、总计 ≤ 50 MiB）+ 记哈希与 stat；读取失败/超限/路径非法 → `incompleteReasons.push('\${path}: \${原因}')`，**显示而非隐藏**。
3. 全部读完后对入口与每个已捕获文件**再 stat 一次**：mtimeMs 或 size 变化 → 重读该文件一次（新哈希），仍不稳 → `incompleteReasons.push('changed-during-capture: \${path}')`。只承诺「校验一致」，不承诺同刻一致。
4. 写 blob、事务插入清单；**去重**：同 workspace+entry 的最近一条 complete 快照文件集（path→sha 完全相等）时直接返回该快照，不新建。
5. 返回 `SnapshotSummary`（含 `complete`、`incompleteReasons`、`fileCount`、`totalBytes`）。

捕获时机：面板保存成功 → `source:'save'`；手动按钮 → `'manual'`；恢复前 → `'pre-restore'`；恢复后 → `'restore'`。

### 6.4 版本列表与恢复（P1.7）

HTTP（挂现有 `/api/design` 认证路由）：

```
GET  /api/design/snapshots?sessionId=&path=            → SnapshotSummary[]（按 createdAt desc，上限 100）
POST /api/design/snapshots {sessionId, path, label?}   → SnapshotSummary（手动捕获）
GET  /api/design/snapshots/:id?sessionId=              → {summary, files: SnapshotFile[]}
GET  /api/design/snapshots/:id/file?sessionId=&path=   → {mime, data(base64)}（校验 path ∈ 清单）
POST /api/design/snapshots/:id/restore {sessionId, expectedRevisions: Record<path,revision>}
                                                       → {summary(restore 快照), restored: string[]}
```

**恢复算法**（`restore-service.ts`）：

1. 快照存在（404）且 `workspace_root` === 当前会话解析的 workspace realpath（否则 409 `WORKSPACE_MISMATCH`）。
2. 对清单中现存于磁盘的文件先捕获 `pre-restore` 快照（含失败原因记录；即便个别文件读失败也继续，原因进入结果报告）。
3. 逐清单文件：路径走现有 `resolve` 校验（不存在的文件允许，视为待重建）；存在的读取哈希，必须等于客户端 `expectedRevisions[path]`（客户端须为每个现存文件提供；缺失即冲突项）→ 任何不符 409 `RESTORE_CONFLICT` + `files` 明细（客户端引导重新载入后再试）。
4. **暂存**：全部 blob 先写成目标同目录 `.design-restore-<uuid>.tmp`。
5. **终检**：重读现存文件哈希，任一变化 → 清理暂存、409 `RESTORE_CONFLICT`。
6. 顺序 rename（缺失文件先 `mkdir -p` 父目录）；**操作日志**写 `design_restore_log`（开始置 running，结束更新 status/report）；某步失败即停止，报告 `restored / failed / pending` 三段，恢复路径 = pre-restore 快照；不回滚、不声称原子、不删除清单外文件。
7. 成功后捕获 `restore` 快照（去重规则同上），返回。

**不完整快照恢复**：`complete = false` 的快照允许恢复但响应/界面必须显示未捕获资源清单（恢复前确认文案）。清单外文件一律不动。

### 6.5 客户端（`features/design`）

- `api.ts` 增加上述端点封装。
- `components/VersionHistory.tsx`：按当前文档列版本（时间、label/source、complete 徽标与原因、大小/文件数）；操作：**保存版本**（manual 捕获）、**查看差异**、**恢复此版本**。
- `features/design/diff.ts`：`lineDiff(a, b)` 简单 LCS 行差异（上限 5000 行，超出截断提示），供 `components/VersionDiff.tsx` 展示文本文件（HTML/CSS）；二进制显示「二进制 · 大小 · 相同/不同」。旧内容走 `snapshots/:id/file`，新内容为当前磁盘 doc。
- 恢复流程：确认框列出将写入的文件 → 409 冲突时提示并引导「重新载入」→ 成功后面板强制重载 + `history.rebuild`。
- 自动捕获：保存成功后触发 `save` 捕获（失败仅提示，不阻塞保存成功状态）。

## 7. 验收对照（对上游计划 P1 验收条目）

| 计划验收项 | 覆盖证据 |
|---|---|
| 相同工作区两聊天看到一致历史 | server 测试：两 session 同 workspace 列表一致；快照归属 workspace_root |
| 不同 backend/worktree 不串 | server 测试：不同 workspace 的快照互不可见；restore 跨 workspace → WORKSPACE_MISMATCH |
| 改标题无关字节不变 | 引擎测试：before/after 差异恰为预期 splice（逐字节断言），fixtures 含注释/实体/未引号属性/CRLF |
| 旧选区/重复节点/无效源码不猜测 | 引擎测试：重复兄弟、插入兄弟后路径漂移、duplicate-attribute、隐式 tbody、TEXT_MISMATCH/拒绝 |
| 撤销/重做/保存/重载/冲突符合规则 | history 单测 + useDesignDocument/组件测试（合并窗口、redo 清除、保存后撤销、外部接管 rebuild） |
| HTML/CSS/二进制图片快照可恢复；中断可报告 | server 测试：完整捕获恢复回读；恢复中途失败（目标路径造目录冲突）→ report 三段 + pre-restore 存在 |
| 受控写入互斥、过期修订拒绝 | safe-file-write 测试：并发 10 写串行无交错；过期 revision 409 |
| 外部写入：草稿保留、备份可恢复 | 既有面板行为保持 + 备份钩子测试（5 份淘汰） |
| 路径越界/symlink/私密/超限/错误 snapshotId | 快照端点测试：清单外 file 读取 403/404、不存在 id 404、超限捕获 incomplete |

## 8. 测试与工具

### 8.1 fixtures（`apps/desktop/src/features/design/__tests__/fixtures/`，主代理随 T1 提供）

- `basic.html`：常规页面，含实体、注释、未引号属性、空白文本、CRLF 行尾一份变体。
- `duplicates.html`：完全相同的兄弟 `<p class="q">dup</p>`×2、重复 id。
- `implicit.html`：无 tbody 的 table、隐式 head/body 场景。
- `malformed.html`：重复属性 `<div a=1 a=2>`、未闭合标签。
- `cascade.html` + `cascade.css`：外部样式 + `!important`（验证回路与样式行为用）。

### 8.2 命令

```sh
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts
```

### 8.3 任务卡与文件边界（Wave 1）

主代理（T1，派发前完成）：types.ts 契约、fixtures、`html/hash.ts`（含 jsdom 回退与向量测试）、`parse5@^8.0.1` 加入 desktop+server 依赖并安装、本文档。

- **L1 编辑核心**（`features/design/html/*`、`history/edit-history.ts`、`__tests__/html/*`、`__tests__/history/*`）：实现 §2/§3，全部用例绿。禁改：types.ts、editing.ts、DesignPanel.tsx、preview.ts。
- **L2 写入边界**（`server/src/infra/fs/safe-file-write.ts`、`design-service.ts` 重构、`server/src/infra/fs/__tests__/*`、既有 design http 测试保持绿）：实现 §5。禁改：HTTP 契约、pi-runtime 目录。
- **L3 面板集成**（`useDesignDocument.ts`、`components/DesignToolbar.tsx`、`components/SelectionEditor.tsx`、`DesignPanel.tsx`、`preview.ts` bridge verify、`__tests__/useDesignDocument.test.ts(x)`、更新 `__tests__/DesignPanel.test.tsx`）：实现 §4；`editing.ts` 在引擎就位后删除并迁移残余测试。依赖 L1 导出名（按 §2 签名编码，接口不一致由主代理收敛）。

### 8.4 任务卡与文件边界（Wave 2，Wave 1 验收后）

- **L4 后端快照**：migration 050、`infra/design/blob-store.ts`、`application/design/resource-graph.ts`、`snapshot-service.ts`、`restore-service.ts`、`interfaces/http/design.ts` 增路由、`db.ts` 导出 `resolveDataDir`、`__tests__` 全套。实现 §6.1–6.4。
- **L5 面板版本**：`api.ts`、`diff.ts`、`components/VersionHistory.tsx`、`components/VersionDiff.tsx`、`useDesignDocument.ts` 挂自动捕获与恢复、组件测试。实现 §6.5。禁改服务端。

### 8.5 门禁基线

以 main 既有失败为基线（另见 docs/reports/2026-10-18-open-items-ledger.md）；本批不允许引入新失败。真实 macOS Tauri 冒烟与远端 backend 验证在 M1 前由用户配合完成，本轮以自动化测试为准并记录待办。

### 8.6 解析器评估记录

对比对象：`DOMParser + outerHTML`（现状，重排整文、无源码位置，否决）、`htmlparser2`（容错定位弱于 parse5 的规范树，隐式节点信息不足，次选）、`parse5@8.0.1`（选定，事实见 §0.1）。评估脚本临时运行于 /tmp，不入库。

### 8.7 验收记录（2026-10-23，主代理）

Wave 1（P1a）与 Wave 2（P1b）由 GLM-5.3-Flash 子代理实现（两轮 workflow，门禁含自动修复回路），主代理验收：

- 测试：desktop 设计模块 151 用例（11 文件）、server 设计/写入/快照 48 用例（6 文件）全绿；两包 `tsc --noEmit` 干净；eslint 0 错误（8 个警告沿袭 P0 既有模式）；react-lifecycle 与 radius 约束检查通过。
- 验收修正（主代理直接改码）：① POST /api/design/snapshots 接受 `source: 'save'`（面板保存自动捕获此前会被记成 manual——L4/L5 并行契约缺口）；② restore 成功后的 post-restore 捕获失败降级为返回原快照 summary（不再出现"文件已恢复但 HTTP 500"）。
- 已知缺口（记录在案）：changed-during-capture 稳定性复验路径无自动化用例（测试环境无法在捕获窗口内可靠制造并发写）；`SNAPSHOT_LIMIT_EXCEEDED` 为保留错误码，现行"超限删最旧"策略下无触发路径；恢复中断场景由"预置目录制造 rename 失败"用例覆盖。
- 待补验证：真实 Agent + macOS Tauri 冒烟（M1 门槛）、浏览器与远端 backend 验证、e2e 快照恢复链路扩展。
