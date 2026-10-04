# 内置工具集对齐 ZCode 实施计划

> 依据：[2026-09-23-zcode-tool-set-gap.md](../reports/2026-09-23-zcode-tool-set-gap.md)。步骤用 `- [ ]` 跟踪。

**Goal:** 补齐 Pi runtime 工具集相对 ZCode 的差距：执行框架（契约元数据 + 调度 + 超时）、Bash 只读免审批、子代理类型与消息、agent 可调用自动化、跨会话上下文读取，以及若干小项。文件编辑类工具不动。

**Architecture:** 所有改动落在 `server/src/infra/providers/pi-runtime/`、`server/src/application/conversation/agent/` 与 `shared/src/core/tools.ts`，不 fork pi-agent-core。调度与超时用 execute 外层 wrapper 实现；只读分类在 `PermissionEvaluator.classify()` 的 Bash 分支里降级类别；子代理类型复用 agent-profiles 与现有 AgentTaskRunner；SendMessage 复用 run steer 通道。

**Tech Stack:** TypeScript、Vitest、pi-agent-core 0.84.1、better-sqlite3。测试命令一律 `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server test -- <files>`。

---

## 核实结论（决定改法）

- pi-agent-core 的 `executeToolCalls` 不可注入；`beforeToolCall` 在串行准备循环里，不能当闸门；`tool.execute` 外层 wrapper 是唯一无侵入插入点。结果按源顺序重排，延迟执行不会乱序。
- `AgentTool.executionMode = 'sequential'` 会让整批退化串行，不用。
- `classify()` 的 Bash 分支在危险与网络判定之后 `return 'shellSafe'`，只读降级插在这一行前。默认 profile 下 shellSafe 与 fileRead 都是 auto-approve，降级只对收紧过的 profile 有效。
- 子代理走 `AgentTaskRunner`，会建真实 session；`task-tools.ts` 调 `startTask` 时丢了 sessionId，这是 SendMessage 的唯一缺口。steer 通道是 `run.steerHandle.steer()`，先例在 `task-settlement-notifier.ts`。
- agent-profiles 是全局的，无项目列；子代理权限只能收窄。
- automations 的 run 走 workflow 引擎的 `ai_prompt` 步骤，不建 session；无数量上限。
- 另一会话消息读取无项目边界检查，需自加；辅助模型用 `completeSimple` 一次调用。
- 浏览器动作是 `agent_browser` 插件工具，scope 只给 `type:'agent'` 会话。

## Task 1: 工具契约元数据 + 调度器 + 超时

- [x] `shared/src/core/tools.ts` 的 `ToolMetadata` 增加可选 `concurrentSafe`、`timeoutMs`；为 30 个内置工具补值；导出 `resolveToolConcurrency()`。
- [x] 新建 `pi-runtime/tool-scheduler.ts`：`ToolScheduler`（shared / exclusive 两档 + 全局并发上限 10）与 `withToolScheduler()`（含超时、abort 联动）。
- [x] `run-tools.ts` 末尾对全部工具（含 MCP 与元工具）应用；`agent-loop/toolsets.ts` 与 `skills.ts` 的 fork 工具集同样应用。
- [x] 测试 `__tests__/tool-scheduler.test.ts`。

## Task 2: Bash 只读分类器

- [x] 新建 `application/conversation/agent/bash-readonly/`：解析（复用 `shell-parser.ts` 的分段与分词，新增重定向与动态词判定，失败即不可证明）、策略表、`isProvablyReadOnlyBashCommand()`。
- [x] `permission-evaluator.ts` `classify()`：危险与网络判定之后，只读命令降级为 `fileRead`。
- [x] `run-permissions.ts` 的 `READONLY_BASH_COMMANDS` 改用新分类器。
- [x] 测试：新建 `bash-readonly.test.ts`，扩展 `permission-evaluator.test.ts`。

## Task 3: 子代理类型 + 任务会话关联 + SendMessage

- [x] `task-tools.ts` Agent 工具增加 `subagent_type`，从 agent-profiles 取活跃 profile 名单校验；描述在构建时列出可用类型。
- [x] `agentProfileId` 经 task metadata → `agent-executor.ts` → `agent-task-runner.ts` → `createSession(agentProfileId)`；`startTask` 传回 `sessionId`。
- [x] 新增 `SendMessage` 工具：`task_id` + `message`；活跃 run 走 steer，已结束的 agent 任务在同一 session 上重新起任务（resumed_background）。通过新增的 `subagentMessenger` 端口注入。
- [x] 测试：扩展 `task-tools.test.ts`、`agent-task-runner` 相关测试。

## Task 4: Cron 工具

- [x] 新建 `pi-runtime/automation-tools.ts`：`CronCreate` / `CronList` / `CronUpdate` / `CronDelete`，通过 `automationPort` 注入；只在有 port 时注册。
- [x] 契约：`cron` 或 `delayMinutes` 或 `intervalMinutes` 三选一；`CronDelete` 标 destructive。
- [x] 测试 `automation-tools.test.ts`。

## Task 5: ReadSessionContext

- [x] 新建 `pi-runtime/session-context-tool.ts`：`session_id` + `query` + `strategy`；同项目校验；`completeSimple` 抽取。
- [x] 测试。

## Task 6: WebFetch `prompt` 摘要 + 缓存

- [x] `web-tools.ts` 增加可选 `prompt`，有则用辅助模型按 prompt 回答；无则保持原行为。
- [x] 进程内 LRU 缓存（15 分钟，50 MB 上限）。
- [x] 测试。

## Task 7: 小项

- [x] Bash `description` 参数（仅 UI 展示）。
- [x] TodoRead 工具。
- [x] AskUserQuestion `preview` 字段透传。

## Task 8: 收尾

实施记录（2026-09-23）：全部在分支 `feat/tool-set-alignment` 上完成，未提交。server 全量 6304 测试、shared 219 测试通过；server/shared lint 0 error；改动文件 prettier 通过。桌面端无需改动（tsc 通过，无测试引用工具表）。

- [x] LSPTool 名不副实：见 Task 9，已改为端口门控的预留入口。
- [x] `pnpm --filter @zclaudia/shared build` + server 全量测试 + lint。
- [x] 更新 `docs/reports/2026-09-23-zcode-tool-set-gap.md` 的状态。

## Task 9: LSPTool 预留入口（2026-09-23 追加）

决定：不下线名字，下线实现。工具面保留为内置（只读分类、shared 调度、稳定名字都靠内置才有），server 由插件声明（对齐 ZCode 的 `lspServers`）、由 server 内一个 manager 统一拉进程与做文档同步。MCP 注入不采用：`mcp__*` 一律 networkOps + exclusive，且拿不到写后事件。

- [x] `server/src/infra/providers/language-server-port.ts`：`LanguageServerPort { serversFor(cwd); query(request, signal) }`、查询/结果类型、`LanguageServerError`、`hasLanguageServers()`。位置 1-based，manager 负责转 0-based；按实际 cwd 键控（worktree 子代理）。
- [x] `pi-runtime/lsp-tool.ts`：`createLspTool({ cwd, port })`，动作 definition / references / hover / symbols / diagnostics；symbols 有 file 走 documentSymbols、只有 query 走 workspaceSymbols；文件必须在工作区内；描述列出可用 server。
- [x] 门控在 `buildTools` 循环（与 Memory 同处）：port 缺席或 `serversFor(cwd)` 为空则不注册。`RunOptions.languageServerPort` 由 run-tools 透传；今天没有任何实现接线，工具永远不出现。
- [x] 删除 `search-tools.ts` 里的 ripgrep 版 LSPTool 与 `ripgrepSearch`；shared 元数据改 `concurrentSafe: true, timeoutMs: 30_000`，描述如实。
- [x] 测试：`lsp-tool.test.ts` 新增；tool-bridge / run-tools 门控用例；pi-adapter 工具数断言改 `- 7`；search-tools 删 4 个 ripgrep 用例。
- [ ] 后续：`LanguageServerManager`（进程、initialize、didOpen/didChange、诊断）+ 插件 manifest `lspServers` + 复用 `lsp-diagnostics-adapter.ts` 的写后诊断；rename 另开可写工具。
