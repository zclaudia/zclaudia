# T1 Agent 核心运行时与终端形态 对比报告

- 对比对象：ZCode（`/Users/zhvala/SourceCode/zcoder/apps/zcode-cli`，Apache-2.0）vs zclaudia（`/Users/zhvala/SourceCode/zclaudia`）
- 维度：agent 主循环与子代理体系、工具系统与权限审批、hooks 生命周期、会话恢复与上下文压缩、TUI 终端形态
- 方法：目录结构 + package.json/README/AGENTS.md → 关键入口文件精读 → 定向 grep；均为本次会话实读，行号/文件数来自 `ls`/`wc -l`/`grep` 实际输出。
- 许可提示：ZCode 仓库根 `LICENSE` 为 Apache License 2.0（已确认文件头）。任何「直接移植」须保留其许可声明与 NOTICE 归属；下文各项均已注明搬运方式，逐条不再重复。

---

## 1. 两侧结构对照（简表）

| 子域 | ZCode（apps/zcode-cli/packages） | zclaudia | 差距判断 |
|---|---|---|---|
| Agent 主循环 | `core/src/runtime/agent-runtime.ts`（720 行）+ `core/src/agent/turn-machine.ts`（344 行显式状态机）+ `runtime/methods/`（约 150 个文件：turn-loop、steering、resume、fork、rewind、compact 等） | 双轨：自有 Pi 运行时 `server/src/infra/providers/pi-runtime/agent-loop/pi-agent-loop-executor.ts`（基于 `@earendil-works/pi-agent-core` 的 `runAgentLoop`）+ 外部引擎插件（claude/codex/cursor 经 SDK/ACP 驱动，`plugins/agents/*/src/runner.ts`） | 循环本体相当（zclaudia 复用 pi-agent-core 成熟实现）；ZCode 在**循环外围的规范化**（状态机、命令队列、恢复）更强 |
| 子代理 | `core/src/subagent/runner.ts`（2145 行：前台/后台、SendMessage 导向、快照/等待/停止）+ explore/general-purpose/persistent-memory + `tool-event-mirror.ts` | `pi-runtime/task-tools.ts`（645 行：Agent/TaskOutput/Monitor/SendMessage/RespondToCoordinator）+ `session-tree/` + `conversation/runtime/background-task-coordinator.ts` | 主干相当；ZCode 多持久记忆、事件镜像、任务注册表一等化 |
| 工具系统 | `core/src/tool/`：`handlers/` 129 个文件、`executor/` 39 个文件、scheduler/registry/path-policy/read-file-state 等 | `pi-runtime/` 100+ 文件（read/bash/edit-write/grep/symbol/web/skill/task/lsp/eval 等）+ `tool-scheduler.ts`（并发上限 10、超时、快照） | 工具覆盖面相当；ZCode 在 bash 只读判定深度与变更纪律上领先 |
| 权限审批 | `core/src/permission/service.ts`（732 行）+ `broker.ts` + `tool/executor/permission-*`（10 文件）+ 授权跨 resume 恢复 | `conversation/agent/permission-evaluator.ts` + `permission-memory.ts`（remember key 持久化）+ `permission-rule-promotion.ts` + `bash-readonly/` + `runtime/run-permissions.ts` | 主干相当；ZCode 增量在授权恢复、审批竞态、能力分组 |
| Hooks | `contracts/src/hooks/index.ts`（8 类事件 + zod schema）+ `core/src/hooks/`（runner 462 行 + workspace-hook-trust 约 10 文件） | `shared/src/interaction/user-hooks.ts:3` 仅 `PreToolUse \| PostToolUse`；执行器 `pi-runtime/user-hooks.ts`；配置 `conversation/runtime/resolve-user-hooks.ts`（global+project 两层） | **事件面 2 vs 8，且无信任准入**，明显落后 |
| 上下文压缩 | `core/src/compact/`：auto-compact 策略（policy.ts，provider_usage token 源、preflight-v1、熔断）+ **microcompact.ts（286 行工具结果定点清理）** + manual/prompt/rounds | `conversation/compaction/`：compaction-service.ts（371 行，摘要式 + 串行化队列）+ chunked-summary.ts + circuit-breaker.ts（熔断 + 冷却，env 可调） | 摘要式相当；**缺 microcompact 层** |
| 会话恢复/fork/rewind | `runtime/methods/resume.ts`（执行状态恢复 + 权限授权恢复 + checkpoint 还原）+ `session-fork.ts`（identity remap）+ `file-rewind.ts`（717 行）+ `workspace-checkpoints.ts` + `contracts/src/rewind/`（Scope/Strategy zod） | `session-tree/fork.ts`（forkSessionAt）+ `pi-runtime/file-history.ts`（每文件 20 份备份/7 天 TTL）+ `runtime/run-recovery.ts` + sqlite session 存储 | 有原语；ZCode 的 scope/strategy 模型与消息级 rewind 语义更完整 |
| TUI | `packages/tui/src/`：**86 个源文件**（OpenTUI React 19 + shiki 高亮 + 鼠标滚动回看 + 侧栏 + 主题 + i18n），另有 `docs/design/v2/tui-*.md` 约 24 篇 spec 和 `bootstrap/src/zcode-protocol-v4/`（TUI 只是客户端之一） | **缺失**：无任何 TUI 包；`apps/desktop` 为 Tauri+React，`server/src/infra/terminal-manager.ts` 是面向桌面 UI 的 node-pty 终端透传，不是 agent TUI | 形态级空白 |
| 测试 | 各包 `--test` + `e2e/`（含 compact-microcompact、file-tools-atomic-write）+ `tests/` | plugins/agents + agent-common + server/application 共 178 个 `*.test.ts`（`find` 统计） | 覆盖广度两侧都重视 |

---

## 2. ZCode 领先点（核心章节）

### 2.1 Hooks 生命周期：8 类事件 + workspace hook 信任准入体系 【P1】
- **解决的问题**：让 hook 不只「Pre/Post 工具」两个点，而能介入权限请求、工具失败、提交 prompt、会话起止；并解决「项目里别人的 hook 脚本是否可信」的准入问题。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/contracts/src/hooks/index.ts`：`HookEventName` 含 `PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / UserPromptSubmit / SessionStart / Stop`（第 70–193 行区域，zod discriminatedUnion 输出 schema）
  - `apps/zcode-cli/packages/core/src/hooks/runner.ts`（462 行 `InMemoryHookRunner`，统一 emitHookEvent/结果解包/诊断脱敏）
  - 信任准入子系统：`apps/zcode-cli/packages/core/src/hooks/workspace-hook-trust-{coordinator,evaluation,records,admission,review-flow,telemetry,domain}.ts` 等约 10 个文件
- **zclaudia 现状**：事件仅 `PreToolUse | PostToolUse`（`shared/src/interaction/user-hooks.ts:3`）；执行器 `server/src/infra/providers/pi-runtime/user-hooks.ts`（顺序执行、exit 2 拦截、超时放行）；配置两层叠加 `server/src/application/conversation/runtime/resolve-user-hooks.ts`。**PermissionRequest / SessionStart / Stop / PostToolUseFailure 事件缺失**；无 hook 信任准入。
- **可搬运性**：重写借鉴。zclaudia 已有 hook 执行管道与两层配置源，扩事件枚举、在 run-handler/permission 流程埋点即可；信任准入状态机（评审→记录→遥测）按 ZCode 模型重写落位到 `conversation/agent/`。
- **体量估计**：事件扩展 2–3 天；信任准入子系统 1–2 周。

### 2.2 子代理运行时：前台/后台生命周期 + 运行中 SendMessage 导向 + 任务注册表一等化 【P1】
- **解决的问题**：subagent 不是「阻塞跑完返回文本」，而是可后台化、可中途导向（steer）、可查询快照、完成后以结构化通知回流父会话的一等任务对象。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/core/src/subagent/runner.ts`（2145 行：`SubagentStart/Run/SendMessage/Wait/Stop/TaskSnapshot`、`AgentBackgroundedOutput`、child traceContext、子会话持久化钩子 `onSessionReady`）
  - `apps/zcode-cli/packages/core/src/runtime-task/registry.ts`（运行时任务注册表：快照、pending message、终态判定）
  - `apps/zcode-cli/packages/core/src/subagent/tool-event-mirror.ts`（子代理工具事件镜像到父会话 UI，186 行）
  - `apps/zcode-cli/packages/core/src/subagent/completion-notification.ts` + `message-steering.ts`
- **zclaudia 现状**：`server/src/infra/providers/pi-runtime/task-tools.ts` 已有 Agent/TaskOutput/Monitor/SendMessage/RespondToCoordinator（含 roster 解析）；`conversation/runtime/background-task-coordinator.ts` + `subagent-messenger.ts` 存在。差距在：无统一的 runtime-task 快照/注册表抽象、无子代理工具事件向父会话时间线的镜像、导向语义分散在多个 coordinator。
- **可搬运性**：重写借鉴。接口形状（Send/Wait/Snapshot/Stop）可直接对齐；落到 zclaudia 需接 session-tree 与 transport 广播。
- **体量估计**：注册表 + 镜像 1–2 周。

### 2.3 Microcompact：工具结果定点清理压缩层 【P1】
- **解决的问题**：会话超限前先清「旧的大工具结果」（读文件、bash 输出等），避免动辄全量摘要；比 summary compaction 更快、保真更高。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/core/src/compact/microcompact.ts`（286 行：阈值比 0.9、保留最近 5 条工具结果、idle 60 分钟、最小节省 256 token、9 类可压缩工具白名单、错误结果清理、`[Old tool result content cleared]` 占位）
  - `apps/zcode-cli/packages/core/src/compact/policy.ts`（auto-compact 决策：`provider_usage` token 源、legacy/preflight-v1 预算策略、输出预留 32K、连续失败熔断 3 次、`reason` 枚举可观测）
  - e2e：`apps/zcode-cli/e2e/compact-microcompact/`
- **zclaudia 现状**：`server/src/application/conversation/compaction/`（compaction-service.ts 371 行摘要式 + chunked-summary.ts + circuit-breaker.ts 熔断/冷却）——**没有工具结果定点清理层**；压缩即全量摘要。
- **可搬运性**：重写借鉴。策略常量与决策逻辑可直接对照实现，落点在 pi-agent-core 的 Entry 模型上做定点替换；注意保留 ZCode 的「决策 reason 可观测」设计。
- **体量估计**：3–5 天。

### 2.4 TUI 终端形态整体缺失 【P2】
- **解决的问题**：为 server 型 agent 提供键盘优先的本地终端客户端；ZCode 还把 TUI 设计为 Protocol V4 的一个普通客户端，业务状态不在 TUI 层（见 `apps/zcode-cli/AGENTS.md`「TUI 只负责输入采集、布局渲染和临时交互态」）。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/tui/src/`（86 文件：`app-permission.ts`、`app-approval.ts`、`app-question-panel.tsx`、`app-file-mentions.ts`、`app-sidebar-subagents.tsx`、`app-shiki-diff-view.tsx`、`app-mouse*`/`app-selection-*`、`app-queued-inputs.tsx`、`theme/` 等；React 19 + `@mbears/opentui-*`）
  - spec：`apps/zcode-cli/docs/design/v2/tui-*.md` 约 24 篇（markdown 渲染、鼠标滚动回看、选区复制、主题、响应式侧栏等）
  - 客户端协议：`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/`（cold-session-resume、command-inbox、interaction-registry 等）
- **zclaudia 现状**：缺失（无 TUI 包；desktop/mobile web 之外无终端形态；`server/src/infra/terminal-manager.ts` 为 node-pty 终端透传，非 agent 客户端）。
- **可搬运性**：重写（大体量）。不建议搬 OpenTUI 栈本身；可借鉴「协议客户端」架构——zclaudia 的 `transport/` wire 消息已是同构思路，如要做终端形态，为现有 server 写一个轻量 TUI 客户端即可。
- **体量估计**：完整 TUI 4–6 周；最小可用（transcript+输入+权限面板）1–2 周。

### 2.5 Turn 状态机 + Runtime Command Queue（结构化 steering/排队输入）【P2】
- **解决的问题**：把「一轮」的相位（模型请求→工具调度→权限→聚合→完成/失败）与「轮中插入的输入/通知/控制命令」形式化，避免散落各处的回调态。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/core/src/agent/turn-machine.ts`（344 行：`requestPermission/resolvePermission/queuePendingInput/drainPendingInputs/aggregateResults` 等显式相位转移）+ `turn-state.ts`（相位合法性 `canTransitionTo`）
  - `apps/zcode-cli/packages/core/src/runtime/command-queue.ts`（五类可排队命令：`PromptRuntimeCommand / TargetContinuation / TaskNotification / SubagentMessage / ControlOnlyTurn`）
  - `apps/zcode-cli/packages/core/src/runtime/helpers/steering.ts`（轮中输入 fork 进历史）
- **zclaudia 现状**：能力存在但未收敛——`conversation/transport/message-handler.ts:227` 的 `run_steer`、`runtime/background-follow-up.ts`、`pending-task-notices.ts` 分散处理。
- **可搬运性**：重写借鉴。命令队列抽象可直接移植（纯 TS 无外部依赖），接在 `run-handler.ts` 主循环上。
- **体量估计**：1 周。

### 2.6 会话 fork / rewind / workspace checkpoint 体系 【P2】
- **解决的问题**：对话树分支、消息级回退、文件级回滚三者打通，且 fork 时 identity（消息/目标/校验器 id）完整重映射、可跨恢复。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/core/src/runtime/methods/session-fork.ts`（`ForkIdentityMap`、goal 快照重映射、原子 fork notice）+ `stable-fork-boundary.ts`
  - `apps/zcode-cli/packages/core/src/runtime/methods/file-rewind.ts`（717 行）+ `workspace-checkpoints.ts`（357 行）+ `runtime/helpers/rewind.ts`（checkpoint 与消息匹配、preview 文案）
  - 契约：`apps/zcode-cli/packages/contracts/src/rewind/index.ts`（`RewindScope/RewindStrategy/RewindTargetStatus` + zod `checkpointCreatedPayloadSchema`）
  - 恢复联动：`runtime/methods/resume.ts` 恢复 `restoreWorkspaceCheckpointEntries/restoreWorkspaceFileRewindEntries`
- **zclaudia 现状**：原语已有——`pi-runtime/session-tree/fork.ts`（forkSessionAt）、`pi-runtime/file-history.ts`（备份/恢复，每文件 20 份、7 天 TTL）；无 RewindScope/Strategy 级模型与消息↔checkpoint 匹配层（深度未全面核对，部分为推断）。
- **可搬运性**：重写借鉴。契约模型照抄思想，落 zclaudia session-tree。
- **体量估计**：1–2 周。

### 2.7 权限：授权跨 resume 恢复 + 审批竞态处理 + 审批建议 【P2】
- **解决的问题**：审批是异步交互，需要处理「批下来时轮已结束/流已断」「用户没选时的默认建议」「重启后未消费的授权」等长尾。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/packages/core/src/runtime/permission-grant-recovery.ts`（`recoverPendingPermissionGrant` + `unpublishedPermissionGrants` WeakMap）+ `runtime/helpers/permission-grant-resume.ts`（`restorePermissionGrantMarker`）
  - `apps/zcode-cli/packages/core/src/tool/executor/permission-responder-race.ts`、`permission-suggestions.ts`、`permission-rules-persistence.ts`、`permission-flow.ts`（Guarded 统一审批生命周期，另见 `docs/design/v2/permission-broker.md`）
  - 规则模型：`core/src/permission/service.ts`（capability group、risk level、`sideEffectScope`、plan-mode 策略 `permission/plan-mode-policy.ts`）
- **zclaudia 现状**：主干相当——`conversation/agent/permission-evaluator.ts`（approve/deny/escalate、remember key）、`permission-memory.ts`（会话级记忆 + 项目级白名单）、`permission-rule-promotion.ts`、`run-permissions.ts`（统一策略归一/合并/收窄）。**缺**：授权跨 resume 恢复、审批竞态显式处理、审批建议生成。
- **可搬运性**：重写借鉴（三处增量各自独立，可按需拆）。
- **体量估计**：各 2–4 天。

### 2.8 子代理持久记忆（user/project/local 三级作用域）【P2】
- **解决的问题**：专用 agent（如 code-reviewer）跨会话积累领域记忆，按作用域隔离存取并在启动时注入。
- **证据路径（ZCode 侧）**：`apps/zcode-cli/packages/core/src/subagent/persistent-memory.ts`（110 行：`~/.zcode/agent-memory/<agent>` / `.zcode/agent-memory` / `.zcode/agent-memory-local` 三级根目录解析）+ `persistent-memory-prompt.ts`（169 行注入文案）+ `profile.ts`（`AgentMemoryScope`，re-export 自 contracts）
- **zclaudia 现状**：缺失——`shared/src/core/agent-profile.ts:47-77` 的 `AgentProfileConfig` 无 agent 级记忆字段；`pi-runtime/memory-tool.ts`/`memory-provider.ts` 是主会话记忆，非 per-agent 持久记忆。
- **可搬运性**：重写借鉴（作用域目录约定 + 注入逻辑都很薄）。
- **体量估计**：2–3 天。

### 2.9 spec 驱动的工具变更纪律 + contracts/adapters 架构边界 【P3】
- **解决的问题**：工具/权限/事件任何一处改动都要过端到端链路 checklist，防止「改了 schema 忘了 UI/远控/持久化」。
- **证据路径（ZCode 侧）**：
  - `apps/zcode-cli/docs/design/v2/tool/00-tool-change-chain.md`（强制前置阅读；含多次带日期的演进记录与验收要求）
  - `apps/zcode-cli/AGENTS.md`（traceId 强制贯穿、I/O 全部收敛 adapter、单文件 400 行上限、schema 优先等）
  - `apps/zcode-cli/packages/contracts/src/`（events/rewind/hooks/tools 全 zod）+ `packages/adapters/src/`（exec/fs/model/provider/storage 等 21 目录）
- **zclaudia 现状**：有 `shared/wire`、plugin-sdk 与 178 个测试文件，但无等价的「工具变更链」spec 纪律文档（`docs/` 下未见对应物，未穷尽核对）。
- **可搬运性**：仅思路（流程资产，非代码）。
- **体量估计**：写 spec 1–2 天，长期执行成本为主。

### 2.10 Bash 只读判定的方言级完备度 【P3】
- **解决的问题**：把「这条 bash 命令是否只读」判定到 argv/flag/git 子命令/方言（CMD/POSIX/Git Bash）粒度，支撑 plan 模式与自动放行。
- **证据路径（ZCode 侧）**：`apps/zcode-cli/packages/core/src/tool/handlers/bash-readonly-policy-*.ts` 约 20 个文件（argv-direct/flags-git/multiword-gh/commands 等），变更验收记录见 `docs/design/v2/tool/00-tool-change-chain.md` 的 2026-09-24 补充段（七类识别正反例）。
- **zclaudia 现状**：`server/src/application/conversation/agent/bash-readonly/`（analyze.ts/policies.ts/index.ts）+ `shell-parser.ts`——有实现但规模小约一个数量级。
- **可搬运性**：仅思路 + 局部借鉴（规则表可逐步补齐；ZCode 文件均 <400 行，规则本身语言无关）。
- **体量估计**：按需增量，每类命令 0.5–1 天。

---

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

1. **多引擎插件运行时**：claude（`@anthropic-ai/claude-agent-sdk` 0.2.141）、codex（app-server 协议）、cursor（ACP）统一到一套 invocations/permissions 抽象（`plugins/agents/*/src` + `runtime-compatibility.json`）；ZCode 是单一自有引擎。
2. **Server/gateway 形态**：跨设备会话同步（transport wire 消息 + broadcast）、移动 web、推送通知链路；ZCode 以本机 CLI/TUI 为主，远控协议为辅。
3. **托管 CLI 安装体系**：`server/src/application/managed-runtimes/`（service 702 行 + installer/downloader/gc/provenance/process-probe），插件作用域内安装验证过的 CLI，不污染系统。
4. **基于 pi-agent-core 的成熟原语**：stream retry、usage 抽取、chunked summary、session 树 sqlite 存储直接复用上游库（`server/package.json` 的 `@earendil-works/pi-agent-core` / `pi-ai` 0.84.1）。
5. **AI 监督/编排域**：`conversation/agent/delegation/`、`ai-review-queue.ts`、`orchestration/`（ZCode 的对应物是 workflow 引擎，定位不同）。
6. **工具结果落盘与预算**：`pi-runtime/agent-hooks.ts` 的每轮 192KB 预算 + 磁盘持久化 + Edit 洪水检测 + 失败循环熔断（`tool-failure-loop-guard.ts`），粒度比 ZCode 的对应机制更贴近防呆。

## 4. 不建议搬运的（及原因）

1. **OpenTUI + React 19 终端栈整体搬运**：与 zclaudia 的 Tauri+React 桌面/移动形态重叠且双前端维护成本高；若确需终端形态，按 ZCode「TUI 只是协议客户端」的架构思路新写轻量客户端（见 2.4）。
2. **ZCode 自有 provider/model 接入层**（`packages/adapters/src/provider`、`model`）：zclaudia 已有 `build-model.ts` + `models-registry.ts` + 多引擎插件，重复建设。
3. **SEA 单文件打包路径**（`docs/design/v2/sea-*.md`、`packages/cli` 的 sea 脚本）：zclaudia 分发走 Tauri/pnpm，无单可执行需求。
4. **`subagent/runner.ts` 的 2145 行单文件形态**：ZCode 自己在文件头注明「拆分前需要先稳定生命周期边界」；搬运时应按 zclaudia 现有 task-runtime/session-tree 边界拆分落位，而不是照抄结构。
5. **`docs/design/v2` 全量 spec 体系**：82 篇文档与 ZCode 的开发流程强绑定；只取「tool change chain」这类链路清单思想即可。

---

## 附：核对方式与未验证项

- 所有关键路径均在本会话用 `ls` / `wc -l` / `grep` / 定点 `sed -n` 实读核对；ZCode 根 `LICENSE` 已确认为 Apache-2.0。
- 未验证项（见 submit unverified）：zclaudia 是否存在等价「工具变更链」spec；zclaudia file-history 与 session 级 rewind UI 的完整链路；ZCode `AgentMemoryScope` 在 contracts 中的定义文件（仅确认了 import 关系）；ZCode sandbox 能力全貌（未深入 adapters/exec 与 zclaudia sandbox 的逐项对照）。

---

## 5. 独立复核记录

> 复核人：独立复核员（与探索员无共享上下文），2026-10-16。覆盖第 2 章 P1/P2 共 8 条，全部为本轮只读实读核对；ZCode 侧路径省略前缀 `apps/zcode-cli/`。

- ⚠️ Hooks 生命周期：8 类事件 + workspace hook 信任准入 —— 事件实为 **7 类非 8 类**（`packages/contracts/src/hooks/index.ts:7-15` `HookEventName` 枚举与 `:251-278` zod schema 均恰好 7 个），但所指 PermissionRequest/SessionStart/Stop/PostToolUseFailure 四事件全部存在，信任准入子系统属实（`packages/core/src/hooks/workspace-hook-trust-coordinator.ts:22` `WorkspaceHookTrustCoordinator`，9 个 workspace-hook-*.ts 共 1170 行；`packages/core/src/hooks/runner.ts:35` `InMemoryHookRunner` 462 行、`:381` emitHookEvent）；zclaudia 侧属实（`shared/src/interaction/user-hooks.ts:3` 仅 `PreToolUse | PostToolUse`，三个 hook 相关文件 grep 无 trust/准入概念）。
- ✅ Microcompact 工具结果定点清理 —— 全部命中：保留最近 5 条（`packages/core/src/compact/microcompact.ts:16`）、阈值比 0.9（`:19`）、9 类可压缩工具白名单（`:21-31`）、决策 reason 可观测（`:55-66`）；`packages/core/src/compact/policy.ts:28` `provider_usage`、`:9` 输出预留 32K；`e2e/compact-microcompact/` 存在（含 case-microcompact.mjs）；zclaudia `compaction/` 仅 chunked-summary/circuit-breaker/compaction-service 三文件，grep 无 microcompact/工具结果定点清理。
- ✅ 子代理运行时一等化 —— `packages/core/src/subagent/runner.ts` 2145 行，SubagentStart/SendMessage/Wait/Stop/TaskSnapshot 类型（`:32-41`）、`AgentBackgroundedOutput`（`:21`）、后台化分支（`:150-153`）均在；`packages/core/src/runtime-task/registry.ts:43` `RuntimeTaskSnapshot` + `:174-182` pendingMessages + `:103` 终态集合；`packages/core/src/subagent/tool-event-mirror.ts` 186 行，`:16-28` 镜像 ToolCall*/Permission* 事件进父会话；zclaudia server/src grep 无 mirror/runtime-task registry。
- ✅ 子代理持久记忆 —— `packages/core/src/subagent/persistent-memory.ts:17-31` user/project/local 三级根目录解析、`:70` `loadPersistentAgentMemory` 读 MEMORY.md 并经 `persistent-memory-prompt.ts`（169 行）注入；zclaudia `shared/src/core/agent-profile.ts` 全文无 memory 字段（`:68` 仅注释提及 in-memory）。
- ✅ Turn 状态机 + Runtime Command Queue —— `packages/core/src/agent/turn-machine.ts` 344 行，requestPermission/resolvePermission/queuePendingInput/drainPendingInputs/aggregateResults（`:53-61`、`:221-285`）与 canTransitionTo（`:19`、`:93`）均在；`packages/core/src/runtime/command-queue.ts:30-115` 五个具名命令族全部存在（union 实有第 6 变体 TargetContinuationLoopRuntimeCommand `:56`，报告按族归并为「五类」可接受）；`packages/core/src/runtime/helpers/steering.ts:39-110` fork 进历史属实。
- ✅ 会话 fork/rewind/workspace checkpoint —— `packages/core/src/runtime/methods/session-fork.ts:137` `ForkIdentityMap`、`:323` goal 重映射、`:979` fork notice；`file-rewind.ts` 717 行 + `rewind-message.ts`（消息级 rewind）+ `workspace-checkpoints.ts` 357 行；`packages/contracts/src/rewind/index.ts:21/:29/:38/:46` Scope/Strategy/TargetStatus/checkpointCreatedPayloadSchema 全在；`resume.ts:41-42`、`:194-195` 恢复时还原 checkpoint；zclaudia `session-tree/fork.ts:16` `forkSessionAt` 属实。
- ✅ 权限长尾处理 —— `packages/core/src/runtime/permission-grant-recovery.ts:4` WeakMap + `:12` `recoverPendingPermissionGrant`；`packages/core/src/tool/executor/permission-responder-race.ts:1-6` 显式双应答方竞速语义；`permission-suggestions.ts:7` `buildDefaultPermissionUpdates` 建议生成；`permission-flow.ts:102/:170` Guarded；`packages/core/src/permission/service.ts` 732 行含 riskLevel/sideEffectScope（`:38`、`:56-57`）；zclaudia conversation 层 grep 无对应物。
- ✅ TUI 终端形态整体缺失 —— `packages/tui/src` 实为 91 个 .ts/.tsx 文件（报告 86 为保守低估）、app.tsx 存在、package.json:24-30 `@mbears/opentui-*` 0.2.15 + react 19.2.5；`docs/design/v2/` 实有 28 篇 `tui-*.md`（报告约 24，同为低估）；`packages/bootstrap/src/zcode-protocol-v4/` 含 cold-session-resume/command-inbox 等；zclaudia 仅 `apps/desktop`，`server/src/infra/terminal-manager.ts:1` 为 node-pty 透传，无任何 TUI 包。
