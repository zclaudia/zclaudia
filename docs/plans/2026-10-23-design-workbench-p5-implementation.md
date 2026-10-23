# P5 交互原型与演示文稿 — 实现设计

日期：2026-10-23。状态：设计定稿，T0 契约由主代理预落，L20–L26 由 flash 子代理（luna）分波实现、主代理逐波验收。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P5 章节；基线见 [P1](2026-10-23-design-workbench-p1-implementation.md)、[P2](2026-10-23-design-workbench-p2-implementation.md)、[P3](2026-10-23-design-workbench-p3-implementation.md)、[P4](2026-10-23-design-workbench-p4-implementation.md)。

本批覆盖 **P5.1 预览执行边界 / P5.2 交互原型 / P5.3 演示文稿 / P5.4 渲染与导出（PNG + PDF）**。

明确排除（第一版边界）：

- **无服务端渲染器**。PNG/PDF 渲染全部在客户端完成（SVG `foreignObject` 光栅化 + 自研 JPEG 直通 PDF 写入器），不引入 puppeteer/playwright/pdf-lib/jszip 新依赖；服务端与 `api.ts` **零改动**。资源仍经既有鉴权 asset API 以 data URL 内联，不开放任何宿主同源或文件接口（P5.1 的「受控资源服务」= 沿用既有内联管线，不开新通路）。
- **PDF 为整页图片 PDF**（每页一张 JPEG，无文字层、不可编辑）。界面与文档明确标注「整页图片，不可编辑文字」，不与可编辑导出混称（上游 P5.4 措辞）。
- **PPTX 不实现**，仅在本档 §8 记录可行性结论，不写代码。
- **deck 播放与缩略图使用静态构建器（脚本剥离）**；带脚本的 deck 页走运行模式查看交互。播放键盘翻页由宿主处理，不执行作品脚本。
- **单页 PNG 捕获为视口区域**（宽度 × 900px），不做整页高度捕获（opaque-origin iframe 无法量测内容高度，属已声明的边界而非承诺）。
- 任意项目 dev server 代理与 React/Vue 源码反向编辑仍为独立扩展（上游计划口径）。
- 真实 macOS Tauri（尤其 WKWebView 下 foreignObject 光栅化是否污染画布）与浏览器实测待用户配合，为 M3 门槛；本批以自动化测试为准，捕获失败路径有明确错误显示（`capture-unsupported` / `capture-failed`），不静默。

## 0. 已定决策（主代理勘察，2026-10-23）

1. **三态模式：编辑（现状）/ 运行 / 演示。** 编辑模式行为与 P1–P4 完全一致（脚本与 on* 剥离、选区桥接可用）；运行模式为页面级交互执行（§2）；演示模式是 deck 专用的覆盖层播放（§5），不是预览模式。模式切换是面板会话内 state，不持久化（每次挂载默认编辑）。
2. **运行模式不放开任何宿主权限。** iframe sandbox 维持 `allow-scripts`（无 `allow-same-origin` / `allow-popups` / `allow-forms` / `allow-top-navigation`），CSP `connect-src 'none'` 拒绝一切网络。存储策略 = opaque origin 下以桥接注入的内存 shim 提供 `localStorage`/`sessionStorage` API（可用、不持久、刷新即失）；`IndexedDB` 在 opaque origin 抛错属已声明限制，不 shim。导航策略 = 构建期分类 + 桥接拦截（§2.2）。弹窗策略 = sandbox 禁止（`window.open` 返回 null）。
3. **交互原型 = 任何页面可切运行模式**，不要求声明清单；「声明范围内的交互」（上游 P5.2）由边界本身定义：本地多页跳转（工作区内 .html）、页内菜单/弹窗（作品脚本自理）、锚点。外部链接与非 HTML 相对链接被阻止并上报状态。运行模式禁用选区/结构树/交给 Agent（只读体验）；切回编辑模式后静态预览重建，支持的节点照常定位（上游验收项）。
4. **deck 约定 = 源码内 `data-zclaudia-slide` 标记元素**（推荐 `<section>`），文档顺序即页序；可选 `data-title` / `data-notes` 属性；比例存 `<body data-zclaudia-deck-ratio="16:9|4:3">`（缺省 16:9）。含 ≥1 个标记元素即视为 deck（工具栏出现「幻灯片」按钮）。**deck 是普通 HTML 页**：经 P1–P3 全部编辑链路可编辑、可保存、可快照、可 ZIP 导出；排序/备注/比例是字节保真的源码块切片（§3）。
5. **deck 结构操作走纯函数源码变换 + 新增 `controller.applySource`**（T0 预落）：deck 模块用 parse5 源码范围（`html/parse.ts` 的 `elementSpan`/`attributeSpan`/`startTagInsertOffset` 等）计算精确切片，控制器以原子草稿替换接入既有 undo/修订/busy 链路。不经 P1 事务引擎（其 locator 面向选区元素，deck 操作面是页级块），但同样满足「无关字节不动」。
6. **渲染导出 = 客户端捕获管线**：`captureHtmlImage`（SVG foreignObject + XMLSerializer + canvas，白底填充）产出 PNG blob（PNG 直接落盘）或 JPEG blob（quality 0.92 → `buildImagePdf` 直通嵌入 `/DCTDecode`，无需解析图像数据，字节级可测）。导出内容 = 当前预览（草稿源码 + 磁盘资源），对话框明示「含未保存修改」。
7. **无新依赖、无锁文件变更、服务端零改动**；`types.ts` 与 `api.ts` 不动。桌面新模块：`interactive.ts`、`deck.ts`、`pdf.ts`、`render-export.ts` + 组件 `DeckPanel.tsx`、`DeckPresenter.tsx`、`RenderExportDialog.tsx`。

## 1. P5.1 预览执行边界（策略表）

| 维度 | 编辑模式（现状，不变） | 运行模式（新） | 演示模式（新，deck 专用） |
|---|---|---|---|
| 作品脚本 / on* 内联事件 | 剥离 | **保留执行**（本地脚本内联为文本；远程 script src 移除并计数上报） | 剥离 |
| 网络 | 无脚本执行 | CSP `connect-src 'none'`，XHR/fetch/EventSource 全拒 | 同编辑 |
| 导航 | 锚点放行，其余阻止 | 相对 `.html`/`.htm` → 桥接 `design-navigate` 上报宿主开页；`#锚点` 放行；外部 scheme / 非 HTML 相对链接 → 阻止并上报 `design-nav-blocked` | 页内导航无（键盘翻页由宿主处理） |
| 存储 | 无 | opaque origin + 内存 shim（可用不持久）；IndexedDB 抛错（声明限制） | 无 |
| 弹窗 / 表单 | sandbox 禁 / preventDefault | sandbox 禁 / preventDefault | 同编辑 |
| 消息桥接 | select / verify / select-path | 仅 `design-navigate` / `design-nav-blocked`（无选区消息） | 无桥接（缩略图/播放 HTML 由 §3.4 过滤掉全部 script） |
| 选区/编辑 | 可用 | 禁用（只读体验） | 不适用 |

运行模式 CSP（构建期注入，与编辑模式的差异仅 script-src 一项）：

```
default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:;
style-src 'unsafe-inline' data:; script-src 'unsafe-inline' data: blob:;
connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'
```

iframe `sandbox` 属性两种模式一致（`allow-scripts`），`PreviewCanvas` 不改。

## 2. P5.2 交互运行预览（`interactive.ts`，新文件）

### 2.1 preview.ts 增量导出（L20 卡内完成，行为不变）

`buildDesignPreview` 内嵌的资产内联机制抽出并导出，供运行模式构建器复用；**仅新增导出，不改既有行为**，`preview.test.ts` 既有用例必须零修改全绿：

```ts
/** preview.ts 新增导出（从 buildDesignPreview 体内抽出，无行为变化） */
export interface AssetInlineLoader {
  /** 工作区相对路径 → data URL；超限/失败 → null。上限沿用 MAX_ASSETS/MAX_ASSET_BYTES/MAX_TOTAL_ASSET_BYTES。 */
  loadInlineAsset(path: string): Promise<string | null>;
  /** 原始引用值 → data URL（data:/blob:/#/scheme 原样返回 null）。 */
  resolveAsset(raw: string, fromDir?: string): Promise<string | null>;
}
export function createAssetInlineLoader(
  loadAsset: (relativeWorkspacePath: string) => Promise<{ mimeType: string; data: string }>
): AssetInlineLoader;
export function workspaceSourceDir(filePath: string): string;   // 原 sourceDir 计算
export function decodeBase64Utf8(base64: string): string;        // 原私有函数导出
```

### 2.2 `buildDesignRunPreview`（L20，新文件 `interactive.ts`）

```ts
export interface RunPreviewOptions {
  source: string;
  /** 工作区相对路径（相对链接解析基准）。 */
  filePath: string;
  loadAsset: (relativeWorkspacePath: string) => Promise<{ mimeType: string; data: string }>;
  channel: string;
}
export interface RunPreviewResult {
  html: string;
  /** 构建期被移除的远程引用计数（状态行展示）。 */
  blocked: { scripts: number; links: number };
}
export async function buildDesignRunPreview(options: RunPreviewOptions): Promise<RunPreviewResult>;
```

构建步骤（每条都是断言点）：

1. DOMParser 解析；移除 `base, object, embed, iframe, meta[http-equiv refresh/csp]`（同静态）。
2. `<script>`：无 src 的内联脚本原样保留；`src` 为远程（scheme 或 `//` 开头）→ 移除且 `blocked.scripts++`；`src` 为相对路径 → `loadAsset` 读取（utf8 解码）内联为 `textContent`。上限：脚本数 ≤12、单脚本 ≤512 KiB、总内联 ≤2 MiB，超限移除并入 `blocked.scripts` 计数。
3. 图片/srcset/`link[stylesheet]`/`style`/`[style]` url() 内联：复用 `createAssetInlineLoader`（同静态规则与上限）；`<link rel="stylesheet">` 失败移除（同静态）。
4. on* 内联事件**保留**；`form[action]` 移除 action、远程 href/src 移除（同静态的远程剥离）。
5. **导航标记**：`a[href]` 中相对 `.html`/`.htm`（可带 `#hash`/`?query`，取 pathname 判后缀）→ 追加属性 `data-zclaudia-nav="<工作区相对路径>"`（原 href 保留，供 `:link` 样式）；`#` 开头锚点不动；其余（外部 scheme、非 HTML 相对）不动，由桥接运行期分类阻止。
6. 注入 §1 运行模式 CSP meta（无 nonce）+ 运行桥接 `<script>`（`head.children[1]` 前插入，同静态位置约定）。
7. `blocked.links` = 远程 `a[href]`（scheme/`//`）与相对非 HTML 链接的合计计数（构建期统计，仅用于提示）。

### 2.3 运行桥接（`interactive.ts` 内生成，与静态桥接同源的转义规则）

- **存储 shim**：IIFE 首行 try/catch 探测 `window.localStorage.getItem`；抛错（opaque origin）则以 `Object.defineProperty(window, 'localStorage', { value: memShim })`（`sessionStorage` 同理）注入内存实现（`getItem/setItem/removeItem/key/length/clear`，≤100 键、单值 ≤64 KiB 防滥用）。
- **submit**：capture 阶段 `preventDefault`（同静态）。
- **click**（capture）：目标为 `a` 或其后代时——`data-zclaudia-nav` 存在 → `preventDefault` + `postMessage({type:'zclaudia:design-navigate', channel, path})`；否则 href 匹配 `/^(?:[a-z][a-z\d+.-]*:|\/\/)/i` → `preventDefault` + `{type:'zclaudia:design-nav-blocked', channel, reason:'external', href: slice(0,500)}`；否则非空相对 href → `preventDefault` + `reason:'unsupported'`；`#` 开头或无 href → 放行。普通元素点击不拦截（作品交互自理，无选区高亮）。
- 无 select/verify/select-path 处理（运行模式只读）。

### 2.4 宿主侧（L26 接线，契约在此固定）

面板消息处理扩展两类（沿用 `event.source === iframe.contentWindow` + channel 校验）：

- `zclaudia:design-navigate`：`path` 校验（string、≤500、无 `\`、无控制字符、非 scheme 开头）→ 在 `files` 清单中 → `controller.open(path)`；不在清单 → 状态条「目标页面不在工作区：<path>」。
- `zclaudia:design-nav-blocked`：`reason 'external'` → 「已阻止打开外部链接」；`'unsupported'` → 「已阻止非页面链接（仅支持工作区内 HTML 跳转）」。状态条 5 秒自动消失或手动关闭。

面板 `previewMode: 'edit' | 'run'`；预览缓存键扩为 `${draftRevision}:${assetEpoch}:${mode}`；运行模式隐藏 SelectionEditor/结构树、禁用「交给 Agent 修改」，状态条固定显示「运行模式：仅供交互体验，编辑请切回编辑模式」+（blocked 计数 >0 时）「已移除 N 个外部脚本、M 个外部链接」。

## 3. P5.3 演示文稿（`deck.ts` 纯逻辑，L21）

### 3.1 约定

- 标记：任意元素带 `data-zclaudia-slide` 即一页（文档顺序 = 页序）；推荐 `<section>` 直接子级放 `<body>` 或单个容器下。**全部标记元素同父级时才可排序**（`siblings: true`），否则 DeckPanel 排序按钮禁用并显示原因。
- 属性：`data-title`（≤200 字符，缺省「第 N 页」）、`data-notes`（演讲者备注 ≤2000 字符）。
- 比例：`<body data-zclaudia-deck-ratio="16:9"|"4:3">`，缺省 `16:9`。
- 上限：标记元素 ≤60（超出 `parseDeck` 抛 `DesignEditError('STRUCTURE_NOT_ALLOWED')`，中文消息「幻灯片数量超过 60 页上限」）；遍历 ≤10000 节点、深度 ≤128（对齐 element-tree）。

### 3.2 接口

```ts
export type DeckRatio = '16:9' | '4:3';
/** 捕获/播放的逻辑像素尺寸（96dpi 口径）。 */
export const DECK_RATIO_DIMENSIONS: Record<DeckRatio, { width: number; height: number }>;
// '16:9' → { width: 1600, height: 900 }；'4:3' → { width: 1200, height: 900 }

export interface DeckSlideSpan { start: number; end: number }   // 含标签的整元素源码范围
export interface DeckSlide {
  index: number;
  /** 从 body 子元素起的元素序号路径（与选区/树口径一致）。 */
  elementPath: number[];
  title: string;
  notes: string;
  tagName: string;
  span: DeckSlideSpan;
}
export interface DeckInfo { slides: DeckSlide[]; ratio: DeckRatio; siblings: boolean }

export function parseDeck(source: string): DeckInfo;        // 解析失败抛 DesignEditError('MALFORMED_HTML')
export function isDeck(source: string): boolean;            // parseDeck 成功且 slides.length > 0

/** 幻灯片重排（from → to）；越界抛 'INVALID_VALUE'，非 siblings 抛 'STRUCTURE_NOT_ALLOWED'。
 *  实现 = 源码块 [start,end) 拼接搬移，块外字节零改动。 */
export function reorderDeckSlides(source: string, from: number, to: number): string;
/** </body> 前追加模板页（与最后一页同父级；无 body 或解析失败抛错）。 */
export function addDeckSlide(source: string): { source: string; index: number };
/** 删除一页；删到 0 页合法（页面退化为普通页）。 */
export function deleteDeckSlide(source: string, index: number): string;
/** 更新/写入 data-notes（值 ≤2000、含控制字符拒绝 'INVALID_VALUE'；写入时属性值按 " & < > 转义——引号等由转义承载，不拒绝）。 */
export function updateDeckSlideNotes(source: string, index: number, notes: string): string;
/** 更新/写入 data-title（≤200，校验与转义同上）。 */
export function updateDeckSlideTitle(source: string, index: number, title: string): string;
/** body 写/改 data-zclaudia-deck-ratio（无 body 或值非法抛错）。 */
export function setDeckRatio(source: string, ratio: DeckRatio): string;
```

实现约束：全部经 `html/parse.ts`（`parseDocument`/`childElements`/`findBody`/`findElement`/`elementSpan`/`startTagSpan`/`attributeSpan`/`attrValue`/`startTagInsertOffset`/`newAttributeInsertOffset`）取得源码范围后做字符串拼接；**禁止整文重序列化**。`addDeckSlide` 模板（插入点 = `</body>` 前，若有既有页则对齐其缩进，无则两空格）：

```html
<section data-zclaudia-slide data-title="新页">
  <h2>新页标题</h2>
  <p>在此填写内容。</p>
</section>
```

### 3.3 测试要点（L21）

多页含嵌套普通 `<section>`、非 siblings 拒绝排序、reorder 前后非块内字节逐字节不变（含中间插着的非 slide 兄弟节点）、notes/title 属性含引号的转义、ratio 属性新增与替换、add/delete/空页退化、MALFORMED_HTML、60 页上限、elementPath 与选区口径一致（对照手算路径）。

### 3.4 幻灯片预览过滤（`deck.ts` 内，供缩略图/播放/捕获共用）

```ts
/** 输入 = 已构建好的静态预览 HTML（含桥接 script）；输出 = 仅显示第 index 页、
 *  移除全部 <script>、注入 display 规则的渲染用 HTML。index 越界抛错。 */
export function filterSlideInPreviewHtml(previewHtml: string, index: number): string;
```

实现：DOMParser 解析 → 移除全部 `script` 元素 → `head` 追加 `<style>`：`[data-zclaudia-slide]{display:none!important}` 与 `[data-zclaudia-slide][data-zclaudia-slide-active]{display:block!important}` → 按文档序找第 index 个 `[data-zclaudia-slide]` 设 `data-zclaudia-slide-active` → 序列化。测试：仅一页可见、script 清空、越界抛错。

## 4. T0：`controller.applySource`（主代理预落，契约冻结）

```ts
/**
 * P5 deck 页级源码替换：以原子草稿替换走既有历史/修订链路。
 * 守卫：disposed / busy / 无活动页 / source 与当前草稿相同 → false（不记录历史）。
 * 行为：page.draft = source；修订经 ports.sha256 重算；selection 清空；
 * history.record({ before, after, label, at: Date.now() })（无 mergeKey，独立 undo 步）；
 * externalChange/missing 不动。返回是否替换成功。
 */
async applySource(source: string, label: string): Promise<boolean>;
```

undo 走既有 `moveHistory`（无需新代码）。测试（`workspace/controller.test.ts` 追加）：替换成功且修订更新、selection 清空、undo 还原旧草稿、busy 互斥、相同 source 拒绝、loading 页拒绝。

## 5. P5.3 组件（L23）

### 5.1 DeckPanel（Modal，新文件 `components/DeckPanel.tsx`）

Props（全部上抛，不自持工作区状态）：

```ts
interface DeckPanelProps {
  open: boolean;
  /** 活动页信息；null = 关闭态。 */
  page: { path: string; source: string; busy: boolean } | null;
  /** 已构建的活动页静态预览 HTML（复用面板缓存）；null = 构建中。 */
  previewHtml: string | null;
  /** deck 结构（面板按 draftRevision memo 的 parseDeck 结果）。 */
  deck: DeckInfo | null;
  /** 提交源码变换（面板接 controller.applySource）。 */
  onCommit: (source: string, label: string) => Promise<boolean>;
  onPresent: (startIndex: number) => void;
  onClose: () => void;
}
```

- 缩略图网格：每页 mini iframe（`filterSlideInPreviewHtml(previewHtml, i)`，360×240 布局缩放，对齐 PageOverview 形态）；`previewHtml` 为 null 时显示占位。页卡：序号、标题输入框（change → `updateDeckSlideTitle` → onCommit）、上移/下移按钮（`reorderDeckSlides(source, i, i+1)`，`!deck.siblings` 时禁用 + title 提示「幻灯片不在同一父级，无法排序」）、删除按钮（二次确认，「演示」按钮。
- 备注编辑：页卡展开区 textarea + 保存按钮（`updateDeckSlideNotes` → onCommit；预检 >2000 字禁用提交）。
- 底部工具条：新增页（`addDeckSlide`）、比例 select（`setDeckRatio`）、页数显示 `N/60`。
- 每次提交后以返回的 source 重建本地视图（props 页面 source 由面板 state 驱动刷新）；busy 时全部操作禁用。操作失败（抛错）以页内 alert 显示异常消息。

### 5.2 DeckPresenter（全屏覆盖层，新文件 `components/DeckPresenter.tsx`）

Props：`{ slides: DeckSlide[]; ratio: DeckRatio; previewHtml: string | null; startIndex: number; onClose: () => void }`。

- 挂载即 `container.requestFullscreen?.()`（catch 静默降级为 fixed inset-0 z-50 黑底覆盖层）；卸载时若处于全屏则 `document.exitFullscreen?.()`（catch 静默）。
- 键盘（window keydown，卸载清理）：`ArrowRight`/`PageDown`/`Space` 下一页、`ArrowLeft`/`PageUp` 上一页、`Home`/`End` 首/末页、`Escape` 关闭（若处于浏览器全屏，先退出全屏再关闭由 onClose 一并处理）。
- 幻灯片区：按 `DECK_RATIO_DIMENSIONS[ratio]` 比例盒居中，`transform: scale(min(容器W/宽, 容器H/高))`；iframe（sandbox `allow-scripts`，内容 = `filterSlideInPreviewHtml(previewHtml, i)`）宽高固定逻辑像素，`overflow: hidden`（内容溢出属页面制作问题，边界在文档声明）。
- 底栏：`第 i/N 页 · <标题>`、上一页/下一页按钮、备注开关（`N` 键同效）：开启时底部条显示当前页 notes（空则「无备注」）、关闭按钮（`Esc`）。
- `previewHtml` 为 null → 居中「正在构建预览…」。

## 6. P5.4 渲染与导出（L22 纯逻辑 + L24 对话框）

### 6.1 `pdf.ts`（新文件，零依赖 JPEG 直通写入器）

```ts
export interface PdfJpegPage { widthPx: number; heightPx: number; jpegBytes: Uint8Array }
export interface BuildImagePdfOptions { dpi?: number }   // 缺省 96；pt = px * 72 / dpi（四舍五入）
/** 每页一张 JPEG 的整页图片 PDF（无文字层）。页数 1–200；尺寸 1–10000px；
 * jpegBytes ≥4 且以 0xFF 0xD8 开头；否则抛 Error（中文消息）。 */
export function buildImagePdf(pages: PdfJpegPage[], options?: BuildImagePdfOptions): Uint8Array;
```

结构（断言点）：`%PDF-1.4` 头；对象 1 = Catalog（/Pages 2 0 R），2 = Pages（/Kids + /Count），每页三对象 = Page（/MediaBox [0 0 wPt hPt]、/Resources /XObject </ImN …>、/Contents）、Image XObject（/Type /XObject /Subtype /Image /Width /Height /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 精确字节）、Content stream（`q wPt 0 0 hPt 0 0 cm /ImN Do Q`）；xref 表偏移逐一正确 + trailer /Root /Size；`%%EOF` 结尾。JPEG 字节原样透传（PDF 版本化：二进制注释行含非 ASCII 位标记）。

### 6.2 `render-export.ts`（新文件）

```ts
export interface CaptureRequest {
  html: string;                 // 已构建的预览 HTML（通常经 filterSlideInPreviewHtml）
  width: number; height: number;   // 逻辑像素 1–10000
  mime: 'image/png' | 'image/jpeg';
  quality?: number;             // jpeg 用，缺省 0.92
}
export class RenderCaptureError extends Error {
  constructor(readonly code: 'capture-unsupported' | 'capture-failed', message: string) { … }
}
export async function captureHtmlImage(request: CaptureRequest): Promise<{ blob: Blob; width: number; height: number }>;
/** 非(deck 页视口区域捕获请求（fill/custom 统一 1280×900，preset 有宽则 宽×900；上限 10000）。deck 单页捕获请求由 L24 组装（filterSlideInPreviewHtml + DECK_RATIO_DIMENSIONS），避免与 L21 并行竞态。 */
export function buildPageCaptureRequest(previewHtml: string, viewport: { preset: string; width: number | null }): CaptureRequest;
/** 导出文件名：<base>-slide-01.png / <base>.pdf / <base>.png（base = 入口名去扩展，非法字符转 _，复用服务端 buildExportFilename 口径的客户端版）。 */
export function buildRenderExportFilename(entryPath: string, ext: 'png' | 'pdf', slideIndex?: number): string;
```

`captureHtmlImage` 步骤（jsdom 测试 mock Image/canvas，真实光栅化为 M3 手工门槛）：

1. `DOMParser('text/html')` 解析 → `XMLSerializer.serializeToString`（**必须**：foreignObject 内容须良构 XHTML，`outerHTML` 的未闭合 void 元素会令 SVG 图片加载失败）。
2. 包 `<svg xmlns="http://www.w3.org/2000/svg" width height viewBox="0 0 W H"><foreignObject width="100%" height="100%">` + 序列化结果 + `</foreignObject></svg>`；`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`。
3. `new Image()` await load（`onerror` / 10 s 超时 → `RenderCaptureError('capture-failed')`）；`document.createElement('canvas')`，尺寸 = width/height；`getContext('2d')` 为 null → `capture-unsupported`；先 `fillStyle '#ffffff'` fillRect（白底，避免透明背景 JPEG 变黑），`drawImage`，`toBlob`（null → `capture-unsupported'`）。

### 6.3 RenderExportDialog（Modal，新文件 `components/RenderExportDialog.tsx`，L24）

Props：`{ open; onClose; entryPath: string; previewHtml: string | null; deck: DeckInfo | null; viewport: { preset; width } }`。

- deck 页：主按钮「导出 PDF（N 页 · 整页图片）」+ 次按钮「导出 PNG（逐页下载）」；非 deck 页：「导出 PNG（视口区域）」。
- 固定说明文字：「导出内容为当前预览（含未保存修改）；PDF 为整页图片，不可编辑文字。」
- 执行：逐页 `buildSlideCaptureRequest` → `captureHtmlImage`（PDF 用 image/jpeg 0.92，PNG 用 image/png）→ PDF：收集后一次 `buildImagePdf` → `saveBlobToFile(blob, '<base>.pdf')`；PNG：逐页 `saveBlobToFile`。进度行「正在导出 i/N…」+ 取消按钮（置标志位，当前页完成后停止；已下载文件不撤销）。
- 单页失败：错误列表展示该页异常消息（`RenderCaptureError` 中文映射：capture-unsupported → 「当前环境不支持页面捕获」，capture-failed → 「页面捕获失败」），其余页继续；全部失败时 alert 汇总。capture 层不 mock 的真实成败交由 M3 实测。

## 7. 验收对照（上游计划 P5 验收条目）

| 计划验收项 | 覆盖证据 |
|---|---|
| 区分静态编辑/交互运行/演示模式；脚本隔离来源与受控资源服务；导航/网络/存储/弹窗/消息策略 | §1 策略表 + L20 桥接测试（nav/blocked/存储 shim/CSP/脚本内联与远程移除）+ 零新通路（资源仍经鉴权 API data URL 内联） |
| 交互作品可运行但不能访问宿主凭据或文件接口 | sandbox `allow-scripts`（无 same-origin/popups/forms/top-nav）+ `connect-src 'none'`；L26 集成测试断言运行模式消息仅两类且 path 经校验 |
| 本地多页跳转、菜单、弹窗等声明范围内交互；编辑/运行可切换 | L20 navigate 桥接 + L26 宿主开页/状态条 + 模式切换集成测试（切回编辑后选区可用） |
| 动态节点无法映射源码 → 只读或交给 Agent | 运行模式禁用选区编辑（只读）；编辑模式从源码构建，动态节点不存在于静态预览 |
| 固定 HTML deck 约定、缩略图、排序、备注、键盘翻页、全屏演示、比例设置 | §3 约定 + L21 纯逻辑测试 + L23 DeckPanel/DeckPresenter 测试 |
| 三页 deck 可排序、编辑、播放、保存、重新打开 | L26 集成测试（deck 操作走 applySource → save → 重新 parse 一致）+ controller 测试 |
| PNG/PDF 从同一明确版本与资源包导出；字体、分页、截图与实际预览一致性 | 捕获输入 = 预览 HTML（同一构建管线与 data URL 资源）→ 结构上一致；页数 = slides.length（L22/L24 断言）；字体随预览内联；实际光栅化 M3 实测 |
| PDF 页数与页面内容一致 | buildImagePdf 页数断言 + 对话框进度/汇总 |
| PPTX 可行性验证、界面不混称 | §8 结论；UI 固定「整页图片，不可编辑文字」文案 |
| macOS Tauri 与浏览器分别验证 | M3 手工门槛，本批自动化 + 失败路径显式化 |

## 8. PPTX 可行性结论（本批交付物之一，不写代码）

- **图片型 PPTX**（每页一张图，等同 PDF 版）：客户端零依赖可做（PPTX=OOXML ZIP，需 ZIP 写入器；桌面当前无 jszip，引入为小依赖）或服务端 pptxgenjs/python-pptx。无许可障碍、保真度与 PDF 图片版相同。**不提供文字层，与可编辑 PPT 无关。**
- **可编辑元素 PPTX**（文字框/形状映射）：需要 HTML 布局引擎级解析（文本度量、自动换行、盒模型→占位符对齐），复杂度高且保真度有限，任何宣称「HTML 直转可编辑 PPT」的方案在通用页面上均不可靠。**建议继续以整页图片 PDF 为主，待真实需求再立项。**
- 界面口径：所有图片型导出必须标注「整页图片，不可编辑文字」，不得出现「导出为 PowerPoint」之类的混称。

## 9. 测试与任务卡

### 9.1 命令（各卡钉死，绝对路径）

```sh
# desktop（L20–L26 全部）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
# 类型/静态
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec eslint src/features/design
# server（本批应零改动；验收时仅回归）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts src/application/design/__tests__
```

基线：desktop design 524 用例（30 文件）全绿；server design 115（8 文件）全绿；eslint 0 error / 既有 warning 基线；`check-react-lifecycle-invariants` 与 `check-radius-conventions` 沿用。**本批不触碰 server 文件**（验收时 git status 核对）。

### 9.2 T0（主代理，派发前）

本设计文档 + `controller.ts` §4 `applySource` + `workspace/controller.test.ts` 追加用例。除此之外无共享契约文件改动。

### 9.3 Wave 1（并行 3）

- **L20 交互运行预览**。新文件 `interactive.ts` + `__tests__/interactive.test.ts`；修改 `preview.ts`（**仅** §2.1 增量导出抽函数，既有行为与测试零变化）。实现 §1 运行 CSP/§2 全部。测试形态对齐 `preview.test.ts` 的 jsdom BridgeHarness（真实执行桥接脚本）。**禁改：`api.ts`、`types.ts`、controller、组件、服务端、其他桌面模块。**
- **L21 deck 纯逻辑**。新文件 `deck.ts` + `__tests__/deck.test.ts`。实现 §3 全部（仅依赖 `html/parse.ts` 与 `types.ts` 的 `DesignEditError`）。**禁改：`html/parse.ts`、`types.ts`、preview/interactive、controller、组件、服务端。**
- **L22 PDF 与捕获纯逻辑**。新文件 `pdf.ts`、`render-export.ts` + `__tests__/pdf.test.ts`、`__tests__/render-export.test.ts`。实现 §6.1/§6.2（**不依赖 deck.ts**：deck 单页捕获请求与 PDF 组装属 L24 接线）。**禁改：`api.ts`、`types.ts`、preview/interactive/deck、controller、组件、服务端。**

### 9.4 Wave 2（Wave 1 验收后，并行 2）

- **L23 deck 组件**。新文件 `components/DeckPanel.tsx`、`components/DeckPresenter.tsx` + 对应测试（`deck.ts` 真实现可用；controller/预览构建 mock：`onCommit`/`previewHtml` props 注入）。实现 §5。**禁改：DesignPanel、DesignToolbar、api.ts、deck.ts 纯函数、服务端。**
- **L24 渲染导出对话框**。新文件 `components/RenderExportDialog.tsx` + 测试（`captureHtmlImage` mock、`pdf.ts`/`buildRenderExportFilename` 真实现、`saveBlobToFile` mock）。实现 §6.3。**禁改：DesignPanel、DesignToolbar、api.ts、render-export.ts/pdf.ts 纯函数、服务端。**

### 9.5 Wave 3（Wave 2 验收后，单卡）

- **L25 面板接线与文档**。修改 `DesignPanel.tsx`、`components/DesignToolbar.tsx`（模式切换/幻灯片/渲染导出按钮）、`docs/design-workbench.md`（P5 小节）；集成测试：模式切换与缓存隔离、运行模式隐藏编辑器、navigate/blocked 消息处理、deck 检测与三组件挂载、deck 操作 → 保存 → 重开一致、渲染导出对话框打开。实现 §2.4/§5 接线。**禁改：L20–L24 已验收文件的行为（props 对接可微调并记录）。**

## 10. 验收记录

### T0 + Wave 1（2026-10-23，主代理验收通过）

T0（controller.applySource + 1 用例）与 L20/L21/L22 三卡并行完成：

- **测试**：desktop design 524 → 601 用例全绿（34 文件；interactive 10 + deck 41 + pdf 14 + render-export 11 + controller 1 = 77，数目吻合）；`tsc --noEmit` 0 错；eslint 0 error / 27 warning（P3 基线口径不变）；lifecycle/radius OK；git status 无越权文件（服务端零改动 ✓）。
- **主代理裁决与修正**：① **修正** `buildPageCaptureRequest` 的 custom 视口被固定 1280（文档措辞含糊的次优读法）——改为「带数值宽度即用其宽度，仅 fill 回退 1280」，同步改测试；② **接受** L20 对 §2.2 步骤顺序矛盾的消解：构建期先分类计数再剥离（http(s) 链接构建期移除并计数，非 http scheme 与 `//` 留给桥接运行期阻止——桥接 external 分支因此可达）；③ **接受** L21 对转义规则矛盾的裁决（仅拒控制字符，`" & < >` 转义承载），文档已改写明确；④ **接受** L21：addDeckSlide 插入点以 `</body>` 为准（与「同父级」在推荐结构下一致）、60 页上限在 add 时同样生效、reorder 越界检查优先于 siblings 检查；⑤ **接受** L22：`foreignObject width="100%"`（SVG 根有显式宽高，Chromium/WebKit 均解析，M3 实测兜底）、xref 20 字节标准格式。
- **代码审查**：preview.ts 纯增量抽取（调用点显式传 sourceDir，行为零变化，preview.test.ts 零修改）；interactive.ts 桥接转义/存储 shim 探测（非 opaque 环境不安装）/CSP 无 nonce/脚本三重上限与失败计数正确；deck.ts reorder 双向拼接顺序人工验证正确、slide span 含解析错误守卫、addDeckSlide 缩进保留处理（`\n空白` 行文重排）正确；pdf.ts 对象布局/xref/Length 精确/DCTDecode 直通；render-export.ts XMLSerializer 良构化必须性正确、Image 超时与双失败路径、白底填充。

### Wave 2（2026-10-23，主代理验收通过）

L23（DeckPanel + DeckPresenter）与 L24（RenderExportDialog）并行完成：

- **测试**：desktop design 601 → 643 用例全绿（37 文件；DeckPanel 17 + DeckPresenter 14 + RenderExportDialog 11 = 42，数目吻合）；`tsc --noEmit` 0 错（L23 报告的 RenderExportDialog `Uint8Array<ArrayBufferLike>`→BlobPart 错误为 L24 修复前的中间态快照，L24 已自行加 `as BlobPart` 修掉，验收复跑确认）；eslint 0 error / 29 warning（基线 27 + 2 条 `set-state-in-effect`，与 ExportDialog 同类既有模式：DeckPanel props source 同步、RenderExportDialog open 重置）；lifecycle/radius OK；git status 无越权文件。
- **接受 L23 判断**：① DeckPanel 连续操作以乐观更新后的本地 source 为基线，onCommit false 回退 page.source + 页内 alert（测试固化）；② 播放器缩放不设上限 1（全屏放大填充是播放期望行为）；③ 底栏上/下页按钮首末页禁用（键盘侧 clamp 不动）。已知 v1 限制（不阻塞）：标题输入每次键击一条 undo 记录（applySource 无 mergeKey，属契约冻结范围）、极速连击可能出现一次「提交未生效」回退提示。
- **接受 L24 判断**：完成汇总的「成功 N/M 页」用 succeeded 计数而非 files.length（PDF 模式 files 仅 1 项）；取消立即以已收集内容汇总（runId 失效旧回调），当前页捕获完成后不再落盘；PDF 组装失败以非页面错误进错误列表。次要：saveBlobToFile 被用户取消保存时仍计入成功（返回值 string|null 未检查）——Tauri/浏览器保存对话框取消语义属边缘，记录不改。

### Wave 3（2026-10-24，主代理验收通过）

L25（面板接线与文档）单卡完成：

- **测试**：desktop design 643 → 651 用例全绿（37 文件；DesignPanel 新增 8 用例，既有 43 用例零回归）；`tsc --noEmit` 0 错；eslint 0 error / 30 warning（+1 `set-state-in-effect`：切页关闭三对话框的 effect，与 Wave 2 已接受同类）；lifecycle/radius OK；git status 无越权文件。
- **代码审查**：缓存键三分量（`草稿修订:资源纪元:模式`）在 ensurePreview/活动页读取/总览表三处同步；navigate path 校验（长度/反斜杠/控制字符/scheme）+ files 成员判定 + 5 秒自动消失提示条；run 模式隐藏整个底部编辑区（含结构树）与「交给 Agent 修改」禁用（title 提示）；blocked 计数随缓存条目存储、渲染期同源读取；deck 检测 memo 依赖 `[activePage]`（控制器页快照按 rev 缓存，失效语义与 `[draftRevision]` 等价）；三组件挂载/切页统一关闭；`filesRef` 上移与 P4.5 共享，语义不变。
- **接受 L25 判断**：deck memo 用 `[activePage]`（等价失效 + 规避 react-compiler preserve-manual-memoization 警告 4→0）；blocked 存缓存条目而非独立 ref（不新增 render 期 ref 读取点）；handoff 禁用走独立 `runMode` 参数；已知边界——预览缓存按 path 单槽，模式切换往返会重建（测试按 edit 2 次 + run 1 次断言）。
- **终门禁（主代理复跑，2026-10-24）**：desktop design 651/651（37 文件）+ server design 115/115（8 文件，本批零改动 ✓）；双端 `tsc --noEmit` 0 错；eslint 0 error / 30 warning（基线 27 + 3 条同类 `set-state-in-effect`，逐条记录于各波）；lifecycle/radius OK；git status 全部变更落在 design 模块、docs 与 T0 controller（无服务端/契约/越权文件）。

### 待补验证（M3 门槛）

真实 macOS Tauri（尤其 WKWebView 下 SVG foreignObject 捕获是否污染画布、全屏播放体验）与浏览器实测：三页 deck 排序/备注/播放/保存/重开、运行模式多页跳转与菜单弹窗、PDF 页数与内容一致性、PNG 落盘；自动测试已覆盖结构、协议与失败路径，光栅化真实成图以实测为准。
