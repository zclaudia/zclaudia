# knip 发现清单（第一梯队任务 D，2026-10-16）

工具：knip 6.41.0（`pnpm knip`）；配置：根 `knip.json`。

## 口径

- 任务纪律：**发现只记录、不删除**。本清单是存量问题的完整台账；
  为让 `pnpm knip` 作为增量守卫运行（当前退出码 0），以下全部条目已在
  `knip.json` 的 `ignore` 段逐文件挂账（barrel 统一 glob 挂账）。
  人工清理某文件后，应删除 `knip.json` 中对应条目并重跑 `pnpm knip` 确认。
- 快照来源：`pnpm exec knip --reporter json`（配置含入口修正与
  `ignoreExportsUsedInFile: true` 之后、挂账 ignore 之前，代码状态与当下一致）。
- `ignoreExportsUsedInFile: true` 消掉了约 580 项"仅在定义文件内使用"的导出——
  这类不是死代码（有真实使用，只是多余的 `export` 关键字），未列入台账。
- 基线（仅 workspace 声明、无任何调优）共 1058 项 → 调优后待人工清理 461 项。

## 总览：461 项 = 未使用导出/类型 441（非 barrel 130 + barrel re-export 311）

- 未使用文件 11 + 重复导出 6 组 + 依赖问题 2 + 失效 import 1

## 高严重度（建议优先人工确认）

### 1. 失效 import（模块不存在）

- `server/src/infra/providers/pi-runtime/__tests__/invocations.test.ts:8` import `../types.js` —— 目标文件不存在（`pi-runtime/types.ts` 缺失）。
  该测试当前依赖此坏引用存活与否待确认，建议补文件或修 import。

### 2. 未使用文件（dead file 候选，11 个）

| 文件                                                                    | 说明                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `e2e/helpers/ai-test-utils.ts`                                          | 非死代码：是 `e2e/vitest.config.e2e.ts:18` 的 setupFiles，knip 静态图未关联；挂账豁免，不删 |
| `e2e/helpers/performance.ts`                                            | 无引用，确认后可删                                                                          |
| `apps/desktop/src/features/chat/InvocableAutocomplete.tsx`              | 无引用组件，确认后可删                                                                      |
| `apps/desktop/src/features/settings/ServerPickerDropdown.tsx`           | 无引用组件，确认后可删                                                                      |
| `apps/desktop/src/services/message-handlers/index.ts`                   | 无引用 barrel，确认后可删                                                                   |
| `server/src/application/plugins/mcp-bridge.ts`                          | 无引用，确认后可删                                                                          |
| `server/src/application/plugins/worker-runner.ts`                       | 无引用，确认后可删                                                                          |
| `server/src/application/managed-runtimes/index.ts`                      | 无引用 barrel（service.ts 本体有引用），确认后可删                                          |
| `server/src/dev/agent-playground/index.ts`                              | 无引用（agent-playground 从 desktop 入口走），确认后可删                                    |
| `server/src/domains/meta-workflow/index.ts`                             | 无引用 barrel，确认后可删                                                                   |
| `server/src/application/conversation/agent/delegation/review-parser.ts` | 无引用，确认后可删                                                                          |

### 3. 依赖问题

- `shared/package.json`：生产依赖 `@earendil-works/pi-ai` 在 shared workspace 内零引用
  （如只是经 server 使用，应移到 server 的依赖）。**未擅自移除**，待人工确认。
- `server/package.json`：devDependencies `memfs` 零引用，**未擅自移除**，待人工确认。
- unlisted（脚本 import 了未声明依赖，依赖 pnpm 提升才碰巧可用）：
  - `scripts/diagnostics/test-gateway-ws.js:3` import `ws` —— 根 package.json 未声明。
  - `scripts/hooks/check-native-modules.mjs:41` import `node-pty` —— 根 package.json 未声明。
  - 其中 `node-pty`（check-native-modules.mjs）是**有意的运行期探测**，属误报，已在配置 `ignoreDependencies` 豁免；
    `ws`（test-gateway-ws.js）是真实缺口：要么在根 devDependencies 声明，要么删脚本。

### 4. 重复导出（同一符号两个导出名，6 个文件）

- `apps/desktop/src/stores/gatewayStore.ts`：shouldShowNonCurrentInstanceBackend / shouldShowBackend
- `apps/desktop/src/components/plugins/PluginPanelRenderer.tsx`：PluginPanelRenderer / default
- `apps/desktop/src/components/permission/PluginPermissionDialog.tsx`：PluginPermissionDialog / default
- `apps/desktop/src/actions/projectWorkspaceActions.ts`：resolveProjectWorkspace / migrateSessionLayouts
- `shared/src/core/agent-profile.ts`：PI_AGENT_RUNTIME / DEFAULT_AGENT_RUNTIME
- `apps/desktop/src/components/ui/typography.ts`：SECTION_LABEL / EYEBROW

## 中严重度：非 barrel 的未使用导出/类型（130 项，70 个文件）

以下符号在分析范围内（workspace src + e2e，含测试文件）无任何消费者。
多为功能迭代后的遗留 API；删除前建议用 `pnpm dep:refs <file>:<name>` 复核动态引用。

### desktop

- `apps/desktop/src/components/permission/PluginPermissionDialog.tsx`：default
- `apps/desktop/src/components/plugins/PluginPanelRenderer.tsx`：default
- `apps/desktop/src/components/workspace/dragSplit.ts`：MULTI_INSTANCE_PANELS
- `apps/desktop/src/features/automation/automation-types.tsx`：displayProjectName, ProjectInfo, AgentConfigInfo
- `apps/desktop/src/features/automation/useAutomationApi.ts`：useAutomationApi
- `apps/desktop/src/features/chat/TranscriptCapabilities.tsx`：useTranscriptCapabilities, TranscriptCapabilities
- `apps/desktop/src/features/chat/api.ts`：ChatActionsContextValue
- `apps/desktop/src/features/chat/clientActions.ts`：setClientActionContextFactory
- `apps/desktop/src/features/chat/tool-call/toolClassifiers.ts`：isAskUserQuestionTool, isPlanModeTool, toolDisplayName
- `apps/desktop/src/features/claudia/useClaudiaThreads.ts`：ClaudiaThreadsState
- `apps/desktop/src/features/meta-workflow/api.ts`：getRun, sendSetPhases, sendCancelRun
- `apps/desktop/src/features/openspec/api.ts`：getCapability, listSpecChanges, pauseExecutor, resumeExecutor, refreshExecutor, createAnonymous
- `apps/desktop/src/features/sidebar/types.ts`：SidebarHeaderProps
- `apps/desktop/src/features/workflows/api.ts`：createGlobalWorkflow
- `apps/desktop/src/hooks/useWslDiscovery.ts`：checkWslServerHealth
- `apps/desktop/src/services/api.ts`：fetchApi, apiCall, apiCallVoid
- `apps/desktop/src/services/api/agent-profiles.ts`：createAgentProfile, updateAgentProfile, deleteAgentProfile, restoreAgentProfileForBackend
- `apps/desktop/src/services/messageHandler.ts`：MessageDispatchContext
- `apps/desktop/src/services/terminal/useTerminalController.ts`：useTerminalController
- `apps/desktop/src/stores/composerStore.ts`：DraftAttachment
- `apps/desktop/src/stores/gatewayStore.ts`：toGatewayServerId
- `apps/desktop/src/stores/invocableCatalogStore.ts`：getInvocableCatalogState
- `apps/desktop/src/stores/permissionStore.ts`：AIReviewResult
- `apps/desktop/src/stores/projectStore.ts`：ProjectDashboardView
- `apps/desktop/src/stores/rightSidebarStore.ts`：RIGHT_SIDEBAR_LIMITS
- `apps/desktop/src/stores/runStore.ts`：ToolCallHostMeta
- `apps/desktop/src/stores/sendQueueStore.ts`：selectQueue
- `apps/desktop/src/stores/sessionsStore.ts`：isLocalSessionBucketKey

### server

- `server/src/application/conversation/agent/ai-risk-analysis-adapter.ts`：createWorkflowAIReviewProviderFactory
- `server/src/application/conversation/agent/delegation-evaluator.ts`：DelegationConfig
- `server/src/application/conversation/agent/permission-evaluator.ts`：tokenizeShellWords, getCommandSignature, shouldSkipTokenAsTextArgument, shouldIgnoreOutsideWorkspaceExecutable, extractPathsFromCommand, isPathWithinRoot, normalizeExternalRoot, splitCompoundCommand, extractCommandSubstitutions, normalizeRememberableShellFragment, unwrapGroupedFragment, extractFindExecCommands, extractXargsCommands, extractShellWrapperCommands, extractHeredocCommands, extractParallelCommands, extractRememberableShellCommands, resolveProfile, ShellToken, PermissionMemoryRow, PermissionMemoryDb, OutsideWorkspaceMemoryRow
- `server/src/application/conversation/agent/permission-memory.ts`：persistSessionSandboxGrant, loadSessionSandboxGrantKeys, PermissionMemoryRow, OutsideWorkspaceMemoryRow
- `server/src/application/conversation/runtime/active-run-phase.ts`：TERMINAL_PHASES
- `server/src/application/invocations/router.ts`：InvocableCatalogService
- `server/src/application/managed-runtimes/service.ts`：ManagedInstallDescriptor
- `server/src/application/orchestration/agent-task-runner.ts`：AgentTaskRunCallbacks
- `server/src/domains/agent-loop/types.ts`：OutputContract
- `server/src/domains/agent-profiles/agent-profile-deletion-service.ts`：AgentProfileInUseError
- `server/src/domains/executor/executor-port.ts`：ExecutorProgress, ExecutorStatus, ExecutorType, GitCommit
- `server/src/domains/llm-profiles/repository-registry.ts`：getLlmProfileWriter, LlmProfileWriterRepo, OAuthCredentialsWriter
- `server/src/domains/local-pr/types.ts`：LocalPRStatus, ExecutionState, PendingAction
- `server/src/domains/openspec/bootstrap-service.ts`：ParsedRequirement
- `server/src/domains/openspec/markdown/types.ts`：flattenDelta
- `server/src/domains/sessions/agent-readiness.ts`：resolveAgentReadinessForSession
- `server/src/infra/providers/codex-oauth.ts`：\_resetCodexOAuthProviderForTest
- `server/src/infra/providers/message-types.ts`：ProviderRuntimeEventType
- `server/src/infra/providers/pi-runtime/bash-guards.ts`：CriticalBashMatch, BashSensitivePathMatch, BashToolRoutingSuggestion, BashFileBypassMatch, BashFileBypassKind
- `server/src/infra/providers/pi-runtime/invocations.ts`：PiSkillRef
- `server/src/infra/providers/pi-runtime/models-registry.ts`：\_resetModelsRegistryForTest
- `server/src/infra/providers/pi-runtime/run-tools.ts`：concreteMcpToolName
- `server/src/infra/providers/pi-runtime/sandbox-execution/classifier.ts`：formatGrantKeys
- `server/src/infra/providers/pi-runtime/sandbox-execution/types.ts`：SandboxPrivilegeRequest
- `server/src/infra/providers/pi-runtime/sandbox-network-memory.ts`：persistSessionSandboxGrant, loadSessionSandboxGrantKeys
- `server/src/infra/providers/pi-runtime/task-tools.ts`：parseTaskOutputWindowParams
- `server/src/infra/providers/pi-runtime/tool-bridge.ts`：ToolExecutionEvent
- `server/src/infra/providers/types.ts`：LanguageServerInfo, LspQueryAction, LspQueryRequest, LspQueryResult
- `server/src/interfaces/http/provider-capabilities.ts`：capabilitiesForSession
- `server/src/interfaces/http/session-invocables.ts`：getInvocableCatalogService
- `server/src/server.ts`：MessageSender
- `server/src/utils/agent-loop-runtime-types.ts`：AgentLoopExecutor
- `server/src/utils/process-tree.ts`：findProcessesByArgsIncludes, summarizeProcesses
- `server/src/utils/provider-trace.ts`：summarizeServerMessage

### plugins

- `plugins/agents/codex/src/app-server-protocol.ts`：FileUpdateChange, KnownNotificationParams, TurnScopedServerRequestParams
- `plugins/agents/codex/src/tool-effects.ts`：cleanEffectPath, makeFileChangeEffect
- `plugins/agents/cursor/src/acp-runner.ts`：ExternalAgentRunContext
- `plugins/agents/cursor/src/tool-effects.ts`：makeFileChangeEffect

### root/e2e/scripts

- `e2e/helpers/connection-helper.ts`：waitForAppReady
- `e2e/helpers/connection.ts`：deleteServerByName
- `e2e/helpers/setup.ts`：createGatewayApiClient
- `e2e/page-objects/PermissionPage.ts`：PermissionPage

## 低严重度：barrel（index.ts）未消费 re-export（311 项，28 个文件）

barrel 文件大量 re-export 了无人经该 barrel 消费的符号（底层符号可能仍被直接 import 使用，
因此这不是"删除符号"清单，而是"修剪 barrel"清单）。这是存量架构模式，统一以 glob
`**/index.{ts,tsx}` 挂账；长期方向二选一：修剪 barrel 至实际消费面，或调用方改为直连深路径后删 barrel。

| 文件                                                               | 未消费 re-export 数 |
| ------------------------------------------------------------------ | ------------------- |
| `server/src/infra/providers/pi-runtime/index.ts`                   | 53                  |
| `server/src/application/plugins/index.ts`                          | 48                  |
| `server/src/domains/sessions/index.ts`                             | 40                  |
| `server/src/domains/openspec/index.ts`                             | 33                  |
| `server/src/domains/agent-loop/index.ts`                           | 13                  |
| `apps/desktop/src/features/task-center/index.ts`                   | 11                  |
| `server/src/domains/attachments/index.ts`                          | 11                  |
| `server/src/domains/workflows/index.ts`                            | 11                  |
| `server/src/domains/issue-orchestration/index.ts`                  | 10                  |
| `server/src/domains/agent-profiles/index.ts`                       | 9                   |
| `server/src/infra/providers/pi-runtime/agent-loop/index.ts`        | 9                   |
| `server/src/domains/local-issues/index.ts`                         | 7                   |
| `server/src/domains/turn-summaries/index.ts`                       | 7                   |
| `server/src/infra/lsp/index.ts`                                    | 7                   |
| `server/src/domains/automations/index.ts`                          | 5                   |
| `server/src/domains/projects/index.ts`                             | 5                   |
| `apps/desktop/src/features/meta-workflow/index.ts`                 | 4                   |
| `server/src/domains/llm-profiles/index.ts`                         | 4                   |
| `server/src/domains/local-pr/index.ts`                             | 4                   |
| `server/src/domains/supervision/index.ts`                          | 4                   |
| `server/src/application/conversation/agent/bash-readonly/index.ts` | 3                   |
| `server/src/domains/notification-feed/index.ts`                    | 3                   |
| `server/src/infra/providers/pi-runtime/session-tree/index.ts`      | 3                   |
| `apps/desktop/src/components/filesymbols/index.ts`                 | 2                   |
| `server/src/domains/executor/index.ts`                             | 2                   |
| `apps/desktop/src/features/chat/index.ts`                          | 1                   |
| `e2e/page-objects/index.ts`                                        | 1                   |
| `server/src/domains/activities/index.ts`                           | 1                   |

逐符号明细：

- `server/src/infra/providers/pi-runtime/index.ts`：buildTools, ALL_TOOL_NAMES, runPreToolUseHooks, runPostToolUseHooks, withStreamRetry, extractUsage, zeroUsage, buildAgentHooks, truncateContent, DEFAULT_OUTPUT_LIMIT_BYTES, translateToolEvent, PendingArgOverrides, withPendingArgOverrides, DEFAULT_OVERRIDE_TTL_MS, PLAN_MODE_SYSTEM_PROMPT_SUFFIX, recordPiContextUsage, buildExternalMetaTools, buildExternalProviderCatalog, concreteMcpToolName, createConcreteMcpTool, externalToolKey, buildActiveSkillContext, buildSkillCatalog, resolveSkillExecutionPolicy, skillRefKey, buildSkillMetaTools, BUILTIN_AGENT_LOOP_TOOLSETS, buildAgentLoopTools, getAgentLoopToolsetDescriptor, AgentLoopTimeoutError, runPiAgentLoop, ToolName, ToolBridgeOptions, ToolExecutionEvent, HookInvocation, PreHookOutcome, RetryNotification, AgentHooksInput, AgentHooksOutput, TruncateResult, TranslateToolContext, PiRunToolBundle, PiRunPromptBundle, LoadedExternalToolSchema, SkillExecutionDependencies, SkillExecutionMode, RuntimeDiscoveredSkill, SkillExecutionPolicy, AgentLoopToolsetDescriptor, ToolsetContext, AgentLoopExecutor, AgentLoopExecutorInput, AgentLoopExecutorResult
- `server/src/application/plugins/index.ts`：registerPluginsDomain, createPluginRoutes, createPluginToolsRoutes, PluginLoader, PluginManagementError, PluginManagementService, PluginPackageError, PluginPackageService, pluginPackageService, PluginFrontendError, PluginFrontendService, setDatabase, getDiscoveredSkills, getExternalSkillDirs, saveExternalSkillDirs, loadAndCacheSkills, refreshSkillCache, addPluginSkills, PluginSchedulerService, pluginScheduler, PluginStorage, PluginStorageManager, pluginStorageManager, createProviderAPI, PluginProviderAPI, WorkerHost, workerHost, PluginsDomainDeps, PluginToolsRoutesDeps, PluginLoaderOptions, ManagedPluginInfo, PluginExecutableRequirement, PluginPackageMutationResult, PluginPackagePreview, PermissionRequest, PermissionState, PermissionStore, ToolHandler, ToolMeta, ToolRegistration, ToolScope, ToolSource, DiscoveredSkill, WorkflowStepMeta, StorageAPI, ProviderCallOptions, ProviderCallResult, ProviderStreamChunk
- `server/src/domains/sessions/index.ts`：createSessionRoutes, mountMessageRoutes, mountSearchRoutes, SessionDraftRepository, SessionMessageRepository, SessionLifecycleError, SessionLifecycleService, assertPlanStatusTransition, isSessionLocked, isSessionArchived, PLAN_STATUS_TRANSITIONS, SessionQueryError, SessionQueryService, SessionExportError, SessionExportService, normalizeSessionType, normalizeSessionCreateInput, buildSessionUpdatePatch, isSessionValidationError, SessionsDomainDeps, CreateSessionMessageInput, SessionMessageListOptions, StoredSessionMessage, SessionSearchQuery, SessionSearchResult, SessionDomainEvent, SessionEventBase, SessionCreated, SessionArchived, SessionRestored, SessionMetadataUpdated, SessionDeleted, SessionPlanStatusChanged, SessionUnlocked, SessionSyncResult, SyncedSessionSummary, SessionExportResult, SessionCreateInput, SessionUpdatePatch, TaskSessionSeed
- `server/src/domains/openspec/index.ts`：parseSpec, parseDelta, formatSpec, formatRequirement, applyDelta, applyDeltaToEmptyCorpus, validateSpec, validateDelta, buildExplorePrompt, parseExploreResponse, BootstrapReviewItemRepository, ParsedSpec, ParsedRequirement, ParsedScenario, DeltaDoc, DeltaOp, RfcKeyword, MergeResult, ValidationResult, ValidationIssue, ArchiveResult, CapabilityArchiveSummary, ExploreInput, ExploreResult, BootstrapStartInput, BootstrapStartResult, ReviewFinalizeResult, DraftResult, BootstrapScan, BootstrapScanStatus, BootstrapReviewItem, BootstrapReviewOp, BootstrapReviewStatus
- `server/src/domains/agent-loop/index.ts`：createObjectJsonContract, AgentLoopContext, AgentLoopContextPolicy, AgentLoopEventKind, AgentLoopOwner, AgentLoopOwnerType, AgentLoopRunStatus, AgentLoopRuntimePermissions, AgentLoopToolsetRequest, FutureOutputContract, OutputContract, ResolveAgentLoopContextArgs, ResolvedAgentLoopContext
- `apps/desktop/src/features/task-center/index.ts`：TaskPill, TaskCenterView, TaskCenterPopover, TaskDrawer, useSubagentDetail, useSubagentSteps, useTaskCenter, useTaskCompletionToasts, TaskCenterViewProps, SubagentDetail, TaskCenterViewModel
- `server/src/domains/attachments/index.ts`：createAttachmentRoutes, AttachmentService, toAttachment, AttachmentRepository, detectKindFromMime, isValidOwnerKind, registerOwnerGuard, checkOwnerAccess, AttachmentDomainDeps, AttachmentDomainResult, AttachmentRow
- `server/src/domains/workflows/index.ts`：WorkflowGeneratorService, WorkflowRepository, WorkflowStepRunRepository, BUILTIN_WORKFLOW_TEMPLATES, WorkflowRunAggregate, assertRunTransition, assertStepTransition, WorkflowDomainDeps, WorkflowDomainResult, WorkflowRunEvent, ResolvedPermissionWorkflow
- `server/src/domains/issue-orchestration/index.ts`：ExecutorService, IssueLifecycle, IssueStatusPropagator, deriveSubIssueStatus, AnonymousIssueService, IssueDomainEvent, ExecutorStatusChangedEvent, SubIssueStatusChangedEvent, SpecChangeStatusChangedEvent, RegisterIssueOrchestrationDeps
- `server/src/domains/agent-profiles/index.ts`：AgentProfileRepository, AgentProfileDeletionService, AgentProfileInUseError, AgentProfileNotFoundError, createAgentProfileRoutes, createRuntimeDescriptorRoutes, ensureDefaultAgentProfile, AgentRuntimeSummary, AgentProfilesDomainDeps
- `server/src/infra/providers/pi-runtime/agent-loop/index.ts`：BUILTIN_AGENT_LOOP_TOOLSETS, buildAgentLoopTools, AgentLoopTimeoutError, runPiAgentLoop, AgentLoopToolsetDescriptor, ToolsetContext, AgentLoopExecutor, AgentLoopExecutorInput, AgentLoopExecutorResult
- `server/src/domains/local-issues/index.ts`：createLocalIssueRoutes, LocalIssueService, LocalIssueRepository, LocalIssueCommentService, LocalIssueCommentRepository, LocalIssueDomainDeps, LocalIssueDomainResult
- `server/src/domains/turn-summaries/index.ts`：createTurnSummaryRoutes, TurnSummaryService, buildSummaryPrompt, parseSummaryResponse, TurnSummaryRepository, TurnSummaryDomainDeps, TurnSummaryDomainResult
- `server/src/infra/lsp/index.ts`：createTypeScriptPreset, defaultLanguageServerPresets, LanguageServerManagerOptions, RegisteredPreset, DiagnosticsRequest, LaunchSpec, SpawnLanguageServer
- `server/src/domains/automations/index.ts`：AutomationRepository, AutomationService, SYSTEM_PERMISSION_AUTOMATION_KEY, AutomationEnginePort, AutomationWorkflowLookupPort
- `server/src/domains/projects/index.ts`：createProjectRoutes, ProjectWorktreeService, ProjectNotFoundError, ProjectRootPathMissingError, ProjectsDomainDeps
- `apps/desktop/src/features/meta-workflow/index.ts`：useMetaWorkflowStore, handleMetaWorkflowMessage, MetaWorkflowScreen, MetaWorkflowViewState
- `server/src/domains/llm-profiles/index.ts`：createLlmProfileRoutes, LlmProfileDeletionService, LlmProfileNotFoundError, LlmProfilesDomainDeps
- `server/src/domains/local-pr/index.ts`：LocalPRService, LocalPRRepository, LocalPRDomainDeps, LocalPRDomainResult
- `server/src/domains/supervision/index.ts`：SupervisorError, SupervisionDomainDeps, SupervisionDomainResult, SupervisionSchedulingPort
- `server/src/application/conversation/agent/bash-readonly/index.ts`：evaluateReadonlyPolicy, BashAnalysis, BashInvocation
- `server/src/domains/notification-feed/index.ts`：createNotificationRoutes, NotificationDomainDeps, NotificationDomainResult
- `server/src/infra/providers/pi-runtime/session-tree/index.ts`：forkSessionAt, projectEntriesToMessageRows, ProjectedMessageRow
- `apps/desktop/src/components/filesymbols/index.ts`：symbolNameForFile, symbolMarkupForFile
- `server/src/domains/executor/index.ts`：IExecutor, ExecutorFactory
- `apps/desktop/src/features/chat/index.ts`：useChatActionsOptional
- `e2e/page-objects/index.ts`：PermissionPage
- `server/src/domains/activities/index.ts`：ActivityResult

## 配置白名单（静态分析不可见项，非发现、无需清理）

- `ignoreBinaries`: `codex`（插件测试按名拉起 Codex CLI）、`wsl.exe`（Windows 专属路径）、
  `xdg-open`（Linux opener，darwin 上误报）。
- `ignoreDependencies`: `node-gyp`（native 模块构建工具链）、`node-pty`（运行期探测）、
  `pyright` / `typescript-language-server`（LSP 运行期按字符串名 spawn 的二进制）、
  `ws` / `memfs` / `@earendil-works/pi-ai`（真问题，见"高严重度 §3"，挂账而非删除）。
- 入口补充：根 `scripts/**`（package.json 经 bash 包装调用，knip 解析不到嵌套 node 调用）、
  `e2e/**/*config*`（非标准命名经 --config 传入）、`e2e/fixtures/**`（测试按字符串路径加载）、
  desktop `vitest.*.config.ts` / `src/test/**`（setupFiles）/ `src/agent-playground/**`（脚本动态加载）、
  server `scripts/**` / `test-*.mjs`（手工工具）、plugins `probes/**`（手工探针）与
  cursor `src/__tests__/fixtures/**`（按路径 spawn 的假进程）。
- `ignoreUnresolved`: `../types.js`（见"高严重度 §1"，修复后应移除该条）。

## 维护指引

1. 清理完某文件后：删除 `knip.json` `ignore` 中对应行 → `pnpm knip` 应保持退出码 0。
2. barrel 全部修剪完后：删除 `**/index.{ts,tsx}` glob，knip 恢复逐 barrel 守卫。
3. 新增 agent plugin 时：在 `knip.json` `workspaces` 补显式键（当前 claude/codex/cursor 为显式清单）。
4. 删除存疑符号前：`pnpm dep:refs <file>:<exportName>` 查静态引用（仅静态分析，
   动态 import / 字符串路径引用需人工确认）。
