# 右栏架构重设计：Session-Scoped Workspace

**日期**: 2026-06-25
**范围**: 桌面端右栏（`apps/desktop/`）。移动端 BottomPanel 不在本次范围内。

## 背景与动机

右栏新增了「不同 tab 拆分」功能，但实测基本不可用。根因不是这个功能本身，而是右栏底子：**「右栏里显示什么」由三套互相独立、互不同步的真相源描述**，split 只是叠加上去的第三套，于是它们必然漂移。

### 当前的三套真相源

1. **面板可见性模型（旧）** — [pluginStore.panels](../../../apps/desktop/src/stores/pluginStore.ts) 里每个 panel 一个全局 `visible` 布尔 + `panelPlacements`。[usePanelRegion](../../../apps/desktop/src/components/panels/usePanelRegion.ts) 从这里推导 `visiblePanels`。这是"右栏 = 一列 tab"的老模型。
2. **Split 布局树（新）** — [splitLayoutStore.root](../../../apps/desktop/src/stores/splitLayoutStore.ts) 一棵二叉树，只在第一次被 `effectiveTab` 种下，之后两套各走各的。
3. **Pinned tools（第三套）** — [sessionToolsStore](../../../apps/desktop/src/stores/sessionToolsStore.ts) 把工具发布成带 `onClick` 的图标按钮，完全绕过前两套。

### 由不同步直接导致的"基本不可用"现象

- **新打开的面板在 split 模式下消失**：[RightSidebar](../../../apps/desktop/src/components/RightSidebar.tsx) 渲染时一旦 `isSplitLayout` 为真就只渲染树，完全无视 `visiblePanels`。已拆分后再打开文件 → file-viewer 变 `visible=true` 但树里没有它 → 看不到。
- **关 pane ≠ 关面板**：`closePane` 不会把 `panel.visible` 置回 false，反之亦然。
- **有 pinned tools 时根本无法发起拆分**：拖拽手柄长在 panel tab 上，但 `hasPinned` 时 header 显示的是图标按钮而非 tab，拖拽入口直接没了。
- **布局全局、面板按 session**：`splitLayoutStore` 是单一全局持久化，不按 session 分。切 session 后树还在，但里面 file/draft/changes 的语义全变。
- **"激活"有两套**：`rightSidebarStore.activeTab`（全局单值）与树里的 `focusedPaneId` 并存，含义冲突。

## 目标

把三套真相源塌缩成一套：**按 session 分键的布局树成为右栏唯一真相源**，面板退化为纯工具定义。一条渲染路径，可拆分/可调整大小，并为未来的 pane 内多 tab 预留结构。

## 设计决定（已与用户确认）

1. **布局按 session 绑定** —— 每个会话记住自己的右栏布局，切 session 时布局跟随。
2. **单工具一个 pane，数据模型预留 tab 组** —— pane 现在恒装一个工具，但结构能容纳"pane 内多 tab"，将来加 tab 不重建。
3. **"主 pane"复用** —— file/diff/draft 等瞬态工具在主 pane 里替换显示；用户手动拆出来的 pane 不被劫持。
4. **统一为单一真相源** —— 树即真相，面板退化为工具注册表（方向 A）。
5. **openMode 默认 + 可覆盖** —— 每工具有 `shared`/`dedicated` 默认落点，但调用点可用 `target` 按次覆盖，手动拖拽也能越过。
6. **加工具入口** —— 右栏头部一个 `+` 选择器（复用 launcher 列表）。

## 架构

### 新 store：`rightWorkspaceStore`（按 sessionId 分键）

```ts
type ToolRef = {
  toolId: string; // 对应注册表里的 Tool.id（即原来的 panel.id）
  instanceKey?: string; // 通用"按 scope 实例"键（终端：`${backendId}::${projectId}`）
};

type PaneNode = {
  id: string;
  kind: 'pane';
  tools: ToolRef[]; // tab-ready：现阶段恒为 1 项
  activeToolId: string; // 当前激活 tab；现阶段 == tools[0].toolId
};

type GroupNode = {
  id: string;
  kind: 'group';
  dir: 'row' | 'col';
  ratio: number; // 第一个子节点占比，clamp [0.1, 0.9]
  children: [LayoutNode, LayoutNode]; // 二叉
};

type LayoutNode = PaneNode | GroupNode;

type SessionWorkspace = {
  root: LayoutNode | null; // null = 空 → 显示 launcher
  primaryPaneId: string | null; // openTool 的默认落点
  focusedPaneId: string | null;
};

interface RightWorkspaceState {
  bySession: Record<string, SessionWorkspace>;
  openTool(sessionId: string, toolId: string, opts?: OpenToolOpts): void;
  closePane(sessionId: string, paneId: string): void;
  closeTool(sessionId: string, paneId: string, toolId: string): void; // tab-ready
  splitPane(sessionId, fromPaneId, dir, toolId, instanceKey?): SplitResult;
  replaceTool(sessionId, paneId, toolId, instanceKey?): SplitResult; // center-drop
  setRatio(sessionId, groupId, ratio): void;
  focusPane(sessionId, paneId): void;
  resetSession(sessionId): void;
}

type OpenToolOpts = {
  instanceKey?: string;
  target?: 'primary' | 'focused' | 'new-split'; // 覆盖工具默认 openMode
};
```

布局树的算法（split / removePane 折叠到兄弟 / setRatio / 安全校验）直接**移植现有 [splitLayoutStore](../../../apps/desktop/src/stores/splitLayoutStore.ts) 的纯函数**（`pathTo` / `findPane` / `replaceChild` / `removePane` / `setRatioAt` / `isSafeTree`），只是搬进按 session 的容器。这些逻辑已被现有测试覆盖，是可信的。

### `pluginStore.panels` 降级为工具注册表（Tool）

每个工具只保留**定义**，不再持有 `visible` 这种运行时状态：

```ts
type Tool = {
  id: string;
  label: string;
  icon?: string;
  component?: unknown; // builtin 组件（同现 UIExtension）
  iframeUrl?: string; // 第三方 iframe 工具
  actions?: unknown; // tab/pane 级动作按钮
  openMode: 'shared' | 'dedicated'; // 默认落点；可被 OpenToolOpts.target 覆盖
  multiInstance?: boolean; // 终端 = true，其余单例
  scopeKey?: (ctx) => string; // multiInstance 工具如何算 instanceKey
  alwaysMount?: boolean; // 隐藏时仍保留 DOM（终端 xterm）
  platforms?: ('desktop' | 'mobile')[];
};
```

`openMode` 含义（对决定 3 的一般化）：

- **`shared`**（file-viewer / draft / session-changes / memory）→ 落**主 pane**，替换激活工具。
- **`dedicated`**（terminal / notifications / lineage）→ **自己独占一个 pane**；已存在则聚焦不重复 → 永不被开文件劫持，且不依赖用户记得先手动拆分。

`openMode` 与 `target` 的关系（三层语义，互斥只在第一层）：

1. **作为工具默认值**：单选，一个工具要么 shared 要么 dedicated。
2. **作为运行时能力：不互斥**。shared 工具照样能被手动拖拽拆进独立 pane；dedicated 工具在 workspace 为空时自己就是主 pane；调用点可用 `target` 按次覆盖。
3. **pane 不存 mode**：pane 只装 `ToolRef`；mode 只在"打开那一刻"被读一次用于路由。

> **边界**：本次只动桌面端右栏。移动端 BottomPanel 仍走现有 `panel.visible` 模型（注册表是共享的，右栏 workspace 不再用 visible）。控制爆炸半径。

## 行为

### `openTool(sessionId, toolId, opts?)` 决策顺序

1. **算实例键**：`multiInstance` 工具用 `tool.scopeKey(ctx)` 或 `opts.instanceKey`；单例无键。
2. **查重**：树里已有匹配（单例比 `toolId`；多实例比 `toolId + instanceKey`）→ **聚焦该 pane、设其 `activeToolId`，不重复创建**，结束。
3. **定落点** = `opts.target ?? (tool.openMode === 'shared' ? 'primary' : 'new-split')`：
   - **workspace 为空**（root null）：建单 pane 装该工具，标记为 primary + focused。（shared / dedicated 都从这里起步。）
   - **`primary`**：替换主 pane 的激活工具；聚焦主 pane。（主 pane 缺失则回退建新。）
   - **`new-split`（dedicated）**：从主 pane（或 focused pane）拆出**新 pane**（非 primary），聚焦它。
   - **`focused`**：替换当前 focused pane 的激活工具。

### 关闭 / 拆分 / 替换

- **`closePane`**：`removePane` + 祖先 group 折叠到兄弟。若关掉的是 primary → 重指给树内第一个剩余 pane；若是 focused → 同理重指；树空 → 三者皆 null（→ launcher）。
- **`closeTool`**（tab-ready）：从 `pane.tools` 移除；pane 空 → `closePane`。现阶段单工具下 `closeTool` 等价 `closePane`。
- **`splitPane`**：单例冲突检查 —— **冲突时聚焦已存在的 pane，而非现状的"拒绝"**。新 pane 作为第二个子节点插入，非 primary，focused。
- **`replaceTool`**（center-drop）：交换某 pane 的激活工具，含冲突检查。

### 会话切换

- 所有 action 显式收 `sessionId`。右栏组件读 `bySession[currentSessionId]`（`currentSessionId` 来自现有的活动会话 store）。
- 切 session = 换 key 读，布局**自动跟随**。
- 新 session 无记录 → 空 workspace → launcher。

## 渲染（单一路径）

- **`RightSidebar`**：只剩外壳（宽度拖拽 + 折叠 + 头部 `+` 工具选择器），渲染 `<WorkspaceView sessionId={currentSessionId}>`。**删除** `hasPinned` / `showTabs` / 叠加层那整套分支。
- **`WorkspaceView`**：root 为 null → `RightSidebarEmptyState`（launcher）；否则递归渲染树（移植 [SplitLayoutView](../../../apps/desktop/src/components/split/SplitLayoutView.tsx)）。**单 pane = 单节点树，走同一条路径**（不再有"单面板叠加层 vs 树"双路径）。`ResizeObserver` 供 ratio 计算。
- **`PaneView`**：头部（激活工具名 + actions + 关闭）+ 内容（移植 PanelContent）。**拖拽手柄改挂在 pane 头部**，任何情况都能发起拆分 —— 根治"有 pinned tools 时拖不动"。`DropOverlay` 按 pane 渲染。
- **Launcher**（空状态 + 头部 `+` 弹层共用）：列出注册表工具为 tiles，点击 → `openTool`。
- **`sessionToolsStore` 删除**。composer 上现有的快捷工具按钮保留，但改成直接调 `openTool`（等于预设落点的 openTool 快捷方式）。徽标/badge 由各工具自身状态订阅提供，不再经 sessionToolsStore 中转。

## 持久化与生命周期

- 按 sessionId 存 localStorage，**有界 LRU**（默认最近 50 个 session），超出淘汰最旧；session 被删 → 删对应条目。防止无限增长。
- 旧的全局 `claudia-split-layout` 持久化**直接丢弃**（全局、无法映射到 session、仅 UI 布局、代价低）。
- `rightSidebarStore` 保留 `widthFraction` / `collapsed`（真·全局 UI 偏好），**删 `activeTab`**（并入 per-session `focusedPaneId`）；版本号 +1 + 迁移。
- `pluginStore`：`panels` 留作注册表；右栏不再读写 `panel.visible`（移动端仍用）。

## 测试策略

- **树算法单测**：split / 折叠到兄弟 / setRatio / `isSafeTree`（移植现有用例）。
- **openTool 落点单测**：primary 复用 / dedicated 独占 / 单例聚焦不重复 / 多实例按 instanceKey 区分 / `target` 覆盖。
- **会话隔离单测**：session A 开的工具不影响 session B；切换后各自布局独立。
- **LRU 淘汰单测**：超过上限淘汰最旧、删 session 清条目。
- **渲染三态**：单 pane / 拆分 / 空 launcher。

## 分阶段交付

1. **阶段 1**：建 `rightWorkspaceStore` + `WorkspaceView` 单 pane 渲染路径，把所有右栏 `panel.visible` 调用点迁移到 `openTool/closePane`，达到与现状平价 → 删除 `splitLayoutStore`、`sessionToolsStore`、旧双路径分支。
2. **阶段 2**：在干净底座上重做 split + 拖拽（移植 dragSplit / ResizeDivider / DropOverlay，手柄挂 pane 头部）。
3. **阶段 3**：pane 内多 tab 组（`tools[]` 长度 > 1，pane 头部出 tab 条）。

## 未来扩展（YAGNI，本次不做）

- pane 内 tab 组（阶段 3 已规划，结构已预留）。
- 每项目/每会话的默认布局模板（新 session 自动种一个布局）。
- 工具间的链接联动（如 diff 跳到 file-viewer）。
