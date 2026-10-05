# P5 实施计划 — 子代理内层步骤流（parentToolUseId 全链路打通）

日期：2026-10-05
上游：`docs/mockups/task-center-mockup.html` Frame 4（抽屉的「执行过程」迷你步骤流，P4 砍掉的部份）
前置：P4 抽屉已落地（`7ef3a0ad`），本计划补齐其数据源。
涉及仓库：`zclaudia-plugin-sdk`（本地 `/Users/zhvala/SourceCode/zclaudia-plugin-sdk`）+ `zclaudia`。

## 0. 问题与思路

Claude Agent SDK 给每条子代理消息（assistant / user / stream_event）打 `parent_tool_use_id`，这是「内层工具调用属于哪个 Task 调用」的唯一血缘标记。当前该标记在插件边界被丢弃：

- `plugins/agents/claude/src/runner.ts` 只用它做丢弃判断（stream_event 丢、usage 不计），从不转发；
- `@zclaudia/plugin-sdk` 的 `ProviderRuntimeEvent`（`src/providers.ts`）**没有该字段**，runner 想传也没处放；
- 下游 server translator / wire / desktop runStore 因此全部无感知，runStore 把一个 run 的所有工具调用摊平，抽屉拿不到「这个 agent 干了哪几步」。

思路：把 `parentToolUseId` 作为**可选字段**沿链路逐跳透传（plugin-sdk → runner → server domain → wire → desktop meta），desktop 端用 runStore 既有的 `runToolMeta` 平行映射模式承载（`effect`/`backgroundable` 就是这么进宿主侧的），最后在抽屉渲染步骤流。每一跳都是机械透传；不加字段的运行时（pi / codex / cursor）完全不受影响。

## 1. 逐跳改动点

### 1.1 plugin-sdk（独立仓库，先改先发）

- `src/providers.ts`：`ProviderRuntimeEvent` 加 `parentToolUseId?: string`（注释：子代理内层事件的血缘，值为父 Task 调用的 tool_use_id；仅 claude 类嵌套 runtime 发出）。
- `package.json`：version `0.6.0` → `0.6.1`（additive optional，patch）。
- 验证：`pnpm check`（typecheck + test + build + pack:check）。

### 1.2 claude runner（`plugins/agents/claude/src/runner.ts`）

- `transformClaudeSdkMessage` 顶部取 `const parentToolUseId = msg.parent_tool_use_id`（string 时有效）。
- `assistant` 分支的 `tool_use` 事件、`user` 分支的 `tool_result` 事件：带 parent 时附上 `parentToolUseId`。
- 子代理 `stream_event` 维持丢弃（抽屉步骤取自完整消息块，不需要内层文本 delta）。
- 测试：transform 用例——带 parent 的 assistant/user 消息产出带字段事件；主循环消息不带。

### 1.3 server（`server/src/application/conversation/runtime/`）

- `run-domain-events.ts`：`ToolEventPayload` 加 `parentToolUseId?: string`（`tool.started`/`tool.finished` 共用）。
- `provider-event-translator.ts`：`tool_use`/`tool_started` 与 `tool_result`/`tool_finished` 分支透传。
- `wire-projector.ts`：`tool_use`/`tool_result` wire 消息带条件展开 `...(payload.parentToolUseId ? { parentToolUseId } : {})`。
- 测试：translator + projector 各补透传用例。

### 1.4 shared（`shared/src/wire/messages/run.ts`、`shared/src/core/message.ts`）

- `ToolUseMessage` / `ToolResultMessage` 加可选 `parentToolUseId`。
- `ToolCall`（持久化 metadata 形态）加可选 `parentToolUseId`——重载历史时内层步骤仍可归因。

### 1.5 desktop

**存储（复用 runToolMeta 平行映射，不动 kit）**

- `stores/runTypes.ts`：`ToolCallHostMeta` 与 `ToolCallState` 各加 `parentToolUseId?: string`。
- `services/message-handlers/delta-buffer.ts`：`scheduleToolUse` 加末参，写入 `metaByTool`。
- `services/message-handlers/run-messages.ts`：`tool_use` 分支透传 `msg.parentToolUseId`。
- `stores/runStore.ts`：`addToolCall` 末参 → `runToolMeta`；`toToolCallState` 投影进 `ToolCallState`。（`tool_result` 不需带：meta 在 tool_use 时已落。）

**持久化 round-trip（desktop 是写入方，server 不透明存储 metadata，无需改 server 持久层）**

- `services/message-handlers/run-finalization.ts`：序列化 `parentToolUseId` 进 message toolCalls metadata。
- `services/message-hydration.ts`：hydrate 时映射回 `ToolCallState`。

**渲染**

- `features/chat/tool-call/ToolCallList.tsx`：三种模式（streaming / collapsed SummaryBar / expanded）统一过滤 `tc.parentToolUseId` 非空的调用——内层步骤不再出现在主 transcript，只在抽屉里。
- `features/task-center/useSubagentSteps.ts`（新）：按 `task.toolUseId` 跨 run 收集 `parentToolUseId` 匹配的 `ToolCallState[]`（activeToolCalls 优先、history 兜底），保持出现顺序。
- `features/task-center/TaskDrawer.tsx`：Prompt 之上加 **Steps** 区——迷你步骤行（`getToolIcon` 图标 + 工具名 + 一行参数摘要 + 状态点），复用 `ToolCallList` 的 `getToolCallSummary` 做参数摘要（导出重用它，避免第二份格式化逻辑）。

## 2. 依赖流转（关键路径）

zclaudia 的 `pnpm-workspace.yaml` 把 `@zclaudia/plugin-sdk` override 钉在 `0.6.0`。本地联调期间临时改为 `link:../zclaudia-plugin-sdk` 跑全量测试；**提交前**改为 `0.6.1` 并同 commit 落地。合并顺序约束：

1. plugin-sdk 提交并发布 `0.6.1`（发布动作由仓库 owner 执行）；
2. zclaudia 提交（pin `0.6.1`）；
3. 发布后 zclaudia 侧 `pnpm install` 重建 lockfile（本次提交不动 lockfile，避免把 link 路径固化进去）。

## 3. 测试与验证

| 层 | 内容 |
|---|---|
| plugin-sdk | `pnpm check` 全绿 |
| runner | transform 透传用例（带/不带 parent） |
| server | translator/projector 透传用例 + 现有套件 |
| desktop | meta 链路（addToolCall→ToolCallState 投影）、hydration round-trip、ToolCallList 三种模式过滤、drawer steps 渲染与排序；全量 vitest + tsc + radius |
| E2E | WS 注入带 `parentToolUseId` 的 tool_use/tool_result：主 transcript 只见 1 张 Task 卡、抽屉 Steps 实时列出内层步骤；真 claude 后端的手动验证留给发布后 |

## 4. 风险与备注

- **现状揭示**：runner 目前把子代理内层 `tool_use`/`tool_result` 块无标记转发（注释明言 "only their tool_use / tool_result blocks are surfaced"），即 claude runtime 下主 transcript 现在就会混入内层调用卡。本计划落地后它们被过滤进抽屉——顺带修正了这个串扰。
- **并行 Task 归因**：血缘按 tool_use_id 精确匹配，并行 agent 互不混淆。
- **非 claude 运行时**：不发该字段，行为与今天完全一致。
- **重载降级**：P4 抽屉的 prompt/result 解析依赖 runStore 活态，reload 后退化（P4 既有限制）；steps 的 metadata round-trip 让**历史消息**里的 Task 卡在展开态也能看到步骤归属（ToolCallList 过滤），抽屉 steps 仍只覆盖活态 run。
