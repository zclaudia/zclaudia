# 大文件与耦合问题修复计划

- 日期：2026-10-14
- 依据：[docs/reviews/2026-10-14-large-files-coupling-review.md](../reviews/2026-10-14-large-files-coupling-review.md)
- 原则：**纯重构零行为变化**（仅两处标注的缺陷修复例外）；每个执行单元文件互不重叠，可并行；每单元自带测试验证；不做 git commit（留待人工 review）

## 范围

**本轮执行**：报告路线图第一批（低成本高确定性）+ 第二批（P1 全部）+ 三个纯搬移类低风险项。
**暂缓（后续独立 PR）**：ClaudiaChat 组件级拆分第二阶段、plugins/loader、run-permissions、run-provider-launch、GatewayTransport/BackendChannelManager、codex app-server-client、宿主契约下沉 agent-common、shared/tools.ts 与 usage-accumulators 拆分、shared/facade 升格、app→infra ratchet 禁令、InteractionItem/ChatInputArea/MessageInput 拆分、PermissionSettings、setup-components、e2e 源码 import。暂缓理由：单独立项体量（每个 2-5 人日）或风险集中（ClaudiaChat 状态互锁、loader 无行为级护栏），不与批量重构混在一轮。

## 执行单元（并行，文件互不重叠）

### 服务端（S1–S5）

| #   | 单元                                   | 主要文件                                                                                               | 内容                                                                                                                                                                                                                                                                                                                                                                                  | 验收测试                                                                                            |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| S1  | skills.ts 拆分                         | `server/src/infra/providers/pi-runtime/skills.ts`                                                      | 拆出 `skill-policy.ts`（策略解析+catalog）、`skill-fork.ts`（fork 执行器+fork 工具集）、`skill-meta-tools.ts`（6 个 meta 工具）；主文件留状态类型+LoadSkill+直调协议；**保持 `prepare`/`executeDirectSkillInvocation` 从 skills.ts 导出**（run-provider-launch.ts 零改动）；顺路用 tool-common 的 jsonResult 替换本地重复实现                                                         | `__tests__/skills.test.ts` 全绿；tsc                                                                |
| S2  | edit-tool 拆分 + 缺陷修复              | `server/src/infra/providers/pi-runtime/edit-write/edit-tool.ts`                                        | 拆出 `patch-executor.ts`（apply_patch 操作执行）、`edit-core.ts`（读守卫+匹配+应用，纯逻辑）；三条路径共享尾部提为 `persistMutation()`；**缺陷修复：hashline 路径补跑 write-lifecycle 与诊断**（对齐另两条路径），并补回归测试                                                                                                                                                        | `edit-write-tools.test.ts`、`apply-patch.test.ts`、`hashline-recovery.test.ts` 全绿 + 新增用例；tsc |
| S3  | feature-domains 瘦身                   | `server/src/feature-domains.ts`                                                                        | 内联逻辑外移：permission 进度翻译→`application/permissions/permission-workflow-progress.ts`；clearPendingPermission 裸 SQL→`application/permissions/clear-pending-permission.ts`；metaWorkflowAiRunPort→`application/workflows/meta-workflow-ai-port.ts`；getProjectRoot→`application/bootstrap/project-root.ts`；本文件只留 wiring，返回值形状不变（唯一消费方 domain-bootstrap.ts） | tsc + `permission-workflow-routing.integration.test.ts` + sessions/permissions 相关集成测试         |
| S4  | 路由类型化错误 + 目录抽取              | `server/src/domains/supervision/routes.ts`、`supervisor-service.ts`、`domains/workflows/routes.ts`     | service 侧类型化错误（仿 PluginPackageError 模式）+ 统一 error→status 映射，消除 `message.includes('not found')` 反推（supervision 遍布、workflows:537）；workflows 内建 step 目录（556-685）抽 `builtin-step-catalog.ts`；**HTTP 契约不变**                                                                                                                                          | `interfaces/http/__tests__/supervision.test.ts`、`workflows.test.ts` 全绿；tsc                      |
| S5  | bash-tool 去重 + shell-parser 注释修复 | `server/src/infra/providers/pi-runtime/bash-tool.ts`、`application/conversation/agent/shell-parser.ts` | bash-tool 两处后台任务创建（329-380 / 548-616）提 `createBackgroundBashTask()`；shell-parser 头注释与实际 fs 依赖矛盾——注入 stat（默认 fs.statSync）并修注释                                                                                                                                                                                                                          | bash 相关测试 + `shell-parser` 测试全绿；tsc                                                        |

### 桌面端（D1–D5）

| #   | 单元                                | 主要文件                                                                                   | 内容                                                                                                                                                                                                                                                                                                                                                    | 验收测试                                                                                    |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| D1  | MessageList 搬移拆分 + 环修复       | `apps/desktop/src/features/chat/MessageList.tsx`                                           | 建 `features/chat/message-list/`：`useItemVirtualizer.ts`（虚拟化+测量管线）、MessageItem/SegmentedContent/AssistantContent(+`assistantMarkdown.tsx`)/AttachmentDisplay/MessageActionsMenu/`specialCards.tsx`/`classifyMessage.ts`；**第一步纯机械搬移零行为变化**；顺带修 chat⇄browser 运行时环（ChatLink 经 barrel 回依赖 chat，改 props/直连导入）   | `MessageList.test.tsx`、`MessageList.ChatLink.test.tsx` 全绿（随迁改 import）；tsc          |
| D2  | ClaudiaChat 抽 hooks + 草稿恢复统一 | `features/claudia/ClaudiaChat.tsx`、`features/chat/ChatInterface.tsx`、`ChatInputArea.tsx` | 第一阶段仅抽 hooks：`useClaudiaThreads/useClaudiaRuns/useClaudiaTranscriptSync/useClaudiaProfileBinding`、`claudiaProtocol.ts` 纯函数；组件渲染不动；**严格保持 newTopicArmed/rejectedDraft/composerKey 互锁**；草稿恢复统一为 `useComposerPrefill(sessionId)` 供三处使用（若三处语义确有实质差异，抽公共机制并保留各自触发条件，以零行为变化为硬约束） | `ClaudiaChat.test.tsx`、`ChatInterface.test.tsx`、`ChatInputArea.mobile.test.tsx` 全绿；tsc |
| D3  | WindowsSetup 轮询泄漏修复           | `components/setup/WindowsSetup.tsx`                                                        | **缺陷修复**：handleConnect 的 setInterval（133-151）与 handleGatewayConnect 的 interval+15s setTimeout（172-185）随卸载/重跑清理；补卸载清理测试；结构拆分仅在前者完成后视余量做                                                                                                                                                                       | 现有测试 + 新增清理用例全绿；tsc                                                            |
| D4  | agents 编辑器面板化                 | `features/agents/ProfileEditor.tsx`、`McpServerEditor.tsx`                                 | McpServerEditor：env/header pairs 两段重复抽通用 `KeyValuePairsEditor`（agents/ui/），OAuth/Trust 段外移；ProfileEditor：Capabilities tab 三个子面板（ToolSets/McpProviders/Skills）外移，经现有 hooks 传值；populateForm effect 若测试依赖则保留                                                                                                       | `ProfileEditor.test.tsx`、`McpServerEditor.test.tsx` 全绿；tsc                              |
| D5  | 纯搬移（automation + fileviewer）   | `features/automation/AutomationsTab.tsx`、`components/fileviewer/FileViewerPanel.tsx`      | AutomationsTab：CreateAutomationForm/AutomationCard 移出为独立文件；FileViewerPanel：`VirtualizedCodeView.tsx`、`useFileContentPolling.ts`、`detectLanguage.ts`（EXT_TO_LANG 供 FileViewerActions 共用）、`FileViewerActions.tsx`、`useResizableTree.ts`；零行为变化                                                                                    | `FileViewerPanel.test.tsx`、`fileViewerStore.test.ts`、automation 相关测试全绿；tsc         |

## 验证协议

1. 基线：派发前全量 `pnpm test` 绿（后台已启动，如有预存失败先记录豁免清单）。
2. 每单元：目标测试全绿 + 所在包 `tsc --noEmit` 无错。
3. 汇总：全量 `pnpm test` + `pnpm check:architecture` + `pnpm lint`；失败由主会话修复或回退对应单元。
4. 不 commit；最终改动清单+测试证据在会话中汇报。

## 已知风险

- S3（feature-domains）无专属测试，靠类型检查+集成测试兜底——改动保持纯搬移。
- D2 状态互锁最复杂——先抽 hooks 冻结行为，每小步跑 ClaudiaChat 测试。
- 行号基于审查时快照，执行以符号定位为准。

---

## 执行结果（2026-10-14 当日完成）

10 个单元全部执行完毕（6 个首发 + 4 个因账户限流重试），每单元由独立 sub-agent 并行完成，全部通过各自验收（目标测试 + `tsc --noEmit`）。

| 单元               | 结果 | 要点                                                                                                                                                                                                                                                                                          |
| ------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 skills.ts       | ✅   | 1359→808 行，新增 skill-policy/skill-fork/skill-meta-tools（215/229/205 行）；`prepare`/`executeDirectSkillInvocation` 导出保持，run-provider-launch 零改动；jsonResult 去重改为 textResult(JSON, details) 等价形式                                                                           |
| S2 edit-tool       | ✅   | 1194→654 行，新增 patch-executor/edit-core/persist-mutation；**hashline 缺陷已修复**（补 write-lifecycle+诊断），新增回归用例并用旧代码实证其有效性；patch 失败语义逐一比对保留                                                                                                               |
| S3 feature-domains | ✅   | 725→598 行，四块内联逻辑外移至 application/{permissions,workflows,bootstrap}；返回形状零改动；check:architecture 通过                                                                                                                                                                         |
| S4 路由错误        | ✅   | `utils/route-error-mapping.ts` 统一映射（放 utils 而非 interfaces/http，因 domains 禁止 import interfaces 的既有规则）+ `SupervisorError` 类型化错误 + `builtin-step-catalog.ts`；HTTP 契约零变化（plain-Error 消息规则作为声明式兼容层保留）；其余路由同模式尚有 8 处/4 文件未改（记录在案） |
| S5 bash/shell      | ✅   | `createBackgroundBashTask()` 去重（两路径 start/adopt 差异保留）；shell-parser stat 注入+注释修正                                                                                                                                                                                             |
| D1 MessageList     | ✅   | 1131 行拆为 message-list/ 目录 11 个文件（容器 187 行），原位置留 re-export；chat⇄browser 环经新建 `features/chat/api.ts` 公共入口消除；desktop 全量 UI 套件 3190 绿                                                                                                                          |
| D2 ClaudiaChat     | ✅   | 942→633 行，抽出 4 hooks + claudiaProtocol；互锁状态逐行保留；prefill 统一为 useComposerPrefill/useSessionInitialDraft/useComposerMountDraft（三处语义有实质差异，按"共享机制+保留各自触发条件"处理）；新增 18 个单测                                                                         |
| D3 WindowsSetup    | ✅   | **轮询泄漏已修复**（timer 注册表+卸载清理+防叠加），新增 6 个 fake-timers 回归用例；结构整理未做（护栏不足，守约束放弃）                                                                                                                                                                      |
| D4 agents 编辑器   | ✅   | ProfileEditor 1251→850、McpServerEditor 1003→746；KeyValuePairsEditor + 3 面板 + OAuth/Trust 段外移；populateForm effect 经测试证实有依赖路径，保留                                                                                                                                           |
| D5 纯搬移          | ✅   | AutomationsTab 705→233、FileViewerPanel 1047→402；7 个新文件纯移动                                                                                                                                                                                                                            |

**汇总验证**：`pnpm test` 全绿——server 567 文件/6531 通过（1 skip 与基线一致）、desktop 三配置共 447 文件/5113 通过（含新增 ~30 个用例）、shared 236、plugins+agent-common 434；`pnpm check:architecture` 通过；`pnpm lint` 0 错误（878 条预存警告）。

**收尾修正**（主会话）：D2 的跨 feature 深导入 `ClaudiaChat.tsx → chat/hooks/useComposerPrefill` 违反架构规则，已改为经 `features/chat/api.ts` 公共入口导出。

**基线修复**：派发前修复了预存失败 `useActiveSessionStream`（hook 在 dddd1b12 增加 `runtimeState==='ready'` 守卫后测试未跟上，补齐测试夹具中的 ready backend）。

**暂缓项**（见上文范围一节）保持不变，作为后续独立 PR。工作区另有 `desktop/services/message-handlers/*`、`stores/interactionStore`、`shared/wire/messages/core.ts` 等在途改动，非本轮产生，未触碰。所有改动未 commit，待人工 review。
