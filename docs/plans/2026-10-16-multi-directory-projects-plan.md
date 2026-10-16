# 项目支持附加目录（主目录 + 附加目录）计划

- 日期：2026-10-16
- 性质：实现计划（尚未开始编码）
- 目标：一个项目除主目录 `rootPath` 外，可再绑定若干附加目录；agent 对附加目录有读写能力，且不触发「Outside workspace」升级。

## 1. 模型与边界（先定死，避免范围蔓延）

**主目录 + 附加目录，不是对称多根。**

| 方面 | 主目录 `rootPath` | 附加目录 `additionalPaths` |
| --- | --- | --- |
| session `cwd` / 相对路径基准 | ✅ | ❌（agent 用绝对路径访问） |
| agent 读写、权限边界内 | ✅ | ✅ |
| 沙箱可写 | ✅ | ✅ |
| git 状态 / worktree / Local PR / supervision / checkpoint | ✅ | ❌（本期明确不管） |
| LSP 诊断 / 符号工具 | ✅ | ❌ |
| 文件树 / `@file` | ✅ | 二期 |

- 仅 `type = 'code'` 且已设 `rootPath` 的项目可配置；`chat_only` 与无主目录项目不展示该入口。
- 附加目录与项目绑定，不随 worktree 映射：session 的 `cwd` 可能是主目录的 worktree，附加目录始终是原路径。
- 与现有「运行时学到的 outside-workspace 根」（`permission_outside_workspace_roots`，用户批准后记忆）是**两个概念**：学到的根是隐式、需批准过一次；附加目录是显式配置、永远免提示。两者在判定处取并集，存储互不影响。
- 不做：session 级 `/add-dir`、对称多根、附加目录的 git 面板（见 §9）。

## 2. 现状要点（已核实）

- 数据：`projects.root_path` 单列；`Project.rootPath?: string`（`shared/src/core/project.ts`）；仓库层 `domains/projects/repository.ts`、校验 `domains/projects/model.ts`（`ProjectPatch`）。迁移最新为 `047_prompt_cache_trace.ts`。
- 运行时 cwd：`application/conversation/runtime/run-bootstrap.ts` 取 `message.workingDirectory || session.working_directory || session.root_path`，经 `resolveProviderCwd` 得 `cwd`，写入 `ActiveRun.workspaceRoot` 与 `RunOptions.cwd`。
- 权限边界：`agent/permission-evaluator.ts` 的 `getOutsideWorkspacePaths / targetsOutsideWorkspace / isOutsideWorkspacePathAllowed` 均以单个 `rootPath` 调 `shell-parser.ts:isPathWithinRoot`（纯词法比较）。`run-permissions.ts` 在 479/520/538 行传 `rootPath: cwd`。
- Pi 工具：21 处调用 `pi-runtime/workspace-paths.ts:resolveInsideWorkspace(cwd, path)`，越界直接抛 `Path is outside workspace`（含 realpath 校验）。**这意味着对 Pi，权限批准不能放行 cwd 外路径，必须改工具层。**
- Pi 沙箱：`pi-runtime/sandbox.ts:wrapCommand` 的 `allowWrite: [workspaceRoot, tmpDir]`。
- Claude 插件：SDK `Options.additionalDirectories?: string[]` 已存在（`sdk.d.ts`），`plugins/agents/claude/src/runner.ts` 两处构造 `sdkOptions`（约 116、219 行）未使用。
- Codex 插件：`app-server-protocol.ts` 中 `thread/start` / `thread/resume` 参数仅有 `cwd/model/modelProvider/developerInstructions`，**未暴露可写根**，需 spike。
- Cursor 插件：走 `cursor-agent`，cwd 驱动；需 spike。
- 其他读取 `root_path` 且需评估的点：`infra/services/file-transfer-service.ts:249`（`allowedRoots`）、`apps/desktop/src/stores/projectStore.ts:471`（合并增量时 `incoming.rootPath ?? existing.rootPath`）。

## 3. 阶段划分

| 阶段 | 内容 | 依赖 | 可并行 |
| --- | --- | --- | --- |
| P0 | Spike：Codex 与 Cursor 能否注入可写/可读附加根 | 无 | 与 P1 并行 |
| P1 | 数据 + 校验 + API + 共享类型 | 无 | — |
| P2 | 运行时：根集合下发、权限判定、Pi 工具/沙箱、Claude 透传、系统提示 | P1 | 子任务可并行（见 §5） |
| P3 | 桌面 UI：新建项目、项目设置、runtime 能力提示 | P1 | 与 P2 并行（文件互不重叠） |
| P4 | Codex / Cursor 接入（按 P0 结论） | P0、P2 | — |
| P5 | 文件树 / `@file` / 文件查看器多根展示（二期，可拆独立 PR） | P1 | — |

## 4. P1：数据、校验、API

1. **迁移 `048_project_additional_paths.ts`**：`ALTER TABLE projects ADD COLUMN additional_paths TEXT`（JSON 字符串数组，NULL 视为 `[]`）。用 ADD COLUMN，不要求用户 `rm data.db`。按 047 的迁移写法与 `migrations/index.ts` 注册，补迁移测试（`migrations/__tests__`）。
2. **共享类型**：`shared/src/core/project.ts` 的 `Project` 增 `additionalPaths?: string[]`；经 wire/facade 的 project 序列化路径透出（核对 `shared/src/wire`、`facade` 里是否有逐字段白名单）。先 build shared。
3. **仓库层**：`domains/projects/repository.ts` 的 row 映射、insert、update 增 `additional_paths`；读出统一返回数组（NULL → `[]`），避免前端 `undefined` 与 `[]` 混淆。
4. **校验（服务端，集中在一个函数 `normalizeAdditionalPaths(rootPath, paths)`，放 `domains/projects/model.ts` 或同域新文件）**：
   - 必须绝对路径、存在、是目录；存 `realpath` 之后的规范化路径；
   - 去重；与 `rootPath` 相同或位于 `rootPath` 之内的丢弃（冗余）；位于其他附加目录之内的丢弃；
   - 拒绝：文件系统根 `/`、用户 home 目录本身、`~/.zclaudia` 数据目录及其子目录、`~/.ssh` 等 `SENSITIVE_DENY_READ`（`pi-runtime/sandbox.ts`）内的路径；
   - 数量上限 8；
   - `chat_only` 项目或无 `rootPath` 时拒绝设置；
   - `ProjectPatch` 支持 `additionalPaths` 的设置与清空（传 `null`/`[]`）。
   错误信息使用用户可读英文（UI 文案一律英文）。
5. **API**：项目 create/update 路由透传 `additionalPaths`（`apps/desktop/src/services/api/projects.ts` 对应服务端路由，核对 `domains/projects` 路由文件）；复用 `interfaces/http/files.ts` 约 149 行的「目录列表（project-root picker）」接口选目录。
6. **主目录变更联动**：改 `rootPath` 时对既有 `additionalPaths` 重新跑 `normalizeAdditionalPaths`，被新主目录包含的自动丢弃。
7. **测试**：model 校验单测（相对路径、不存在、文件、嵌套、重复、敏感路径、超上限、chat_only）；repository 往返测试；路由测试。

## 5. P2：运行时

### 5.1 根集合下发（单一事实源）
- 在 `run-bootstrap.ts` 加载 session 时一并读出项目的 `additional_paths`，得到 `workspaceRoots = { primary: cwd, additional: string[] }`。
- 写入 `ActiveRun`（`application/conversation/transport/types.ts`，现有 `workspaceRoot`、`allowedOutsideWorkspaceRoots` 旁新增 `additionalRoots: string[]`）。`background-follow-up.ts` 里构造 ActiveRun 的位置（约 259 行）同步补齐。
- 运行时校验：执行时附加目录若已不存在，则跳过并 `console.warn`，不让整个 run 失败；在 run 开头给用户一条非阻塞提示（沿用现有 notice 机制，若无则只记日志）。
- 宿主 `RunOptions`（`run-context.ts` 的 `baseRunOptions`）新增 `additionalDirectories?: string[]`，插件契约类型同步新增（找到 `RunOptions` 的定义处，若来自 npm 包 `@zclaudia/plugin-sdk` 需走其发布流程，**先确认**；若不想动 SDK，可经现有 extension/metadata 字段透传，二选一在实施前定）。

### 5.2 权限判定（安全相关，TDD）
- `shell-parser.ts` 新增 `isPathWithinAnyRoot(filePath, roots[])`，保留 `isPathWithinRoot` 不变。
- `permission-evaluator.ts`：`getOutsideWorkspacePaths / getOutsideWorkspaceRootsToRemember / isOutsideWorkspacePathAllowed / targetsOutsideWorkspace` 的 `rootPath: string` 参数改为 `roots: { primary: string; additional?: string[] }`（或保持 `rootPath` 并追加 `additionalRoots`，以改动面最小为准）。相对路径仍基于 primary 解析。`EvaluationContext` 增 `additionalRoots`。
- `run-permissions.ts` 479/520/538 行传入 `additionalRoots`；`isOutsideWorkspacePathAllowed` 的 `allowedRoots` 取「学到的根 ∪ 附加目录」。
- 注意工作区现有未提交改动正落在 `run-permissions.ts`、`background-follow-up.ts`、`consume-provider-stream.ts`、`plugins/agents/claude/src/{permissions,runner}.ts` 等文件上：**动手前先确认这些 WIP 的归属，避免互相覆盖；本计划实施单独分支/worktree，不夹带 WIP。**
- 重点测试：路径穿越（`extra/../secret`）、前缀碰撞（`/a/proj-extra` 不应被 `/a/proj` 放行，现有 `+ path.sep` 已处理，要回归）、符号链接逃逸（附加目录内指向目录外的链接）、Bash 命令中的相对路径与 `cd`、大小写不敏感文件系统（macOS）。

### 5.3 Pi 工具层
- `workspace-paths.ts`：新增 `resolveInsideWorkspaces(roots, requestedPath)`：相对路径基于 primary；绝对路径在任一根内（沿用同一套 realpath + 缺失祖先探测）则放行；`Path is outside workspace` 错误信息列出可用根。`resolveInsideWorkspace(cwd, p)` 保留为单根包装，**21 个调用点逐个迁移**，通过 `tool-options.ts` 把 `workspaceRoots` 注入各工具工厂（read / edit / write / patch-executor / search / ast-bridge / rename-symbol / lsp / symbol / bash / file-history）。
- Glob/Grep：默认搜 primary；显式 `path` 指向附加目录时允许。
- `file-history`（快照/rewind）：路径落在附加目录时也要能记录与回滚，核对其以 workspace 相对路径作 key 的假设，必要时改用 `root 标识 + 相对路径`。
- LSP / RenameSymbol：仅 primary；附加目录内文件不产生诊断，工具返回明确提示而非静默忽略。
- 沙箱：`WrapOptions` 增 `additionalRoots`，`allowWrite: [workspaceRoot, ...additionalRoots, tmpDir]`；`bash-tool.ts`（约 142/401/502/616 行）、`eval-tool.ts`、`eval-task-runtime.ts`、`command-task-runtime.ts` 的调用点补传（后三者经 `metadata.workspaceRoot` 传递，需同路径传 `additionalRoots`）。`readOnly` 模式下附加目录同样只读。
- Pi 的 sandbox 拒写检测与 remediation（`remediation.ts`）逻辑不变，但提示文案若提到「workspace」需覆盖附加目录。

### 5.4 Claude 插件
- `ClaudeAgentRunOptions` 增 `additionalDirectories?: string[]`，`adapter.ts` 从宿主 RunOptions 映射，`runner.ts` 两处 `sdkOptions` 设置 `additionalDirectories`。
- 其 `canUseTool` 回调走服务端 `run-permissions` 判定，已由 §5.2 覆盖。
- `plugins/agents/claude` 下已有未提交改动，同样先对齐归属。

### 5.5 让 agent 知道有哪些目录
- 在项目上下文/系统提示（核对 `run-context.ts` / `run-prompt.ts` 里 `taskContext` / 项目 context 拼装处）追加一段：`Additional directories (read/write allowed): <abs path> …`，并说明相对路径基于主目录、使用附加目录需用绝对路径、附加目录不参与 git 状态。
- 对原生 context 的 runtime（Claude/Codex）通过 `developerInstructions` 或等价通道；Pi 走其 system prompt。无附加目录时不输出该段（保持提示缓存前缀稳定，避免无谓破坏 prompt cache）。

## 6. P3：桌面 UI

- `useNewProjectForm.ts`：新增 `additionalPaths: string[]` 状态；`NewProjectModal.tsx`（245 行）在「Working directory」下加「Additional directories」列表：每行一个路径（输入 + 浏览按钮 + 移除），底部「Add directory」。复用现有 folder picker 弹层（`initialPath` 机制）。仅 `type = code` 且主目录非空时显示。
- `ProjectSettings.tsx`：同样的列表编辑，保存时随 `rootPath` 一起提交；服务端返回的规范化结果回写表单（被丢弃的冗余项给出一行说明）。
- `projectStore.ts`（约 471 行）合并增量时补 `additionalPaths: incoming.additionalPaths ?? existing.additionalPaths`。
- `services/api/projects.ts` 类型补 `additionalPaths`。
- **runtime 能力提示**：在 agentRuntimes descriptor 契约（server 下发、desktop fetch 的那份）新增 `additionalDirectories: 'native' | 'host' | 'none'`（Pi=host，Claude=native，Codex/Cursor 视 P0）。项目所选 agent 为 `none` 时，列表下显示一行提示「This agent can't write to additional directories; it will ask for approval」之类（实际文案按降级行为定）。
- 遵守 `docs/ui-conventions.md`（行/字体/图标纪律）；复用现有 `EditorRow/FIELD_CLASS`、lucide 图标；文案全英文。
- 移动端：按 SETTINGS_SURFACES 的「桌面=administer、移动=connect/observe」，移动端只读展示附加目录，不提供编辑。
- 侧栏项目行/项目详情可选显示「+N dirs」小标记，非必须。

## 7. P0 / P4：Codex 与 Cursor

**P0 Spike（各约半天，输出写入 `docs/` 并记 memory）**
- Codex：用固定的 CLI 版本（`app-server-protocol.ts` 注释写 0.154.0）实测 `thread/start` 是否接受 `sandbox` / `config` 覆盖（`sandbox_workspace_write.writable_roots`）或 per-turn `sandboxPolicy`；确认 thread 创建后能否变更；确认只读访问 cwd 外是否本来就放行（`workspaceWrite` 下通常读不受限、写受限）。
- Cursor：实测 `cursor-agent` 是否有 add-dir / workspace 多目录参数；ACP `session/new` 是否接受多个 workspace folder。
- 结论分三档：`native`（原生支持，直接透传）/ `host`（宿主经 canUseTool 审批放行）/ `none`（降级：仅提示词告知路径，写入走原有 outside-workspace 审批）。

**P4**：按结论实现；`none` 档必须保证降级行为诚实（UI 提示 + 提示词不承诺可写）。

**P0 结论（已完成，详见 `docs/reviews/2026-10-16-{codex,cursor}-additional-directories-spike.md`）**
- Codex：`native`。`thread/start`/`thread/resume` 传 `sandbox:"workspace-write"` 与 `config:{sandbox_workspace_write:{writable_roots:[…],network_access:true}}`（无需 experimentalApi）；`resume` 在新进程里**不持久化**、传入即**替换**，所以每次 resume 都必须带全量列表；运行中变更用 `turn/start.sandboxPolicy`（会替换整个策略，须重述 `networkAccess:true`）。读 cwd 外本来就放行。plan 模式不加根。bump 版本前需在 `runtime-compatibility.json` 的最低版本上复测，且仅验证了 macOS。
- Cursor：`host`。ACP 无原生多根，`session/new.additionalDirectories` 被静默忽略；读不拦；文件写到 cwd 外会发 `session/request_permission`（`kind:"edit"`，带 `diff.path`），宿主可按路径自动应答（现有 `AcpPermissionBridge`→`canUseTool` 通路）。shell 写入按命令白名单拦、与目录无关，无法按根自动放行（写入会照常弹审批）。legacy stream-json 视为 `none`。
- 因此 P4：Codex 透传 writable_roots；Cursor 在权限桥里对「edit 且路径落在附加目录内」自动允许，shell 保持审批；descriptor：Pi=`host`、Claude=`native`、Codex=`native`、Cursor=`host`（shell 除外）。

## 8. P5：文件树 / @file / 查看器（二期）

- 文件面板顶层按根分组（主目录 + 各附加目录标签）；`@file` 补全与 `FileReference` 支持附加目录路径（现按相对主目录显示，附加目录用绝对路径或 `<dirname>:` 前缀）。
- `file-transfer-service.ts:249` 的 `allowedRoots` 增加附加目录；文件查看器的读写接口 allowed-root 校验同步（核对 `interfaces/http/files.ts`、`workspace.ts` 的路径校验位置）。
- 单独拆 PR，不阻塞 P1–P4。

## 9. 明确不做 / 后续

- session 级 `/add-dir`（临时添加，不改项目）——模型上可叠加在项目级之上，后续再做。
- 附加目录的 git 状态、worktree、Local PR、supervision。若日后需要「一个项目多个 git 仓库」，是独立的大需求（git 层重做），不在此计划内。
- 附加目录的 LSP 诊断。

## 10. 验证

- 单测：§4 校验、§5.2 权限（含符号链接/穿越/前缀碰撞）、§5.3 `resolveInsideWorkspaces`、沙箱参数、repository/迁移。
- 集成：Pi 真实 run，要求读写附加目录文件（含 Bash 写入）→ 无升级提示、成功；写入第三方路径 → 仍触发 Outside workspace。
- 手测（桌面 + browser shell）：新建项目带 2 个附加目录；设置页增删；agent 提示词确认；改主目录后冗余项被丢弃；附加目录被删后 run 仍能启动。
- 回归：未配置附加目录的项目，权限判定、沙箱参数、系统提示完全不变（含 prompt cache 前缀）。
- 全套：`pnpm test`（server / shared / desktop / plugins 各自套件）+ `tsc`。

## 11. 风险

| 风险 | 对策 |
| --- | --- |
| 权限边界放宽引入越权 | 词法 + realpath 双重校验；敏感路径与数据目录拒绝；TDD；上限 8 个 |
| Pi 21 个调用点迁移遗漏 | 先加一条全局测试：grep 禁止新代码再调用旧单根 `resolveInsideWorkspace`（迁移完后保留包装仅供测试/内部） |
| Codex/Cursor 无原生能力 | P0 先定档位，UI 如实提示，不做假承诺 |
| 与工作区未提交 WIP 冲突 | 单独分支/worktree 实施；先确认 WIP 归属 |
| plugin-sdk 契约改动需发布 | 先确认 `RunOptions` 定义归属，优先选不改 SDK 的透传方案 |
| 附加目录失效 | 运行时跳过 + 提示；设置页标红不存在的路径 |
| 提示缓存被破坏 | 无附加目录时不输出该段；有时放在稳定的 system 段且顺序固定 |

## 12. 待用户确认

1. 附加目录数量上限 8 是否合适？
2. 敏感路径拒绝清单（`/`、home、数据目录、SENSITIVE_DENY_READ）是否过严/过松？
3. Codex/Cursor 若只能降级（`none`），是否接受先上线 Pi + Claude？
