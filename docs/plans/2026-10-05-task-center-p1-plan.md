# P1 实施计划 — 后台任务中心（Pill + Popover，双挂载分层）

日期：2026-10-05
范围：方案 P1 + 组件双挂载分层（为 P3 右栏 panel extension 预留）
设计稿：`docs/mockups/task-center-mockup.html`（Frame 1 / Frame 2）
规范：`docs/ui-conventions.md`（全部新 chrome 必须遵守）

## 0. 目标与非目标

**目标**

- 后台任务入口从聊天底部横条迁移为 Session Header 的 L1 Pill + L2 Popover 任务中心。
- 取消终态任务 15 秒自动移除，改为手动 dismiss / "清除已完成"。
- 任务列表分组（运行中 → 已暂停 → 已完成），行内减重（PID 挪入详情区）。
- 组件按「内容组件 + 容器适配」双挂载分层落地，P3 注册右栏 panel 时零重写。

**非目标（P1 不做）**

- Sub-agent 专属 UI（`kind`/`agentType` 分流、Task 工具卡升级）→ P3。
- 子 transcript 抽屉 → P4。
- 完成 toast 通知 → P2。
- 右栏 panel extension 的实际注册 → P3（P1 只做分层准备）。
- wire/服务端改动：无。

## 1. 组件分层（双挂载契约）

```
features/task-center/
├── TaskCenterView.tsx      # 纯内容组件：分组列表 + 行 + 详情展开（无定位、无浮层逻辑）
├── TaskRow.tsx             # 单行：状态点 / 描述 / meta / hover 操作
├── TaskDetail.tsx          # 行下内联详情：命令 / 状态 / 进程 / outputFile 芯片
├── TaskPill.tsx            # L1 环境指示 Pill
├── TaskCenterPopover.tsx   # 容器 A：fixed backdrop + 绝对定位浮层（复刻 SessionHeader info popover 模式）
├── TaskAmbientStrip.tsx    # 聊天底部一行提示（替代 BackgroundTaskPanel），点击开 Popover
└── useTaskCenter.ts        # 派生状态 hook：分组、计数、跨会话标注
```

**分层契约（P3 右栏挂载的关键）**

- `TaskCenterView` 只接收 props（`tasks`、`onStop`、`onDismiss`、`onLocate`、`onClearFinished`），不读 store、不感知容器；容器负责数据源装配。
- `TaskCenterPopover` 与未来的 `TaskCenterPanelExtension`（P3 注册进 `pluginStore` 的 `UIExtension`，`visible` 绑定「存在运行中任务」）都只是 `TaskCenterView` 的薄壳。
- 面板容器需要滚动区自适应高度，因此 `TaskCenterView` 的根节点不做 `max-h` 限制，由容器给约束（Popover 给 `max-h-[60vh]`）。

## 2. Store 改动 — `stores/backgroundTaskStore.ts`

| 改动 | 说明 |
|---|---|
| 删除 `AUTO_REMOVE_DELAY_MS` / `scheduleAutoRemove` / `autoRemoveTimers` | 终态任务不再自动消失；HMR/beforeunload 清理逻辑同步简化 |
| 新增 `clearTerminalTasks(sessionId?: string)` | "清除已完成"：仅移除 completed/failed/stopped；不带 sessionId 时清当前 server 全部 |
| 新增 selector `selectRunningCount` | 运行中任务计数。**范围决策：当前 server 全部会话**（任务带 `serverId`/`sessionId`，跨会话条目在 P1 就渲染会话标签；点击跳转依赖会话导航 action，若成本超预期则降级为 P2，P1 先只读展示） |
| 新增 selector `selectTasksGrouped(sessionId)` | 返回 `{ running, paused, terminal }` 三段，供 `useTaskCenter` 消费 |
| 保留 PID monitor 不变 | `startPidMonitor`/`stopPidMonitor` 逻辑不动 |

`upsertBackgroundTask`（`services/message-handlers/background-task-messages.ts`）无需改动；四类消息处理不变。

## 3. 集成点改动

### 3.1 `features/chat/SessionHeader.tsx` — 挂载 TaskPill

- 位置：desktop 的 session info chip 之前（两者同为 `hidden md:block` 的 chip 家族，视觉节奏一致）；`currentSession.type === 'background'` 时隐藏。
- 复用现有 popover 模式：`fixed inset-0 z-[70]` backdrop + `absolute right-0 top-full z-[80]` 浮层（与 info chip 完全一致，含 `aria-haspopup="dialog"` / `aria-expanded`）。**注意**：ui-conventions §8 要求用 `z-dropdown` token，现有 header 的 `z-[70]/z-[80]` 是历史遗留；新代码用 `z-dropdown`，不扩散任意值。
- Pill 形态：`h-7`、ghost、`rounded-md`（control 层级），`Loader2` 旋转图标（running>0 时）+ 计数（`text-foreground` 半粗）+ "running"；无任务时不渲染。图标 `strokeWidth={1.75}`。
- 移动端（`<md`）：Pill 不渲染，入口仅靠 3.2 的 ambient strip。

### 3.2 `features/chat/ChatInterface.tsx` — 替换 BackgroundTaskPanel

- 删除 `<BackgroundTaskPanel>` 挂载（约 L644）及 `components/BackgroundTaskPanel.tsx`、`components/__tests__/BackgroundTaskPanel.test.tsx`。
- 原位挂载 `<TaskAmbientStrip sessionId={…} onOpen={…} />`：仅当前会话有运行中任务时显示一行（状态点 pulse + "N 个任务运行中" + "查看任务中心 →"），点击聚焦 Header Pill 并打开 Popover（通过一个 `taskCenterStore` 的 `popoverOpen` 标志或直接回调到 SessionHeader 的 ref——推荐前者，新增一个 6 行的 `taskCenterUiStore` 管理 Popover 开合，避免 prop drilling）。
- `onStopTask` 的 `wsSendMessage({type:'stop_background_task'})` 逻辑从 ChatInterface 上移到 `useTaskCenter`，Popover 内每行的「停止」复用同一入口。

### 3.3 Popover 内容（对齐 mockup Frame 2）

- 宽 `w-[380px]`，`rounded-xl border bg-popover shadow-xl`（Panel 圆角层级）。
- 头部：`font-semibold` "任务中心" + 右侧 ghost「清除已完成」（仅存在终态任务时可用）。
- 分组 label 用 `SECTION_LABEL`（`components/ui/typography.ts`），句首大写，禁止 uppercase。
- 行：28px 高、hover `bg-secondary`；状态色一律 `TONE_DOT`（`ui/tone.ts`）；meta 位显示相对时间 + usage 摘要（`12k tok · 3 tools`）。
- hover 浮现操作：运行中→「停止」（destructive ghost）；终态→「dismiss」；**每行至多一个彩色控件**（ui-conventions §5）。
- 行下详情（`TaskDetail`）：命令（mono）、状态、进程（PID/cliPid/uptime，复用现 `PidBadge` 的 `getProcessInfo` 懒查询逻辑但改为展开时一次性拉取）、`outputFile` 引用芯片（`rounded-[var(--radius-inline-token)]`）。
- 页脚说明行（`text-muted-foreground/60`）："已完成任务保留至手动清除"。
- 空态：无任务时 Popover 不可打开（Pill 不渲染），无需空态 UI。

## 4. 行为对照表（现状 → P1）

| 行为 | 现状 | P1 |
|---|---|---|
| 入口 | 聊天底部横条（常驻占位） | Header Pill（无任务不渲染）+ 底部一行 strip（仅运行中） |
| 终态任务 | 15 秒自动移除 | 保留至手动 dismiss / 清除已完成 |
| 列表形态 | 扁平列表 `max-h-40` | 分组 Popover `max-h-[60vh]` |
| PID 展示 | 行内 `[pid]` 徽标 + hover 查询 | 详情区内联展示，展开时查询 |
| 计数范围 | 当前会话 | 当前 server 全部会话（跨会话带会话标签） |

## 5. 测试

| 文件 | 改动 |
|---|---|
| `stores/__tests__/backgroundTaskStore.test.ts` | 删自动移除用例；新增 `clearTerminalTasks`（含 sessionId 过滤）、`selectRunningCount`、`selectTasksGrouped` 用例 |
| 新增 `features/task-center/__tests__/TaskCenterView.test.tsx` | 分组顺序、hover 操作显隐、详情展开、清除已完成回调 |
| 新增 `features/task-center/__tests__/TaskPill.test.tsx` | 计数渲染、无任务不渲染、点击开合 |
| `features/chat/__tests__/ChatInterface.test.tsx` | 更新：BackgroundTaskPanel → TaskAmbientStrip 的挂载断言 |
| 手动验证 | `pnpm desktop:dev`：跑 `run_in_background` 命令 + 杀进程验证 PID monitor 标 stopped 后任务**不消失** |

## 6. 实施顺序（可独立 review 的提交）

1. **store**：`backgroundTaskStore` 行为变更 + selector + 测试（无 UI 依赖，先合）。
2. **组件**：`features/task-center/` 全部新组件 + 测试（纯新增，不接线）。
3. **接线**：SessionHeader 挂 Pill、ChatInterface 换 strip、删旧 Panel、更新测试。
4. **回归**：`pnpm test` + `pnpm --filter @zclaudia/desktop run check:radius` + lint。

## 7. 风险与备注

- **跨会话跳转**：若 session 导航 action 与多窗口（`sessionWindow`）场景有冲突，P1 降级为只读展示，跳转放 P2。
- **strip 与 Pill 的状态同步**：通过 `taskCenterUiStore.popoverOpen` 单源管理，避免两处各自维护 open state。
- **移动端**：P1 移动端仅保留 ambient strip；BottomPanel 挂载随 P3 的 panel extension 自然获得（`usePanelRegion` 已处理 mobile 兜底），不在 P1 投入。
- **不扩散旧模式**：新 Popover 用 `z-dropdown` token 和 `SECTION_LABEL`，不复制 header 里的 `z-[70]` 任意值。

## 8. 验证记录（2026-10-05，已完成）

### E2E 方法：WS 注入（可复用于 P2–P4）

无需改动应用代码即可端到端驱动任务中心：

1. `pnpm browser:build && pnpm browser:start`（构建与启动**必须分开执行**——`cmd1 && cmd2 &` 的后台链会让 server 抢在构建完成前启动，服务旧产物）。
2. Playwright `page.routeWebSocket(/\/ws\//, ...)` 拦截 `ws://<host>/ws/backend-facade`，双向转发。
3. 注入的消息必须套 facade 信封：`{ type: 'backend_message_received', backendId, message }`；`backendId` 从首个 `facade_snapshot` 消息的 `snapshot.localBackendId` 取。
4. `task_notification` / `task_status_notification` 按 wire 类型直发即可；不带 `seq` 时 `isStaleRunEvent` 直接放行。
5. 注意：注入带 `taskRootPid` 的任务会触发 PID monitor 查询真实进程——用一个不存在的 PID 可以顺带验证"进程退出 → 标记 stopped"链路。

### 验证抓到的两个 bug（已修复，附回归测试）

1. **双 dialog DOM**：移动 overlay 起初只靠 CSS `md:hidden` 隐藏，桌面端 DOM 里同时存在两个 `role="dialog"`。教训：**双挂载容器必须按断点条件渲染，不能只做 CSS 隐藏**——`TaskCenterEntry` 现在用 `useIsMobile()` 二选一渲染。
2. **事件对象渗入 store action**：`onClick={onClearFinished}` 会把 MouseEvent 当作 `sessionId` 传给 `clearTerminalTasks`，导致清除静默失效。教训：**store action 不能直接别名为 React 事件处理器**——`useTaskCenter` 的 `clearFinished` 现为显式无参包装，并有"带事件参数调用"的回归测试。

### 验证结果

- 注入运行中/完成/进程退出等消息流后：Pill 计数、strip、分组、详情展开、Stop/Dismiss、Clear finished 全部符合设计；终态任务 20 秒后仍保留（旧行为 15 秒消失）。
- 全量 desktop 测试 4578 通过；`check:radius` OK；页面零 JS 错误。
