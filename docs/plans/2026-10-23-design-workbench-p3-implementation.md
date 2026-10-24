# P3 扩展可视编辑 — 实现设计

日期：2026-10-23。状态：P3.1–P3.4 已实现并通过主代理验收（2026-10-23，见 §10 验收记录；L10–L14 由 flash 子代理（luna）分波实现）；P3.5 为独立后续批次未含；真实 Agent/Tauri 冒烟与远端 backend 验证待 M2 前补做。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P3 章节；基线见 [P1](2026-10-23-design-workbench-p1-implementation.md) 与 [P2](2026-10-23-design-workbench-p2-implementation.md)。

本批覆盖 **P3.1 排版与盒模型 / P3.2 图片与链接 / P3.3 元素导航 / P3.4 受限结构修改**。**P3.5 CSS 来源编辑是独立交付批次，不在本批**（生效规则的展示与外部样式表写回另行设计）。自由拖拽绝对定位画布、任意 React/Vue 组件源码反向编辑、跨容器移动元素均明确排除。

## 0. 已定决策（主代理勘察，2026-10-23）

1. **所有新编辑继续走 P1 事务管线，不新增第二个写入通路。** `controller.apply(operations)` 对操作种类不敏感，新的 `attribute` / `structure` 操作种类直接穿过；撤销/重做/保存/冲突语义全部继承（结构操作一次事务 = 一条历史记录 = 一次整体撤销）。
2. **样式编辑维持「只写选中元素的 inline 声明」（P1.8 语义不变）。** 属性白名单扩到 24 个（§2.1），每个属性带独立校验；`value: null` 仍是清除该 inline 声明。遇到外部 `!important` / 媒体查询覆盖时不提高优先级，走既有 override 提示（§6.3 扩展到关键字属性）。
3. **图片选择走服务端清单接口，写相对路径保持可移植。** 勘察事实：`DesignService.list`（`server/src/application/design/design-service.ts:206`）只收集 HTML 文件，无法复用。新增 `GET /api/design/assets`（§5.1）列出工作区图片；面板把工作区相对路径换算成相对当前文档目录的引用写入 `src`（§5.2），不复制文件、不写绝对路径。`src`/`href` 引擎侧只做语法校验（禁 scheme/反斜杠/控制字符，扩展名白名单），路径合法性由服务端 resolve + 预览资产内联兜底。
4. **结构修改收窄为四种自包含动作：复制 / 删除 / 上移 / 下移。** 全部是「同父级」操作，无跨容器移动（嵌套合法性无法静态保证）。复制时对副本子树内所有 `id` 追加 `-copy`（冲突则 `-copy-2`…）去重，并把副本内部指向被改名 id 的 `href="#…"` 同步重写；删除时若子树内 id 被子树外的 `href="#…"` 引用则拒绝（`ANCHOR_REFERENCED`）——不猜测、不静默断链。
5. **元素导航复用预览桥接，不引入第二个选区来源。** 结构树从草稿源码构建（纯函数），点击树节点/父级/子级按钮向 iframe 发 `zclaudia:design-select-path`，桥接高亮该元素并回发标准 `zclaudia:design-select` 消息（携带计算样式与属性）——选区仍只有一个入口 `controller.handleSelectionMessage`，`base === draftRevision` 不变式原样生效。
6. **计算样式作为编辑器初始值，随选区消息携带。** 桥接 select 消息追加 `styles`（固定 20 个计算样式键，§4.1）与 `attrs`（src/alt/href）、`inlineStyle`；编辑器表单初始值取自这些字段，「内联」徽标取自 `inlineStyle` 解析结果。应用修改后由面板发一次 select-path 重选（§6.3），刷新计算样式并驱动 override 对比——颜色沿用既有 verify 回路不动，其余属性走重选对比。
7. **无新依赖。** parse5 v8 已在 desktop 依赖中，`parseFragment` 支持同样的 `sourceCodeLocationInfo` 选项（L10 卡须先在 node_modules 核实签名再使用）。服务端改动仅一个清单端点，不碰锁文件。

## 1. 共享契约（T0 主代理预落，子代理不得改动）

### 1.1 `types.ts` 扩展

```ts
// ---- P3 扩展可视编辑 ----

/** P3 可编辑的 inline 样式属性白名单（24 个）。 */
export type DesignStyleProperty =
  | 'font-family' | 'font-size' | 'font-weight' | 'line-height' | 'text-align'
  | 'color' | 'background-color'
  | 'width' | 'height'
  | 'margin' | 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left'
  | 'padding' | 'padding-top' | 'padding-right' | 'padding-bottom' | 'padding-left'
  | 'border-width' | 'border-style' | 'border-color' | 'border-radius'
  | 'object-fit';

/** 可编辑的元素属性白名单；适用标签见 §3.2。 */
export type DesignAttributeName = 'src' | 'alt' | 'href';

export type DesignStructureAction = 'duplicate' | 'delete' | 'move-up' | 'move-down';

export type DesignEditOperation =
  | { kind: 'text'; value: string }
  | { kind: 'style'; property: DesignStyleProperty; value: string | null }
  | { kind: 'attribute'; name: DesignAttributeName; value: string | null }
  | { kind: 'structure'; action: DesignStructureAction };

/** 选区携带的计算样式子集（桥接 select 消息，键为 CSS 属性名 kebab-case）。 */
export type DesignComputedStyles = Partial<
  Record<
    | 'font-family' | 'font-size' | 'font-weight' | 'line-height' | 'text-align'
    | 'width' | 'height'
    | 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left'
    | 'padding-top' | 'padding-right' | 'padding-bottom' | 'padding-left'
    | 'border-width' | 'border-style' | 'border-color' | 'border-radius'
    | 'object-fit',
    string
  >
>;

export interface DesignSelection {
  // …既有字段不变…
  /** 桥接携带的计算样式（每值 ≤120 字符）；非桥接来源的选区可缺省。 */
  styles?: DesignComputedStyles;
  /** 选中元素的白名单属性现值（src/alt/href，各 ≤500 字符）。 */
  attrs?: Partial<Record<DesignAttributeName, string>>;
  /** 选中元素 style 属性原文（≤2000 字符），编辑器据此标「内联」徽标。 */
  inlineStyle?: string;
}

export type DesignEditErrorCode =
  | …既有 10 项不变…
  | 'ATTRIBUTE_NOT_ALLOWED'   // 属性名不在白名单，或与选中标签不匹配（src/alt 限 img，href 限 a）
  | 'STRUCTURE_NOT_ALLOWED';  // 结构操作与其他操作混用、对 body 根操作、无相邻兄弟元素等
```

新增错误码（引擎抛出，`DesignEditError.code`）：

| code | 场景 |
|---|---|
| `ATTRIBUTE_NOT_ALLOWED` | 属性名不在 {src, alt, href}；或 src/alt 用于非 `img`、href 用于非 `a` |
| `STRUCTURE_NOT_ALLOWED` | 事务里结构操作与其他操作并存（结构操作必须独占事务且仅一个）；对 `elementPath: []`（body）做结构操作；move-up/move-down 无相邻兄弟元素 |

`ANCHOR_REFERENCED`、`INVALID_VALUE`、`IMPLICIT_ELEMENT` 等复用既有码（`ANCHOR_REFERENCED` 为新增第 12 个码：删除会断开子树外 `href="#id"` 引用）。

### 1.2 桥接消息（`preview.ts`，L11）

| 方向 | 消息 | 载荷 |
|---|---|---|
| 面板→iframe | `zclaudia:design-select-path` | `{ channel, elementPath: number[] }`（沿 verify 的路径校验：≤64 层，整数 ≥0） |
| iframe→面板 | `zclaudia:design-select`（既有） | 追加 `styles` / `attrs` / `inlineStyle`（§4.1） |
| iframe→面板 | `zclaudia:design-select-failed` | `{ channel, reason: 'not-found' }`（路径在预览 DOM 中无对应元素） |

`zclaudia:design-verify` / `zclaudia:design-verify-result` 原样保留（颜色 override 回路不变）。

### 1.3 `api.ts` 追加（T0 落库）

```ts
export interface DesignAssetList { files: string[]; }
export function listDesignAssets(backendId: string, sessionId: string): Promise<DesignAssetList>;
// GET /api/design/assets?sessionId=   —— 工作区图片文件清单（§5.1）
```

### 1.4 HTTP 契约

```
GET /api/design/assets?sessionId=   → { files: string[] }（工作区相对路径，按 localeCompare 排序）
```

错误码复用既有（SESSION_NOT_FOUND / WORKSPACE_UNAVAILABLE 等），无新增。

## 2. 排版与盒模型（P3.1）

### 2.1 属性白名单与校验（L10，`html/values.ts`）

```ts
/** 校验一个白名单属性的 inline 值。返回规整后的值或 null（非法）。 */
export function safeStyleValue(property: DesignStyleProperty, value: string): string | null;
/** 校验元素属性值（name 已由引擎限白名单与标签）。返回规整值或 null。 */
export function safeAttrValue(name: DesignAttributeName, value: string, tagName: string): string | null;
```

校验规则（每条都是测试断言点）：

- **颜色**（color / background-color / border-color）：沿用 `safeColor`。
- **长度**（width / height / margin* / padding* / border-width / border-radius / font-size）：`/^0$/` 或 `±数字+单位`，单位 ∈ {px, em, rem, %, vh, vw, vmin, vmax, ch, ex, pt, pc, cm, mm, q, in}；数字整数位 ≤4（即 |v| < 10000）、小数位 ≤3。font-size、padding*、border-width、border-radius 拒绝负值；margin* 允许负值；width/height 额外允许 `auto`；font-size ≤1000。margin/padding/border-width/border-radius 额外接受 1–4 个空格分隔的多值简写（每个 token 各自按该属性规则校验，margin 的 token 可为 auto）。
- **line-height**：`normal`，或 0.1–10 的无单位数字，或正长度。
- **font-weight**：`normal | bold | bolder | lighter` 或 100–900 整数（百位步进不强制）。
- **text-align**：`left | right | center | justify | start | end`。
- **border-style**：`none | hidden | solid | dashed | dotted | double | groove | ridge | inset | outset`。
- **object-fit**：`fill | contain | cover | none | scale-down`。
- **font-family**：trim 后 ≤120 字符，拒绝 `;{}`、`<>`、`\\`、`url(`/`var(`/`expression(`（大小写不敏感）；引号与逗号允许（字体栈合法语法）。
- 所有属性统一拒绝空串与长度 >120（font-family 同）；写入前 trim。

### 2.2 引擎接线（L10，`html/edit-engine.ts`）

- `style` 操作从「仅两种颜色」放开为整个白名单：`buildStyleFold` 的值校验由 `safeColor` 换成 `safeStyleValue(property, value)`；`SELECTION_STYLE_KEYS` 仅对 color/background-color 镜像进 selection 字段，其余属性不镜像（计算值由 §6.3 重选刷新）。
- **简写/长写共存**：`setDeclaration`（P1 已实现）按属性名精确匹配最后一条同名声明；`style="margin: 8px"` 上写 `margin-top: 4px` → 追加在后（后写者胜）；清除不存在的 `margin-top`（只有简写）→ 无变化 → 参与 `EMPTY_TRANSACTION` 判定。既有行为，补测试锁死。

### 2.3 编辑器表单（L13，`SelectionEditor.tsx`）

分组（每组标题 + 两列网格，紧凑行距；沿用面板中文文案风格）：

| 分组 | 字段（label → 输入形态） |
|---|---|
| 文字 | 文字（textarea，既有）；文字颜色 / 背景颜色（Input + 清除按钮，既有） |
| 排版 | 字体（font-family Input）、字号（font-size）、行高（line-height）、字重（font-weight 下拉：normal/bold/100–900 自由输入 → 用 Input+datalist 或纯 Input；实现取纯 Input）、对齐（text-align 下拉 6 项） |
| 尺寸与间距 | 宽度 / 高度（Input，placeholder auto）；外边距 / 内边距（Input，接受简写多值如 `8px 12px`——按 §2.1 长度校验扩展：**简写值 = 1–4 个空格分隔的合法长度/auto**，仅 margin/padding/border-radius/border-width 接受多值） |
| 边框 | 边框宽度 / 边框颜色 / 圆角（Input）；边框样式（下拉 10 项） |
| 图片（仅 img） | 图片（src Input + 「选择…」按钮开图片清单下拉 + 「清除」）；替代文本（alt）；显示方式（object-fit 下拉） |
| 链接（仅 a） | 链接地址（href Input）；链接文字即「文字」字段（text 操作，既有） |

- 初始值：`selection.styles` / `selection.attrs` / 既有 color/backgroundColor/text 字段；没有对应来源的字段初始为空串。
- 「内联」徽标：字段 label 右侧小标记，当 `parseDeclarations(selection.inlineStyle ?? '')` 最后一值为该属性时显示（§3.1 的 `parseDeclarations` 由 L10 导出）。
- 每个样式字段带「×」清除按钮 → `onApply([{kind:'style', property, value: null}])`；应用按钮一次提交所有「与初始值不同且非空」的字段；多值简写校验失败时该字段标红并显示「值无效」，不提交（客户端预检复用 `safeStyleValue`，引擎侧仍是最终裁决）。
- 图片清单下拉：打开时调 `listDesignAssets`（按 backendId+sessionId 缓存于组件 state，面板生命期内复用；失败显示错误可重试），选中项经 `relativeAssetRef`（§5.2）写入 src 字段。

## 3. 图片与链接 + 结构修改的引擎（L10）

### 3.1 `style-declarations.ts` 追加

```ts
/** 解析 inline 声明列表（保留原文拼写；同名取最后一条）。 */
export function parseDeclarations(styleValue: string): { name: string; value: string }[];
```

### 3.2 属性操作（edit-engine）

- `{ kind: 'attribute', name, value }`：`value === null` 删除属性；否则 `safeAttrValue` 校验（src：非空、≤500、禁 scheme（`^[a-z][a-z\d+.-]*:` 与 `//` 开头）、禁反斜杠/控制字符/空白首尾、扩展名 ∈ {png,jpg,jpeg,gif,webp,svg,ico,avif}（从 `#fragment`/`?query` 前取）；alt：≤500 任意文本；href：≤2000，允许相对路径 / `#anchor` / `http(s)://` / `mailto:` / `tel:`，拒绝 `javascript:` / `data:` / `vbscript:`（大小写不敏感）与控制字符）。
- 标签匹配：src/alt 仅 `img`，href 仅 `a`；违者 `ATTRIBUTE_NOT_ALLOWED`。
- splice：已有属性 → `attributeSpan` 原位替换（`name="escaped"`）；新属性 → `newAttributeInsertOffset` 插入 ` name="escaped"`。`escapeAttr` 统一转义。同一事务多个 attribute 操作允许（不同名各自生效；同名后者覆盖前者——按操作序归并后再构建 splice）。
- selection 更新：返回的 locator 同步 `attrs`（写入/删除反映到对应键）。

### 3.3 结构操作（edit-engine）

前置校验：`txn.operations` 含 structure ⇒ 必须恰好一个操作且无其他 kind，否则 `STRUCTURE_NOT_ALLOWED`；`locator.elementPath` 为空数组（body）⇒ `STRUCTURE_NOT_ALLOWED`。

记 `span = elementSpan(element)`（无则 `IMPLICIT_ELEMENT`）、`parentPath = elementPath.slice(0, -1)`、`index = elementPath.at(-1)`、兄弟表 `siblings = childElements(parent)`：

- **duplicate**：取 `copy = source.slice(span.start, span.end)`。
  1. 收集全文档 id 集 `docIds`（解析树全量遍历，**排除**被复制子树自身的 id）与副本子树内 id 列表 `copyIds`（文档序）。
  2. 对每个 `copyIds` 项：`newName = id + '-copy'`，冲突（∈ docIds ∪ copyIds ∪ 已分配新名）则 `-copy-2`、`-copy-3`…；建立 oldId→newId 映射。
  3. `parse5.parseFragment(copy, { sourceCodeLocationInfo: true })`（先核实 v8 签名）；对副本内 `id` 属性值与 `href="#oldId"` 属性值按映射原位替换（splice 集合在副本字符串内从高偏移向低偏移应用）。
  4. 插入位置 `span.end` 之后紧贴；splice：`[span.end, span.end) → copy'`。
  5. 新选区：同 path 但末位 = `index + 1`（副本位置）；text/sourceText 取副本首元素文本（与 locator 相同的来源，textContent trim ≤2000）。
- **delete**：
  1. 收集子树内全部 id；遍历全文档 `href` 属性，若存在 `href="#id"` 且该元素 span 在被删 span 之外 → `ANCHOR_REFERENCED`（message 列出被引用 id）。
  2. splice：`[span.start, span.end) → ''`（不吞相邻空白，字节保持哲学）。
  3. 新选区：父级（parentPath + parent 的 tagName/text），engine 端从解析树取 parent.textContent trim ≤2000。
- **move-up / move-down**：`prev = siblings[index-1]` / `next = siblings[index+1]`；不存在 → `STRUCTURE_NOT_ALLOWED`。span 记号：移动向上时区域 `[p.start, t.end)`（p=prev, t=target）替换为 `source[t.start,t.end) + source[p.end,t.start) + source[p.start,p.end)`（**中间夹的字节原样保留在两者之间**）；向下对称。新选区：末位 = index∓1。
- 结构操作的新 selection 一律 `base = nextRevision`，`styles`/`attrs`/`inlineStyle` 不携带（由面板重选刷新，§6.3）。
- `EMPTY_TRANSACTION` 判定不适用（结构操作必然改变源码）；splice 冲突（区域重叠）理论上不可能（同父兄弟 span 不交叠），加防御断言。

### 3.4 错误文案（T0 已入 `controller.ts` `editErrorMessage`）

| code | 文案 |
|---|---|
| `ATTRIBUTE_NOT_ALLOWED` | 该元素不支持修改此属性（src/alt 仅图片，href 仅链接） |
| `STRUCTURE_NOT_ALLOWED` | 该结构操作在此元素上不可用（可能混用了其他修改，或没有可交换的相邻元素） |
| `ANCHOR_REFERENCED` | 此元素（或其子元素）的 id 被页面锚点引用，删除会断开链接；请先处理引用 |

## 4. 预览桥接扩展（L11，`preview.ts`）

### 4.1 select 消息载荷追加

点击与 select-path 共用同一构造函数；新增载荷：

- `styles`：`getComputedStyle(el)` 固定 20 键（§1.1 DesignComputedStyles 键集），每值 `String(v).slice(0, 120)`，空值省略键。
- `attrs`：仅 src/alt/href 且元素确有该属性时携带，各 `slice(0, 500)`。
- `inlineStyle`：`el.getAttribute('style')`，≤2000 截断。

### 4.2 `zclaudia:design-select-path` 处理

沿 verify 的路径走查（`node.children[step]`，不依赖 data-zclaudia-path 标记——未标记元素也可由树选中）；命中 → 提取既有点击处理的高亮逻辑为 `selectElement(node)`（outline 保存/恢复 + 构造 select 消息，含 §4.1 载荷）复用；未命中 → `parent.postMessage({ type: 'zclaudia:design-select-failed', channel, reason: 'not-found' })`。

`markStaticElements` 上限（5000）不变：超限元素点击不可选，但树→select-path 仍可选（能力差异在树 UI 以 reason 呈现，§7）。

## 5. 图片清单（P3.2 宿主资源接口）

### 5.1 服务端（L12）

`DesignService.listAssets(sessionId)`：复用 `list` 的遍历骨架（SKIP_DIRS、点开头目录/文件跳过、MAX_LIST_FILES=5000、MAX_LIST_DIRS、realpath+containment、坏符号链接静默跳过），谓词换为 `/\.(png|jpe?g|gif|webp|svg|ico|avif)$/i`。实现上把 `list` 的 walk 抽为私有 `walkFiles(root, predicate)`，两个公开方法共用（既有 `list` 行为与测试不变）。

HTTP（`interfaces/http/design.ts`）：`GET /assets?sessionId=` → `{ files }`，错误处理沿用现有路由形态。

### 5.2 客户端换算（L13，新文件 `asset-ref.ts`）

```ts
/** 把工作区相对路径换算为相对 docPath 所在目录的引用（'assets/a.png' → '../assets/a.png' 等）。 */
export function relativeAssetRef(docPath: string, assetPath: string): string;
```

纯函数：按 `/` 段求公共前缀，回退 `../` 段数 + 剩余段；不做 URL 编码（与既有预览 `workspacePath` 的 decode 逻辑对称，写什么读什么）。

## 6. 面板与导航接线（L14）

### 6.1 `DesignPanel.tsx`

- `isValidSelection` 追加校验：`styles`（键数 ≤32、值 string ≤200）、`attrs`（键 ∈ {src,alt,href}、值 ≤500）、`inlineStyle`（string ≤2000）——全部可选。
- 新增 `selectPath(path: number[])`：`iframeRef.current?.contentWindow.postMessage({ type: 'zclaudia:design-select-path', channel, elementPath: path }, '*')`；传给 SelectionEditor（父级/子级按钮）与 ElementTree（节点点击）。
- 父级/子级路径计算：`elementPath.slice(0, -1)` 与首子元素 `[...path, 0]`（子级须经元素树 util 校验存在，L11 的 `childElementPath(source, path)`，不存在禁用按钮）。
- `handleApply` 的 mergeKey：text/style 沿用（`style:${property}`）；attribute → `attr:${name}`；structure 不设 mergeKey（每操作独立撤销）。
- **应用后重选**：apply 返回后若操作含 attribute/structure/非颜色 style，记 `reselectRef.current = applied.elementPath`；`handleFrameLoad` 里在 verify 之后补发 `select-path`（同一帧加载只发一次）。随后到达的 select 消息刷新计算样式；**override 对比扩展**（§6.3）在该 select 消息上执行。
- `zclaudia:design-select-failed` 处理：清 reselectRef，不弹错（树与预览短暂不同步属正常，用户下次点击自愈）。

### 6.2 SelectionEditor 导航区（L13 组件内、L14 接线）

选区标题行下加：`<tag> · path` 行右侧「父级」「子级」按钮（path 为空/无子元素时禁用），经 props `onSelectPath` 上抛。结构区：「复制」「删除」「上移」「下移」按钮（无相邻兄弟时对应禁用；删除带确认——用 window.confirm 或行内二次点击确认，实现取「再次点击确认」内联文案，避免新 Modal 依赖）。

### 6.3 override 对比扩展

既有 verify 回路（color/backgroundColor）不动。重选到达的 select 消息上，对 `reselectRef` 记录的本轮写入值逐属性对比：

- 颜色：`colorsEquivalent`（既有）。
- 关键字属性（text-align/font-weight/border-style/object-fit）：trim+lowercase 相等。
- 长度属性：仅当写入值为 `^[\d.]+px$` 时按 `parseFloat` 数值对比；其余写法（em/%/简写）不对比（不可靠即不判定，宁缺勿误报）。
- 任一属性失配 → `setOverrideWarning(true)`（复用既有提示位与文案）。

## 7. 元素结构树（P3.3）

### 7.1 纯函数（L11，新文件 `element-tree.ts`）

```ts
export interface ElementTreeNode {
  path: number[];
  tagName: string;
  id: string | null;
  classes: string[];      // ≤3 个，超出省略
  textPreview: string;    // 首个文本节点 trim ≤40 字符；无则 ''
  /** editable 可全量编辑；implicit 源码无显式标签（只读）；svg- subtree 仅文字/样式/结构；deep 超出桥接 64 层（树内只读）。 */
  capability: 'editable' | 'implicit' | 'svg-subtree' | 'deep';
  reason?: string;        // 非 editable 时的中文原因
  children: ElementTreeNode[];
  truncated?: boolean;    // 子树因节点数上限被截断（≤10000 访问 / ≤128 深度，对齐 markStaticElements）
}

export function buildElementTree(source: string): ElementTreeNode[];
/** path 的第一个子元素路径；无子元素返回 null。 */
export function childElementPath(source: string, path: number[]): number[] | null;
```

- body 以下逐层构建；`svg` 子树内所有节点 capability = `svg-subtree`（reason：「SVG 内容仅支持文字、样式与结构调整」）；无 `sourceCodeLocation` → `implicit`（reason：「源码中无显式标签」）；path 深度 ≥64 → `deep`（reason：「层级超出预览桥接上限」），其子树不再展开。
- 伪元素与脚本生成节点不出现（树来自源码、预览不执行脚本）——面板帮助文案一句话说明该边界。

### 7.2 组件（L14，新文件 `components/ElementTree.tsx`）

工具栏「结构树」开关（DesignToolbar 加按钮）；打开时渲染于 SelectionEditor 上方（max-h-56 滚动）。行 = 缩进 + `<tag>` + `#id` + `.class`（≤3）+ textPreview 灰字；点击行 → `onSelectPath(path)`；当前选区行高亮（elementPath 全等）；capability ≠ editable 的行可点击选中（能看计算样式）但 reason 以禁用色小字显示；`truncated` 显示「…（已截断）」。树按活动页草稿构建（`useMemo(source)`，source 变化即重建）。

## 8. 验收对照（上游计划 P3 验收条目）

| 计划验收项 | 覆盖证据 |
|---|---|
| 卡片改排版、间距、图片、链接后与源码一致 | L10 引擎测试（各属性写入/字节保持/无关源码不动）+ L13 表单测试（提交正确操作数组）+ L14 接线测试 |
| 普通样式覆盖 | L10：style 属性追加/原位替换；L14：verify+重选对比通过不告警 |
| `!important` / 媒体查询覆盖 | L14：计算样式失配 → overrideWarning=true（mock select 消息）；既有颜色回路回归 |
| 简写属性 | L10：margin 简写下写 margin-top 追加生效；清除不存在长写 → EMPTY_TRANSACTION；清除简写整条移除 |
| 复制、排序、撤销、保存与重载 | L10 结构操作（id 改名/锚点重写/插入位置/字节保持/新选区路径）；L13 按钮提交；既有 controller apply/undo/save 管线回归 |
| 锚点引用 | L10：删除被引用 id → ANCHOR_REFERENCED；副本内引用随改名重写 |
| 不能可靠处理的组合明确拒绝 | 结构操作混用/根元素/无兄弟 → STRUCTURE_NOT_ALLOWED；非法值 → INVALID_VALUE；属性标签不匹配 → ATTRIBUTE_NOT_ALLOWED |
| 只读原因 / 能力边界 | L11 树 capability/reason；L14 树 UI 呈现 + 帮助文案（伪元素/脚本节点说明） |
| 素材相对路径可移植 | L12 清单端点；L13 relativeAssetRef 换算测试；预览资产内联回路回归 |

## 9. 测试与任务卡

### 9.1 命令（各卡钉死，绝对路径）

```sh
# desktop（L10 / L11 / L13 / L14）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
# server（L12）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts src/application/design/__tests__
# 类型/静态
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
```

### 9.2 T0（主代理，派发前）

本设计文档；`types.ts` §1.1；`api.ts` §1.3；`controller.ts` `editErrorMessage` 追加 §3.4 三条文案（唯一允许的 controller 改动）。无新依赖、无锁文件变更。

### 9.3 Wave 1（并行 ≤3）

- **L10 编辑引擎扩展**（`html/values.ts`、`html/style-declarations.ts`、`html/edit-engine.ts` + 对应测试）。实现 §2.1/§2.2/§3.1–3.3。禁改：types.ts、preview.ts、controller、组件、服务端。先核实 parse5 v8 `parseFragment` 签名再用。
- **L11 桥接与元素树**（`preview.ts`、新 `element-tree.ts` + 测试）。实现 §4/§7.1。禁改：types.ts、edit-engine/values/style-declarations、controller、组件、服务端。
- **L12 服务端图片清单**（`design-service.ts`、`interfaces/http/design.ts` + 测试）。实现 §5.1。禁改：desktop 目录、deps/export/snapshot/restore 服务。

### 9.4 Wave 2（Wave 1 验收后）

- **L13 SelectionEditor 扩展**（`components/SelectionEditor.tsx`、新 `asset-ref.ts` + 测试）。实现 §2.3/§5.2/§6.2 的组件部分（onSelectPath/onApply 均 props 上抛，含结构按钮与导航按钮的禁用态）。禁改：DesignPanel.tsx、ElementTree（尚不存在）、workspace 核心、服务端。

### 9.5 Wave 3（Wave 2 验收后）

- **L14 面板接线与结构树**（`DesignPanel.tsx`、`components/DesignToolbar.tsx` 加「结构树」按钮、新 `components/ElementTree.tsx` + 测试）。实现 §6.1/§6.3/§7.2。禁改：SelectionEditor 内部表单逻辑（props 对接可改）、workspace 核心、服务端、preview.ts。

### 9.6 门禁基线

以 main 既有失败为基线（docs/reports/2026-10-18-open-items-ledger.md）；本批不引入新失败。desktop eslint 既有 27 警告为基线，0 error 口径；`check-react-lifecycle-invariants` 与 `check-radius-conventions` 沿用。真实 macOS Tauri 冒烟（卡片全流程实机操作）在 M2 前由用户配合补做，本批以自动化测试为准并记录待办。

## 10. 验收记录

### Wave 1（2026-10-23，主代理验收通过）

L10/L11/L12 三张卡并行完成，验收：

- **测试**：desktop 设计模块 381 用例（21 文件，+161）全绿；server 62 用例（+3）全绿；双端 `tsc --noEmit` 0 错误。
- **裁决与修正（主代理）**：① 设计文档笔误「27 个属性」实为 24（types.ts union 为准），已回写 §0.2/§1.1；长度上限口径修正为「整数位 ≤4（|v| < 10000）」；② 接受 L10 三项实现判断：delete 后父级选区 text 取编辑前解析树 textContent（面板重选刷新，已加注释锁死）、parse5 v8 parseFragment 带 sourceCodeLocationInfo 已运行时核实、同偏移零宽插入按操作序稳定排序；③ 接受 L12 事实：walkFiles 沿用 `Dirent.isFile()`，符号链接文件一律静默排除（与既有 list 行为一致）；④ 接受 L11 细节：selectElement 在写 outline 前读 inlineStyle（避免混入桥接自身样式），select-path 的 sourceText 省略（types 可选）。
- **代码审查**：结构操作（duplicate id 唯一域/锚点重写、delete 引用检查、move 区域公式与防御断言）、safeStyleValue/safeAttrValue 规则、element-tree capability 判定、桥接 select-path/select-failed 回路均与契约一致。git status 无越权文件。

### Wave 2 / Wave 3（2026-10-23，主代理验收通过）

L13（SelectionEditor 扩展 + asset-ref）单卡完成；L14（ElementTree + DesignPanel 接线）单卡完成，主代理验收时发现并修复一处集成缺陷：

- **测试**：desktop 设计模块 435 用例（23 文件，+214 于 P2 基线 220）全绿；fileDownload 30 用例回归绿；server 72 用例绿；双端 `tsc --noEmit` 0 错误；全仓 `eslint src` 0 error（warning 为基线）；`check-react-lifecycle-invariants` 与 `check-radius-conventions` OK；git status 无越权文件。
- **主代理修复（Wave 3 验收）**：L14 的 `reselectMismatch` 只从 `selection.styles` 取计算值，而 `color`/`background-color` 是 select 消息的顶层字段——混合事务（颜色+其他属性）的颜色 override 检查被静默跳过。已改为这两个键回退读顶层 `selection.color`/`selection.backgroundColor`，并补锁定测试（`compares top-level color fields on the reselect reply for mixed color+style applies`）。
- **接受 L13 判断**：颜色两字段保留「非空即提交、引擎兜底」宽松预检（DesignPanel 既有 INVALID_VALUE 提示回路依赖该路径）；图片清单纯函数面板无 Modal 依赖；select 型字段空值=不修改。
- **接受 L14 判断**：对比表为 DesignPanel 模块私有纯函数（不导出，避免 react-refresh 警告）；font-weight 双侧归一（bold→700/normal→400，bolder/lighter 跳过）；ElementTree 截断用例经 buildElementTree 透传 mock（万节点真实渲染代价过高，截断逻辑已由 element-tree.test.ts 锁死）；「默认展开前两层」= path 长度 ≤2 展开。
- **执行注记**：fileDownload 测试在 `vitest.ui.config.ts` 的 exclude 列表中，须用默认 vitest 配置跑（`vitest run src/services/__tests__/fileDownload.test.ts` 不带 `--config`）。

### 待补验证（M2 门槛）

真实 Agent + macOS Tauri 冒烟（卡片全流程实机：排版/间距/图片/链接修改 → 复制/排序/撤销 → 保存重载；结构树与父级/子级导航实机；图片清单拉取）、浏览器与远端 backend 验证。本批以自动化测试为准并记录待办。
