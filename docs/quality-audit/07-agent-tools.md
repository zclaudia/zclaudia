# 07 — Agent Tools 实现质量报告

Scope: 全部 agent 工具实现，覆盖两个位置：

- `server/src/infra/providers/pi-runtime/` — 约 30 个内置工具（`tool-catalog.ts` 分发表）+ 工具执行基础设施（约 18,600 LOC）
- `server/src/application/conversation/agent-tools/` — MCP-bridge 作用域的 `agent_shell / agent_file_ops / agent_http_request / agent_memory / agent_browser`（约 590 LOC）

方法：5 个并行审查分组，每个源文件完整通读，关键假设均对照真实代码/依赖（含已安装的 `@earendil-works/pi-agent-core@0.79.3`）或经验性复现验证；所有发现标注 `file:line`。未修改任何代码。

评分标准沿用本系列：架构边界 20 / 类型契约 15 / 测试质量 20 / 可维护性 15 / 可靠性 15 / 安全隐私 10 / 工程体验 5。

## 总体评分：68 / 100

| 维度 | 得分 | 文件工具 A | Bash/沙箱 B | 搜索/Web C | 编排/元工具 D | 基础设施 E |
| --- | --- | --- | --- | --- | --- | --- |
| 架构边界 (20) | **14.4** | 16 | 14 | 15 | 12 | 15 |
| 类型契约 (15) | **10.6** | 12 | 11 | 10 | 10 | 10 |
| 测试质量 (20) | **13.6** | 15 | 13 | 12 | 13 | 15 |
| 可维护性 (15) | **10.0** | 11 | 10 | 10 | 9 | 10 |
| 可靠性 (15) | **9.2** | 11 | 8 | 9 | 9 | 9 |
| 安全隐私 (10) | **5.8** | 8 | 5 | 6 | 4 | 6 |
| 工程体验 (5) | **4.0** | 4 | 4 | 4 | 4 | 4 |
| **组总分** | **67.6** | **77** | **65** | **66** | **61** | **69** |

发现统计：**BLOCKER ×1，HIGH ×20，MEDIUM ×47，LOW ×51**（共 119 条）。

## 执行摘要

整体工程质量中上：模块分层清晰（catalog → bridge → hooks → translators）、注释充分解释"为什么"、测试量大且偏行为断言、模型侧错误消息普遍带错误码和恢复建议。但存在系统性短板：

1. **安全是最大的失分维度（5.8/10）**。问题不是缺设计，而是防线之间互相架空：沙箱/敏感路径守卫存在，但子进程继承完整 `process.env`（含 API key）；MCP 信任策略存在，但 `MCPTool` 桥可绕过；计划模式只读过滤存在，但外部 MCP 工具可绕过；Agent 工具甚至透传模型自提交的 `permission_override`。
2. **多处"已验证的断流"**：`updatedInput` 被上游 pi-agent-core 静默忽略（BLOCKER）；`sandbox-denial.ts` 整个模块是死代码且文档描述的迭代循环不存在；`Monitor` 启动的任务永远 running；`LSPTool` 名义 LSP 实为纯 ripgrep。
3. **并发/TOCTOU 是各组共性**：写锁按未解析路径加锁（符号链接别名绕过）、patch delete/rename 在锁外校验、AstEdit 读改写无 digest 复核、bash 后台切换时旧监听器销毁子进程 stdio 丢尾部输出。
4. **无界资源增长点分散各处**：图片读取无大小上限、bash spill 文件无上限、deferred-diagnostics map 永不过期、tool-results/MCP 输出/tmp 备份无清理策略、task-logs 无 TTL。
5. **测试缺口与真实 bug 一一对应**：已确认 bug 几乎都落在未测试路径（CRLF hashline、patch 尾换行、>50KB 日志分页、fc/fd 域名误杀、observer 抛异常、计划模式×外部工具）。

## P0 — 立即修复（BLOCKER / 高危安全）

> **修复状态（2026-07-22）：8/8 已全部修复并验证**。验证：受影响测试 895/895 通过（78 个文件）、server `tsc --noEmit` 零错误、ESLint 零新增警告（基线 9 条均预存）。实现要点见下表"修复结果"列；主要行为变化记录在文末附录。

| # | 位置 | 问题 | 修复结果 |
| --- | --- | --- | --- |
| P0-1 | `agent-hooks.ts` + 新增 `pending-arg-overrides.ts` | `updatedInput` 被 pi-agent-core@0.79.3 静默忽略（已确认最新 0.81.1 同样不支持，无升级路径） | 本地替换层：按 pi tool-call id 记录 override，`buildTools` 包装 `execute` 消费并用 pi 自己的 `validateToolArguments` 重校验（一次性、5 分钟 TTL、256 上限）；substitution 位于 observer 包装内侧，遥测/用户钩子仍只见原始参数（凭证卫生保持）。回归测试 `arg-override-passthrough.test.ts` 13 条含生产 bundle 行为证明 |
| P0-2 | `task-tools.ts:83,108` | 模型可自提交 `permission_override` 直达子代理权限策略 | execute 仅转发父级 `options.permissionOverride`；schema 加 `additionalProperties:false` 作第二层。回归测试断言模型注入的 override 不进 task metadata |
| P0-3 | 新增 `env-scrub.ts`；应用于 `bash-runner.ts:257`、`sandbox.ts:163`、`command-executor.ts:111` | 子进程继承完整 `process.env`（密钥可读可外泄） | "过滤密钥而非严格白名单"：密钥名模式 + 已知密钥清单剔除，基础安全变量保留；`extraEnv` 显式优先，新增 `ZCLAUDIA_BASH_ENV_PASSTHROUGH` 逃生口。用户钩子经 `runBash` 自动继承 |
| P0-4 | `bash-tool.ts:275-286,446-448`、`sandbox-execution/permissions.ts:47-64` | 关键命令的 sandbox 硬门被 `sandbox_mode:"unsandboxed"` 绕过；批准文案不披露关键性 | fail-closed：关键模式 + unsandboxed 直接返回结构化错误（含 escalation 重试路径）；`SandboxUnsandboxedAccess` 批准详情附带 `criticalReason` 警告 |
| P0-5 | `mode-tools.ts:181-196` | ExitPlanMode 无 plan/空白 plan 绕过用户批准 | 计划模式下无 plan 或纯空白 plan → `plan_required` 错误（UI 驱动退出不受影响，无需新增无 plan 评审卡片）；非计划模式下裸调用保持 no-op。描述同步更新 |
| P0-6 | `run-tools.ts:62-92`、`run-permissions.ts:271-277` | 计划模式可被 pinned/动态加载的 MCP 工具绕过 | 计划模式下 bundle 跳过具体 MCP 工具、过滤 `LoadExternalTool`（发现类 meta 工具保留；RunSkill fork 已与计划过滤交集）；权限层对 run 级计划模式的外部工具名 fail-closed 兜底。新建 `run-tools.test.ts` |
| P0-7 | `bash-guards.ts`（归一化层 `:331`） | 守卫可被分离 flag/`--`/引号拼接/base64/glob/`cd ~`/`2>` 绕过 | 匹配前归一化（位置感知去引号、flag 簇合并、`--` 折叠）；新增 base64 管道、nc exec、glob/替换敏感路径、`cd ~` 感知、fd 重定向检测；HOME 展开统一 `os.homedir()`；模块头注释明确"UX/批准层，非安全边界"。回归测试钉住 12 个已堵绕过形状 + 2 个有意保留的 UX 层缺口 |
| P0-8 | 新增 `server/src/utils/ip-guard.ts`；应用于 `web-tools.ts:517-524`、`network-guard.ts:17` | SSRF 缺口：`::ffff:` 映射地址、169.254/16 等范围缺失、fc/fd 域名误杀、DNS fail-open、rebinding TOCTOU | 共享 `isPrivateOrReservedIp`（v4 全特殊用途段 + v6 展开含映射/兼容形式递归）；ULA 判断仅限真 IPv6；DNS 失败 fail-closed；web-tools 用 undici `connect.lookup` 钉住已验证 IP 建连（逐跳转重验证保留） |

## P1 — 高优先（正确性/可靠性）

| # | 位置 | 问题 | 修复方向 |
| --- | --- | --- | --- |
| P1-1 | `hashline.ts:49-55` + `edit-write-tools.ts:1452` | CRLF 文件 hashline 编辑必然失败（读时去 `\r`、编辑时保留），模型陷入重读循环 | `splitLines` 去尾部 `\r`；补 CRLF 回归测试 |
| P1-2 | `apply-patch.ts:9` + `edit-write-tools.ts:754` | 合法 patch 带尾换行即解析失败，报错文案误导；patch 引擎零单元测试 | 首尾检查前 trim 空行；补测试 |
| P1-3 | `read-tool.ts:644-696` | 图片分支无文件大小上限（2GB PNG 全量读入 + Jimp 解码放大） | 读取前 stat 门限 |
| P1-4 | `bash-runner.ts:341-344` | 后台切换后 `waitForChild` 监听器仍会在 exit+100ms 销毁子进程 stdio——adopter 未排空的尾部输出静默丢失 | handoff 时解除 `waitForChild` 武装，流所有权完整移交 |
| P1-5 | `bash-runner.ts:277-288` + `command-executor.ts:149-157` | spill 文件无上限增长；`adopt()` 全量 `readFileSync` 进内存 | spill 设上限（保尾部）；adopt 改流式拷贝/rename |
| P1-6 | `task-output-window.ts:116` | 日志 >50KB 时 `nextOffset = size`（EOF），中间段被静默跳过，与 schema 分页契约矛盾 | `nextOffset = offset + bytesRead`；补 >50KB 分页测试 |
| P1-7 | `task-tools.ts:259-275` | Monitor start 制造永久 running 的僵尸任务（无 monitor runtime、无 reconcile）；'agent' 任务重启后同样无法收敛 | 实现或移除 monitor runtime；bootstrap 增加 agent/monitor reconcile |
| P1-8 | `tool-execution-observer.ts:61-70` | observer 抛异常会把已成功的工具结果替换为错误结果——观察者永不应破坏 run | try/catch 包裹 + 不 await 进结果路径 |
| P1-9 | `agent-hooks.ts:323` | 失败循环守卫只看 `details.ok===false`，对抛异常的工具（`ctx.isError`）完全失明 | `isFailure = ctx.isError || details.ok === false` |
| P1-10 | `run-tools.ts:98-105` | `RunOptions.abortController.signal` 从未接入 `buildAgentHooks`：`shouldStopAfterTurn` 的 abort 检查是死代码，用户钩子进程在 run 中止后继续跑 | 两个调用点传入 signal |
| P1-11 | `symbol-tools.ts:209-217` | Python 函数体扫描遇 def 级缩进注释即截断；EditSymbol 据此替换会留下孤儿行→语法损坏文件 | 扫描跳过 `#` 注释行；补回归测试 |
| P1-12 | `lsp-diagnostics-adapter.ts:133-135` | 诊断缓存只在首次等待，之后每次写入都返回陈旧诊断 | 引入文档版本号，缓存早于最近一次保存时等待 |
| P1-13 | `search-tools.ts:63,139` | context 模式文件名含 `-<digits>-`（如 `report-2024-01.ts`）解析错文件/行号；`pattern.trim()` 破坏有意的缩进搜索 | 右向左解析或改用 `rg --json`；仅空检查用 trim |
| P1-14 | `agent-tools/index.ts:54-77` | `safePath` 对悬空符号链接可被写穿（stat 失败回落到父目录，writeFile 跟随链接写到项目外） | 最终路径 `lstat`，拒绝符号链接（对齐 memory-provider.ts:115-118） |
| P1-15 | `mcp-bridge-tools.ts:64-87` vs `external-tools.ts:367-385` | 同一 MCP 工具经 `MCPTool` 通用桥调用时绕过信任策略、无输出截断——被拒工具仍可达，多 MB 响应直入上下文 | 两条路径共享信任策略与输出预算逻辑 |
| P1-16 | `agent-tools/index.ts:107-200,248,311` | `agent_shell` 裸 `/bin/sh -c` 无沙箱无权限回调、30s 只 SIGTERM；`agent_file_ops` 读写无大小上限；`agent_http_request` 无超时 | 接入沙箱包装/权限流；读写设上限；加整体超时；SIGTERM 后 SIGKILL |

## 跨组系统性主题

### 1. 防线互相架空（安全 5.8/10 的根因）
每层单独看都有设计，组合起来失效：敏感路径守卫 vs 环境变量直读；MCP 信任策略 vs MCPTool 通用桥；计划模式只读过滤 vs 外部工具追加；批准交互 vs 模型自控 override。建议建立"策略单点"原则：权限/信任决策集中在 permission 层强制执行，工具层不再各自为政。

### 2. TOCTOU 与锁粒度
- `edit-write-tools.ts:561-563,1173-1175`：锁加在未解析路径上，符号链接别名互斥失效（丢更新）
- `edit-write-tools.ts:913-949,988-1026`：patch delete/rename 在校验与加锁之间有窗口
- `ast-bridge-tools.ts:154-202`：读→算→写无锁内复核，且跳过 `validateMutationContent`（密钥扫描）
- `file-history.ts:17-28`：备份索引 read-modify-write 无同步
统一修复模式：锁内重读/重校验（digest 或 mtime），多路径按序加锁。

### 3. 无界资源增长清单
| 资源 | 位置 | 现状 |
| --- | --- | --- |
| 图片读取 | read-tool.ts:658 | 无大小上限 |
| bash spill | bash-runner.ts:277 | 无上限，adopt 全量入内存 |
| deferred diagnostics | write-lifecycle.ts:52 | map 永不过期 |
| 文件备份 | file-history.ts | 无清理、/tmp 0644 可读 |
| tool-results | tool-result-store.ts:34 | 无淘汰策略 |
| MCP 输出 | external-tools.ts:207 | 共享 tmp 目录、无清理 |
| task-logs | command-executor.ts | 无 TTL（bash-logs 有 24h 清扫） |
| eval 临时产物 | eval-kernel.ts:144 / eval-task-runtime.ts:72 | kernel 脚本/日志/payload 不清理 |

### 4. 死代码与"假实现"
- `sandbox-denial.ts` 整模块死代码，注释描述的迭代上限不存在（controller 只重试一次，且丢失 `recommendedNextStep`）
- `updatedInput` 全链路死代码（见 P0-1）
- `LSPTool`（search-tools.ts:432-497）名义 LSP 实为 rg 文本搜索，`action` 参数被忽略、query 未转义——主动误导模型
- `lsp-diagnostics-adapter` 无生产调用方（仅测试接线）
- `use_cache`（web-tools.ts:660）死参数；`eval-task-runtime.ts:324` 死计算（Cwd 恒为 `.`）
- `noop-edit-guard.ts` 源文件含字面 NUL 字节，被 git/rg 当二进制

### 5. 错误契约不一致
`jsonResult({ error })`（无 `ok:false`）与 `errorResult`（有 `ok:false`）混用：task-tools.ts:84、search-tools.ts:457、web-tools.ts:801,970。依赖 `details.ok` 的失败循环守卫和 remediation 对这些失败失明。建议统一走 `errorResult` 并加 lint/测试约束。

### 6. 重复实现已漂移
- `NETWORK_FAILURE_PATTERNS`、`isDomainAllowed`、`SandboxNetworkAccess` 常量、`resolveDataDir` 各两处（B 组）
- `agentToolParameters` 复制 5 份；`textResult`/`jsonResult` 在 skills.ts/external-tools.ts 重实现（D/E 组）
- MCP 风险判定复制到 `interfaces/http/mcp-servers.ts:255-295`（E 组）
- `stripHtml` 在 web-tools/web-extract 逐字重复（C 组）
- 截断机制三套并存：tool-common 80k 字符 / agent-hooks 64KiB 字节 / external-tools 80k 字符

## 测试缺口汇总（与已确认 bug 的映射）

| 缺口 | 对应 bug |
| --- | --- |
| CRLF hashline 往返（现有测试纯 LF） | P1-1 |
| apply-patch 零单测（尾换行/空上下文行/EOF 无尾换行） | P1-2 |
| 负向安全测试为零（守卫绕过形状未钉住） | P0-7 |
| 计划模式 × 外部工具组合无测试 | P0-6 |
| `updatedInput` 端到端执行无测试（现有测试给出虚假信心） | P0-1 |
| >50KB 日志分页无测试 | P1-6 |
| observer 抛异常韧性无测试 | P1-8 |
| network-guard fc/fd 误杀、hex v4-mapped 无测试 | P0-8 |
| 并发测试整体缺失（写锁互斥、符号链接别名、备份索引竞态、handoff 竞态） | §主题 2 |
| agent_shell/file_ops/http_request 零测试 | P1-16 |
| workspace-paths 无测试（`..` 前缀合法名误拒） | 见 A 组 MEDIUM |
| tool-catalog 30 个工厂无运行时冒烟测试 | 见 E 组 LOW |

## P2 — 中低优先改进（按组精选）

**文件工具（A，77 分）**
- `workspace-paths.ts:10,21`：`..` 边界判断误拒 `..data` 类合法名，改 `=== '..' || startsWith('..' + sep)`
- `text-io.ts:15-22`：混合换行文件编辑会把全文归一化，diff 与磁盘不一致；按多数派/逐行保留
- `read-tool.ts:540`：≥250 行且 ≥30% 可折叠时默认返回骨架，描述未告知模型；补描述与 `full:true` 逃生口
- `file-history.ts`：备份 0600、restore 时重校验工作区包含关系
- `write-lifecycle.ts:132`：deferred diagnostics 加 TTL/LRU
- patch 预检双计 noop 失败（edit-write-tools.ts:759）；`Edit` 实际支持 `preview_only` 但 schema 未声明；patch 非原子需在描述中警示

**Bash/沙箱（B，65 分）**
- grant  widening：批准 `http://host:port`，会话持久化为整个 host 任意端口/协议（grants.ts:45）
- 重启后 live-pid 后台任务无退出监听，不轮询永不收敛；`stop()` 不确认 kill 生效（command-executor.ts:204-247）
- 退出码靠结果文本正则恢复（command-task-runtime.ts:20），应存结构化字段
- `2>` 重定向逃逸文件写守卫；`2>>` 被意外拦下——行为靠巧合
- 任何 shell 元字符即关闭全部工具路由引导（bash-guards.ts:220），需在描述中说明
- adopter 日志管线无背压；task-logs 无 TTL；Windows 仅裸 `bash` fallback 且 ENOENT 与命令失败不可区分

**搜索/Web（C，66 分）**
- `web-tools.ts:749`：忽略 charset，GBK/ISO-8859-1 页面乱码
- `ast-bridge-tools.ts:213`：AstEdit 返回无上限 diff；`ast-tools.ts:35`：同步遍历、无 .gitignore、符号链接环无 visited-set
- `web-tools.ts:1015`：0 结果短路 fallback 链；`format:'raw'` 绕过二进制守卫（873）；重定向无整体时限（9 跳 × 30s）
- `ripgrep-runner.ts:60`：stderr 无上限、SIGTERM 后无 SIGKILL 升级
- `lsp-diagnostics-adapter.ts:50`：file-URI 手工拼接遇 `#%?` 即损坏，改 `pathToFileURL`
- `total` 语义在 Grep/Glob 间不一致（search-tools.ts:246,397）

**编排/元工具（D，61 分）**
- `eval-tool.ts:180`：后台 Eval 丢弃会话已授权域名；`eval-tool.ts:220`：新 grant 改变 kernelKey 导致 kernel 状态静默丢失（无 `kernelRestarted` 信号）
- `skills.ts:899`：`invokeSkill` 对纯文本失败体 `JSON.parse` 即抛，且 `ok:true` 覆盖错误载荷；fork 执行无超时（633）
- `worktree-tools.ts:26`：raw SQL 写 `working_directory`，绕过 normalize 与广播
- `interaction-tools.ts:120`：AskUserQuestion deny/dismiss 也返回 `answered:true`
- `browser.ts:86`：整body 入内存再截断；改流式读取

**基础设施（E，69 分）**
- `tool-result-store.ts` / `external-tools.ts:207`：结果与 MCP 输出持久化无淘汰、落共享 tmp；改数据目录 + 0700 + TTL
- `tool-bridge.ts:29`：enabled 重复名不去重（部分 provider API 拒绝）
- `tool-schema-compat.ts:51`：anyOf 合并丢弃 `required`（目前靠执行时校验兜底，需注释+测试钉住）
- `tool-execution-observer.ts:24`：`extractTouchedPaths` 漏 AstEdit/worktree 工具，与 telemetry 的提取逻辑不统一
- `agent-hooks.ts:439`：persist 路径丢失 `truncated` 标志；telemetry 把 advisory 文本计入 outputBytes
- `user-hooks.ts:46`：钩子进程继承完整 env（与 P0-3 同源）

## 建议行动顺序

1. **本周（P0）**：P0-1 ~ P0-8，其中 P0-2/P0-4/P0-5 是小改动高杠杆，P0-1 需上游修复或本地包装层。
2. **两周内（P1）**：P1-1 ~ P1-16，配合"测试缺口"表逐项补回归测试——每个 bug 的测试用例在审查中已基本给出。
3. **一个月内（主题治理）**：策略单点化（主题 1）、锁内复核模式统一（主题 2）、资源 TTL 清扫统一框架（主题 3）、删除死代码与假实现（主题 4）、错误契约统一并加约束（主题 5）、重复实现单源化（主题 6）。

## 分组详细结论（保留各组健康度评价）

- **A 文件读写工具（77）**：模块划分干净、原子写+读状态守卫+循环检测设计成熟；失分在 1766 行 God-file、CRLF/patch 边角、并发缺口。
- **B Bash/沙箱（65）**：升级状态机结构好、批准默认 fail-closed；失分在 env 透传、守卫可绕、spill/切换竞态、死模块。
- **C 搜索/Web（66）**：流式 rg 有上限有超时、SSRF 有多层防御；失分在 LSPTool 假实现、LSP 陈旧缓存、AstEdit 安全缺口、charset/二进制边角。
- **D 编排/元工具（61）**：skills/remediation/memory 测试与实现俱佳；失分在双套工具系统安全姿态分裂、僵尸任务生命周期、agent-tools 裸奔。
- **E 基础设施（69）**：分层与 schema 收口干净、ToolName↔工厂编译期全覆盖；失分在 updatedInput 断流、observer 信任级别错误、abort 未接线。

## 附录：P0 修复引入的行为变化（2026-07-22）

1. Bash 子进程（含沙箱、后台任务、用户钩子）不再看到密钥命名的环境变量（`*_TOKEN`、`*_SECRET`、`*_API_KEY`、`AWS_*` 等）；依赖这些变量的工作流需 `ZCLAUDIA_BASH_ENV_PASSTHROUGH="FOO,BAR"` 或显式 `extraEnv`。注意：`mcp-client.ts`、`mcp-remote-client.ts`、`process-supervisor.ts`、`terminal-manager.ts` 仍有 env 透传，列为后续项。
2. `sandbox_mode:"unsandboxed"` 遇到关键模式命令会被直接拒绝（此前两次批准后在宿主机执行）。
3. `cmd 2> errors.txt` 形式的 stderr 重定向现在与 `>` 一样路由到 Write 工具提示。
4. ExitPlanMode 在计划模式下必须携带非空 plan（此前可裸调用直接退出）。
5. 计划模式 run 不再暴露 pinned MCP 工具与 `LoadExternalTool`；外部发现类工具保留。
6. Agent 工具调用带额外参数时可能被严格 provider 的 schema 校验拒绝。
7. network-guard 的 DNS 失败改为 fail-closed：DNS 抖动时 `agent_browser`/`agent_http_request` 会被阻断（此前放行）。
8. fake-IP DNS 环境（如 Clash 风格代理，应答落在 198.18.0.0/15）下 WebFetch 会按策略阻断所有域名——策略正确，但需告知该环境用户。
9. WebFetch 通过逐请求钉住 IP 的 undici Agent 直连已验证地址，不再走环境代理变量（防 rebinding 的既定副作用）。
10. 修复时一并消除的环境依赖：`tool-bridge.test.ts` 的 WebFetch 用例改用 DNS mock（`example.com` → 公网 IP），此前依赖真实解析器，在 fake-IP DNS 机器上必失败。

**工作区并发事故记录**：修复期间工作区发生多次外部 revert/reset（4 个修复组互相观察到编辑被覆盖）；最终状态已逐文件重新验证，事故备份保留在 `stash@{0}`（含 README 批次表等中间态），确认无遗失后可丢弃。
