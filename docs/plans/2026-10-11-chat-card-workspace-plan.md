# 聊天卡片化与统一 Pane 编排 实施计划

> 视觉参考：[docs/mockups/chat-card.html](../mockups/chat-card.html)（变体 B + 布局画廊）。步骤用 `- [ ]` 跟踪。

**Goal:** 把中间的聊天区做成和左栏、右栏同一类的卡片（S1），再让聊天成为右栏 workspace 树里的一个钉住的 pane，可以拖到任意位置、最大化（S2），最后支持多个聊天并排和命名布局预设（S3、S4）。

**Architecture:** 一个共享的 `PaneCard` 外壳同时承载右栏 pane 和聊天。聊天以 `toolId: 'chat'` 的叶子进入现有的二叉 workspace 树，沿用拆分、比例和持久化。存储格式迁移与开关启用时的树归一化分开；移动采用原子动作；pane 平铺挂载，树只负责几何布局。"右栏折叠"只改变非聊天叶子的可见性和几何布局。

**Tech Stack:** React、Zustand（persist）、Tailwind、Vitest。命令（在仓库根）：

```bash
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config=vitest.ui.config.ts <files>   # UI 测试
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config=vitest.unit.config.ts <files> # store / 几何测试
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit         # 类型
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop run lint                  # eslint + lifecycle + radius
```

---

## 已定决策

1. **变体 B**（2026-10-11）：header、transcript、composer 和选择器行同在一张卡里。
2. **长期方向**：中间聊天与右栏工具是同一类 pane，可自由编排；不是只做一层皮肤。
3. **阶段**：S1 视觉卡片 → S2 聊天进树（钉住）→ S3 多聊天 → S4 预设。每个阶段独立可发布，后一阶段不推翻前一阶段。
4. **助手消息在卡片内用 Flat**（去掉 `bg-card` 气泡，仅用户消息有框）。mockup 里的 Tinted 方案作为备选，不实现。
5. **卡片圆角跟代码走**（`rounded-lg`，同 `PaneView`），不用 mockup 里的 16px。
6. **移动端不动**：所有改动仅限桌面（`!isMobile`）。
7. **S2 稳定挂载是前置约束**：在统一 workspace 内，移动、折叠、最大化和还原都不能卸载仍存在的聊天 / 工具实例。先完成平铺宿主，再接入交互，不再把是否保持挂载留到实测后决定。

## 核实结论（决定改法）

- **三栏没有统一容器。** `App.tsx:514` 是 flex 行，放 `Sidebar` 和 `<main>`；聊天与右栏是 `SessionChatLayout.tsx:107`（`bg-background`）里的兄弟节点。左栏边槽是 `Sidebar.tsx:633` 的 `p-1.5`，右栏是 `WorkspaceView.tsx:91` 的 `p-2`。
- **右栏 tray 已删。** `8f91059e` 去掉了 `bg-[hsl(var(--sidebar))]`，`RightSidebar.test.tsx` 断言根节点无 `bg-` 类。聊天卡片直接坐在 `--background` 上，卡片对画布只有 +2 色阶（亮色），靠 `border-border/50` 加 `shadow-sm` 撑，和现在右栏卡片一样。
- **卡片外壳只在 `PaneView.tsx:82-84`。** `flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden rounded-lg border bg-card`，聚焦 `border-muted-foreground/30 shadow-md`，否则 `border-border/50 shadow-sm`。`RightSidebar.tsx:262-269` 的空态卡片手抄了一份。
- **聊天里写死背景的位置：**
  - `ChatInterface.tsx:505` 根 `bg-background`。
  - `SessionHeader.tsx:161` `bg-background`，`:536` 未读点 `ring-background`。
  - `MessageList.tsx:649`、`:846`、`:907` 助手气泡 `bg-card`（进卡片会白底白卡）；`:904` 用户气泡 `bg-muted/60 shadow-apple-sm`。
  - 其他 `bg-card`：`FilePushNotification.tsx:66`、`InlinePermissionRequest.tsx:205`。
- **聊天不能直接当 pane。** `PaneView.tsx:48-72` 用 `activeToolRef(pane)` 去 `usePluginStore.panels` 里找面板，找不到渲染 "Unavailable panel"；`PanelContent` 不传 `sessionId`；`root: null` 表示空；store 里没有"钉住"概念。**`alwaysMount` 帮不上忙**：它只是终端 xterm 的可见性开关（`builtinPanels.ts:47`，`UIExtension.visible`），不是通用的"始终挂载"。
- **不能把聊天注册成 builtin panel。** Settings → Plugins 的 Built-in 列表来自 `panels.filter(p => p.builtin)`，会把聊天列进去；launcher 也会列出。所以聊天由 `PaneView` 按 `toolId` 直接分支处理，不走注册表。
- **树按 session 存。** `bySession`（上限 50，LRU），`persist` key `claudia-right-workspace` version 1，`merge`（`rightWorkspaceStore.ts:624-639`）用 `isSafeTree`（`:193`）丢弃坏树。`isSafeTree` 不校验多余字段，所以给节点加可选字段向后兼容。
- **版本迁移不能只写在 `merge`。** 当前 Zustand 在版本不匹配且没有 `migrate` 时不会把旧状态交给 `merge`，v1 布局会恢复为空。已用仓库安装的版本和内存 storage 做最小复现；S2 必须增加显式 `migrate`，并用真实 persist hydration 路径验证。
- **首次开启不能只靠 hydration。** 当前 `ensureSession` 对已有 entry 直接返回，`merge` 不会随实验开关变化重跑。运行中开启时，需要对已有工具树和空 entry 都执行幂等归一化。
- **现有拖放不是原子移动。** `RightSidebar` 跨 pane 边缘拖放先 `moveTab` 到目标，再 `splitTabOut`。目标换成钉住的聊天 pane 后，这两步会与保护规则冲突；需要直接在目标边缘插入的原子动作。
- **现有尺寸换算只看根容器。** `WorkspaceView` 给所有嵌套 group 的 divider 传整棵 workspace 的宽高。统一 workspace 必须按每个 group 的实际矩形换算，并递归计算子树最小尺寸。
- **聊天组件基本按 `sessionId` prop 驱动**，`ChatInterface` 自己已经调用 `useSessionRoute`。和全局"选中会话"耦合的只有：`ToolCallItem.tsx:33`、`tool-call/useRunInTerminal.ts:22`、`App.tsx:301` 的 `useActiveSessionStream`、`actions/openPanel.ts:20` 的 `currentSessionCtx`、每个 `ChatInterface` 都注册的 `useKeyboardShortcuts`（`window` 级 `Ctrl+\``、`Cmd+P`）。这些是 S3 的前置工作。
- **工具状态是全局单例或按项目的 store。** `fileViewerStore` 是全局单例（`SessionChatLayout.tsx:67-73` 在 projectRoot 变化时关掉它）；`draftEditorStore.activeSessionId` 单个（`:56-61`）；`terminalStore` 按 `backend::project`。
- **同项目的 session 可以有不同的 `workingDirectory`**（worktree），`projectRoot = workingDirectory || rootPath`（`SessionChatLayout.tsx:40`）。所以 S3 里"工具跟随聚焦聊天"不是可有可无：Claude 和 Codex 各用一个 worktree 对比时，Git 和 Files 必须跟着变。
- **`SessionChatLayout` 被三处使用**：`App.tsx:642`、`SessionChatWindow.tsx:199`（弹出窗口）、`ProjectDashboard.tsx:228`（supervisor 聊天）。改它就是改这三处。
- **左栏收起时** `SidebarCollapsedBar`（`App.tsx:484`）是通栏顶栏，主列左边距为 0；`App.tsx:566-575` 有绝对定位的拖拽条（`h-2` / `h-10`）。

## 设计要点

### 数据模型（S2）

```ts
// 不改 PaneNode / GroupNode / ToolRef 的形状，只加常量与辅助函数
export const CHAT_TOOL_ID = 'chat';          // 聊天叶子：tools: [{ toolId: 'chat', instanceKey: sessionId }]
export const isChatRef = (t: ToolRef) => t.toolId === CHAT_TOOL_ID;
export const isPinnedPane = (p: PaneNode) => p.tools.some(isChatRef);

pruneChat(root)   // 去掉聊天叶子，兄弟节点上提：给 flag 关闭时的旧渲染用
pruneTools(root)  // 只保留聊天叶子：仅供折叠后的几何计算，不决定挂载列表
withChat(root, sessionId, ratio)  // 幂等归一化：没有聊天时生成 row[chat, root]
normalizeSessionWorkspace(ws, sessionId, ratio) // 保留有效 pane 引用，修复失效引用
```

- **存储迁移与启用分离**：`persist.migrate` 无条件把 v1 存储格式迁到 v2，保留工具树、pane ID、工具 ref、比例、主 pane / 聚焦引用和 LRU；此时不依赖开关，也不插入聊天。`merge` 只做安全校验和引用修复。开关启用后由独立的归一化动作插入聊天。
- **归一化入口**：统一 workspace 首次挂载、运行中开启、重新开启以及 `ensureSession` 都调用同一幂等动作；已有 entry 也必须处理。等待 appearance、workspace 和右栏宽度 store hydration 完成后再归一化并渲染，避免闪现工具树或用未恢复的宽度播种。已含当前 session 聊天叶子的树原样保留，不重新包树或覆盖用户布局。
- **"折叠"语义**：宿主始终从完整 `root` 枚举挂载 pane；`collapsed` 时只用 `pruneTools(root)` 计算可见聊天的矩形，工具宿主保持挂载但隐藏，展开恢复完整树的几何布局。隐藏宿主不可聚焦、不可命中拖放，并通知需要可见性信号的工具。头部的面板开关含义不变。
- **`widthFraction` 退役为首次播种用**：只在缺少聊天时使用已恢复的 `1 - widthFraction` 创建聊天 / 工具拆分比例；之后由树分隔条接管。开关关闭时旧路径仍使用 `widthFraction`，不从聊天归一化重新覆盖它。
- **空态与首个工具**：树里只有聊天叶子且展开时，右侧渲染虚拟 `RightSidebarEmptyState` 卡片（不进树）。打开首个工具时创建真实工具 pane，默认生成 `row[chat, tool]` 并设为主工具 pane 和聚焦 pane；虚拟卡片消失。已有工具 pane 时，追加目标按“聚焦工具 pane → 主工具 pane → 第一个工具 pane”选择，跳过聊天；关闭全部工具后再次打开使用同一规则。
- **钉住规则**：聊天不能被 `closePane` / `closeTool` / 普通 `moveTab` / `splitTabOut` / `replaceTool` / `resetSession` 删除，普通 tab 也不能移入聊天。聊天位置只由专用原子移动动作改变；工具可在聊天边缘拆分。S3 将关闭规则放宽为“至少保留一个聊天”，届时单独扩展聊天 tab 的移动规则。
- **原子边缘移动**：`moveTabToEdge(sessionId, sourcePaneId, targetPaneId, ref, edge)` 在一次 store 更新中验证、取出源 ref、折叠空源 pane、在目标边缘插入新 pane，并修复主 pane / 聚焦引用；不先合并进目标。聊天用 `moveChatPane` 移动原有 pane ID，支持目标 pane 边缘，也支持根边缘。冲突检查区分“移动已有 ref”和“创建新 ref”，前者排除被移动的源 ref；非法动作不产生中间状态、不触发工具关闭 / 打开生命周期。

### 卡片外壳（S1）

`components/workspace/PaneCard.tsx` 是唯一的卡片类名来源：`PaneView` 和聊天卡片都用它。`data-chat-surface="card"` 属性由 `ChatInterface` 根节点设置，聊天内部靠它切换样式（CSS，不靠 prop 分支）。

### 表面适配（S1）

| 位置 | 现在 | 卡片内 |
|---|---|---|
| `ChatInterface` 根 | `bg-background` | `bg-transparent`（外层提供底色） |
| `SessionHeader` | `bg-background` | `bg-transparent`，卡片内加 `border-b border-border/50` |
| 未读点 | `ring-background` | `ring-card` |
| 助手气泡 | `bg-card shadow-sm` | 透明、无阴影（Flat） |
| 用户气泡 | `bg-muted/60 shadow-apple-sm` | `bg-secondary`，无阴影 |
| 工具行 / diff | `bg-muted` | 不变 |
| `FilePushNotification`（已有 `border`）、`InlinePermissionRequest`（`:205` 的行内 `bg-card`） | `bg-card` | 前者不变；后者加分隔线；截图确认都能读 |

### 渲染身份与性能（S2）

- `WorkspaceView` 分开平铺 pane 外壳与内容宿主：外壳以稳定的 `pane.id` 为 key，聊天 / 工具内容以 workspace 内完整 `(toolId, instanceKey)` 为 key，宿主父级保持不变。树只计算外壳和内容矩形，分隔条单独渲染；内容不能通过改变 portal 容器来换组，否则仍会重挂载。移动聊天复用 pane ID；移动工具 tab 即使新建目标 pane，也保留原内容宿主。折叠 / 最大化 / 活动 tab 切换只改矩形和可见性，实际关闭 ref 才卸载对应内容。
- 聊天和面板现在是兄弟节点，是为了流式输出不重渲染面板（`SessionChatLayout.tsx:21-24`）。`ChatPane` 内容用 `memo`，props 只有 `sessionId`，项目信息在内部自取；聚焦和几何状态由外壳消费，不把频繁变化的 `focused` context 传入聊天内容。计数测试分别验证挂载次数与渲染次数，`memo` 不能替代稳定挂载。
- 保持挂载的验收覆盖：左右 / 上下移动、工具边缘拆分、折叠 / 展开、聊天 / 工具最大化和还原。确认聊天草稿、附件、滚动位置、选区 / 输入法组合状态，以及工具编辑内容和插件 iframe 状态保留。流式期间做同样操作，工具内容不因聊天流式更新重渲染。
- 实验开关关闭会切回旧宿主，允许这一显式模式切换重新挂载；必须恢复已持久化草稿并保留完整树，开 → 拆分 → 关 → 开后布局恢复。此例外不适用于统一 workspace 内的日常交互。

### 几何与最小尺寸（S2）

- 先递归求子树最小尺寸，再分配矩形。`row` 的最小宽度为两子树宽度之和加 gutter，高度取最大；`col` 的宽度取最大，高度为两子树高度之和加 gutter。叶子最小宽度：聊天 360px、工具 240px；最小高度依据 header / composer 的必要高度加可用内容区确定，并将常量与验证结果写入任务 2.5。
- 每个 divider 使用所属 group 的实际矩形，扣除 gutter 后将指针像素位移换算为比例；按两个子树的最小尺寸钳制。窗口 resize 和非拖动布局也必须满足约束，不只处理 `onDrag`。resize 时的有效比例只用于几何计算，不覆盖保存的用户比例。
- 可用区域小于总最小尺寸时，使用至少满足子树最小尺寸的虚拟画布，视口允许横 / 纵滚动；不压缩叶子到不可用，也不删除 pane 或覆盖布局。折叠 / 最大化按可见投影重新求最小尺寸。拖放命中、overlay 和 divider 坐标必须统一计入画布滚动偏移。

---

## S1：聊天卡片（视觉，带开关）

**出口标准：** 开关打开后，桌面端聊天区是一张和右栏一致的卡片；五个主题下可读；开关关闭时与现在逐像素一致。

- [x] **1.1 抽 `PaneCard`。** 新建 `apps/desktop/src/components/workspace/PaneCard.tsx`：props 为 `focused?`、`className`、`children`、透传 `data-*` 与 `onPointerDown`。类名取自 `PaneView.tsx:82-84`。`PaneView` 改用它；`RightSidebar.tsx:262-269` 的空态卡片也改用它。测试：`PaneCard.test.tsx`（聚焦 / 未聚焦类名、透传属性）；现有 `PaneTabs.test.tsx`、`WorkspaceView.test.tsx` 保持绿。
- [x] **1.2 实验开关。** 新建 `stores/appearanceStore.ts`（persist，key `claudia-appearance`，`{ chatCard: boolean }`，默认 `false`）。切换入口先放 Settings → Debug 的一个开关（避免实验阶段去改 `SETTINGS_SURFACES`），稳定后再移到 General。测试：默认值、持久化。
- [x] **1.3 套卡片。** `SessionChatLayout.tsx`：`chatCard && !isMobile && !poppedOutLabel` 时，用 `PaneCard` 包住 `ChatInterface`，并给 `ChatInterface` 传 `surface="card"`（设置 `data-chat-surface`）。外边距：`py-1.5`，左右见 1.5。根节点保持 `bg-background`（`:107`）作为画布。
- [x] **1.4 表面适配。** 按"表面适配"表改：`ChatInterface.tsx:505`、`SessionHeader.tsx:161/536`、`MessageList.tsx:649/846/904/907`（给助手气泡加 `zc-assistant-bubble` 类，在 `styles/index.css` 里用 `[data-chat-surface='card'] .zc-assistant-bubble` 覆盖）、`FilePushNotification.tsx:66`、`InlinePermissionRequest.tsx:205`。不改 token，不手改 `@generated:tokens` 块。测试：`SessionHeader.test.tsx`、`ChatInterface.test.tsx` 加 `surface="card"` 用例；开关关闭的快照类名不变。
- [x] **1.5 间距与边缘情况。**
  - 左边距：左栏展开时由左栏的 `p-1.5` 提供，不再加；左栏收起（`SidebarCollapsedBar`）时聊天卡片自己 `pl-1.5`。
  - 右边距：右栏展开时由 `WorkspaceView` 的 `p-2` 提供；右栏折叠时 `pr-1.5`。
  - 拖拽条：`App.tsx:566-575` 的绝对定位条会盖住卡片顶部 2px，确认不影响点击，必要时给卡片 `mt-2`。
  - `SessionChatWindow`（弹出窗口）四边都加边距；`ProjectDashboard.tsx:228` 的嵌入处确认观感。
  - `PaneTabs.tsx:149/159` 的 `from-card` 遮罩不受影响（右栏本来就是卡片）。
- [x] **1.6 视觉验证。** 使用隔离 Vite 1490 和后端 3101（数据目录 `/tmp/zclaudia-workspace-qa`），通过 Settings → General 切换五个主题并截图；另外覆盖空会话、有工具调用、右栏开 / 关和左栏收起。使用 CUA 的真实 UI 操作，不向用户数据写入测试会话。
- [x] **1.7 文档。** `docs/ui-conventions.md` 新增一节"Cards"：所有持久 chrome 面板使用 `PaneCard`；画布 `--background`，卡片 `--card`，圆角 `rounded-lg`。
- [x] **1.8 验收。** `tsc`、`lint`（含 `check:radius`）、UI 测试全绿；子任务完成后汇总验证并形成可审查提交；各 agent 不执行 reset 或独立覆盖共享文件。

---

## S2：聊天进树（钉住）

**出口标准：** 开启 `unifiedWorkspace` 后，当前 session 恰有一个聊天叶子；能拖到其他 pane 或根的四个边缘、最大化、折叠工具；这些操作保持仍存在的组件实例和瞬态状态。v1 布局可无损恢复，新会话可打开首个工具，窄窗口和嵌套拆分满足尺寸规则；关闭开关回到 S1 渲染，再开启恢复原布局。

**执行顺序：** 2.1 存储迁移 → 2.2 开关 / 归一化 → 2.3 钉住保护 / 首个工具 → 2.4 原子移动 → 2.5 几何求解 → 2.6 稳定宿主 → 2.7 聊天分支 → 2.8 工作区接入 → 2.9 折叠 / 最大化 → 2.10 消费者回归 → 2.11 阶段验收 → 2.12 文档。2.1–2.6 的测试通过后再接入聊天和交互，不以后置实测决定基础渲染结构。

- [x] **2.1 Store：格式迁移与校验。** `stores/rightWorkspaceStore.ts` 增加聊天辅助函数，并将 persist 升到 `version: 2`。
  - 增加显式 `migrate(persisted, version)`，无论开关是否启用都保留 v1 工具树、pane ID、完整 ref、比例、有效主 pane / 聚焦引用和 LRU。此步骤只迁存储格式，不插入聊天，不读取 appearance store。
  - `merge` 负责 `isSafeTree` 校验和失效引用修复；持久化的 `maximizedPaneId` 也必须验证存在，否则清空。不要把添加聊天的行为藏在 `merge` 中。
  - 测试：用序列化的 v1 storage 数据走真实 persist hydration，确认工具树恢复且后续写回版本为 2；覆盖开关默认关闭、空 root、多层拆分、多实例 terminal、无效引用及 v2 重载。分别验证迁移幂等和安全校验，不能只直接调用 helper。
- [x] **2.2 开关、运行时归一化与回退。** `appearanceStore` 增加 `unifiedWorkspace`（默认 `false`，Debug 开关）；实现统一的 `normalizeSessionWorkspace` 动作。
  - 等相关 store hydration 完成，统一 workspace 首次挂载 / 开关开启 / 重新开启 / `ensureSession` 均走同一动作；已有 entry 不得直接跳过。旧工具树包成 `row[chat, oldRoot]`，空 entry / 新会话生成单聊天叶子；比例用首次播种时的 `1 - widthFraction`。
  - 已有正确聊天叶子时不改变 ID、比例或布局；校验当前 session 引用。保留有效主工具 pane / 聚焦引用，无工具 pane 时主工具 pane 为 `null`，聚焦聊天。
  - 关闭时走旧路径 `ChatInterface` + `RightSidebar`；给旧 workspace 渲染器传 `pruneChat(root)` 投影，不能让内部 selector 又读回完整树。保留完整持久化树；移动端始终走旧路径。
  - 测试：默认关闭启动 → 打开、持久化开启启动、已有工具树 / 空 entry / 无 entry、重复 ensure、hydration 先后顺序、切换其他已有会话、开 → 拆分 → 关 → 开及刷新。每次归一化只含一个当前 session 聊天叶子；原工具和布局不丢。
- [x] **2.3 钉住保护与首个工具落点。** 所有删除 / 替换 / 普通 tab 移动动作保护聊天，普通工具不得并入聊天 pane；`openTool` 的落点只在工具 pane 中选择。
  - 无工具 pane 时创建真实工具 pane 与聊天组成默认 `row[chat, tool]`，设置主工具 pane / 聚焦 pane；有工具 pane 时按设计要点的候选顺序追加。重复打开只激活已有 ref，不创建重复工具；关闭最后一个工具保留聊天。
  - `resetSession` 遇到聊天按钉住规则保持原状态；实际删除 session 的 `removeSession` 仍可删除整个 entry。保护失败不得触发工具生命周期。
  - 测试（store 和 workspace actions）：逐个保护动作、移入 / 移出聊天、聚焦聊天时打开工具、新会话打开首个工具、全部工具关闭后重开、工具去重、主工具 pane 失效后的回退，以及虚拟空态到真实 pane 的转换。
- [x] **2.4 原子边缘移动与冲突检查。** 实现 `moveTabToEdge` 与 `moveChatPane`，不复用“先 `moveTab` 再 `splitTabOut`”的跨 pane 操作。
  - 工具拖到聊天边缘直接创建相邻工具 pane；聊天移动复用 pane ID，可指定目标 pane 或根边缘。验证源 ref / 目标 / 保护规则后一次提交；非法操作保持原状态。源与目标相同、唯一 tab 的无意义自拆分应返回 no-op。
  - `dragSplit` 对聊天目标禁用中心和 tab 合并；移动已有 ref 时从冲突集合排除源 ref，创建新 ref 仍执行 singleton / instanceKey 去重。pointer-up 必须再次校验许可，不能只靠 overlay 的 disabled 样式。
  - 测试：工具 → 聊天四边、聊天 → 工具四边及根四边、源最后一个 tab / 多 tab、源 pane 上提后的嵌套目标、同 pane 自拆分、非法中心放置、源 / 目标不存在、重复工具冲突。断言单次状态提交、无中间混合聊天 pane、ref 总数守恒、引用有效、pane ID 复用、无 onClose / onOpen 副作用。
- [x] **2.5 几何求解、最小尺寸与窄聊天。** 提取可独立测试的子树最小尺寸和矩形分配函数，按“几何与最小尺寸”规则实现；记录叶子最小高度常量及其依据。
  - 每个 divider 用所属 group 的实际尺寸，扣除 gutter，按子树最小尺寸和有效比例范围钳制；拖动、窗口 resize、折叠 / 最大化投影都调用同一求解器。视口不足时使用可滚动虚拟画布，保留存储比例。
  - `ComposerFooter` 和 header 的 agent 选择器使用聊天容器 query（约 400px 以下）压缩选择器行 / agent 芯片，`ChatInputArea` 的 `max-w-3xl` 阅读列保持不变。
  - 测试：row / col / 混合三层树、gutter、局部 divider 位移、两个子树的宽高约束、极端比例、resize 后最小尺寸、视口不足时滚动和比例保留、滚动画布中的命中坐标、聊天独占投影。DOM 验证 360px 聊天的 composer 仍可发送。
- [x] **2.6 稳定挂载的平铺宿主。** `WorkspaceView` 从完整树枚举 pane 外壳与全部内容 ref，分别以 `pane.id` 和完整 `(toolId, instanceKey)` 为 key 平铺挂载；使用 2.5 的矩形绝对定位，divider 单独渲染。内容宿主保持同一父级，不因 tab 移动换父级或 portal 容器；可见投影只决定几何与隐藏状态。
  - 隐藏 pane / 非活动 tab 内容仍挂载，但不能获得焦点、响应快捷键或命中拖放；工具可见性通过显式宿主信号传递，不靠全局 panel.visible 或 `alwaysMount` 维持实例。隐藏 terminal ref 不应因初次挂载就自动创建终端，初始化仍按显式打开或首次可见驱动。移动聊天保留原 ID；关闭 ref 才移除内容宿主。
  - 测试：用含局部输入状态和 effect 计数的 pane 内容验证移动 / 边缘拆分 / 折叠 / 最大化后 DOM 实例及 mount 次数不变，隐藏工具恢复编辑状态，真实关闭才 unmount；包含插件 iframe 和 terminal 宿主回归。
- [x] **2.7 `PaneView` 聊天分支与内容隔离。** pane 外壳与内容宿主查注册表之前判断 `CHAT_TOOL_ID`：聊天外壳不用工具 `PaneTabs`，对应内容宿主渲染 `ChatPane`，不走 `PanelContent`；聊天不出现在 launcher。
  - `PaneContext`（`sessionId`、`paneId`、`focused`）由外壳和头部消费；memo 的聊天内容只接收 `sessionId`，不消费变化频繁的聚焦 / 几何 context。导航回调通过稳定的工作区 actions context 保留，覆盖 Dashboard 返回和弹出窗口关闭行为。
  - 测试：聊天正常渲染、`surface="card"`、导航回调保留；流式更新不触发工具内容重渲染，聚焦 / 调整尺寸不触发聊天内容的额外渲染。挂载计数与渲染计数分开断言。
- [x] **2.8 `SessionWorkspaceView` 与拖放接入。** 在 `unifiedWorkspace && !isMobile` 时替换 `ChatInterface` + `RightSidebar` 组合，使用 2.6 的稳定宿主。
  - 只有聊天且展开时显示虚拟空态卡片，通过 2.3 打开真实工具。统一根 divider 接管宽度调整；旧 `RightSidebar` 保留用于开关关闭的路径。
  - 复用拖动状态和命中辅助函数，pointer-up 改调 2.4 的原子动作；聊天头部新增拖拽把手。折叠、切 session 和卸载时清理拖动状态。
  - 测试：新会话从空态打开工具、工具 / 聊天拖动四边、禁用区域不落下、滚动画布拖动、切换 session / 折叠时中断拖动。
- [x] **2.9 折叠、未读与最大化。** 增加 `maximizedPaneId`，复用可见投影与稳定宿主，不条件卸载内容。
  - 头部 `rightWorkspaceHasContent` 使用 `pruneChat(root) !== null`；最大化入口为 pane / 聊天头部按钮、双击标签栏、`Cmd+Shift+Enter`，`Esc` 还原，工作区级快捷键只注册一次。
  - 折叠工具时清除工具最大化，显示聊天；最大化工具先展开。显式打开工具展开并解除最大化，使新工具可见；后台活动在折叠时只标未读。关闭最大化 pane 或恢复无效持久化 ID 时自动还原。
  - 测试：折叠 / 展开、聊天 / 工具最大化 / 还原、组合操作、最大化 pane 关闭、无效 ID 重载、新工具打开后的可见性、后台未读。浏览器验证草稿 / 附件、滚动、光标 / 选区、输入法组合输入及工具编辑内容保持，流式期间重复上述操作。
- [x] **2.10 其余消费者。** 检查 `actions/workspaceActions.ts`、`actions/openPanel.ts`、`features/browser/ChatLink.tsx` / `handlers.ts`、`RightSidebarEmptyState`、`PaneTabs`、`ToolLauncherMenu`；区分显式打开与后台未读事件。
  - `SessionChatWindow` 和 `ProjectDashboard` 嵌入同一 `SessionWorkspaceView`，保留原导航回调；主窗口的 `poppedOutSessions` 显示占位且不重复挂载会话内容。移动端 `BottomPanel` 和开关关闭后的工具路径保持可用。
  - 测试：更新 `SessionChatLayout.placement.test.tsx`、`SessionChatWindow.test.tsx`、`ProjectDashboard.test.tsx` 和 workspace actions / browser 相关测试，覆盖三个宿主、弹出占位及移动端。
- [x] **2.11 阶段验收。** 汇总前述回归到 `rightWorkspaceStore.test.ts`、`RightSidebar.test.tsx`、`WorkspaceView.test.tsx`、`ResizeDivider.test.tsx`、`dragSplit.test.ts` 和新增 `SessionWorkspaceView.test.tsx` / 几何测试；通过类型、lint 与对应 store / UI 测试，再执行全量测试。
  - 浏览器摆出 Default、Review、Dock、Preview、Focus 五种布局，各截亮色和暗色；补嵌套三层、~1000px 窗口、低于总最小尺寸的滚动画布和流式中移动 / 折叠 / 最大化。检查 mount / 状态保持，不以截图替代行为断言；补 Tauri 冒烟。
- [x] **2.12 文档与记忆。** 更新 `docs/ui-conventions.md` 的 Cards：聊天钉住规则、原子移动和稳定宿主；记录格式迁移 / 归一化的分工、几何约束和最小高度验证结论。

---

## S3：多聊天并排（先设计，再实现）

S3 引入的是新的产品语义（一个布局里有多个 session），先做一个设计 spike，再拆实现任务。本次按用户要求完成 S1–S4；纯 store / 几何工作并行，集成依赖按前述测试门槛验证。实验开关默认关闭，尚未执行发布。

- [x] **3.0 设计 spike（产出一份决策文档，放在 `docs/plans/`）。** 必须回答：
  1. **布局归谁。** 现在按 session 存。多聊天后建议改为按项目存（`byProject`），聊天叶子只引用 `sessionId`；迁移规则（同项目多棵树取最近使用的那棵）。
  2. **侧栏点击语义。** 点击一个已经在布局里的 session → 聚焦那个 pane；点击不在布局里的 → 替换聚焦的聊天 pane；`Cmd/Ctrl+点击` → 在旁边打开。
  3. **工具跟随。** 工具 pane 默认绑定"聚焦的聊天"，可固定到某个聊天；标签栏显示 `follows <session>` 芯片。`projectRoot` / `workingDirectory` 从被绑定的聊天取（不同 worktree 的对比场景必须成立）。
  4. **全局单例工具。** `fileViewerStore`（全局单例，`SessionChatLayout.tsx:67-73` 切 projectRoot 就关）和 `draftEditorStore.activeSessionId`：是改成按 pane 的状态，还是接受"跟随切换时重置"。
  5. **流式订阅。** 确认 `ChatInterface` 内的 `useSessionRoute` 能同时服务多个已挂载的聊天；`App.tsx:301` 的 `useActiveSessionStream` 只订阅选中的那个是否需要扩展。
  6. **快捷键。** `Ctrl+\``、`Cmd+P` 现在每个 `ChatInterface` 都注册一次，多聊天会重复触发。
  7. **弹出窗口。** 一个聊天 pane 弹出后，布局里怎么表示。
  8. **"最后一个聊天"保护**放宽为"至少保留一个聊天 pane"。
- [x] **3.1 解耦前置（可独立于多聊天发布，本身就是改进）。**
  - `ToolCallItem.tsx:33`、`tool-call/useRunInTerminal.ts:22` 不再读 `useSelectionStore.selectedSessionId`。`ChatActionsContext`（`features/chat/ChatActionsContext.tsx`）目前只有 `handleSendMessage` 和 `setMode`，要给它加一个 `sessionId` 字段（`ChatInterface` 构造 `chatActionsValue` 时填入），这两处再改用 `useChatActionsOptional()?.sessionId`，没有 provider 时才退回 `selectedSessionId`。
  - 快捷键从 `useKeyboardShortcuts` 提到工作区级注册，只对聚焦的聊天 pane 生效。
  - `actions/openPanel.ts` 的 `currentSessionCtx()` 改为取"聚焦的聊天 pane"，退而取 `selectedSessionId`。
- [x] **3.2 模型与 tab 实例身份。** 聊天叶子的 `instanceKey` 就是 `sessionId`；允许多个聊天叶子；一个 pane 里多个聊天 ref 就是"session tabs"，`PaneTabs` 显示会话标题；关闭规则按 3.0 的结论；项目归属保存在 `projectWorkspaceStore.byProject`（版本 1），布局树继续由稳定 `workspaceId` 锚定兼容 `bySession`；采用项目会话目录完成加载后的 MRU 归属迁移，附真实 hydration 测试。详见[实施决策](./2026-10-11-multi-chat-decisions.md)。
  - 同一 workspace 内同一 session 只保留一个聊天 ref，已打开时只聚焦。复用 S2 的完整 ref 内容宿主（`toolId` + `instanceKey`，聊天即 sessionId），扩展为多聊天和 session tabs；tab 换组 / 切换活动 tab 时只改变外壳归属、矩形与可见性，不卸载仍打开的内容，为 S4 合并 tabs 保留状态打基础。
  - 测试：session 去重、活动 / 非活动聊天 tab 的草稿和滚动保持、跨 pane 移动后的 mount 次数和订阅次数、不同 instanceKey 的工具互不覆盖。
- [x] **3.3 侧栏集成。** 按 3.0 的语义改 `Sidebar` 的 session 点击；`App.tsx:642` 的 `key={selectedSessionId}` 重置逻辑和 `SessionWorkspaceView` 的关系理清。
- [x] **3.4 工具跟随。** 工具绑定按完整 ref 保存 `follow` 或固定 `sessionId`，避免 pane 合并后引用失效；`FlatWorkspaceView` 的 `projectId` / `projectRoot` / `workingDirectory` 从被绑定的聊天解析；标签栏显示 `follows` 芯片，可固定 / 解除。
- [x] **3.5 单例 store 处理**（按 3.0 第 4 点的结论）。
- [x] **3.6 入口。** session 菜单增加"Open beside"、"Compare with…"；拖一个 session 到 pane 边缘也能拆分。
- [x] **3.7 测试与性能。** 2 到 3 个同时流式输出的聊天，确认互不重渲染、工具 pane 不随聊天流式刷新；Compare、Main + watcher、Session tabs 三种布局的截图。

---

## S4：布局预设

**出口标准：** 一键切换命名布局，用户能保存当前布局；切换不丢工具状态。

**执行顺序：** S3 的完整 ref 宿主与去重规则通过后，先做 4.1 槽位 / 实例映射模型，再做 4.2 纯映射与原子应用，最后接 4.3–4.4 的用户入口。预设应用不靠重建内容宿主来实现布局切换。

- [x] **4.1 槽位、占位与实例映射模型。** `stores/layoutPresetStore.ts`（persist）：`{ id, name, builtin, tree }`，每个槽位有稳定 `slotId` 和类型（`chat`、`tool:<toolId>`），可表达同一 pane 内的多个 tab 槽位，不保存 session 引用或当前工具 instanceKey。内置预设仍是 Default、Review、Dock、Preview、Focus、Compare、Main + watcher、Session tabs（后三个在 S3 之后可用）。
  - 预设只是几何 / 分组模板；应用结果将槽位映射到现有完整 ref，内容宿主继续使用 S3 的稳定实例 key。保留可复用 pane ID；需要合并 / 拆分外壳时也不能改变仍打开的内容宿主身份。
  - 为未填充槽位定义独立的运行时占位节点，并覆盖树校验、几何、持久化和填槽操作；不得用重复聊天 ref、虚构 session 或 `tools: []` 的 `PaneNode` 冒充占位。workspace 存储格式相应升到 version 3，显式迁移保留 v1 / v2 的树和实例引用；布局 preset store 另有自己的版本。
  - 固定工具绑定须保留其目标聊天 ref 身份；聊天换 pane / 合并 tabs 后重映射绑定，不能因旧 pane ID 消失而切换工作目录。动态跟随聚焦的工具保留动态跟随语义。
- [x] **4.2 映射算法与原子应用。** 先计算完整应用结果并校验，再一次更新布局；不触发聊天创建、工具 onOpen / onClose 或订阅重建。
  - **聊天一对一分配**：遍历当前树，收集唯一的已打开聊天 ref（包含非活动 tabs）；当前聚焦聊天优先填首个聊天槽，其余按原树 / tab 顺序填剩余槽。同一 ref 只能分配一次，不能把聚焦会话复制到所有槽。
  - **槽位不足**：全部已打开聊天必须保留，多余 ref 作为首个聊天 pane 的额外 session tabs，保持原顺序；Focus 也只隐藏非活动 tabs，不关闭其他聊天。带工具绑定的聊天照样保留。
  - **槽位过多**：剩余聊天槽显示“选择会话 / 在此打开”的占位；不自动创建 session，也不重复已有聊天。选中已经打开的 session 时只聚焦其现有实例，选择未打开的 session 才填该槽。Compare 只有一个聊天时保持第二槽为空。
  - **工具分配**：用 `toolId` 匹配可接受的槽位，但搬运完整 `(toolId, instanceKey)` ref；同 toolId 的多个实例按原顺序一对一分配，多余工具并入工具 pane 的 tabs，没有工具槽时保留一个额外工具 pane。缺失的工具显示 launcher 占位，不自动打开；重复模板槽位不能复制 singleton。
  - 保留内容宿主、活动 ref、聚焦聊天及固定 / 动态工具绑定；必要时重映射 pane 引用，清理失效最大化状态。保存用户预设只提取槽位与分组 / 比例，不序列化会话身份。
  - 测试：两个 / 三个不同会话套 Compare、Main + watcher、Session tabs；聚焦优先和其余顺序；聊天槽不足时 tabs 保全、槽过多时占位、已打开 session 去重；两种 instanceKey 的 terminal 保全、singleton 不复制、无工具槽 / 缺失工具；固定绑定在不同 worktree 的聊天合并 / 拆分后仍指向原会话。断言应用前后完整 ref 集合守恒、无生命周期副作用、重复应用幂等，草稿 / 滚动 / 工具编辑状态和 mount 次数保持。
- [x] **4.3 用户预设。** "保存当前布局"、重命名、删除；命名冲突处理。
- [x] **4.4 入口。** 聊天头部加"Layout"菜单（`DropdownMenu` 原语）；键盘入口 `Cmd/Ctrl+Alt+L`（仓库暂无全局命令面板，打开同一可访问菜单）；按项目记住最近使用的预设。
- [x] **4.5 测试与文档。** 覆盖 preset 持久化、workspace v1 / v2→v3 的真实 hydration、占位树重载 / 填槽和保存预设后重新应用；浏览器切换八种预设，验证 ref 保全与状态保持，更新 `docs/ui-conventions.md`。S4 的测试以 4.2 的一对一映射和实例身份约束为出口条件。

## Review 修正对应表（2026-10-11）

| 问题 | 修正落点 | 必须先通过的验证 |
|---|---|---|
| 1. 升版本后仅靠 merge 丢 v1 布局 | 2.1 显式 migrate，格式迁移独立于开关 | 序列化 v1 → 真实 hydration → v2 写回 → 重载 |
| 2. 首次运行中开启未给已有会话加聊天 | 2.2 共用幂等归一化入口和 hydration 门槛 | 已有树 / 空 entry / 新会话，开关切换和反复 ensure |
| 3. 裁剪渲染树卸载工具 / 重挂聊天 | 2.5–2.6 先做几何和稳定宿主，再接 2.9 | 移动 / 折叠 / 最大化 / 还原的实例、局部状态和 mount 计数 |
| 4. 边缘拖放与钉住保护冲突 | 2.3 保护边界、2.4 原子移动，再接 2.8 | 四边移动、单次提交、ref 守恒、非法动作无副作用 |
| 5. 只有聊天时无法打开首个工具 | 2.3 无工具落点时创建真实拆分 | 新会话首开、全部工具关闭后重开、空态转换 |
| 6. 最小尺寸和位移未按嵌套子树求解 | 2.5 局部矩形、递归最小尺寸、滚动画布 | 三层混合树、resize、极端比例和滚动命中 |
| 7. 多聊天预设复制聚焦会话 / 丢实例身份 | 3.2 完整 ref 宿主，4.1–4.2 一对一映射 | 多会话槽位不足 / 过多、multi-instance 工具和固定绑定保全 |

---

## 验证矩阵（每个阶段出口都过一遍）

| 项 | 方法 |
|---|---|
| 类型 / lint / 测试 | `tsc --noEmit`、`lint`（含 `check:radius`、`check:lifecycle`）、对应 `test:unit` / `test:ui`，再跑全量 `test` |
| 五个主题 | Settings → General 切换后截图 |
| 右栏 开 / 关、左栏 收起 | 浏览器里各一张 |
| 窄窗口（~1000px） | 聊天最小宽度、选择器行折叠 |
| S2 存储迁移与开关 | v1 序列化数据真实 hydration；默认关闭后首开；已有 / 空 / 新会话归一化；开 → 拆分 → 关 → 开和重载 |
| S2 稳定挂载 | 移动、工具边缘拆分、折叠、最大化 / 还原的 mount 计数；草稿、附件、滚动、选区和工具局部状态保持 |
| S2 原子拖放与首个工具 | 四边移动的 ref 守恒和单次提交；非法放置无副作用；首个工具及全部工具关闭后重开 |
| S2 嵌套几何 | 三层 row / col 混合树，局部 divider、窗口 resize、最小宽高、视口不足滚动与命中 |
| S3 / S4 实例与预设 | session 去重、聊天槽不足 / 过多、完整工具 ref、固定 worktree 绑定；切换预设后实例和状态保持 |
| 弹出窗口、Dashboard 嵌入 | `SessionChatWindow`、`ProjectDashboard` 手动走一遍 |
| 流式输出 | 真实跑一个带工具调用的会话，确认无闪烁、滚动位置保留 |
| Tauri | 浏览器验证之外，补一次 Tauri 桌面冒烟（拖拽条、红绿灯区域） |

## 风险

| 风险 | 缓解 |
|---|---|
| 卡片对画布只有 +2 色阶，看起来糊 | 靠描边加阴影（和右栏一致）；最差情况把画布切回 `--sidebar` 作为一个开关选项（mockup 已有对照） |
| 移动 / 折叠 / 最大化改变父级，丢局部状态 | 2.6 平铺稳定宿主作为接入前置，投影只改几何 / 可见性；mount 和状态保持测试 |
| 流式输出拖慢整棵树 | memo 聊天内容只接 sessionId，聚焦 / 几何由外壳消费；分别测渲染和挂载次数 |
| v1→v2 迁移损坏用户布局 | 2.1 显式 migrate 不依赖开关，2.2 幂等归一化；真实 hydration 和回退重载测试 |
| 运行中首开缺聊天或首个工具无落点 | 2.2 覆盖已有 entry，2.3 无工具 pane 时创建真实拆分；开关 / 首开 / 重开测试 |
| 拖放先合并再拆分撞上钉住规则 | 2.4 原子移动，冲突检查排除移动源；非法动作和生命周期测试 |
| 嵌套 / 窄窗口把聊天挤到不可用 | 2.5 子树最小尺寸与局部矩形求解，视口不足用滚动画布；resize 和命中测试 |
| 预设重复聊天或覆盖工具实例 / 绑定 | 3.2 稳定完整 ref 宿主，4.2 一对一映射与溢出 tabs；ref 守恒和状态保持测试 |
| 全局单例 store（fileViewer、draft）在多聊天下抖动 | S3 spike 第 4 点先定方案，再实现 |
| 并发 session 抹掉未提交改动 | 协调共享文件边界，汇总通过后提交 |
| 聊天里还有其他 `bg-card` / `bg-background` 漏网 | 1.4 之后全局 grep `features/chat` 复查，截图确认 |

## 不在范围内

- 移动端的自由编排（保持单栈）。
- Home、Agents、Settings、Automations 等整页 mode 变成 pane。
- 把左栏也并入 workspace 树。
- 按 Automation 运行自动切换布局（4.x 之后再议）。
- 改色板 / token（本计划不改 `@generated:tokens` 块）。

## 用户已确认（2026-10-11）

1. **S3 的布局归属**：按项目保存，同项目共享工作台。
2. **侧栏点击语义**：普通点击替换聚焦聊天；Cmd/Ctrl+点击并排打开；已打开会话只聚焦。

S2 的稳定挂载、格式迁移与归一化分离、原子拖放和首个工具落点已作为本次 review 的修正要求写入任务，不再将日常交互的重新挂载作为待拍板选项。


## 实施与验证记录（2026-10-11）

S1–S4 已实现。用户确认布局按项目保存；普通侧栏点击替换聚焦聊天，Cmd / Ctrl 点击并排打开。两个实验开关默认关闭，通过 Settings → Debug 启用。

架构上，纯树模型与算法位于 `utils/workspaceLayout.ts`，窗口存储 key 位于 `utils/workspaceStorage.ts`；跨 store 的项目初始化由 actions 协调。`features/chat/ChatPane.tsx` 和 `features/chat/SessionWorkspaceView.tsx` 负责聊天集成，通用平铺渲染器通过稳定组件参数注入聊天内容。项目归属兼容桥接、独立窗口 namespace 及工具 singleton 行为见[实施决策](./2026-10-11-multi-chat-decisions.md)。

自动验证：

- 桌面全量：107 个 unit 文件 / 1626 项、17 个 hooks 文件 / 164 项、311 个 UI 文件 / 3150 项通过，共 4940 项。
- `tsc --noEmit`、生产构建、生命周期和圆角检查通过；完整 lint 为 0 errors、404 warnings。
- 架构检查无新增违规。用 `git archive HEAD` 的独立基线目录复核，现有三个失败完全一致：`cache-trace.ts` 的 infra → domain 依赖、`BackgroundTaskChip` 与 `TaskDrawer` 的内部跨 feature 依赖；本次未扩大 allowlist。
- 真正 persist hydration 覆盖 v1 / v2 → v3、项目 MRU 归属和窗口 namespace；原子动作覆盖四边、根 gutter、tab 合并、最后聊天保护、ref 守恒及非法动作零生命周期副作用。
- 稳定宿主集成覆盖八种预设、三份聊天草稿、不同 scope 终端、编辑内容、选区、滚动、iframe、固定绑定和 mount / unmount 计数。

人工验证使用 CUA、本地隔离后端和本地确定性模型响应服务，走实际 HTTP / WebSocket / agent / PTY 链路。Main、Watcher、Review 三个聊天同时发送，均完成 `ListSkills` 工具调用和流式响应；流式期间最大化 Review，再恢复后另外两个聊天的响应完整保留。浏览器还验证独立草稿、折叠 / 展开、八种预设、五种主题、1000px 窗口滚动画布、360px composer、侧栏收起、空会话及 Dashboard 内聚焦 / 切换聊天仍保留 Dashboard。

Tauri 独立测试应用验证单会话 scope、首个终端打开、实际终端命令输出、关闭终端回到工具空态、聊天最大化 / 还原、标题栏拖动、原生缩放和关闭按钮。人工检查发现的“独立窗口未注册工具目录”已修复到共享 WindowRouter，初始化幂等，并加主窗口 / 独立聊天 / Dashboard 回归。

本地截图保存在 `artifacts/chat-workspace-qa/`（忽略目录），包含八种预设、五种主题、窄窗口、Dashboard 和 Tauri 终端。中文系统输入法的真实 composition、附件上传和每种主题下全部状态的交叉组合未进行人工遍历；这些不扩大为本次已有截图的验证结论。自动宿主身份与状态保持检查已通过。
