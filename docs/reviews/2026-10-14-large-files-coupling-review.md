# 代码审查报告：大文件与耦合分析

- 日期：2026-10-14
- 范围：全仓（以当前工作区状态为准，含未提交的 GatewayTransport / gateway manager 修改）
- 方法：6 个并行 sub-agent 分区审查（服务端 infra、服务端 application/domains、桌面 chat 特性、桌面 agents/设置与传输层、shared+plugins、全局架构依赖体检），每条结论均附 file:line 证据
- 优先级定义：P1 = 建议尽快排期；P2 = 有明确收益、随迭代安排；P3 = 择机顺手做

---

## 一、项目规模概览

| 区域                  | 文件数 | 行数    | 备注                                    |
| --------------------- | ------ | ------- | --------------------------------------- |
| server/src            | 1368   | 265,376 | 含测试；非测试源码约 13.9 万行          |
| apps/desktop/src      | 1188   | 200,037 | Tauri（非 Electron）+ React             |
| e2e                   | 118    | 19,613  | Playwright，基本黑盒                    |
| plugins               | 80     | 17,826  | codex / claude / cursor 三个 agent 插件 |
| shared                | 130    | 15,758  | 双端契约                                |
| packages/agent-common | 15     | 1,722   | 插件侧实现工具箱                        |

排除测试后的最大源码文件（前 13，均 >1000 行）集中在：pi-runtime 工具集（skills/web-tools/external-tools/edit-tool/read-tool）、plugins loader、lsp/manager、desktop 的 ProfileEditor / MessageList / McpServerEditor / FileViewerPanel、codex 的 app-server-client。

## 二、总体结论

**架构纪律显著优于平均水平，"大文件"问题真实存在但分布集中。**

健康的部分（有证据支撑）：

- 存在 ratchet 式强制检查 `pnpm check:architecture`，当前**零分层违规**；
- desktop → server 直接 import 为 **0**，渲染层统一走 `facade/` + HTTP 到内嵌 server，原生能力走 Tauri invoke（仅 18 个 command / 7 个文件）；
- domains 之间**零互相 import**，域间协作全部经 ports 在组合根装配；插件只依赖 `@zclaudia/plugin-sdk`（版本被 pnpm overrides 锁死），摸不到 server 内部；
- fan-in 最高的模块几乎全是类型/端口/纯工具（uuid、transport/types、providers/types），属于稳定核心而非杂物抽屉；
- 不少"大文件"其实已是门面/已拆分协作模块（bash-tool、gateway-client、supervisor-service、managed-runtimes/service、messageHandler），无需再拆。

需要处理的部分，按严重度：

1. **两个疑似行为缺陷**（重构时顺带修复）：`edit-tool.ts` hashline 路径不跑 write-lifecycle 和诊断（三条路径的尾部样板已漂移）；`WindowsSetup.tsx` 连接轮询 setInterval/setTimeout 未随卸载清理。
2. **五个 P1 大文件**：`edit-tool.ts`、`skills.ts`、`feature-domains.ts`、`MessageList.tsx`、`ClaudiaChat.tsx`。
3. **两类跨文件耦合债**：application/domains → infra 具体实现的值导入共 203 处（与"注入端口"目标相悖，建议 ratchet 增量收敛）；`ClaudiaChat` 是绕过 chat hooks 的平行实现，与 chat 特性存在草稿恢复、权限过滤等三处逻辑重复。
4. **一条运行时循环依赖**：`features/chat/MessageList.tsx ⇄ features/browser/ChatLink.tsx` 经 barrel 往返（值循环，有模块初始化顺序风险）。全仓其余 35 条环均为 type-only 弱环。

---

## 三、P1 问题清单（建议优先排期）

### P1-1 server/src/infra/providers/pi-runtime/edit-write/edit-tool.ts（1194 行）

- **问题**：单文件四职责——apply_patch 多文件分发（141-580，440 行）、单文件 batch edit（753-923）、hashline edit（926-1046）、精确/空白匹配 edit（1047-1185）。"备份→原子写→recordWrite→lifecycle/诊断"尾部在三处重复（878-903、1019-1025、1141-1166）且已漂移：**hashline 路径不跑 write-lifecycle 和诊断**（对比 1161-1166），疑似遗漏。`createEditBridgeTool` 递归调用自身（162），noop 防护重复 6 处。
- **拆分**：`patch-executor.ts`（apply_patch 操作执行）+ `edit-core.ts`（读守卫+匹配+应用，纯逻辑）+ 工具壳留 schema/分发；共享尾部提为 `persistMutation()`。
- **测试**：`__tests__/edit-write-tools.test.ts`、`apply-patch.test.ts`、`hashline-recovery.test.ts`；patch 失败语义需重点回归。
- **工作量**：3-4 人日。**风险**：低-中（拆分顺带修复 hashline 缺诊断）。

### P1-2 server/src/infra/providers/pi-runtime/skills.ts（1359 行）

- **问题**：五合一——执行策略解析（251-418，含关键词启发式）、状态管理、fork 子 agent 执行器（636-808，含超时/abort 竞态）、slash 直调协议（989-1189）、6 个 meta 工具（1191-1359）。162-164 本地重实现 `jsonResult`（与 tool-common 重复）。
- **拆分**：`skill-policy.ts` / `skill-fork.ts` / `skill-meta-tools.ts`，主文件留状态类型 + LoadSkill + direct invocation。application 层唯一消费点 `run-provider-launch.ts:32` 保持导出即可零改动。
- **测试**：`__tests__/skills.test.ts`（1159 行）覆盖充分。**工作量**：3 人日。**风险**：低。

### P1-3 server/src/feature-domains.ts（725 行）

- **问题**：组合根角色合理，但混入内联业务逻辑：permission workflow 进度翻译（427-503，~80 行业务事件→wire 转换）、`clearPendingPermissionFromActiveRun` 裸 SQL（358-371）、`metaWorkflowAiRunPort` 适配器（522-552）、`getProjectRoot` 裸 SQL（603-616）。
- **拆分**：提为 `application/permissions/permission-workflow-progress.ts`、`application/workflows/meta-workflow-ai-port.ts`、`application/bootstrap/project-root.ts`、`application/permissions/clear-pending-permission.ts`；唯一消费方 `domain-bootstrap.ts`。
- **风险**：**无专属测试**（565 个测试无直接覆盖），靠类型检查+集成测试兜底。**工作量**：2-3 人日。

### P1-4 apps/desktop/src/features/chat/MessageList.tsx（1131 行）

- **问题**：手写虚拟化+ResizeObserver 测量管线内嵌渲染组件（119-255、366-405）；直接解码消息协议哨兵 metadata（compactionMarker/filePush/goal-auto/thinkingBlocks 等，133-158、272-325），并现场拼装 FilePushItem（297-315）；内联 130 行 ReactMarkdown components（1001-1124）；一文件 6 组件 + 双 context 并存。
- **拆分**：建 `features/chat/message-list/`：容器 + `useItemVirtualizer.ts` + MessageItem/SegmentedContent/AssistantContent/`assistantMarkdown.tsx`/`specialCards.tsx`/`classifyMessage.ts`（纯函数协议判别）。调用方仅 ChatMessagePane。
- **测试**：`MessageList.test.tsx`、`MessageList.ChatLink.test.tsx`。**先机械搬移（零行为变化），虚拟化提取单独提交**。**工作量**：3-4 人日。**风险**：中。

### P1-5 apps/desktop/src/features/claudia/ClaudiaChat.tsx（942 行）

- **问题**：实为第二个 ChatInterface——8 种职责：后端解析、submitting 重放、4s 轮询+版本号防竞态（259-370）、陈旧 run 对账（295-346）、profile 绑定状态机（190-229）、中断恢复、**内联拼装 wire 协议**（450-457，attachments JSON.stringify 进 input）、全部渲染。与 chat 特性重复：自有消息气泡平行于 MessageList、权限过滤重复（383-390 vs ChatInterface 147-151）、草稿恢复重复（56-72+401-410）。
- **拆分**：`features/claudia/` 下抽 `useClaudiaThreads.ts`、`useClaudiaRuns.ts`、`useClaudiaTranscriptSync.ts`、`useClaudiaProfileBinding.ts`、`claudiaProtocol.ts`（纯函数）+ 三个展示组件。
- **测试**：`ClaudiaChat.test.tsx`（343 行，容器级，hooks 抽出后需补 hook 单测）。**风险**：中高——`newTopicArmed/rejectedDraft/composerKey` 三者互锁，先抽 hooks 冻结行为再拆组件。**工作量**：5-6 人日。

### P1-6（附）features/chat ⇄ features/browser 运行时循环依赖

`MessageList.tsx:27` → `../browser` barrel → `ChatLink.tsx:6` → `../chat` barrel → `SessionChatLayout`，组件值循环。修法：ChatLink 的 chat 依赖改为 props/actions 注入。随 P1-4 一并处理，0.5 人日。

## 四、P2 问题清单

### 服务端

| 项                                         | 问题摘要                                                                                                                                                               | 方案                                                                                                                                                                                             | 工作量                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `application/plugins/loader.ts`（1343）    | god object：扫描/manifest、生命周期串行化、8 类贡献注册/回滚、能力协商含 MCP 探测、app_config 裸 SQL、worker 托管                                                      | 拆 `plugin-discovery.ts` / `contribution-registrar.ts` / `capability-negotiator.ts` / `plugin-config-store.ts`，loader 收敛为生命周期门面；pluginLoader 单例签名不变则零改动；lifecycle 测试齐全 | 4-5 人日                   |
| `runtime/run-permissions.ts`（778）        | 单工厂 ~530 行串 6 段决策管线；MCP 信任判定裸 SQL（125-206）；直连 `providerRegistry`/`isSandboxAvailable`（40-41）而非端口                                            | 拆 `mcp-trust-resolver.ts`（SQL 下沉 repository）、`permission-auto-resolve.ts`（resolver 链）、`permission-escalation-flow.ts`；测试 664 行兜底                                                 | 3-4 人日                   |
| `domains/supervision/routes.ts`（716）     | 30+ handler 重复 try/catch，且用 `message.includes('not found')` 反推状态码（55、173、394-400 等）——service 改报错文案即静默改 HTTP 语义                               | service 侧类型化错误（仿 `PluginPackageError`），统一 error→status 中间件                                                                                                                        | 1 人日                     |
| `runtime/run-provider-launch.ts`（715）    | 引擎模式解析（180-310）、usage 台账（470-503）、技能 fork（363-429）、预压缩（544-584）四块可独立测试单元内联；71 行 import 时注册全局监听（与 run-events.ts:21 重复） | 拆 `resolve-engine-execution.ts` / `usage-ledger-setup.ts` / `direct-skill-invocation.ts`；副作用显式化；测试 1080 行兜底                                                                        | 2 人日                     |
| `domains/workflows/routes.ts`（697）       | 556-685 内联 ~130 行内建 step 目录硬编码；同样 `includes('not found')`                                                                                                 | 抽 `builtin-step-catalog.ts` + 复用错误映射器                                                                                                                                                    | 0.5-1 人日                 |
| `pi-runtime/web-tools.ts`（1244）          | 两工具 + SSRF + 三家搜索 provider + fetch 管道 + 解码混住；`fetchCache` 模块级单例迫使导出测试钩子（796-801）                                                          | `web-search/providers.ts`（211-461 整块平移，接口已就绪）+ `web-fetch-core.ts`；调用方仅 tool-catalog.ts:44                                                                                      | 2-3 人日                   |
| `pi-runtime/external-tools.ts`（1073）     | 信任策略/输出落盘/9 个 meta 工具混住；三处复制粘贴（119-124、587-605 vs 627-646、666-701 vs 817-848）                                                                  | `mcp-trust.ts` / `mcp-output-store.ts` / `external-meta-tools.ts` + `registerLoadedTool()`                                                                                                       | 2 人日                     |
| application/domains → infra 直连（203 处） | 与"注入端口"目标相悖；典型 `application/bootstrap/domain-ports.ts:3` 取 `getGatewayClient` 单例、`domains/llm-profiles/repository.ts:1` 继承 SQLite 基类               | 不动层序，优先掐单例访问器到 bootstrap 组装点；利用现有 ratchet 加增量禁令；随上面各项顺路做                                                                                                     | ratchet 成本很低，随项推进 |

### 桌面端

| 项                            | 问题摘要                                                                                                                    | 方案                                                                                                      | 工作量     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `ChatInputArea.tsx`（747）    | goal 生命周期 + 200 行内嵌移动端工具菜单 IIFE（494-700，到处 `getState()`）+ 只读门控三职合一；24 个 props                  | `useSessionGoal.ts` + `MobileToolsMenu.tsx` + `ComposerGate.tsx`；props 分组                              | 2-3 人日   |
| `MessageInput.tsx`（938）     | handleSend 内嵌提交协议分类（544-630）；handleKeyDown 合并 mention/slash 两套键盘状态机（435-526）                          | `classifySubmission.ts` 纯函数 + `useComposerKeyboard.ts`                                                 | 2 人日     |
| `InteractionItem.tsx`（798）  | 4 渲染器+表单组件+纯函数同文件；PlanReviewRenderer 280 行（457-735）双路径分叉是最易错点                                    | `interactions/{PromptRenderer,ApprovalRenderer,PlanReviewRenderer,formFields,promptResponse}`             | 1-2 人日   |
| **草稿恢复逻辑三处重复**      | ChatInterface 220-229、ChatInputArea 205-227、ClaudiaChat 56-72+401-410                                                     | 统一为 composerStore 支撑的 `useComposerPrefill(sessionId)`，随 ClaudiaChat 拆分一并做                    | 1 人日     |
| `GatewayTransport.ts`（929）  | 控制连接+退避重连+健康探测+registry 同步+v4 数据通道（591-793，~250 行 FIFO 泵）混装；与 store 零耦合（回调出站，设计干净） | 抽 `BackendChannelManager` 类；**不要**抽重连策略类（与 generation 重置交织，收益为负）；三个测试文件兜底 | 2-3 人日   |
| `ProfileEditor.tsx`（1251）   | ~20 个 useState；Capabilities tab 460 行内联（741-1204）；populate effect 与 keyed-remount 契约重复                         | 拆 ToolSetsPanel/McpProvidersPanel/SkillsPanel 三个子面板；删 populate effect                             | 1-1.5 人日 |
| `McpServerEditor.tsx`（1003） | env/header pairs 两段逐字重复（644-705 vs 708-768）；signature 依赖数组列两遍                                               | 通用 `KeyValuePairsEditor`；OAuth/Trust 段外移                                                            | 0.5-1 人日 |

### shared / plugins

| 项                                   | 问题摘要                                                                                                                                                                      | 方案                                                                                           | 工作量   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| codex `app-server-client.ts`（1064） | 进程管理+JSON-RPC 编解码+会话装饰+turn 编排四合一（cursor 插件同类已拆分，codex 未对齐）                                                                                      | 抽 `jsonrpc-line-transport.ts`（~250 行）+ `turn-stream.ts`（~300 行）；测试 1232 行按模块切分 | 3 人日   |
| **宿主契约跨插件重复**               | usage 泵（claude runner 360-419 vs codex 862-947）与"无 sessionId 的 init = systemInfo 更新"约定（runner 447-460 vs app-server-client 924-947）各实现一遍，第三个插件还会再抄 | agent-common 增 `system-info-update.ts` + 文档化 wire 约定；usage 泵只统一约定不强行合并       | 1.5 人日 |

## 五、P3 与可选项（择机顺手做）

- `lsp/manager.ts`（1223）：编排门面，目录已拆 7 个子模块；可选再提 `query-service.ts`/`rename-service.ts`，rename 时序精细，建议下次触碰时顺手做（2 人日）。
- `read-tool.ts`（1024）：单一职责，仅 execute 内五模态分支长；可选提 `read-modalities.ts`。
- `bash-tool.ts`：后台任务创建两处近似重复（329-380 vs 548-616），提 `createBackgroundBashTask()`，半小时。
- `shell-parser.ts`：文件头注释称"仅依赖 path"但 :8 import 了 fs 并 statSync（170-178）——修注释或注入 stat。
- `package-service.ts`：`validateArchiveEntries`（224-387，160 行安全校验）独立成 `package-validation.ts`（0.5-1 人日）。
- `supervisor-service.ts`：log/getLogs（552-673）裸 SQL 下沉 repository；静态 `installCleanupHooks`（688-705）移 bootstrap。
- `shared/src/core/tools.ts`（878）：440 行纯数据表淹没逻辑但属刻意单文件设计；轻拆 `tool-refs.ts`/`tool-catalog.ts`，re-export 兼容零改动（0.5 人日）。
- `agent-common/usage-accumulators.ts`（604）：三个协议 accumulator 同文件，按协议拆 + re-export（0.5 人日）。
- shared/facade（~1900 行运行时状态机）：长期升格 `packages/` host-runtime 包（2 人日）；短期可接受。
- `FileViewerPanel.tsx`（1047）：纯移动拆 `VirtualizedCodeView.tsx`/`useFileContentPolling.ts`/`detectLanguage.ts`/`FileViewerActions.tsx`，主组件降至 ~350 行（1-1.5 人日）。
- `PermissionSettings.tsx`（1 人日）、`AutomationsTab.tsx` 纯移动拆两个组件文件（0.5 人日）。
- `WindowsSetup.tsx`：**轮询清理是真实缺陷，可单独先行修复（半天）**；页面本身低频。
- 三个 Editor 共性：`useFormDraft<T>` 降样板（2-3 人日）——注意是降样板不是纠错，勿过度抽象成统一表单框架。
- `ActiveRun`（transport/types.ts:205）：14 组状态的可变 god context 被全 runtime 目录共享；建议新代码按状态组收敛为只读快照+显式端口，不必一次性大改。
- `test/setup-components.ts`（717 行、21 处 vi.mock）：按 mock 域拆 `test/mocks/*.ts` 按需挂载。
- e2e 两处穿透源码 import（`e2e/spec-init-flow.test.ts:5`、`plugin-packages.playwright.spec.ts:4`）：把 `validateSpec`/`buildZip` 挪到 shared 或 test-utils 包。
- codex `text-budget.ts` 11 行 re-export 垫片可删（0.1 人日）。
- server 26 条 type-only 弱环聚在 `infra/providers/types.ts ⇄ pi-runtime/index.ts` 枢纽家族，可把共享类型下沉 `*-types.ts` 整理（无运行时危害，低优先）。

## 六、无需拆分清单（重要结论）

| 文件                                 | 理由                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `gateway/gateway-client.ts`（964）   | transport/heartbeat/channel/proxy 已外置，本类内聚于"gateway 对等连接"单一职责；双 API 面瑕疵可接受，743 行测试在位 |
| `bash-tool.ts`（695）                | 已是 facade，guards/runner/output/inflight/sandbox 全部独立且有测试                                                 |
| `symbol-tools.ts`（755）             | 纯函数解析引擎 + 两个薄工具；parser 提取为可选优化                                                                  |
| `supervisor-service.ts`（706）       | 门面，职责实际分散在 12 个协作类                                                                                    |
| `managed-runtimes/service.ts`（702） | 职责单一，重活已委托 descriptor/gc/installer/resolver，945 行测试                                                   |
| `recoveryStore.ts`（856）            | 单一连贯恢复状态机，纯 reducer 无副作用，跨四域协调是本质复杂度；1313 行专测。拆了反而制造跨 store 协调问题         |
| `useSessionChanges.ts`（888）        | 主体纯函数聚合 + 薄订阅，按可测试性组织，814 行测试；仅建议迁 `features/changes/`                                   |
| `AgentsContent.tsx`（904）           | 路由/粘合层，各分支共享 selection/bridge/nonce 状态与 keyed-remount 调用点，拆散破坏内聚                            |
| `messageHandler.ts`（323）           | dispatcher 注册表 + 13 个子模块，拆分典范                                                                           |
| `ChatInterface.tsx`（728）           | 组合根，已下沉 12 hooks，1927 行集成测试兜底；残留 fork/canonical 小重复属 P3 微调                                  |

## 七、建议执行路线图

1. **第一周（低成本高确定性，~4 人日）**：WindowsSetup 轮询清理（缺陷修复）；supervision/workflows 路由类型化错误+目录抽取；bash-tool 后台任务去重；草稿恢复统一 `useComposerPrefill`。
2. **第二批（P1 服务端，~6-7 人日）**：skills.ts 拆分 → edit-tool.ts 拆分（顺带修 hashline 诊断缺失）→ feature-domains.ts 内联逻辑外移。
3. **第二批（P1 桌面端，~9-10 人日）**：MessageList 机械搬移（先零行为变化，虚拟化单独提交，一并消 chat⇄browser 环）→ ClaudiaChat 先抽 hooks 再拆组件。
4. **第三批（P2，按迭代穿插）**：plugins/loader、run-permissions、GatewayTransport/BackendChannelManager、codex app-server-client、宿主契约下沉 agent-common、三个 Editor 面板化。
5. **持续（ratchet）**：给 `application→infra 单例访问器` 加增量禁令，随每项拆分顺路把 `providerRegistry`/`pluginEvents`/`isSandboxAvailable` 换成构造注入。

P1 合计约 17-20 人日，P2 合计约 20 人日，P3 合计约 12 人日。每项均确认有对应测试文件兜底（报告中已列出路径），除 feature-domains.ts 外风险可控。

## 八、审查方法附注

- 6 个 sub-agent 并行执行，覆盖：服务端 infra / 服务端 application+domains / 桌面 chat / 桌面 agents+传输 / shared+plugins / 全局架构体检。
- 架构体检用内联 DFS 全图遍历替代 madge（未安装，遵循"不装新依赖"约定），server 795 文件 / desktop 745 文件，共 36 条循环依赖，35 条为 type-only 弱环。
- 所有行号基于 2026-10-14 当前工作区（含未提交修改），后续代码变动可能使行号漂移。
