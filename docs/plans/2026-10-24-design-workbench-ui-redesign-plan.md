# 设计工作台 UI 重构实现方案

日期：2026-10-24。状态：P0–P4c 与 P6 键盘/文档已落地（2026-10-24），并完成真实应用三档截图走查与缺陷修复（2026-10-25）；P5 待后续批次。

范围：`apps/desktop/src/features/design/` 的**视图层**。目标是把当前「纵向堆叠的工具栏 + 256px 长表单」重构为
[`docs/mockups/design-workbench-layout.html`](../mockups/design-workbench-layout.html) 所示的自适应工作台：
单行顶栏 + 左栏（Pages / Layers / Library）+ 画布 + 右侧检查器（Design / Styles / History）+ 状态条，
窄面板退回单列加底部面板，Agent 交接收敛为画布底部的内联输入条。

## 1. 目标与非目标

**目标**

1. 顶栏一行，只放高频操作；全部使用 lucide 图标 + `Tooltip`，一行只有一个实心按钮（Save），符合 [`ui-conventions.md`](../ui-conventions.md)。
2. 画布成为主角：整行横幅合并进状态条与面板内通知；编辑区不再被 `max-h-64` 限死。
3. 检查器按元素类型显示分组，分组可折叠并记住折叠状态；样式来源与版本历史成为同一检查器的页签。
4. Templates / Brand / Assets / Media / 页面总览 / 结构树进入左栏，不再各弹一个 Modal 打断上下文。
5. Agent 交接内联：选区 chip + 输入框 + 上下文预览 popover，保留「预填到聊天、用户确认后发送」的既有安全语义。
6. 宽（≥960）、中（640–959）、窄（<640，含 240px 工具最小宽度的退化）三档自适应。
7. 顺手把 1575 行的 `DesignPanel.tsx` 拆成 hook + 组合根，避免新布局再次变成一团。

**非目标（本方案不动）**

- `workspace/controller.ts`、`html/*` 编辑引擎、`css-drafts`、`preview.ts` / `interactive.ts` 桥接协议、`api.ts` 与 server 端：**零改动**。
- 编辑能力、撤销/保存/冲突语义、快照与分享语义不变。
- 预览 iframe 内的选区高亮样式（桥接注入的 CSS）不变。
- 不做 Figma 式的自由画布（缩放平移手势、多选、拖拽改布局）。

## 2. 现状 → 新布局映射

| 现状（`components/` 或 `DesignPanel.tsx`）                       | 新位置                                                                  | 处理方式                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| `DesignToolbar`（20 个文字按钮）                                 | 顶栏 + `⋯` 菜单 + 左栏入口                                              | **删除**，由 `layout/TopBar` 取代            |
| `PageTabs`（标签 + Open page 下拉）                              | 顶栏左侧标签；未打开文件改为 `+` 菜单与 Pages 面板                      | 重写                                         |
| `ViewportControls`（独占一行）                                   | 顶栏中部：设备图标 + 宽度 + 缩放                                        | 重写，**需要** `PreviewCanvas` 回报实际缩放  |
| 6 种整行横幅（`DesignPanel` 内联 JSX）                           | 状态条 / 画布内通知栈 / 阻断型画布横幅 / Agent 条内联提示               | 抽出 `useDesignNotices` + 组件               |
| `PreviewCanvas`                                                  | 画布区                                                                  | 小改（`onScaleChange`、空态）                |
| `SelectionEditor`（759 行单表单）                                | 右栏 Design 页签                                                        | 保留逻辑，渲染拆为可折叠分组 + 吸底应用条    |
| `StyleSourcePanel`                                               | 右栏 Styles 页签                                                        | 基本不改，仅去掉自带外边距                   |
| `VersionHistory` + 底部折叠条                                    | 右栏 History 页签                                                       | 小改                                         |
| `ElementTree` + Structure 开关                                   | 左栏 Layers                                                             | 小改（去 `max-h-56`、说明文字改 tooltip）    |
| `PageOverview`（画布替换式网格）                                 | 左栏 Pages（缩略图列表）；网格视图保留为 Pages 头部的「Grid」开关       | 抽出 `PageThumbnail`                         |
| `TemplateDialog` / `AssetLibrary`                                | 左栏 Library 的 Templates / Assets 视图                                 | 抽 `*View` 内容，Modal 变成薄壳              |
| `BrandPanel` / `MediaGenPanel`                                   | 左栏 Library 的 Brand / Media 视图（`BrandView` / `MediaGenView`，表单型；Modal 变薄壳，见 §6.4 的取舍） | P4c 已落地                                   |
| `ExportDialog` / `RenderExportDialog` / `SharePanel`             | 单个「Export & Share」对话框（分页签）                                  | P5 抽内容合并，之前先从 `⋯` 菜单分别进入     |
| `DeckPanel` / `DeckPresenter`                                    | 顶栏 Slides 入口 → 左栏 Slides 页签（检测到 deck 时出现）；播放器不变   | P5                                           |
| `AgentContextPreview`（Modal）                                   | Agent 输入条上的「Context」popover                                      | P3 取代                                      |
| `DraftDiffModal`（`DesignPanel` 末尾）                           | 保持 Modal；入口 = 状态条「Unsaved」 + `⋯` 菜单 + History 页签顶行      | 移出到 `components/DraftDiffModal.tsx`       |
| 保存前关闭 / Reload CSS 两个确认 Modal                           | 不变                                                                    | 随组合根保留                                 |

## 3. 架构

### 3.1 布局骨架与「画布永不重挂载」不变量

`PreviewCanvas` 的 iframe 一旦重挂载就会触发 `load`、丢失选区并重建桥接，所以**三档布局必须只靠 CSS Grid 区域与定位改变外观，不能用条件渲染把画布放进不同的父节点**。约定：

- 组合根渲染一个固定结构：`topbar / rail / canvas / inspector / status` 五个同级子节点，布局由根节点上的 `data-tier="wide|medium|narrow"` 与 grid 模板决定。
- 抽屉、底部面板是同一个 DOM 节点换了定位，不是另挂一份。
- 每个面板的内部状态（如 `SelectionEditor` 的表单值）同样不能因折叠而卸载：折叠用 `hidden` / `grid-rows-[0fr]` 而不是 `&&` 条件渲染；确实需要卸载的重内容（缩略图 iframe）再单独做可见性门控。

```
wide  (≥960)      ┌ topbar ─────────────────────────────┐
                  │ rail(40+224) │ canvas │ inspector 300│
                  └ status ─────────────────────────────┘
medium (640–959)  rail 只剩 40px 图标条，面板以抽屉覆盖在画布上；检查器 280 右侧固定
narrow (<640)     topbar 压缩；rail 隐藏，经左上角按钮抽屉打开；检查器变画布下方底部面板
                  (peek 76px / open clamp(260px, 45%, 420px)，选中元素时自动 open 一次)
< 360             顶栏只留 页面名 + Save + ⋯，视口/模式/撤销进入 ⋯
```

### 3.2 档位判定

新增 `hooks/useElementTier.ts`：对组合根 `ref` 挂 `ResizeObserver`（`PreviewCanvas` 已有同款模式与 `typeof ResizeObserver` 守卫），返回 `{ width, tier }`。

- 不用 CSS 容器查询：三档的 DOM 行为（抽屉开合、底部面板、菜单收纳）需要 JS 知道档位。
- 宽度未知（0，jsdom 或首帧）时按 `wide` 处理，保证现有测试与首帧不闪烁；测试通过 stub `ResizeObserver` 切档。
- 阈值常量集中在 `layout/tiers.ts`（960 / 640 / 360），不散落魔法数。

### 3.3 布局偏好持久化

新增 `stores/designLayoutStore.ts`（zustand + `persist`，与其他 desktop store 同款）。键：`zclaudia-design-layout-v1`，**全局**（不分工作区，不放进 `DesignWorkspaceUiState`，那是按工作区身份存的）。

```ts
interface DesignLayoutPrefs {
  leftOpen: boolean;            // 左栏面板展开（图标条始终在）
  leftTab: 'pages' | 'layers' | 'library' | 'slides';
  libraryTab: 'assets' | 'templates' | 'brand' | 'media';
  leftWidth: number;            // 200–420，默认 240
  rightOpen: boolean;
  rightTab: 'design' | 'styles' | 'history';
  collapsedSections: Record<string, boolean>; // 检查器分组折叠，key = section id
}
```

窄/中档的抽屉开合、底部面板 peek/open 是**临时态**，不持久化。

### 3.4 `DesignPanel.tsx` 拆分（P0，零视觉变化）

先做纯重构，让后续每一步的 diff 只含布局：

| 新文件                                | 搬出内容                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `validators.ts`                       | `isValidSelection` / `isValidMatchedRule` / `isValidRulesMessage` 等；`DesignPanel.tsx` **继续 re-export** `isValidRulesMessage`（现有测试从这里 import） |
| `hooks/usePreviewPipeline.ts`         | 预览缓存 LRU、`ensurePreview`、并发队列、`loadPreviewAsset`、`previews`、`activePreview`、`runBlocked`     |
| `hooks/usePreviewBridge.ts`           | `message` 监听、`verifyRef` / `reselectRef`、`selectPath`、`handleFrameLoad`、`overrideWarning`、`runNotice`、`styleRules` |
| `hooks/useStyleSources.ts`            | CSS 草稿表订阅、`cssDocs`、`styleSource` memo、`handleApplyExternal`、`saveStyles`、冲突/确认状态          |
| `hooks/useAgentHandoff.ts`            | 品牌缓存、`recentImports`、`buildContextInput`、`generate` / `handoff` / `prefill`                         |
| `components/DraftDiffModal.tsx`       | 文件末尾的 `DraftDiffModal`                                                                                |
| `DesignPanel.tsx`（组合根，目标 ≤350 行） | `DesignPanel` 外壳（无会话态提示）、`DesignPanelSession`：装配 hooks + 渲染布局                        |

验收：`pnpm --filter @zclaudia/desktop test -- features/design` 全绿，**测试一行不改**；肉眼无变化。

### 3.5 新增文件结构

```
features/design/
  layout/
    tiers.ts                 阈值与类型
    DesignWorkbench.tsx      grid 骨架 + data-tier + 抽屉/底部面板逻辑
    TopBar.tsx               页签 / 视口 / 缩放 / 模式 / 撤销重做 / Save / ⋯
    PageTabs.tsx             (重写) 标签 + `+` 菜单
    ViewportBar.tsx          设备图标 + 宽度输入 + 缩放（含 Fit 切换）
    MoreMenu.tsx             ⋯ 菜单条目装配
    StatusBar.tsx
    NoticeStack.tsx          画布内通知（toast 样式，面板局部）
    CanvasBanner.tsx         阻断型横幅（外部变更 / 文件缺失 / 页面错误）
    CanvasEmptyState.tsx     无页面时的首屏（生成 / 模板入口）
    LeftRail.tsx             图标条 + 面板宿主 + 拖拽改宽
  inspector/
    Inspector.tsx            头部（面包屑）+ 页签 + 滚动体 + 底部吸附槽
    InspectorSection.tsx     可折叠分组（button + aria-expanded，状态进 layout store）
    section-matrix.ts        按元素类型的分组可见性（纯函数）
    collect-operations.ts    从 SelectionEditor 抽出的纯函数
    breadcrumb.ts            由 element-tree 取祖先链
  rail/
    PagesView.tsx  LayersView.tsx  LibraryView.tsx  SlidesView.tsx
    PageThumbnail.tsx        自 PageOverview 抽出（可见性门控）
  agent/
    AgentBar.tsx             画布底部输入条
    ContextPopover.tsx       取代 AgentContextPreview
  hooks/
    useElementTier.ts  useDesignNotices.ts  (+ §3.4 的几个)
```

## 4. 各部分详细设计

### 4.1 顶栏（`layout/TopBar.tsx`）

高度 44px（`h-11`），`border-b border-border`，从左到右：

1. **页签**（`PageTabs`）：`role="tablist"`；标签 = 脏点（`TONE_DOT.warning`）+ basename + 关闭（lucide `X`，hover 才出现，当前页常显）；缺失页用 lucide `TriangleAlert`；溢出时横向滚动。`+` 是 `DropdownMenu`，列出未打开的文件（替代原 `Select`），`limit` 失败的提示沿用 `openFailureMessage`，改用 `NoticeStack`。
2. **视口**（`ViewportBar`）：lucide `Monitor` / `Tablet` / `Smartphone` 三个图标按钮（`aria-pressed`），外加 `Maximize2`（= `fill` 预设）；宽度输入保留原有校验（240–3840 整数，非法回退，Enter/blur 提交，提交即 `custom`）。**只有 `onViewportChange` 的语义不变。**
3. **缩放**：`−` / 百分比 / `+`。百分比按钮：`fit` 模式显示「Fit · 64%」，单击在 fit/manual 间切换，双击回 100%；`fill` 预设下整体禁用（沿用）。
   - **新依赖**：`PreviewCanvas` 增加 `onScaleChange(scale: number)`（在现有 `scale` 计算后用 effect 回报），否则 fit 模式下无法显示真实百分比（`zoom.value` 在 fit 模式是陈旧值）。
4. `spacer`
5. **模式分段** `Edit | Run | Slides`：Edit/Run 沿用 `aria-pressed` + 原 aria-label（`Edit mode` / `Run mode`）。Slides 在 `deckAvailable` 为假时禁用并提示原因；它是**动作**不是模式——P5 前打开 `DeckPanel` Modal，P5 起切到左栏 Slides 页签。
6. **Undo / Redo**：`IconButton`（`Undo2` / `Redo2`），保留原 aria-label。
7. **Save**：`Button variant="primary"`，唯一实心；`!dirty || busy` 禁用。
8. **`⋯`**（`DropdownMenu`，`align="end"`）：

   | 条目                      | 行为                                                         | 备注                                    |
   | ------------------------- | ------------------------------------------------------------ | --------------------------------------- |
   | Export & Share…           | P5 前拆成三条：Export ZIP… / Render PNG/PDF… / Share…         | 需活动页且非 loading                    |
   | Unsaved changes           | 打开 `DraftDiffModal`                                        | 仅 dirty                                |
   | Reload from disk          | `controller.reload()`                                        | 原按钮 `Reload`                         |
   | Refresh file list         | `refreshNow()`                                               | 原 `Refresh design files`               |

   快捷键提示：**当前代码里没有任何设计面板快捷键**，Tooltip 不得谎称 `⌘S` / `⌘Z`。P6 再统一接线（见 §6.6），接线后才在 Tooltip 加快捷键。

窄档与 <360 的收纳：视口、缩放、Undo/Redo 依次进入 `⋯`（菜单里同名条目，保持可达）。

### 4.2 状态条（`layout/StatusBar.tsx`）

高度 26px，`text-[11px] text-muted-foreground`，内容全部是**持续状态**：

- 保存状态：`TONE_DOT.warning` +「Unsaved · View diff」（按钮，打开 `DraftDiffModal`）；干净时「Saved」。
- 活动页 `loading` / `busy` 指示。
- 运行模式：「Run mode: removed N external script(s) and M external link(s)」（取代原运行模式整行横幅，`role="status"`）。
- 右侧：视口标签 + 实际缩放；检查器开关（`PanelRight` 图标）。

版本计数（mockup 里的「v7 · 3 个保存点」）依赖 `VersionHistory` 内部拉取的列表；P1–P4 **不显示**，P6 视需要把版本列表上提为 `useDesignVersions` 再加。

### 4.3 通知模型（取代 6 种整行横幅）

| 原横幅                                   | 新去处                                                                         | 保持的可访问性契约 |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ------------------ |
| Prefilled into the current chat          | `NoticeStack` 瞬时（4s），带「Open chat」动作（聚焦 composer）                 | `role="status"`    |
| `runNotice`（导航被拦截 / Opened x）     | `NoticeStack` 瞬时（5s，沿用）                                                 | `role="status"`    |
| `runFeedback`（Agent 完成：N 页变化）    | `NoticeStack` **常驻**（不自动消失），带变化文件按钮与 `×`                     | `role="status"`    |
| 未保存 → 先保存再交接                    | 不再是横幅：`AgentBar` 内联禁用提示 + 「Save」按钮                             | —                  |
| `externalChange` / `missing` / `error`   | `CanvasBanner`：画布顶部紧贴的细条（阻断/需处理，不自动消失）                  | `status` / `alert` |
| 运行模式说明                             | 状态条（§4.2）+ 检查器的 Run 占位说明                                          | `role="status"`    |

`useDesignNotices()`：`push({ id, tone, text, actions?, ttl? })`，同 id 去重刷新；返回当前列表与 `dismiss`。组件局部（不进全局 `toastStore`——这些提示带面板内动作且测试按面板作用域查询）。`runFeedback` 不 push，直接由 `useAgentRunFeedback` 状态派生渲染，避免双源。

### 4.4 画布区

- `PreviewCanvas` 保持唯一实例；背景用 `bg-sidebar`（对比 `bg-background` 的页面卡片），页面区域加 `shadow-apple-md`——视觉由外层容器决定，组件本身只加 `onScaleChange` 与 `emptyState` 插槽。
- **空态**（`pages.length === 0` 且文件清单为空）：`CanvasEmptyState`——「Describe a page and let the Agent build it」+ 「Start from template」。有文件但尚无打开页时仍走现有自动打开逻辑。
- 运行模式：整个检查器与 Agent 条隐藏（沿用「只读体验」），检查器区域显示一句运行模式说明；窄档底部面板同样收起。
- 总览（网格）模式：保留 `overviewOpen`，改由 Pages 面板头部「Grid」开关控制，仍替换画布区内容（`PageOverview` 不变），但 `PreviewCanvas` **不卸载**——用 `hidden` 隐藏，避免 iframe 重载。

### 4.5 右侧检查器

**头部**：面包屑（`body › main.hero › h1.hero-title`，`font-mono` 属「路径」例外，符合约定 §2）；每一段可点（`selectPath(prefix)`）；右侧保留 Parent 按钮，Child 保留在 Design 页签的结构分组旁。祖先链由 `breadcrumb.ts` 基于 `buildElementTree`（`element-tree.ts`）生成——**新增纯函数 `ancestorsOf(source, path)`，不改 `buildElementTree` 现有输出**。无选区时头部为「Inspector」。

**页签**：Design / Styles / History。History 页签带「有未保存修改」的 `TONE_DOT.warning` 小点。

**Design 页签**（`SelectionEditor` 重排，逻辑保持）：

1. 从 759 行里抽出 `collect-operations.ts`：把现有 `collectOperations`（含 `safeStyleValue` / `safeAttrValue` 预检、颜色宽松规则）改成纯函数 `collectOperations(values, selection, computedStyles): { operations, invalid }`，组件内只负责 setState。**行为逐条与原实现一致**，先补特征测试（见 §7）再搬。
2. 分组（`InspectorSection`，默认展开项见下），顺序固定：

   | 分组 id          | 内容                                  | 默认 | 可见条件（`section-matrix.ts`）                           |
   | ---------------- | ------------------------------------- | ---- | --------------------------------------------------------- |
   | `text`           | Element text                          | 展开 | 非 void 元素（`img`/`br`/`hr`/`input` 等不显示）          |
   | `link`           | Link URL（+ 清除）                    | 展开 | `tagName === 'a'`                                         |
   | `image`          | Image URL、选择/生成、Alt、`object-fit` | 展开 | `tagName === 'img'`                                       |
   | `typography`     | 字体/字号/行高/字重/字距/对齐         | 展开 | 含文本的元素；`img` 隐藏                                  |
   | `fill-border`    | 文字色、背景色、圆角、边框三件套      | 折叠 | 总是（文字色对 `img` 隐藏）                               |
   | `size-spacing`   | 宽高、padding、margin                 | 折叠 | 总是                                                      |
   | `structure`      | Copy / Delete / Move up / Move down   | 折叠 | 总是（原有禁用规则不变）                                  |

   「可见条件」是**唯一新增的行为差异**（原先所有分组恒显）。条件只用于隐藏明显无意义的分组，隐藏不影响 `collectOperations` 能提交的字段集合。
3. **吸底应用条**（`position: sticky; bottom: 0`，在检查器滚动体内）：仅当存在待提交修改时出现——「N pending changes · Discard · **Apply changes**」。
   - 保留批量应用模型（`Apply changes` 一次提交全部字段，一次一条撤销记录），**不**改为逐字段即时应用——后者会改变撤销粒度与 `mergeKey` 语义，另立决策（§9 Q1）。
   - pending 数量 = 对当前表单跑一次纯函数 `collectOperations`（不写 invalid 状态）。`Discard` = 重置为选区初始值（已有 `useEffect([selection])` 的重置逻辑复用）。
   - 保留 `Apply changes` 的 aria-label（e2e 与 25 处测试依赖）。
4. `View source` 与 `Selected element` 标题移入头部 / 结构分组；`overrideWarning`、`INVALID_PREFIX` 错误、`LOCATE_ERROR`、`LINE_OFFSET_HINT` 仍显示在检查器内（吸底条上方），不进入全局通知。
5. 无选区空态：说明文案（原 `Selected element` 空态）+ 页面信息（文件、依赖数）+ 两个入口（让 Agent 生成 / 从模板开始，二者都是 ghost/outline，遵守一行一强调）。

**Styles 页签**：渲染 `StyleSourcePanel`，仅调整容器内边距；`Save styles` 保持在它自己的头部（同样是 ghost，不是实心）。冲突横幅与 Reload 确认框逻辑不动。

**History 页签**：顶行「Unsaved changes」（dirty 时，点击打开 `DraftDiffModal`）+ `VersionHistory` 现有内容；去掉 `DesignPanel` 底部的折叠条。

### 4.6 左栏（`layout/LeftRail.tsx`）

- 40px 图标条（`IconButton`，`aria-pressed`；Pages `FileText`、Layers `ListTree`、Library `Library`；deck 页多一个 Slides `Presentation`）常驻；点击当前项折叠面板；面板宽 `leftWidth`，右缘可拖拽（200–420，`pointer` 事件实现，不复用 `ResizeDivider`——那个绑定工作区几何）。
- **Pages**：已打开页缩略图列表（`PageThumbnail`：只在行进入视口时才挂 iframe，复用现有 `ensurePreview` 并发≤2 的队列；非可见时显示灰块），脏点 / Missing 徽标；行 `⋯`：Open in viewer / Close。下方「Not open」分组列出未打开文件（取代 Open page 下拉）。头部：`+`（模板入口）、Grid 开关。
- **Layers**：`ElementTree` 去掉 `max-h-56`，`TREE_HELP` 文案改为头部 info `Tooltip`。选中行高亮沿用。
- **Library**：顶部 `Assets | Templates | Brand | Media` 分段控件（`libraryTab`）。
  - Assets / Templates：完整内嵌（浏览/挑选类任务正适合和画布并排）。
  - Brand / Media：表单型，**P4c 已内嵌**；面板内顶部是一行安静的工具动作「Expand」（把 `leftWidth` 抬到至少 320，不缩小已更宽的面板）与「Open in dialog」（走原 Modal 薄壳，作为兜底）。`⋯` 菜单的 Brand / Media 与 Library 页签都进入内嵌视图，只有工具行动作打开对话框；对话框打开期间对应内嵌视图停用（不轮询、不重复请求），关闭后恢复。
- 窄/中档：面板作为覆盖在画布上的抽屉（`z-dropdown` 层级，`Esc`/点击画布关闭，焦点返回触发按钮）。

### 4.7 Agent 输入条（`agent/AgentBar.tsx`）

- 位置：画布底部居中浮动（窄档贴底、宽度 100%−20px）。浮动会盖住页面底部一小块——可在 `PreviewCanvas` 底部加 `pb-20` 的滚动余量，保证页面最后一屏能滚到条上方。
- 组成：选区 chip（`tag.class`，无选区为「Page」）｜输入框｜`Context` 按钮（打开 popover）｜发送 `IconButton`/primary 小按钮。**条内的 primary 与顶栏 Save 不在同一「控制行」**，按约定各自一个。
- 任务判定：有选区且页面干净 → `modify`；无选区 → `generate`；`dirty` → 输入禁用并内联提示「Save first to hand off」+ 就地 Save 按钮（沿用原 `Generate page` / `Hand off` 的 dirty 禁用规则）；运行模式 → 整条隐藏。
- 发送：`buildDesignAgentContext(input, task, { request })` → `prefill(prompt)` → `NoticeStack`「已预填到当前聊天」。**仍然预填、不自动发送**（沿用 P4 的发送前可见原则；是否改成直接发送见 §9 Q2）。空输入允许发送（等价原 Generate page 的默认提示词）。
- `agent-context.ts` 只增加可选的第三参数 `{ request?: string }`，缺省时输出与现有快照**逐字节相同**（`agent-context.test.ts.snap` 不改）；有值时在 prompt 末尾追加 `## Request` 段。
- `ContextPopover`：复用 `AgentContextPreview` 里的 sections 渲染（抽成 `ContextSections`），锚定在条上方；`AgentContextPreview` Modal 在 P3 末删除并迁移其测试。
- e2e 契约：原 `Generate page` / `Hand off to Agent` 两个按钮消失，e2e 改为聚焦 `Ask Agent` 输入、点 `Send to chat`（见 §7.3）。

### 4.8 对话框归并（P5）

1. **Export & Share**：每个现有对话框拆成「内容 + 动作」两部分——`ExportDialogContent`、`RenderExportContent`、`ShareContent`，各自保留现有全部状态机（导出进度、取消、`EXPORT_INCOMPLETE` 确认、分享创建/撤销）；`ExportShareDialog` 只是 Modal + 三页签 + 把各自的 footer 动作放进页签内。原三个对话框文件保留为薄壳直到测试迁移完。
   - 风险：`RenderExportDialog` 有长任务与取消，不能因切页签卸载进行中的任务 → 三页签内容**同时挂载**，非当前页签 `hidden`。
2. **Slides**：`DeckPanel` 的内容搬进左栏 `SlidesView`；`DeckPresenter` 全屏播放器不变。
3. 其余 Modal（保存前关闭、Reload 样式文件、`DraftDiffModal`）保持——它们是真正需要确认/聚焦的对话。

## 5. 分阶段交付

每阶段独立可发布，都要通过 `pnpm --filter @zclaudia/desktop test`（design 相关）、`lint`、`check:radius`、typecheck。规模用 S/M/L，不承诺工期。

### P0 拆分 `DesignPanel`（S–M，无视觉变化）

- [x] 按 §3.4 抽出 `validators.ts`、四个 hook、`DraftDiffModal`；`DesignPanel.tsx` 保留 `isValidRulesMessage` 的 re-export。
- [x] 现有测试**零修改**全绿；手动对比前后行为一致（预览缓存、选区回环、CSS 草稿、运行模式）。

### P1 新外壳（M）——**检查点 A：能看到新布局**

- [x] `useElementTier`、`designLayoutStore`、`layout/*`（`DesignWorkbench`、`TopBar`、`PageTabs`、`ViewportBar`、`MoreMenu`、`StatusBar`、`NoticeStack`、`CanvasBanner`）。
- [x] `PreviewCanvas.onScaleChange`；画布 `pb` 余量。
- [x] 右栏先**原样承载**现有组件：Design 页签 = 现 `SelectionEditor`，Styles = `StyleSourcePanel`，History = `VersionHistory`；`ElementTree` 挂在左栏 Layers；Library 相关入口放进 `⋯` 菜单与左栏 Library 视图，仍弹原 Modal。
- [x] 删除 `DesignToolbar`、`ViewportControls`、旧 `PageTabs`；整行横幅按 §4.3 迁移。
- [x] 三档布局与「画布不重挂载」不变量的测试（§7.2）。
- 验收：宽/中/窄三档截图与 mockup 结构一致；iframe 在切页签、开合左栏/检查器、切档位时不触发 `load`；所有原功能仍可达（经菜单）。

### P2 检查器重做（M）

- [x] 抽 `collect-operations.ts` + 特征测试先行；`section-matrix.ts`；`InspectorSection`；面包屑 `ancestorsOf`。
- [x] `SelectionEditor` 重排为分组 + 吸底应用条；空态；History 页签顶行；折叠状态入 layout store。
- 验收：`SelectionEditor.test.tsx` 中字段/校验/应用断言全部通过（仅改动与布局相关的查询）；对每种元素类型（`h1`/`p`/`a`/`img`/`div`/`button`）断言分组可见性；吸底条仅在有待提交修改时出现。

### P3 Agent 输入条（S–M）——**检查点 B：mockup 主体可见**

- [x] `agent-context.ts` 增加 `request`；`AgentBar`、`ContextPopover`、`ContextSections`；迁移 `AgentContextPreview.test.tsx`。
- [x] 顶栏/菜单移除 Generate page / Hand off；e2e 同步。
- 验收：generate / modify 两条路径产出的 prompt 与改动前一致（无 request 时快照不变）；dirty 时禁用并可就地保存；预填后聊天输入框内容正确；运行模式隐藏。

### P4 左栏（L）

- [x] 4a：`LeftRail`（图标条、拖拽改宽、抽屉）、`PagesView` + `PageThumbnail`、`LayersView`，移除 Design 页签里的临时 `ElementTree` 与 Open page 菜单。
- [x] 4b：`LibraryView` 的 Assets / Templates（抽 `AssetLibraryView` / `TemplateView`，Modal 变薄壳）。
- [x] 4c：Brand / Media 内嵌（含 Expand / Open in dialog 兜底）。`BrandView` / `MediaGenView` 承载原完整状态机，`BrandPanel` / `MediaGenPanel` 变薄壳；生成/刷新动作移入视图内部。Brand 内嵌仅首次激活或 backend/session 变化时加载，切页签/收起左栏/打开对话框都保留未保存草稿且不重拉；Media 内嵌 `active=false` 时渲染 null 并暂停 `useMediaTasks` 轮询与服务/素材/缩略图请求。恰好一个媒体表面活动（内嵌与对话框互斥）。240px 栏下的紧凑布局：品牌色/字段网格、Logo 堆叠选择、媒体类型短标签、服务/尺寸纵向堆叠、视频参数两列网格、任务结果动作换行。
- 验收：缩略图仅在可见时挂 iframe，同时构建上限仍为 2；Templates 安装后自动切到 Pages 并打开入口页；窄/中档抽屉的焦点与 Esc 行为正确。

### P5 对话框归并与 Slides（M）

- [ ] 5a：`ExportShareDialog`（三页签同时挂载）+ 三个 Content 抽取；5b：`SlidesView`。
- 验收：导出/渲染/分享各自原有测试迁移后通过；渲染导出进行中切换页签不中断。

### P6 收尾（S–M）

- [x] 可访问性与键盘：面板内 `⌘S` / `⌘Z` / `⇧⌘Z`（作用域限定为焦点在面板内；iframe 内按键不冒泡，**不**为此改桥接协议——若需要再另立项）；接线后才给 Tooltip 加快捷键。
- [ ] 版本计数上提（可选）。
- [x] 更新 `docs/design-workbench.md` 的「使用」章节与 `docs/ui-conventions.md`（如新增 `InspectorSection` 作为分组原语的说明）。
- [ ] 用 mockup 做逐屏对照走查（宽/窄/暗色）；`check:radius`、`lint`、`gen:tokens:check`。

## 6. 关键技术决策与理由

1. **JS 档位 + 固定 DOM 结构**：见 §3.1/3.2。容器查询无法表达抽屉与底部面板的交互；条件渲染会重挂载 iframe。
2. **保留批量 Apply**：检查器的吸底应用条只是把原按钮挪位并加 pending 提示，撤销/mergeKey 语义零变化。
3. **通知局部化**：不借用全局 `toastStore`——那套是应用级、固定位置、无面板作用域，且现有测试按面板内 `role="status"` 断言。
4. **Library 表单型视图的取舍**（§4.6）：Brand / Media 在 224–240px 内会局促；给「Expand」与 Modal 兜底，而不是为了和 mockup 一致硬塞。
5. **Slides 是动作而非模式**（§4.1）：它不改变画布/检查器的行为，做成分段里的第三个互斥模式会引入新的状态；用分段样式只是视觉对齐 mockup。
6. **颜色与图标合规**：lucide（`strokeWidth={1.75}`）、`Tooltip` 取代 `title=`、`TONE_DOT` 取代手写色、页签选中态用 `bg-secondary` 取代 `border-primary/40 bg-primary/10`；顶栏只有 Save 为实心。

## 7. 测试迁移

### 7.1 受影响面

- `__tests__/DesignPanel.test.tsx`（2396 行，约 217 处 role/label 查询）：工具栏按钮改为经 `⋯` 菜单或左栏进入。新增测试 helper `__tests__/helpers/design-ui.ts`：`openMoreMenu(name)`、`openLeftTab(name)`、`setTier('wide'|'medium'|'narrow')`（stub `ResizeObserver`），避免各用例重复。
- 保持可访问名称稳定以缩小改动：`Save`、`Undo`、`Redo`、`Edit mode`、`Run mode`、`Apply changes`、`Save styles`、`Version history` 不改名；改名/改入口的：`Export` / `Share` / `Render export` / `Slides` / `Reload` / `Refresh design files`（进菜单）、`Templates` / `Brand` / `Assets` / `Media`（进 Library）、`Generate page` / `Hand off to Agent`（并入 Agent 条）、`Structure` / `Overview`（并入 Layers / Pages）、`Unsaved changes`（状态条与菜单）。
- 组件测试：`ViewportControls.test.tsx`、`PageTabs.test.tsx`、`PageOverview.test.tsx`、`ElementTree.test.tsx`、`AgentContextPreview.test.tsx` 随组件迁移/重写；`TemplateDialog` / `AssetLibrary` / `BrandPanel` / `MediaGenPanel` / `Export*` / `SharePanel` 的内容逻辑测试保留，仅在抽出 Content 后改挂载方式。

### 7.2 新增测试

- `useElementTier`：阈值边界（959/960、639/640、359/360），宽度 0 → `wide`。
- `DesignWorkbench`：三档下关键节点可达；**切档/开合/切页签时 iframe 节点身份不变且不触发 `onLoad`**（对节点引用与 load 回调计数断言）。
- `TopBar`/`MoreMenu`：dirty/busy/loading 门控、<360 收纳后条目仍可达、Slides 禁用原因。
- `ViewportBar`：宽度校验矩阵沿用原用例；Fit 百分比显示依赖 `onScaleChange`。
- `collect-operations`：与迁移前逐字段等价的特征测试（颜色宽松规则、非法字段整单拒绝、attribute 白名单）。
- `section-matrix`：元素类型 × 分组可见性表。
- `Inspector`：pending 计数、Discard 复位、吸底条出现/消失、空态、折叠状态持久化（store）。
- `AgentBar`：任务判定矩阵（无选区/有选区/dirty/运行模式）、有无 `request` 的 prompt、预填通知。
- `agent-context`：无 `request` 时快照不变（现有快照文件不改）。
- `PagesView`：缩略图可见性门控与并发上限；未打开文件打开路径与 limit 提示。

### 7.3 e2e

`e2e/tests/agent-runtimes/design.playwright.spec.ts` 需改：`Generate page` / `Hand off to Agent` → Agent 条的输入与发送；`Reload` → `⋯` 菜单 `Reload from disk`；`There are unsaved changes` 横幅断言 → 状态条「Unsaved」；`Your draft is preserved`（画布横幅）、`Apply changes`、`Save` 断言不变。这些改动**随 P3 一起提交**，不留红的 e2e。

## 8. 风险与缓解

| 风险                                                       | 缓解                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| iframe 因布局变化重挂载，丢选区、重建桥接                  | §3.1 不变量 + 节点身份测试；总览用 `hidden` 而非卸载                                         |
| 缩略图 iframe 数量与脚本执行成本                           | 可见性门控；仍走静态预览构建（无脚本）；沿用并发≤2 与 LRU≤8 的缓存上限                       |
| 吸底条/折叠让表单状态丢失                                  | 折叠不卸载；选区变化才重置（沿用既有 effect）                                                |
| 2396 行测试大面积改动、易引入遗漏                          | P0 先零改动拆分；P1 起引入 helper；每个阶段只改该阶段触及的入口                              |
| 窄档（240px 工具最小宽）可用性                             | <360 档位专门定义；以 240/320/460 三个宽度做手动走查                                         |
| 范围蔓延（一次想做完 mockup 全部）                         | 严格按阶段交付；检查点 A/B 后再决定 P4/P5 的取舍（尤其 Brand/Media 内嵌）                    |

## 9. 待你确认的决策

| #  | 问题                                                                 | 默认（若不回复按此做）                                           |
| -- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Q1 | 检查器仍用「批量 Apply changes」，还是改成每个字段回车/失焦即应用？   | 保留批量 Apply（吸底条）；即时应用另立项，因为会改撤销粒度       |
| Q2 | Agent 条发送后：继续「预填到聊天、你再点发送」，还是直接发送？        | 继续预填（保留发送前可检查的安全语义）                           |
| Q3 | Brand / Media 是否一定要内嵌左栏？                                    | 先内嵌 + 提供 Expand 与 Open in dialog 兜底，看实际手感再定      |
| Q4 | Export & Share 合并是否值得本轮做（P5）？                             | 做，但排在 P1–P4 之后；之前三项都在 `⋯` 菜单里可达               |
| Q5 | 左栏默认展开还是收起？                                                | 宽档展开 Pages；中/窄档收起                                      |

## 10. 建议的推进方式

1. 先做 **P0 + P1**，交付检查点 A：你能直接看到新的外壳（顶栏、三栏骨架、状态条、通知），右栏里先装着旧组件。
2. 接着 **P2 + P3**，交付检查点 B：检查器和 Agent 输入条到位，此时画面与 mockup 基本一致。
3. 看过效果后再决定 P4（左栏）与 P5（对话框归并）的细节取舍。
