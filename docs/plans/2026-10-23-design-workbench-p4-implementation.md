# P4 模板与品牌体系 — 实现设计

日期：2026-10-23。状态：设计定稿，T0 契约由主代理预落，L15–L19 由 flash 子代理（luna）分波实现、主代理逐波验收。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P4 章节；基线见 [P1](2026-10-23-design-workbench-p1-implementation.md)、[P2](2026-10-23-design-workbench-p2-implementation.md)、[P3](2026-10-23-design-workbench-p3-implementation.md)。

本批覆盖 **P4.1 模板清单 / P4.2 品牌与设计系统 / P4.3 素材库 / P4.4 Agent 设计上下文 / P4.5 生成与续改反馈**。

明确排除（第一版边界）：

- **不搬运 Open Design 仓库的模板与设计系统内容**（其 `design-templates/`、`design-systems/` 为 Apache-2.0 但含大量第三方品牌素材与多语言副本，逐项归属成本高）。ZClaudia 内置模板为自研静态脚手架，来源记录 `zclaudia-builtin`；Open Design 的 `DESIGN.md + tokens` 文件形态作为格式参考。
- **不建全局（跨工作区）素材库或品牌目录**。品牌文件、素材全部落为工作区项目文件（架构约束 1：项目文件是作品来源）；「全局资产 vs 项目副本」第一版的关系 = 没有全局副本，导入即复制进工作区，DESIGN.md 只引用相对路径。
- **选区截图不进 Agent 上下文**（上游措辞为「可用的选区截图」）：预览为不含 `allow-same-origin` 的 sandbox iframe，截图需要额外 capture 管线；第一版上下文携带选区源码片段替代，边界在检视 UI 中明示。
- **品牌文件不做结构化回读**。表单只用于「首次生成」DESIGN.md/tokens.css；生成后以纯文本编辑（修订校验保存）。反向解析任意人写的 DESIGN.md 不可靠，不做。
- 真实 Agent + macOS Tauri 冒烟（M2 门槛）沿用 P3 待办口径，由用户配合补做；本批以自动化测试为准。

## 0. 已定决策（主代理勘察，2026-10-23）

1. **模板是复制进工作区的静态文件，不是 Agent 提示形状。** 与 Open Design 的 SKILL.md 形态不同，ZClaudia 工作台的模板 = 用户可直接打开编辑的静态 HTML/CSS 起点（4 个：落地页/仪表盘/移动原型/静态展示页），安装到 `design/<id>/` 独立目录，互不覆盖、不动 `design/index.html`。安装写入 `TEMPLATE.json` 标记（templateId/version/installedAt/entry）供未来更新流程识别；更新模板永不自动覆盖用户作品（重复安装默认 409，`overwrite` 显式确认后才替换，且替换走「读当前哈希 → 修订校验写入」的既有安全路径）。
2. **模板自包含，不引用 tokens.css。** 模板自带 `:root` 调色板（内联 SVG/CSS 渐变，无二进制资源、无外链、无脚本）。「品牌 + 模板」的组合方式 = 装好品牌与模板后经 Agent 上下文续改套用品牌（P4.4），而不是模板硬链接品牌文件——避免品牌未安装时导出/快照出现 missing 依赖。
3. **品牌 = `design/DESIGN.md` + `design/tokens.css` 两个可读项目文件**，新增成对读写端点（GET/PUT `/api/design/brand`），修订语义与 `writeDocument` 完全一致（SHA-256 校验 / 空修订 + createIfMissing 创建）。单文件 ≤256 KiB。两文件一次 PUT 分两次安全写入，不声称跨文件原子（与文档保存同口径）。
4. **素材库 = `design/assets/` 目录 + 导入端点 + kinds 扩展。** `POST /api/design/assets/import`（JSON base64，≤10 MiB 解码后，扩展名白名单 = 图片 ∪ 字体）写入工作区，重名自动 `-2`/`-3` 后缀去重并返回最终路径（不覆盖、不丢数据）。`GET /api/design/assets` 增加 `kinds=image|font|all`（默认 image，P3 调用方零改动）。被引用提示在客户端做：匹配活动页 deps 清单与打开页草稿源码中的相对路径。
5. **Agent 上下文 = 纯函数构建 + 发送前检视模态。** `agent-context.ts` 把「工作区信息 / 页面与修订 / 选区定位与源码片段 / 品牌规则全文 / 素材引用 / 视口」组装为 sections 与最终 prompt（英文 prompt，与既有 generate/handoff 一致）；`generate`/`handoff` 改为先开检视模态（sections + prompt 全文可见），确认后才 `prefill`。所有数据经 backendId 限定 API 获取，无跨 backend 通路。
6. **P4.5 的成功信号来自磁盘对比，不来自消息文本。** 监视 `runStore.getSessionRunId(sessionId)` 由非空转空（run 结束，含失败/取消路径）→ 自取磁盘状态（文件清单 + 打开页修订）与面板已知状态对比：有变化 → 横幅列出新增/变更文件（可点开）+ 对变更的打开页打 `Agent` 标签恢复点快照；无变化 → 横幅明确「未检测到设计文件变化」（若末条 assistant 消息含 `**Error:**` 标记则附运行出错提示）。不解析消息内容判断成功。
7. **无新依赖、无锁文件变更；`types.ts` 与 `controller.ts` 不动。** P4 桌面类型全部进 `api.ts`（T0 预落）与新纯逻辑模块；服务端新增三个 application 文件 + 既有 `design-service.ts`/`design.ts` 路由扩展。express JSON 上限 15 MiB 足够 10 MiB base64（≈13.4 MiB 载荷）。

## 1. 共享契约（T0 主代理预落，子代理不得改动）

### 1.1 `api.ts` 追加（T0 落库）

```ts
// ---- P4 模板与品牌体系 ----

export interface DesignTemplateSummary {
  id: string;
  name: string;          // 中文名
  description: string;   // 中文一句话
  entry: string;         // 工作区相对入口路径，如 'design/landing/index.html'
  files: string[];       // 模板将写入的全部文件（不含 TEMPLATE.json）
  version: string;       // '1.0.0'
  source: string;        // 'zclaudia-builtin'
}

export function listDesignTemplates(backendId: string): Promise<{ templates: DesignTemplateSummary[] }>;
// GET /api/design/templates —— 静态目录，无 sessionId

export function installDesignTemplate(
  backendId: string,
  input: { sessionId: string; templateId: string; overwrite?: boolean }
): Promise<{ installed: string[]; entry: string }>;
// POST /api/design/templates/install —— 409 TEMPLATE_TARGET_EXISTS 时错误对象带 files（复用 DesignHttpError 形态）

export interface DesignBrand {
  designMd: string | null;        // 文件不存在为 null
  tokensCss: string | null;
  designMdRevision: string | null;
  tokensCssRevision: string | null;
}

export function getDesignBrand(backendId: string, sessionId: string): Promise<DesignBrand>;
// GET /api/design/brand?sessionId=

export function putDesignBrand(
  backendId: string,
  input: {
    sessionId: string;
    designMd?: string;
    designMdRevision?: string;    // SHA-256；文件不存在时传 '' 创建
    tokensCss?: string;
    tokensCssRevision?: string;
  }
): Promise<{ designMdRevision: string | null; tokensCssRevision: string | null }>;
// PUT /api/design/brand —— 只提交出现的键；修订规则同 putDesignDocument

// listDesignAssets 签名扩展（向后兼容，默认 image）：
export function listDesignAssets(
  backendId: string,
  sessionId: string,
  kinds?: 'image' | 'font' | 'all'
): Promise<DesignFileList>;
// GET /api/design/assets?sessionId=&kinds=  —— kinds 省略时 URL 不带该参数（P3 断言不变）

export function importDesignAsset(
  backendId: string,
  input: { sessionId: string; fileName: string; dataBase64: string; targetDir?: string }
): Promise<{ path: string }>;
// POST /api/design/assets/import —— targetDir 默认 'design/assets'；重名自动去重，返回最终路径
```

`installDesignTemplate` 的 409 载荷 `{ error: { code, message, files: string[] } }` 沿用 `DesignHttpError` 的直连 fetch 提升方式（同 `exportDesignZip` 的错误处理形态）。

### 1.2 HTTP 契约

```
GET  /api/design/templates                          → { templates: DesignTemplateSummary[] }
POST /api/design/templates/install                  → { installed: string[], entry: string }
     body { sessionId, templateId, overwrite? }
     404 TEMPLATE_NOT_FOUND；409 TEMPLATE_TARGET_EXISTS（details.files = 冲突路径列表）
GET  /api/design/brand?sessionId=                   → DesignBrand
PUT  /api/design/brand                              → { designMdRevision?, tokensCssRevision? }
     409 REVISION_CONFLICT / 413 FILE_TOO_LARGE / 400 VALIDATION_ERROR
GET  /api/design/assets?sessionId=&kinds=image|font|all → { files }（默认 image，向后兼容）
POST /api/design/assets/import                      → { path }
     400 ASSET_INVALID（文件名/扩展名/大小/base64 非法）
```

新增 `DesignError` 码：`TEMPLATE_NOT_FOUND`(404)、`TEMPLATE_TARGET_EXISTS`(409, details.files)、`ASSET_INVALID`(400)。其余复用既有（`REVISION_CONFLICT`、`FILE_TOO_LARGE`、`VALIDATION_ERROR`、`SESSION_NOT_FOUND`、`WORKSPACE_UNAVAILABLE`、`PATH_FORBIDDEN`…）。

## 2. P4.1 模板清单（服务端 + TemplateDialog）

### 2.1 目录与内容（L15，新文件 `server/src/application/design/template-catalog.ts`）

4 个自研模板，全部纯静态：

| id | 名称 | 安装目录 | 文件 |
|---|---|---|---|
| `landing` | 落地页 | `design/landing/` | `index.html` + `styles.css` |
| `dashboard` | 仪表盘 | `design/dashboard/` | `index.html` + `styles.css` |
| `mobile` | 移动原型 | `design/mobile/` | `index.html` + `styles.css` |
| `showcase` | 静态展示页 | `design/showcase/` | `index.html` + `styles.css` |

每个模板内容硬性要求（服务端测试逐条锁死，见 §2.3）：

- `<!doctype html>`、`<html lang="zh-CN">`、meta viewport、`<link rel="stylesheet" href="styles.css">`；
- 全部资源自包含：无 `<script>`、无 `on*=` 内联事件、无 `http(s)://` 或协议相对 `//` 引用（src/href 只允许相对路径与 `#` 锚点）；图片只用内联 SVG 与 CSS 渐变；
- `styles.css` 自带 `:root` 调色板与基础排版，含至少一个媒体查询；每个文件 ≤12 KiB；
- 中文示例文案、语义化分区（header/main/section/footer 级结构，落地页含 hero/特性/CTA，仪表盘含侧栏/卡片网格，移动原型为 390px 单列布局，展示页含图文网格）。

目录元数据：`id/name/description(中文)/entry/files/version('1.0.0')/source('zclaudia-builtin')`。

### 2.2 安装服务（L15，新文件 `template-service.ts`）

`TemplateService.install(sessionId, templateId, overwrite)`：

1. 目录查 `TEMPLATE_NOT_FOUND`；`sessionId` 经 `DesignService.workspace()` 解析（复用既有工作区身份与 realpath 校验）。
2. 目标文件集 = 模板 files + `design/<id>/TEMPLATE.json`（内容 `{ templateId, version, installedAt: ISO, entry }`，安装时生成）。
3. 逐个 stat 目标：存在且 `!overwrite` → 收集冲突 → `DesignError(409, 'TEMPLATE_TARGET_EXISTS', details: { files })`。
4. 写入：不存在 → `safeWriteFile(bytes, { expectedRevision: '', createIfMissing: true, maxBytes })`；存在且 overwrite → 先读当前内容哈希作为 `expectedRevision` 再写（并发修改自然 409 `REVISION_CONFLICT`）。目录不存在时先 `fs.mkdir(dirname, { recursive: true })`（路径已由 validateRelativePath/resolve 骨架校验为工作区内非点目录）。
5. 返回 `{ installed: 写入路径列表（含 TEMPLATE.json，工作区相对 / 分隔）, entry }`。单文件 ≤64 KiB 上限（`FILE_TOO_LARGE`）。

`list()` 直接返回目录（无 IO）。

### 2.3 目录不变量测试（L15）

`template-service.test.ts` 含目录自检用例：遍历目录断言 §2.1 硬性要求（entry ∈ files、路径都在 `design/<id>/` 下、HTML 无 script/on*=、href/src 无 scheme 与 `//` 开头、含 styles.css link、文件大小上限、zh-CN）。**模板内容的验收以这些不变量 + 主代理人工审查 HTML 为准**，不追求像素级设计评审。

### 2.4 TemplateDialog（L17，新文件 `components/TemplateDialog.tsx`）

Modal（复用既有 Modal 组件，形态对齐 ExportDialog）：打开时 `listDesignTemplates`；每项显示 name/description/entry/files 数；「安装」按钮 → install → 成功提示已写入文件并 `onInstalled(entry)`（面板开页 + refreshNow）；409 冲突时列出冲突文件，二次确认（「覆盖这些文件」按钮带 overwrite 重试）后才再次调用；其余错误显示可重试。Props 全部上抛（`backendId`/`sessionId`/`open`/`onClose`/`onInstalled`），组件不自持工作区状态。

## 3. P4.2 品牌与设计系统（brand.ts + BrandService + BrandPanel）

### 3.1 文件形态（L16 渲染器输出，服务端只存字节）

`design/DESIGN.md`（人读 + Agent 上下文直接引用）：

```md
# 品牌与设计系统

> 由 ZClaudia 设计工作台生成。可直接编辑本文件与 tokens.css；Agent 修改页面时会读取两者。

## 色彩
| 用途 | Token | 值 |
|---|---|---|
| 主色 | --color-primary | #4f46e5 |
| 辅色 | --color-secondary | … |
| 背景 | --color-background | … |
| 文字 | --color-text | … |

## 字体
- 正文：…
- 标题：…

## 间距与圆角
- 间距基准：8px（--space-unit）
- 圆角：…

## Logo
- 引用：assets/logo.svg（相对 design/ 的路径，素材需已在素材库中）

## 使用规则
…（表单 notes）
```

`design/tokens.css`：

```css
/* ZClaudia design tokens — 与 DESIGN.md 对应，可手动编辑 */
:root {
  --color-primary: #4f46e5;
  --color-secondary: …;
  --color-background: …;
  --color-text: …;
  --font-body: …;
  --font-heading: …;
  --space-unit: 8px;
  --radius-md: 8px;   /* radius 档位：none=0 / sm=4px / md=8px / lg=16px */
}
```

### 3.2 纯逻辑（L16，新文件 `apps/desktop/src/features/design/brand.ts`）

```ts
export interface BrandSpec {
  primary: string; secondary: string; background: string; text: string; // CSS 颜色语法，trim 后非空 ≤40 字符
  fontBody: string; fontHeading: string;                                // ≤120，同 P3 font-family 校验口径（禁 ;{}<>\ url( var( expression(）
  spacingUnit: '4px' | '8px';
  radius: 'none' | 'sm' | 'md' | 'lg';
  logoPath: string;   // 空 或 工作区相对路径（≥1、≤500、禁 scheme/反斜杠/控制字符，与 safeAttrValue src 同口径的语法检查）
  notes: string;      // ≤2000
}
/** 返回违规字段中文错误列表；空数组 = 合法。 */
export function validateBrandSpec(spec: BrandSpec): string[];
export function renderDesignMd(spec: BrandSpec): string;
export function renderTokensCss(spec: BrandSpec): string;
export const RADIUS_VALUES: Record<BrandSpec['radius'], string>; // none/sm/md/lg → 0/4px/8px/16px
```

颜色校验（`validateBrandSpec` 内）：`/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/` 或 `rgb(a)?(...)`/`hsl(...)` 或 CSS 命名色 `^[a-zA-Z]{3,32}$`——宽进严出，服务端只限大小。渲染器对输入做最小转义（notes/logo 里反引号与 `|` 不需处理，markdown 表格只涉及固定字段；notes 作为普通段落输出）。

### 3.3 服务端（L15，新文件 `brand-service.ts`）

`BrandService`（构造注入 `DesignService`，复用 `workspace/resolve/safeWriteFile` 备份 keeper 形态——备份沿用 design-service 既有 `designBackupKeeper`？其为模块私有，BrandService 自建同款实例即可）：

- `read(sessionId)`：逐个尝试读 `design/DESIGN.md`、`design/tokens.css`（`readBounded` 256 KiB）；`FILE_NOT_FOUND` → 该文件 `null/null`；返回四字段。
- `write(sessionId, { designMd?, designMdRevision?, tokensCss?, tokensCssRevision? })`：出现的键逐个写。值必须 string 且 utf8 ≤256 KiB（`FILE_TOO_LARGE`）；修订规则同 `writeDocument`（SHA-256 或 `''`+createIfMissing）；`resolve` 用 `allowMissingLeaf: true`。两文件独立写入，第二个失败时第一个已落盘（响应 409/500，不回滚——与「不声称跨文件原子」一致，错误信息指明哪个文件失败）。

### 3.4 BrandPanel（L17，新文件 `components/BrandPanel.tsx`）

Modal 两个模式：

- **未创建**（`designMd === null && tokensCss === null`）：表单（色彩 4 项 color input + 自由文本、字体 2 项、间距基准 select、圆角 select、Logo 路径 Input + 「从素材库选择…」（内嵌简版图片/字体清单下拉，数据 `listDesignAssets(…, 'all')`，选中经 `relativeAssetRef('design', path)` 换算）、规则 textarea）。提交 = `validateBrandSpec` → `renderDesignMd`/`renderTokensCss` → `putDesignBrand(…, revision '')`。预检失败逐项中文提示。
- **已创建**：两个 textarea（DESIGN.md / tokens.css）+ 各自保存按钮；打开时填入 GET 返回内容，保存带当前修订（`REVISION_CONFLICT` 时提示「文件已在其他位置更新」并可重新加载）。不做表单回读。

任一文件单独存在（半套状态）也走文本编辑模式（表单仅两者都缺省时提供）。

## 4. P4.3 素材库（导入端点 + kinds + AssetLibrary）

### 4.1 服务端（L15）

`DesignService` 扩展：

- `listAssets(sessionId, kinds)`：`kinds` 缺省/`'image'` = 既有图片谓词（P3 兼容）；`'font'` = `/\.(woff2?|ttf|otf|eot)$/i`；`'all'` = 两者并集。HTTP 层透传 `req.query.kinds`（非法值 → 400 `VALIDATION_ERROR`）。
- `importAsset(sessionId, fileName, dataBase64, targetDir)`：
  1. `fileName`：非空 ≤200、`path.basename(fileName) === fileName`（禁目录分隔与 `..`）、无控制字符；扩展名 ∈ 图片 ∪ 字体白名单，否则 `ASSET_INVALID`（message 中文可读）。
  2. `dataBase64`：string，解码后 1 B–10 MiB（`ASSET_INVALID`），base64 解析失败 `ASSET_INVALID`。
  3. `targetDir` 缺省 `'design/assets'`；`validateRelativePath` 校验（禁点组件/绝对/越界）。
  4. 去重：目标 `targetDir/fileName` 存在 → 依次尝试 `stem-2.ext`、`stem-3.ext`…（≤100 次），全占用 → `ASSET_INVALID`（提示目录同名文件过多）；**已存在时永不覆盖**。
  5. `fs.mkdir(dir, { recursive: true })` + `safeWriteFile(bytes, { expectedRevision: '', createIfMissing: true, maxBytes: 10 MiB })`；返回 `{ path: 最终相对路径 }`。

### 4.2 AssetLibrary（L17，新文件 `components/AssetLibrary.tsx`）

Modal：「图片 / 字体」两个 tab（`listDesignAssets(…, 'image' | 'font')`）；

- 图片项：缩略图（`getDesignAsset` data URL，进入视口再加载或直接加载 ≤50 项；>50 显示前 50 + 截断提示）、文件名、被引用徽标。
- 字体项：文件名 + 大小（无字形预览，副标题注明「字体不支持预览」）。
- 「导入」按钮：`<input type="file">`（accept 按当前 tab：图片 `image/*,.svg,.ico,.avif` / 字体 `.woff,.woff2,.ttf,.otf`），`readFileAsBase64` → `importDesignAsset`；返回路径 ≠ 原名时提示「已重命名为 …」；成功后刷新清单并触发 `onImported(path)`。
- 被引用判定（props 传入 `openPages: { path; source }[]` 与 `referencedAssets: string[]`——面板用活动页 deps 传入）：素材工作区路径换算到各打开页目录的相对引用（`relativeAssetRef`）出现在任一打开页草稿源码中，或素材路径 ∈ `referencedAssets` → 徽标「已引用」。
- 图片项「替换选中图片」按钮：仅当 `selection?.tagName === 'img'` 时可用 → `onApply([{ kind: 'attribute', name: 'src', value: relativeAssetRef(dirname(activeDocPath), assetPath) }])`（props 上抛，面板接既有 handleApply）。

## 5. P4.4 Agent 设计上下文（agent-context.ts + 检视模态）

### 5.1 纯逻辑（L16，新文件 `agent-context.ts`）

```ts
export interface AgentContextSection { title: string; lines: string[] }

export interface AgentContextInput {
  workingDirectory?: string;
  projectId?: string;
  pages: { path: string; docRevision: string; dirty: boolean }[];        // ≤12，超出截断标记
  active: {
    path: string; docRevision: string; dirty: boolean;
    selection?: {
      tagName: string; elementPath: number[]; text: string; sourceText?: string;
    } | null;
  } | null;
  brand: { designMd: string | null; tokensCss: string | null } | null;   // null = 未创建（section 省略）
  assets: { referenced: { path: string; kind: string }[]; importedRecently: string[] };
  viewport: { preset: string; width: number | null };
}

export function buildDesignAgentContext(input: AgentContextInput): {
  sections: AgentContextSection[];
  prompt: string;
};
```

构建规则（每条都是断言点）：

- sections 顺序固定：`Workspace` / `Pages` / `Selection`（active 存在才有）/ `Brand rules (design/DESIGN.md)` / `Brand tokens (design/tokens.css)` / `Assets` / `Viewport`；空 section 整省。
- 截断上限：pages ≤12（超出末行 `… (+N more)`）；选区 snippet = `sourceText ?? text` ≤1000 字符（`…` 结尾标记）；designMd ≤6000、tokensCss ≤4000（各自末尾 `… (truncated)`）；referenced ≤20、importedRecently ≤10（同 pages 标记法）。
- Pages 行格式：`- design/a.html (disk rev <前 12 位>…, unsaved local draft)`；Selection 行含 `<tag>`、path 点分、文本 JSON 串、源码片段。
- prompt：英文，sections 渲染为 markdown 标题 + 行；结尾固定任务段：生成场景 = "Create or update … follow the brand rules above when present…"；续改场景 = "Modify the selected element in <path> … preserve the existing design and follow the brand rules…"。任务正文与既有 generate/handoff 措辞同源（工作区相对路径、本地资源、无 JS 渲染、保存到文件）。`buildDesignAgentContext(input, task)`：`task: 'generate' | 'modify'` 决定结尾段。
- prompt 为 sections 的确定性拼接（同输入必同输出——快照测试锁一篇完整样例）。

### 5.2 检视模态（L18，新文件 `components/AgentContextPreview.tsx`）

Props：`{ open, context: { sections, prompt }, task, onClose, onConfirm }`。渲染：sections 列表（title + 逐行 code 风格展示）+ prompt 全文 `<pre>`（max-h 滚动）+ 底部「填入聊天」/「取消」。顶部一句说明：「以下内容将随指令进入当前聊天，可在输入框继续补充。」

### 5.3 面板流程改造（L19，接线）

- `generate`/`handoff` 不再直接 `prefill`：先组装 `AgentContextInput`（品牌经面板缓存的 `getDesignBrand` 结果——面板挂载时拉一次、BrandPanel 保存成功后失效重拉；assets.referenced = 活动页 deps 的 image/font 项；importedRecently = 本面板会话内导入路径，≤10）→ `buildDesignAgentContext(input, task)` → 打开 AgentContextPreview → onConfirm → 既有 `prefill(prompt)`（保留追加语义与提示条）。
- 现有 generate/handoff 的英文模板文本被 §5.1 结尾段取代；dirty 页仍禁止 handoff（既有逻辑不变）。

## 6. P4.5 生成与续改反馈（useAgentRunFeedback + 横幅）

### 6.1 纯逻辑（L16，并入 `agent-run-watch.ts`）

```ts
export interface DesignWatchState {
  files: string[];                                       // 已知 HTML 文件清单
  openPages: { path: string; docRevision: string }[];    // 面板最后已知磁盘修订
}
export interface AgentRunDiff {
  addedFiles: string[];      // 磁盘新增 HTML
  changedPages: string[];    // 打开页磁盘修订 ≠ 面板已知
}
export function diffDesignWatchState(before: DesignWatchState, after: DesignWatchState): AgentRunDiff;
/** 中文状态文案；runErrored=true 时追加「运行报告了错误，详情见聊天。」 */
export function agentRunStatusText(diff: AgentRunDiff, runErrored: boolean): string;
```

文案口径：有变化 = `Agent 已写入 <N> 个文件`；无变化 = `Agent 运行结束，未检测到设计文件变化`。

### 6.2 Hook（L18，`agent-run-watch.ts` 内）

`useAgentRunFeedback({ sessionId, backendId, enabled, getWatchState, refreshNow, onSnapshotWanted })`：

- 订阅 `useRunStore`；记录上次 `getState().getSessionRunId(sessionId)`；观察到「非空 → 空」且 `enabled` → 取 `before = getWatchState()`（面板提供：files + controller 打开页修订）→ 防抖 500 ms → 自取 `after`（`listDesignFiles` + 逐打开页 `getDesignDocument` 失败静默跳过）→ `diffDesignWatchState` → `refreshNow()`（驱动面板常规接管）。
- `runErrored`：run 结束时读 `useChatMessageStore.getState().messages[sessionId]` 最后一条 assistant 消息，`content` 含 `**Error:**` → true（best-effort，消息缺失/无标记 = false）。
- 恢复点：对 `changedPages` 逐页 `createDesignSnapshot(backendId, { sessionId, path, label: 'Agent ' + 'MM-dd HH:mm', source: 'manual' })`（fire-and-forget，失败在状态文案后追加「（恢复点创建失败）」——用完成回调标记）。
- 返回 `{ status: { text, diff } | null, dismiss }`；面板卸载/会话切换清理计时器。
- **不改 `useDesignWorkspace`/runStore/chatMessageStore**（只读订阅）。

### 6.3 横幅（L19，DesignPanel 内渲染）

`status` 非空时在预览区上方渲染 `role="status"` 条：文案 + `addedFiles/changedPages` 去重后以可点 chip 呈现（点击 `controller.open(path)`）+ 右侧 × 关闭。与既有 externalChange/dirty 提示条并列，不互相清除。

## 7. 验收对照（上游计划 P4 验收条目）

| 计划验收项 | 覆盖证据 |
|---|---|
| 模板记录入口/能力/资源/来源/版本；复制后独立编辑；更新不覆盖作品 | L15 目录元数据 + TEMPLATE.json 标记 + 409/overwrite 语义测试；安装文件经 P1–P3 编辑链路全量可编辑 |
| 品牌落为可读项目文件（DESIGN.md + tokens.css） | L16 渲染器快照测试；L15 读写端点与修订冲突测试；L17 表单生成 + 文本编辑 |
| 素材导入/预览/重名/被引用提示；共用资源引用契约 | L15 导入白名单/上限/自动去重测试；L17 缩略图、重命名提示、已引用徽标、替换选中图片（走 P3 attribute 契约） |
| 上下文组合（文件+修订/选区/源码/品牌/素材）且发送前可见；不跨 backend | L16 构建器截断/顺序/确定性测试；L18 检视模态；L19 全部数据经 backendId API 的接线 |
| Agent 写入后更新文档与恢复点、记录来源；无写入/失败/取消明确显示 | L16 diff/文案测试；L18 run 结束监视 + 快照；L19 横幅；成功信号来自磁盘对比 |
| 自动测试覆盖上下文结构 | agent-context 快照 + 截断用例 |
| 真实 Agent 冒烟 | 待用户配合（M2 门槛，沿用 P3 待办口径）；本批自动化 + 模板内容人工审查 |

## 8. 测试与任务卡

### 8.1 命令（各卡钉死，绝对路径）

```sh
# desktop（L16 / L17 / L18 / L19）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
# server（L15）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts src/application/design/__tests__
# 类型/静态
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
```

### 8.2 T0（主代理，派发前）

本设计文档；`api.ts` §1.1 全部函数与类型。无新依赖、无锁文件变更、`types.ts`/`controller.ts` 不动。

### 8.3 Wave 1（并行 2）

- **L15 服务端模板/品牌/素材**。新文件 `template-catalog.ts`、`template-service.ts`、`brand-service.ts`、`application/design/__tests__/template-service.test.ts`、`brand-service.test.ts`；修改 `design-service.ts`（importAsset + listAssets kinds）、`interfaces/http/design.ts`（6 条路由）、`interfaces/http/__tests__/design.test.ts`。实现 §1.2/§2/§3.3/§4.1。**禁改：`apps/` 目录、snapshot/restore/deps/export 服务、`template-catalog` 之外不得新建服务。**
- **L16 桌面纯逻辑**。新文件 `brand.ts`、`agent-context.ts`、`agent-run-watch.ts` + `__tests__/brand.test.ts`、`agent-context.test.ts`、`agent-run-watch.test.ts`。实现 §3.2/§5.1/§6.1。**禁改：服务端、`api.ts`、`types.ts`、组件、DesignPanel、preview/edit-engine。**

### 8.4 Wave 2（Wave 1 验收后，并行 2）

- **L17 对话框组件**。新文件 `components/TemplateDialog.tsx`、`components/BrandPanel.tsx`、`components/AssetLibrary.tsx` + 对应测试（api 全 mock）。实现 §2.4/§3.4/§4.2。**禁改：DesignPanel、DesignToolbar、api.ts、服务端、SelectionEditor 内部。**
- **L18 上下文检视与运行反馈**。新文件 `components/AgentContextPreview.tsx` + `agent-run-watch.ts` 内补 hook（纯函数部分 Wave 1 已定，不得改动——L16 验收后视为契约）+ 测试（runStore/chatMessageStore mock）。实现 §5.2/§6.2。**禁改：DesignPanel、DesignToolbar、api.ts、L16 纯函数、服务端。**

### 8.5 Wave 3（Wave 2 验收后，单卡）

- **L19 面板接线与文档**。修改 `DesignPanel.tsx`、`components/DesignToolbar.tsx`（模板/品牌/素材三按钮）、`docs/design-workbench.md`（P4 小节）；集成测试（三对话框打开/关闭/回调、generate/handoff 走检视模态、run 反馈横幅渲染）。实现 §5.3/§6.3。**禁改：SelectionEditor 内部、L15–L18 已验收文件的行为（props 对接可微调并记录）。**

### 8.6 门禁基线

以 main 既有失败为基线（docs/reports/2026-10-18-open-items-ledger.md）；本批不引入新失败。desktop eslint 0 error（既有 warning 为基线）；`check-react-lifecycle-invariants` 与 `check-radius-conventions` 沿用。P3 未提交变更为当前工作树基线的一部分，本批不得回退其行为（P3 测试全绿为前置）。

## 9. 验收记录

### Wave 1（2026-10-23，主代理验收通过）

L15（服务端）与 L16（桌面纯逻辑）并行完成：

- **测试**：server 62 → 115 用例全绿（模板目录不变量 + install/brand/import 应用层与 HTTP 全链路）；desktop 435 → 474 全绿（brand/agent-context/agent-run-watch 纯函数）；双端 `tsc --noEmit` 0 错误。
- **主代理裁决与修正**：① **修正** template-service 缺少 brand/import 同款的父目录 realpath containment 校验（符号链接 `design` 目录可被跟随）——已补 mkdir 后 `realpath(parent) + assertContained`，并新增「symlinked design 目录 → 403 PATH_FORBIDDEN」测试（server 115 用例含此条）；② 接受 L15 判断：brand-service 首次创建时 `design/` 目录可能不存在，故不走 `resolve(allowMissingLeaf)` 完整 lstat 链，改为 `validateRelativePath + assertContained + mkdir + realpath(parent) 再 assertContained`（叶子由 safeWriteFile no-follow 守护）；「安装中并发改写」竞态在应用层以 partial mock 锁死（HTTP 层无注入点）；③ 接受 L15 的模板内容（4 模板 2.6–4.6 KiB/文件，不变量测试逐条锁死，人工审查 HTML 结构/中文文案合格）；④ 接受 L16 判断：修订前 12 位不加尾省略号（以任务卡为准）、文本 300 截断后 stringify（与既有 handoff slice-then-stringify 同模式）、brand 文件以 `!= null` 判省。
- **代码审查**：模板安装 409/overwrite（读当前哈希再写）/TEMPLATE.json 标记、brand 读写修订语义（SHA-256 或 ''+createIfMissing、两文件独立写不回滚且错误指名文件）、importAsset 白名单/1 B–10 MiB/`-2` 去重永不覆盖、kinds 三值向后兼容、agent-context sections 固定顺序与截断、快照测试精确。git status 无越权文件。

### Wave 2（2026-10-23，主代理验收通过）

L17（三对话框组件）与 L18（上下文检视 + run 反馈 hook）并行完成：

- **测试**：desktop 474 → 514 全绿（L17 +26：TemplateDialog 8 / BrandPanel 8 / AssetLibrary 10；L18 +14：AgentContextPreview 5 + hook 9）。L18 运行中见到的 TemplateDialog 2 个失败为并行时间差，L17 收尾后复跑全绿。
- **主代理增量（controller）**：公共 `DesignPageSnapshot` 新增只读 `deps: DesignDependencyStat[] | null`（映射内部 depsFiles），供 P4.4 素材引用与 P4.3 referencedAssets 使用；`applyDepsStats` 补 `touch(page)`（否则快照缓存返回过期值），首次采样也 emit（assetEpoch 不变，仅状态可见性）；controller 测试 19/19 回归绿。
- **接受 L17 判断**：颜色字段为文本输入 + 小色块预览（非原生 color picker，值非法不显示色块）；TemplateDialog 成功视图替换列表、「打开页面」保持弹窗；BrandPanel 文本模式保存成功后本地修订更新为 PUT 返回值（连续保存可用）；brand.ts 测试用真实现不 mock。
- **接受 L18 判断**：hook 订阅只建立一次（options latest-ref）、过渡时同步捕获 before + runErrored 再防抖 500ms（新过渡重捕获重置）、评估期间切会话结果作废、`<pre>` 用 `whitespace-pre-wrap` 防横向溢出；`agent-run-watch.ts` 既有导出零改动。

### Wave 3（2026-10-23，主代理验收通过）

L19（面板接线与文档）单卡完成：

- **测试**：desktop 514 → 524 全绿（DesignPanel 新增 10 用例：三按钮开对话框、generate/handoff 确认与取消、dirty 禁用、品牌入上下文、横幅 chip/dismiss、导入入上下文、品牌重拉、模板安装回调）。既有用例 1 按新契约最小适配（原「点击生成直接 prefill」正是 §5.3 取代的行为，仅插入检视确认步骤，原断言保留）。
- **总门禁（主代理复跑）**：desktop 524（30 文件）+ server 115（8 文件）全绿；双端 `tsc --noEmit` 0 错；`eslint src/features/design` 0 error / 27 warning（P3 基线口径）；`check-react-lifecycle-invariants` 与 `check-radius-conventions` OK；git status 无越权文件（全部变更落在 design 模块、server design 应用/HTTP、docs）。
- **代码审查**：`buildContextInput` 组装口径与 §5.3 一致（品牌缓存 null 诚实省略 section；deps 首轮 null 时素材引用为空）；`useAgentRunFeedback` 接线（enabled=面板可见、filesRef 防闭包过期）；横幅 chip 去重 + `controller.open` + dismiss；对 L15–L18 组件 props 零微调。

### 待补验证（M2 门槛）

真实 Agent + macOS Tauri 冒烟（品牌 + 模板安装 → 经检视上下文真实生成 → 局部续改保持品牌 → 素材替换重开 → run 反馈横幅实机）、浏览器与远端 backend 验证。本批以自动化测试为准并记录待办。
