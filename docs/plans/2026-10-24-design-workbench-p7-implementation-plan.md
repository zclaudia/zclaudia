# P7 分享与审阅协作 — 实现设计

日期：2026-10-24。状态：P7.1–P7.3 已实现并通过主代理终验收（2026-10-24，见 §12 验收记录；S1–S7 由 flash 子代理（luna）逐卡实现）；本机浏览器真实冒烟通过；第二客户端 LAN 冒烟与 macOS Tauri 分享实测为手工门槛待补；P7.4 仅评估、结论维持现状（§9）。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P7 章节；基线见 [P5](2026-10-23-design-workbench-p5-implementation.md)、[P6](2026-10-24-design-workbench-p6-implementation.md)。

本批覆盖 **P7.1 不可变分享快照 / P7.2 页面与元素评论 / P7.3 审阅到 Agent 修改**；P7.4 多人同时编辑仅做评估（§9，无代码）。T0 契约由主代理预落，S1–S7 由 flash 子代理（luna）逐卡串行实现、主代理逐卡验收。

明确排除（第一版边界）：

- **不经 gateway、无公网托管**：分享由本机 ZClaudia 服务直接对外提供 capability URL。第二客户端需网络可达本机服务——默认绑定 127.0.0.1（同机浏览器即可）；局域网访问需 `SERVER_HOST=0.0.0.0` 或 `ZCLAUDIA_ALLOW_LAN=1`（既有语义，trust-boundary.ts）。此时该客户端的其他 `/api` 请求仍需 Bearer（`servers.client_id`），仅 `/s/*` 分享路由凭 token 访问。
- **分享 = 单入口快照**（该入口 HTML 的资源闭包），不打包工作区其他页面；快照内链接跳转在分享视图被拦截并提示，目标不在清单中的一律不可达。
- **静态分享，不执行作品脚本**：分享视图 iframe `sandbox="allow-same-origin"`（无 `allow-scripts`）+ 文件端点 CSP `default-src 'none'`（script 因此为 none）。表单提交、弹窗、顶层导航均被 sandbox 禁用；CSS 动画可播放。视频经 `media-src 'self'` 可播（若在清单内）。
- **无账号体系**：评审者自报姓名（默认「匿名」）；token 即权限（知悉链接即可访问 `link` 范围），`local` 范围仅限本机访问者。无评论编辑/删除（v1），所有者可标记解决。
- **评论无通知/推送**：面板手动刷新。
- **不完整快照可分享**，但清单与视图如实标注 `incompleteReasons`，不谎称完整。

## 0. 已定决策（主代理勘察，2026-10-24）

1. **分享引用快照，不复制第二份作品库**（架构约束 1「历史快照用于恢复与分享」的字面落地）。`design_shares` 行引用 `snapshot_id`；内容寻址 blob 天然不可变，「旧分享不随本地修改变化」由不可变性保证。**必须补 pin**：`SnapshotService.pruneOldest`（snapshot-service.ts:505）会把超 500 条的最旧快照连同文件行删掉——排除「存在未撤销分享」的快照（§3）。blob 清扫的 referenced 集本来就取自全部存活快照的文件行（:482-487），pin 住行即保住 blob，无需改清扫。
2. **公开路由独立挂载，绕开会话鉴权但只开放四类只读/受限端点**。`/api/design` 在 `authMiddleware` 之后（domain-bootstrap.ts:220），本机放行、远程要求 Bearer；分享视图要被无凭据的浏览器访问，故公开路由挂根级 `/s/:token`（`app.use(createDesignShareRoutes(db))`，与 `/health`、`/api/server/info` 同为无鉴权先例）。可暴露的只有：视图 HTML、清单、清单内文件内容、评论读/写。不暴露工作区路径（清单路径为工作区相对，不含本机绝对路径）、不暴露 sessionId、无任何列举端点。
3. **撤销与过期语义**：未知 token 与已撤销一律 `404 SHARE_NOT_FOUND`（不区分存在性）；已过期 `410 SHARE_EXPIRED`（告知评审者链接过期）。撤销不删除内容（行保留、pin 继续，可再出新分享；v1 无恢复撤销）。
4. **元素定位载荷复用选区语义**：`{ elementPath: number[]; tagName: string; text: string }`——`elementPath` 为 body 起的元素子节点序号，与桌面 `DesignSelection.elementPath`（types.ts:7-24）及 agent-context 选区载荷同构。快照不可变 → 视图内定位恒可解析；**失效判定发生在桌面侧对新版本源码**（§6 comment-locator）：路径越界 / tagName 不符 / 文本不符 → 失效并给原因，绝不静默挂到其他元素（P7.2）。
5. **审阅进聊天复用 P4.4 链路**：新纯模块 `review-handoff.ts` 组装 sections/prompt → `prefill()`（composerStore.setPendingPrefill）→ 用户手动发送；Agent 写入后的新恢复点由既有 `useAgentRunFeedback` 自动快照（P4.5）承担，不新增机制。
6. **服务端零侵入既有域**：新增 migration 052、`share-types.ts`、`share-service.ts`、`share-viewer.ts`（公开路由+视图 HTML）；`interfaces/http/design.ts` 只追加所有者端点；`snapshot-service.ts` 只改 `pruneOldest`；`domain-bootstrap.ts` 只加一行挂载。不触碰 tasks/conversation/pi-runtime/媒体域。
7. **token**：`randomBytes(32).toString('base64url')`（256 位，43 字符，auth.ts 一次性票据同款），DB 唯一索引查询。所有者创建响应给出绝对 `shareUrl`（按请求的 `req.get('host')` 拼接）与尽力而为的 `lanUrls`（服务绑定非回环时枚举 `os.networkInterfaces` 非 internal IPv4）。

## 1. 数据模型（migration `052_design_shares`，T0 预落）

```sql
CREATE TABLE IF NOT EXISTS design_shares (
  id TEXT PRIMARY KEY,               -- sh${randomUUID()}
  workspace_root TEXT NOT NULL,      -- 与 design_snapshots 同口径（fs.realpath 归属键）
  session_id TEXT NOT NULL,          -- 创建会话（所有者操作鉴权用）
  snapshot_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,        -- base64url(32B)
  title TEXT,                        -- trim ≤120，空存 NULL
  scope TEXT NOT NULL DEFAULT 'link',-- 'link' | 'local'
  created_at INTEGER NOT NULL,
  expires_at INTEGER,                -- NULL = 永不过期
  revoked_at INTEGER,                -- NULL = 未撤销
  last_access_at INTEGER             -- 视图/清单命中时更新
);
CREATE INDEX IF NOT EXISTS idx_design_shares_ws ON design_shares(workspace_root, created_at);
CREATE INDEX IF NOT EXISTS idx_design_shares_snapshot ON design_shares(snapshot_id);

CREATE TABLE IF NOT EXISTS design_share_comments (
  id TEXT PRIMARY KEY,               -- sc${randomUUID()}
  share_id TEXT NOT NULL,
  author TEXT NOT NULL,              -- trim 1..60，评审者自报；缺省「匿名」
  body TEXT NOT NULL,                -- trim 1..4000
  target_json TEXT,                  -- {elementPath,tagName,text} | NULL（整页评论）
  created_at INTEGER NOT NULL,
  resolved_at INTEGER                -- 所有者标记解决；NULL = 未解决
);
CREATE INDEX IF NOT EXISTS idx_design_share_comments_share
  ON design_share_comments(share_id, created_at);
```

- 评论上限：每 share 500 条，超出 `400 SHARE_COMMENT_LIMIT`（v1 无速率限制，文档声明）。
- 归属：所有者端点按 `workspace_root`（经 `DesignService.workspace(sessionId)`）校验 share 行；跨工作区 404。

## 2. 服务层（`share-service.ts`，S1）

### 2.1 契约（`share-types.ts`，T0 预落）

```ts
export type DesignShareScope = 'link' | 'local';
export interface DesignShareSummary {
  id: string; token: string; snapshotId: string; entryPath: string;
  title: string | null; scope: DesignShareScope;
  createdAt: number; expiresAt: number | null; revokedAt: number | null;
  commentCount: number; lastAccessAt: number | null;
}
export interface DesignShareComment {
  id: string; author: string; body: string;
  target: { elementPath: number[]; tagName: string; text: string } | null;
  createdAt: number; resolvedAt: number | null;
}
export interface DesignPublicShareManifest {
  title: string; entryPath: string; snapshotLabel: string | null;
  snapshotCreatedAt: number; complete: boolean; incompleteReasons: string[];
  files: Array<{ path: string; kind: string; bytes: number }>;
  shareCreatedAt: number; expiresAt: number | null;
}
```

常量（T0）：`MAX_SHARE_TITLE = 120`、`MAX_COMMENT_BODY = 4000`、`MAX_COMMENT_AUTHOR = 60`、`MAX_COMMENTS_PER_SHARE = 500`、`MAX_SHARE_ELEMENT_PATH_DEPTH = 64`、`MAX_SHARE_TEXT = 200`、`MAX_EXPIRES_DAYS = 365`、`SHARE_SCOPES`。

### 2.2 `ShareService`（S1 新文件，`application/design/share-service.ts`）

```ts
export class ShareService {
  constructor(db: Database.Database, designService: DesignService, blobs: BlobStore);
  create(sessionId: unknown, input: unknown): Promise<DesignShareSummary>; // + shareUrl/lanUrls 由路由层拼
  list(sessionId: unknown, entryPath?: unknown): Promise<DesignShareSummary[]>;
  revoke(sessionId: unknown, shareId: unknown): Promise<DesignShareSummary>;
  listComments(sessionId: unknown, shareId: unknown): Promise<DesignShareComment[]>;
  setResolved(sessionId: unknown, shareId: unknown, commentId: unknown, resolved: unknown): Promise<DesignShareComment>;
  // —— 公开侧（token 授权）——
  resolveByToken(token: unknown): Promise<ShareAccess>;        // 见下
  publicManifest(access: ShareAccess): Promise<DesignPublicShareManifest>;
  publicFile(access: ShareAccess, filePath: unknown): Promise<{ mime: string; bytes: Buffer; sha256: string }>;
  addComment(access: ShareAccess, input: unknown): Promise<DesignShareComment>;
  publicComments(access: ShareAccess): Promise<DesignShareComment[]>;
}
```

- `create`：`workspace = designService.workspace(sessionId)` → snapshotId 校验（`design_snapshots` 行存在且 `workspace_root === workspace`，否则 `404 SNAPSHOT_NOT_FOUND`）→ scope/`expiresInDays`（`null` 或 1..365；`expiresAt = now + days*86400_000`）/title 规范化（trim，空→NULL，>120 → `400 SHARE_VALIDATION`）→ token 生成 + insert → summary（commentCount 0）。
- `revoke`：行归属校验 → 已撤销 `409 SHARE_ALREADY_REVOKED`；否则置 `revoked_at = now`。
- `listComments`/`setResolved`：share 归属校验；resolve 幂等（重复置同值直接返回）；commentId 不存在 → `404 SHARE_COMMENT_NOT_FOUND`。
- **`ShareAccess`**（公开侧统一入口校验）：

```ts
interface ShareAccess {
  share: DesignShareSummary & { workspaceRoot: string };
  snapshot: { id: string; entryPath: string; label: string | null; createdAt: number;
              complete: boolean; incompleteReasons: string[] };
}
```

  `resolveByToken(token)`：token 非 string/空 → `404 SHARE_NOT_FOUND`；查 `design_shares JOIN design_snapshots`（快照行必须仍在）→ 无行或 `revoked_at != null` → `404 SHARE_NOT_FOUND`；`expires_at != null && <= now` → `410 SHARE_EXPIRED`。
- **scope 执行**在路由层：`scope === 'local'` 且请求非本机（`isLocalhost(req)`，middleware/local-only.ts 既有判定）→ `403 SHARE_LOCAL_ONLY`。服务层不管网络属性（可测性）。
- `publicFile`：路径校验复用 `validateManifestPath` 同款语义（非空、≤512、无 `\`、非绝对、无 `..`/`.`/点前缀组件；实现可复制该私有函数或等价重写）→ `design_snapshot_files` 查 `(snapshot_id, path)` → 无行 `404 SHARE_FILE_NOT_FOUND` → `blobs.readBlob(sha)`（单文件 ≤10 MiB，内存返回即可，无需流式）。
- `addComment`：author 规范化（trim；空 → `'匿名'`；>60 → `400 SHARE_COMMENT_INVALID`）；body trim 1..4000；target `null` 或 `{ elementPath: number[]（1..64 项整数 0..9999）, tagName: string（trim 1..40）, text: string（≤200） }`，违规 `400 SHARE_COMMENT_INVALID`；上限检查 → insert。
- `commentCount`：`list`/`create` 用 LEFT JOIN COUNT 聚合。
- `last_access_at` 更新：`publicManifest` 命中时置 now（文件与评论端点不更新，避免写放大）。

### 2.3 错误码表（HTTP 层统一 `sendApiError` 信封）

| code | status | 场景 |
|---|---|---|
| `SHARE_NOT_FOUND` | 404 | 未知/已撤销 token；所有者侧 shareId 不存在或跨工作区 |
| `SHARE_EXPIRED` | 410 | 已过期（公开侧） |
| `SHARE_LOCAL_ONLY` | 403 | `local` 范围 + 非本机请求 |
| `SHARE_VALIDATION` | 400 | create 参数（scope/天数/title/snapshotId 形状） |
| `SHARE_ALREADY_REVOKED` | 409 | 重复撤销 |
| `SHARE_FILE_NOT_FOUND` | 404 | 清单外文件路径 |
| `SHARE_COMMENT_INVALID` | 400 | 评论 author/body/target 校验 |
| `SHARE_COMMENT_LIMIT` | 400 | 超 500 条 |
| `SHARE_COMMENT_NOT_FOUND` | 404 | 所有者 resolve 不存在的评论 |
| `SNAPSHOT_NOT_FOUND` | 404 | create 引用的快照不存在/跨工作区 |

## 3. 快照 pin（`snapshot-service.ts`，S3）

`pruneOldest`（:505-523）两处 SQL 增加排除子句（count 与 oldest-select 一致）：

```sql
AND NOT EXISTS (
  SELECT 1 FROM design_shares sh
  WHERE sh.snapshot_id = design_snapshots.id AND sh.revoked_at IS NULL
)
```

语义：**有未撤销分享的快照永不裁剪**；500 上限只作用于无分享包袱的历史（总数可能因此短暂超 500，可接受——上限语义是「历史配额」而非「硬顶」）。过期未撤销的分享同样 pin（行还在就能访问，内容不消失；v1 文档声明）。blob 清扫无需改动（引用集取自全部存活文件行）。回归测试：建 501+ 快照时被 pin 的不被删；撤销后下次裁剪可删。

## 4. 公开路由与分享视图（`share-viewer.ts`，S2）

新文件 `server/src/interfaces/http/share-viewer.ts`，导出 `createDesignShareRoutes(db): Router`；`domain-bootstrap.ts` 在 `app.use('/api/design', …)`（:220）之后追加一行：

```ts
app.use(createDesignShareRoutes(db)); // 公开分享路由（/s/:token），token 即权限，无会话鉴权
```

路由表（全部无 authMiddleware；Express 4）：

| 方法+路径 | 行为 |
|---|---|
| `GET /s/:token` | 视图 HTML（§4.2），`Content-Type: text/html; charset=utf-8`，`Cache-Control: no-store` |
| `GET /s/:token/manifest.json` | `DesignPublicShareManifest`；命中更新 `last_access_at` |
| `GET /s/:token/f/*` | 清单内文件内容；头见下 |
| `GET /s/:token/comments` | `{ comments: DesignShareComment[] }`（created_at ASC） |
| `POST /s/:token/comments` | body `{ author?, body, target? }` → 201 comment |

- 全部先 `resolveByToken`；`scope==='local'` 时以 `isLocalhost(req)` 判定（本机放行，否则 `403 SHARE_LOCAL_ONLY`）。
- 文件响应头：`Content-Type: <manifest mime ?? 'application/octet-stream'>`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`、`Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'`（script/object/frame 全被 default-src 'none' 封死；`style-src 'unsafe-inline'` 供页内 `<style>`）。入口 HTML 同款头。
- 文件路径取 `req.params[0]`（通配段），逐段 `decodeURIComponent` 后再走 `publicFile` 校验；URL 侧以 manifest 路径为唯一真源。

### 4.2 视图 HTML（同文件内导出模板字符串，无构建、无外链资源）

布局：顶栏（标题 = share.title ?? entry 文件名；快照 label/时间；完整/不完整徽章；过期时间提示；「匿名」姓名输入持久化 localStorage `zclaudia-share-name`）+ 主区 iframe + 右侧评论栏（列表 + 发表表单）。

行为（内联 vanilla JS）：

1. `fetch('manifest.json')` → 标题/徽章渲染；`iframe.src = 'f/' + entryPath.split('/').map(encodeURIComponent).join('/')`；`iframe` 属性 `sandbox="allow-same-origin"`（**无 allow-scripts**——作品脚本永不执行；同源保留使父页可访问 `contentDocument` 做选区）。
2. iframe `load` 后：访问 `iframe.contentDocument`，注册捕获阶段 click 监听：`preventDefault` + `stopPropagation`（拦截一切链接导航，toast「分享为静态快照，链接跳转已停用：<解析后的 href>」）；若点击目标是元素（非文本节点），计算 `elementPath`（自 body 起、按元素子节点序号回溯）、`tagName`（小写）、`text`（textContent 折叠空白截 200），高亮该元素（outline 样式），发表表单显示「定位：<tagName> <text 前 40 字>」，并提供「清除定位（评论整页）」按钮。
3. 评论列表：`GET comments` 渲染（作者/时间/body/定位 chip/已解决徽章）；点击定位 chip → 在 iframe 内按 `elementPath` 重走并高亮，走不到（理论不该发生，防御）标记「定位已失效」。
4. 发表：POST → 成功清空 body、刷新列表；错误（含 410/403/400）在表单区显示服务端 message。
5. 无 JS 框架、无外部请求（除上述五类 API）；深浅色不做，浅色素净即可；总行数目标 ≤450。

## 5. 所有者路由（`interfaces/http/design.ts`，S4）

`createDesignRoutes` 内构造 `ShareService`（与既有服务同款一行式）并追加端点（全部走既有 `handleError` 信封）：

| 方法+路径 | 请求 → 响应 |
|---|---|
| `POST /api/design/shares` | `{ sessionId, snapshotId, scope?, expiresInDays?, title? }` → 201 `{ share: DesignShareSummary; shareUrl: string; lanUrls: string[] }`（`shareUrl = ${req.protocol}://${req.get('host')}/s/${token}`；`lanUrls`：绑定非回环时枚举非 internal IPv4 → `http://<ip>:<port>/s/${token}`，port 取 `process.env.PORT ?? 3100`，尽力而为） |
| `GET /api/design/shares?sessionId&entryPath?` | → `{ shares: DesignShareSummary[] }`（created_at DESC；entryPath 过滤经 snapshot join） |
| `POST /api/design/shares/:id/revoke` | body `{ sessionId }` → `{ share }` |
| `GET /api/design/shares/:id/comments?sessionId` | → `{ comments: DesignShareComment[] }` |
| `POST /api/design/shares/:id/comments/:commentId/resolve` | body `{ sessionId, resolved }` → `{ comment }` |

## 6. 桌面契约（T0 预落 `api.ts` 分享分节；S5 定位与交接模块）

```ts
// api.ts（T0）：类型镜像 §2.1 + 五个所有者函数
export type DesignShareScope = 'link' | 'local';
export interface DesignShareSummary { /* §2.1 */ }
export interface DesignShareComment { /* §2.1 */ }
export function createDesignShare(backendId: string, input: {
  sessionId: string; snapshotId: string; scope?: DesignShareScope;
  expiresInDays?: number | null; title?: string | null;
}): Promise<{ share: DesignShareSummary; shareUrl: string; lanUrls: string[] }>;
export function listDesignShares(backendId: string, sessionId: string, entryPath?: string): Promise<{ shares: DesignShareSummary[] }>;
export function revokeDesignShare(backendId: string, input: { sessionId: string; shareId: string }): Promise<{ share: DesignShareSummary }>;
export function listDesignShareComments(backendId: string, input: { sessionId: string; shareId: string }): Promise<{ comments: DesignShareComment[] }>;
export function setDesignShareCommentResolved(backendId: string, input: { sessionId: string; shareId: string; commentId: string; resolved: boolean }): Promise<{ comment: DesignShareComment }>;
```

### 6.1 `comment-locator.ts`（S5 新文件，纯函数）

```ts
export interface CommentLocatorMatch {
  matched: boolean;
  reason?: 'path-missing' | 'tag-mismatch' | 'text-mismatch';
  text?: string;      // 命中元素的折叠文本（≤200）
  snippet?: string;   // 命中元素的源码切片（parse5 sourceCodeLocation，≤1200 字符）
}
export function matchCommentTarget(source: string, target: DesignShareComment['target']): CommentLocatorMatch;
```

parse5（既有依赖，`{ sourceCodeLocationInfo: true, treeAdapter }` 与 element-tree.ts 同款用法）：从 body 按 `elementPath` 逐级取元素子节点；越界 → `path-missing`；tagName 严格比对（小写）不符 → `tag-mismatch`；文本折叠空白后前 200 字符与 `target.text` 不等 → `text-mismatch`。命中则给 text + snippet（起止 offset 切源码，截 1200）。**target 为 null → `{ matched: true }`（整页评论无定位失效概念）**。只做严格匹配，不做模糊/邻近重挂（P7.2 红线）。

### 6.2 `review-handoff.ts`（S5 新文件，纯函数）

```ts
export interface ReviewHandoffInput {
  comment: DesignShareComment; share: DesignShareSummary;
  snapshot: { label: string | null; createdAt: number; entryPath: string };
  snapshotSource: string | null;   // 快照入口 HTML（getDesignSnapshotFile base64 解码；拿不到为 null）
  currentSource: string | null;    // 当前磁盘入口 HTML
  currentDocPath: string | null;
}
export function buildReviewHandoff(input: ReviewHandoffInput): { sections: Array<{ title: string; body: string }>; prompt: string };
```

sections（agent-context.ts 风格，空则省略、prompt = `## title` 块拼接）：

1. **审阅反馈**：作者、时间（本地格式）、评论原文（≤4000）。
2. **分享版本**：快照 label/时间/entryPath + 「旧分享仍显示此版本，不会因本次修改变化」。
3. **快照中的目标元素**：`matchCommentTarget(snapshotSource, target)` 命中 → snippet；target 为 null → 「整页评论」。
4. **当前版本定位**：`matchCommentTarget(currentSource, target)` 命中 → `currentDocPath` + snippet；失效 → 原因文案（「元素定位已失效（原因），请依据评论描述与分享版本对比自行定位，修改前在回复中说明你定位到的元素」）。**失效时也允许交接**（评论本身往往足以描述意图），但明确要求 Agent 自证定位，不静默假定。
5. **任务指令**：「请根据以上审阅反馈修改当前页面 <currentDocPath>。保持与反馈无关的内容不变。」

## 7. 桌面 UI（S6 `SharePanel.tsx` + S7 接线）

### 7.1 `components/SharePanel.tsx`（Modal，props 全上抛）

```ts
export interface SharePanelProps {
  open: boolean; onClose: () => void;
  backendId: string; sessionId: string | null; docPath: string | null;
  currentSource: string | null;                 // 失效判定与交接用
  onHandoff: (prompt: string) => void;          // DesignPanel prefill + 关面板 + 提示
}
```

- **Tab 1「分享链接」**：创建表单（版本下拉 = `listDesignSnapshots` 前 20 条倒序，缺省最新；范围 select `link`/`local`；有效期 select 永久/1/7/30 天；标题 input；「创建分享」）+ 分享列表（状态 chip 进行中/已撤销/已过期——按 revokedAt/expiresAt 客户端计算；shareUrl 展示 + 复制按钮（clipboard API，失败退回选中提示）；lanUrls 折叠展示；commentCount/lastAccessAt；「撤销」二次确认；「打开」`<a href={shareUrl} target="_blank" rel="noreferrer">`）。
- **Tab 2「审阅评论」**：分享下拉（未撤销的）→ 评论列表（作者/时间/定位 chip（tagName + text 摘要）/失效徽章 = `matchCommentTarget(currentSource, …)` 不 matched 时显示原因/已解决徽章 + 切换开关）+ 每条「交给 Agent 修改」→ `buildReviewHandoff`（snapshotSource 经 `getDesignSnapshotFile` 取入口文件）→ `onHandoff(prompt)`。刷新按钮手动刷新，不做轮询。

### 7.2 接线（S7）

DesignToolbar ⑥ 导出区加「分享」按钮（`disabled={!docPath || loading}`，图标 Share2）；DesignPanel `shareOpen` state + 条件挂载 SharePanel（`currentSource` 传 `doc?.source ?? null`；`onHandoff` → `prefill(prompt)` + `setShareOpen(false)`）；切页关闭 effect（:273-279）追加 `setShareOpen(false)`。Agent 写入后的新恢复点由 `useAgentRunFeedback` 自动落快照（P4.5 既有），S7 仅文档声明。

## 8. 测试与任务卡

### 8.1 命令（各卡钉死，绝对路径）

```sh
# desktop（S5/S6/S7）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec eslint src/features/design
# server（S1–S4）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/application/design/__tests__ src/interfaces/http/__tests__/design.test.ts src/interfaces/http/__tests__/share-viewer.test.ts
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
```

基线：server design 224 通过 + 1 skipped；desktop design 682 通过；双端 tsc 0 错；desktop eslint 0 error / 34 warning 基线。测试风格对齐既有：server 真临时目录 + `:memory:` SQLite + 真实 migration sql + supertest；desktop jsdom + `vi.mock('../api')` 全量桩。

### 8.2 T0（主代理，派发前）

本设计文档 + `migrations/052_design_shares.ts`（+ index.ts 注册）+ `application/design/share-types.ts`（§2.1 契约 + 常量 + `isDesignShareScope` 纯定义）+ 桌面 `api.ts` 分享分节（§6）。除此之外无共享契约文件改动。

### 8.3 任务卡（串行派发，一次一卡）

- **S1 分享服务**。新文件 `application/design/share-service.ts` + `__tests__/share-service.test.ts`（真临时工作区 + 真快照 + :memory: db）。实现 §2.2 全部。测试：create 校验矩阵（scope/天数/title/snapshot 跨工作区）、token 唯一、revoke 幂等冲突 409、resolveByToken 四态（正常/未知 404/撤销 404/过期 410）、publicFile 清单外 404 与路径穿越拒绝、addComment 校验与上限、resolve 归属校验。**禁改：share-types.ts、snapshot-service.ts、路由、桌面端。**
- **S2 分享视图路由**。新文件 `interfaces/http/share-viewer.ts` + `__tests__/share-viewer.test.ts`（supertest 直挂 router，真快照内容断言）+ `domain-bootstrap.ts` 追加挂载一行。实现 §4 全部（含视图 HTML）。测试：视图 HTML 200 与 no-store、manifest 形状与 lastAccess 更新、清单内文件 200 + CSP/nosniff 头 + 正确 mime、清单外/穿越 404、撤销后 404、过期 410、scope local 由注入 remoteAddress 模拟非本机 403（router 层读 `req.socket.remoteAddress`，测试可用连接伪造或把判定函数注入路由工厂）、评论 GET/POST 与 400。**禁改：share-service 内部（可微调导出签名并记录）、share-types.ts、design.ts。**
- **S3 快照 pin**。修改 `snapshot-service.ts` pruneOldest + `__tests__/snapshot-service.test.ts` 追加。实现 §3。测试：pin 快照在超限裁剪中存活、撤销后可被裁剪、blob 不被清扫（sweepUnreferenced 后仍可读）。**禁改：其他文件。**
- **S4 所有者路由**。修改 `interfaces/http/design.ts` + `__tests__/design.test.ts` 追加 describe。实现 §5 全部（真装配 + shareUrl/lanUrls）。测试：五端点形状、404/409/400 映射、lanUrls 在 SERVER_HOST 环境下的尽力而为行为（注入或 env 桩）。**禁改：application/design 各服务内部（签名微调须记录）。**
- **S5 定位与交接模块**。新文件 `comment-locator.ts`、`review-handoff.ts` + 各自 `__tests__`。实现 §6.1/§6.2。测试：命中/三种失效/整页 null/深度路径/文本折叠；handoff sections 五块与失效文案、空 section 省略、长度上限。**禁改：api.ts、组件、服务端。**
- **S6 分享面板**。新文件 `components/SharePanel.tsx` + `__tests__/SharePanel.test.tsx`（api mock）。实现 §7.1。测试：两 tab 渲染、创建流程（表单→api→列表刷新）、状态 chip 计算、复制按钮、撤销确认、评论列表 + 失效徽章 + 解决切换、交接按钮调用 onHandoff 并传 buildReviewHandoff 产物。**禁改：api.ts、DesignPanel、DesignToolbar、服务端。**
- **S7 接线与文档**。修改 `DesignPanel.tsx`、`components/DesignToolbar.tsx`、`DesignPanel.test.tsx`（api mock 增补分享端点 + 接线用例：打开/创建/交接 prefill/切页关闭）、`docs/design-workbench.md`（P7 小节）、上游计划 P7 勾选与基线段。实现 §7.2。**禁改：S1–S6 已验收文件行为（props 对接可微调并记录）。**

### 8.4 主代理终验收

全部门禁复跑（双端 vitest + tsc、desktop eslint、lifecycle/radius、git status 范围核对）；关键路径代码审查（公开路由暴露面、token 语义、CSP/sandbox 头、pin 正确性、凭据不外泄、迁移幂等）；本机浏览器真实冒烟（控制浏览器打开 `/s/<token>`：浏览、选元素、发评论、桌面侧读取并交接）；更新本档验收记录。

## 9. P7.4 多人同时编辑评估（仅结论，无代码）

前提：ZClaudia 的分享是「快照 + 评论」异步审阅，不是实时协作；评论同步 ≠ 共同编辑（计划原文红线）。选项与判据：

| 方案 | 适用 | 代价 |
|---|---|---|
| 文档锁（检出/检入） | 单人轮流改，冲突零容忍 | 最低；体验割裂 |
| 操作日志同步（op-based） | 站点可控、在线为主 | 中；需因果排序与补丁管道 |
| CRDT（如 Yjs）/ OT | 真并发、离线容忍 | 高；HTML 文本级合并与设计语义冲突难解 |

**结论：维持现状（单人编辑 + 快照审阅闭环），不引入任何方案。** 触发重评条件：出现真实的「两人同时改同一作品」需求且评论流程已不够用。届时优先在「精确源码编辑引擎（P1.2）」的事务/op 抽象上做操作同步试点，而不是引入第二套 CRDT 文档模型与现有快照/恢复体系并行。

## 10. 验收对照（上游计划 P7 验收条目）

| 计划验收项 | 覆盖证据 |
|---|---|
| P7.1 分享指定版本及资源包；访问范围、撤销、过期；排除本机路径/凭据/无关文件 | §1–§5：快照引用 + scope link/local + revoke + expiresAt；清单仅含入口资源闭包的相对路径；凭据不在设计文件域（llm_profiles 不进快照） |
| P7.2 评论绑定快照与元素定位；新版本找不到元素显示失效，不静默挂到其他元素 | §1 target_json 绑定 share→snapshot；§6.1 严格匹配三态失效；§7.1 失效徽章 |
| P7.3 选评论组合原版本/当前版本/反馈进聊天；Agent 写入成新恢复点；旧分享仍显示原版本 | §6.2 handoff 五段（含失效自证要求）；P4.5 useAgentRunFeedback 自动快照；快照不可变 + §3 pin |
| 第二个独立客户端只能访问授权快照 | §0.2 公开面仅视图/清单/清单内文件/评论；无列举；token 256 位；CSP/sandbox 封脚本 |
| 访问撤销生效 | revoke → 公开端点 404（S1/S2 测试） |
| 评论能回到正确版本与选区 | 视图内重走 elementPath 高亮；桌面侧失效判定 + 快照片段（S5/S6 测试） |
| 按反馈生成新版本后，旧版仍可审阅和恢复 | 快照不可变；既有 RestoreService 恢复链路不变 |
| P7.4 评估不实现 | §9 |

## 11. 架构约束对照

- 项目文件是作品来源：分享引用快照，不建第二作品库 ✓（§0.1）。
- 工作区身份与聊天身份分离：share 按 workspace_root 归属，sessionId 只做授权 ✓。
- 所有文件访问由宿主处理：公开端点只读内容寻址 blob，路径以清单为白名单，无任意文件 API ✓。
- 按能力拆模块：share-types/share-service/share-viewer/comment-locator/review-handoff/SharePanel 各自独立文件 ✓。
- 复用现有宿主能力：挂载与错误信封沿用 Express 既有模式；无 daemon/第二运行时 ✓。
- 编辑能力显式声明：分享视图「静态、脚本不执行、链接跳转停用」在视图与文档明示 ✓。

## 12. 验收记录

### S1–S7（2026-10-24，主代理逐卡验收通过）

七卡串行完成（每卡 luna 实现、主代理代码审查 + 门禁复跑后放行下一卡）：

- **S1 分享服务**：`share-service.ts`（528 行）+ 24 用例。接受偏差：publicFile 路径形状错误沿用 validateManifestPath 原始码（形状非法 400 VALIDATION_ERROR、越界 403 PATH_FORBIDDEN、清单外 404）；setResolved 非布尔 → 400 SHARE_VALIDATION；已撤销分享的快照行被裁剪时 entryPath 以 '' 呈现（LEFT JOIN COALESCE，S3 pin 只保未撤销）。
- **S2 分享视图路由**：`share-viewer.ts`（448 行，视图 HTML ~311 行静态模板，token 从 location.pathname 解析不进模板）+ 10 用例 + domain-bootstrap 一行挂载。接受偏差：Express 对 text/* 自动追加 charset；`..` 归一化发生在 HTTP 客户端侧，穿越测试改用 raw `node:http` 原始请求目标断言 403；`%` 双重解码边缘归 404 不 500。
- **S3 快照 pin**：pruneOldest 两处 SQL 加 NOT EXISTS 排除 + 3 用例（pin 存活 / 撤销后可裁剪 / blob 清扫后仍可读）。**主代理修正**：`design.test.ts` 快照路由 describe fixture 只应用 050，pruneOldest 引用 design_shares 后 6 用例失败——补 `db.exec(migration052.sql)` 一行（fixture 增补，非断言改动）。
- **S4 所有者路由**：design.ts 五端点 + lanShareUrls 帮助函数 + 6 用例；`{ success, data }` 信封与桌面 apiCallForBackend 解包一致；`req.get('host')` 直接用请求 Host 头（§5 字面）。
- **S5 定位与交接**：comment-locator.ts（96 行）+ review-handoff.ts（124 行）+ 26 用例（含 1 快照）。elementPath 采用元素子节点序号（与 DesignSelection 注释、element-tree/parse findElement、视图侧 DOM `children`（仅元素）三方一致）；tagName 比对对 target 兜底 toLowerCase；隐式节点命中但 snippet undefined。
- **S6 分享面板**：SharePanel.tsx（761 行）+ 9 用例。列表行 shareUrl 由 token + getBaseUrlForBackend 推导（GET list 不回传绝对地址，仅创建响应回填）；eslint 新增 3 条 `set-state-in-effect` warning（打开清空重载/切 tab 重载/关闭复位，与 MediaGenPanel 6 条同类既有模式一致，逐条记录）。
- **S7 接线与文档**：Toolbar ⑥ 区「分享」按钮（Share2，disabled={!docPath||loading}）、DesignPanel shareOpen + prefill 交接 + 切页关闭、3 用例、design-workbench.md P7 小节、主计划 P7.1–P7.3 勾选与基线段。plans 文档 prettier 报 4 处差异经 stash 核对均为既有表格状态，未越权格式化。

### 终验收（2026-10-24，主代理）

- **测试（终态）**：server design 267 通过 + 1 skipped（14 文件：224 基线 + S1 24 + S2 10 + S3 3 + S4 6，另 video-smoke.manual 1 skipped 为既有）；desktop design 720 通过（42 文件：682 基线 + S5 26 + S6 9 + S7 3）；双端 `tsc --noEmit` 0 错；desktop eslint 0 error / 37 warning（= 34 基线 + S6 3，已记录）；lifecycle/radius OK；git status 范围核对无越权文件。
- **代码审查**：公开暴露面仅五端点（视图/清单/文件/评论读写），无列举、无 workspaceRoot/sessionId 外发；token 256 位 base64url、撤销与未知统一 404；文件端点 CSP `default-src 'none'` + nosniff + no-store；iframe `sandbox="allow-same-origin"` 无 allow-scripts；pruneOldest pin 语义与 blob 清扫安全性；migration 052 幂等。
- **真实浏览器冒烟（本机 Chrome 内嵌浏览器，通过）**：隔离数据目录启动真实服务（PORT=3917，ZCLAUDIA_DATA_DIR=/tmp/zclaudia-p7-smoke）→ sqlite 种子 project/session → 真实 API 建快照（index.html + style.css，complete）→ 建分享（link，7 天）→ 浏览器打开 `/s/<token>`：标题/快照信息/完整徽章/过期提示渲染正确，iframe 内快照页面 CSS 生效；点击「核心特性」h2 → 表单出现「定位：h2 核心特性」；填姓名「张三」+ 评论提交 → 列表实时出现（作者/时间/正文/定位 chip）；所有者 API 取回评论 target = `{elementPath:[1,0,0], tagName:'h2', text:'核心特性'}`（路径正确），commentCount/lastAccessAt 更新；revoke → 视图与清单均 404 SHARE_NOT_FOUND，未知 token 404。冒烟环境已清理（服务停止、临时目录删除）。
- **已知实现注记**：浏览器自动化对 sandbox iframe 的 frame-locator 点击在该环境超时（Playwright 进帧限制，非产品缺陷）——冒烟经同源 contentDocument 派发真实 MouseEvent 与 form.requestSubmit() 走视图自身处理器完成，行为路径等价。

### 待补验证（手工门槛）

1. **真实第二客户端冒烟（用户）**：LAN 场景（`SERVER_HOST=0.0.0.0` 或 `ZCLAUDIA_ALLOW_LAN=1`）另一设备打开分享链接、浏览、发评论；本机第二浏览器场景已由上述冒烟覆盖。
2. **macOS Tauri 内嵌服务端同流程（用户）**：桌面构建内创建分享 → 系统浏览器访问。
3. **审阅→Agent 修改→新恢复点全链路（用户）**：真实 Agent 会话中点「交给 Agent 修改」发送、确认 useAgentRunFeedback 自动快照落点与旧分享不变。
