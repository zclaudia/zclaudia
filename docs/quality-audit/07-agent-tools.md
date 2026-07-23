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

> **修复状态（2026-07-22）：16/16 已全部修复并验证**。验证：受影响测试 1205/1205 通过（111 个文件）；server 全量测试 5358 通过、4 个失败均为预存（projects/claudia 的 `no such column: status`，在 P0 前基线 c6908503 上同样失败，与本次无关）；`tsc --noEmit` 零错误；ESLint 警告数与基线完全一致（零新增）。实现要点见下表"修复结果"列；行为变化见文末附录。

| # | 位置 | 问题 | 修复结果 |
| --- | --- | --- | --- |
| P1-1 | `hashline.ts:49-60` | CRLF 文件 hashline 编辑必然失败（读时去 `\r`、编辑时保留），模型陷入重读循环 | `splitLines` 改 `/\r?\n/` 与 Read 侧镜像（孤立 `\r` 保留为内容）；快照歧义路径不再单独预归一化；写入时 `applyLineEndingStyle` 保持磁盘 CRLF。4 条新测试含 Read→Edit 集成 |
| P1-2 | `apply-patch.ts:8-16,31-72` + `edit-write-tools.ts:1042-1073` | 合法 patch 带尾换行即解析失败；空上下文行静默丢失；EOF 无尾换行的 hunk 永不匹配 | 标记前后空行 trim；hunk 内空行按空白上下文行缓冲处理（尾随空行当分隔符）；无 `-`/`+`/空格前缀的非空行改为明确解析错误（不再静默损坏）；仅当目标文件本身无尾 `\n` 时 retry 去尾换行匹配。新建 `apply-patch.test.ts` 16 条（此前零测试） |
| P1-3 | `read-tool.ts:54-57,651-661` | 图片分支无文件大小上限（2GB PNG 全量读入 + Jimp 解码放大） | 新增 `MAX_IMAGE_FILE_BYTES = 50MB`（对齐 PDF 上限），读取前 stat 门限，返回与文本上限一致的 `file_too_large` 结构化错误 |
| P1-4 | `bash-runner.ts:187-257,433,441-451` | 后台切换后 `waitForChild` 监听器仍会在 exit+100ms 销毁子进程 stdio——adopter 未排空的尾部输出静默丢失 | `waitForChild` 返回 `{ promise, disarm }`；handoff 时 disarm（清监听器/定时器/置 settled）；`detach()` 同时 pause 双流（发现：移除 `data` 监听不会暂停 flowing 流，Node exit 时 `flushStdio` 会丢弃无消费者数据）。测试用临时禁用 disarm 验证了区分度 |
| P1-5 | `bash-runner.ts:88,348-358` + `command-executor.ts:50-57,166-313` | spill 文件无上限增长；`adopt()` 全量 `readFileSync` 进内存；adopt 日志管线无背压 | `BASH_SPILL_MAX_BYTES = 64MB` 硬上限 + 丢弃标记（`fullOutputCapped` 透出到工具文本）；热路径改惰性 fd + `writeSync`（写入加 try/catch）；adopt 改 `renameSync`（同文件系统零内存），EXDEV 回退流式拷贝带背压；日志流在 stdio `end`（而非 `exit`）关闭 + 5s 排空宽限；顺带修复 handoff→adopt 窗口内子进程退出导致的 `failed→running` 假转换 |
| P1-6 | `task-output-window.ts:116-128` | 日志 >50KB 时 `nextOffset = size`（EOF），中间段被静默跳过 | 非尾部读 `nextOffset = min(offset, size) + byteLength(output)`；tail 语义不变。新建 `task-output-window.test.ts` 7 条（120KB 三页字节级重组验证无跳过/重叠；该文件此前零直接单测） |
| P1-7 | `task-tools.ts:269-279` + 新增 `domains/tasks/executors/reconcile-stale-tasks.ts`；`domain-bootstrap.ts:290` | Monitor start 制造永久 running 的僵尸任务（无 monitor runtime、无 reconcile）；'agent' 任务重启后无法收敛 | 查实 monitor runtime 从未存在（start 自引入即为假实现）：start 改返回 `monitor_start_unsupported` 结构化错误并指向 TaskOutput+`wait_ms`（不再建行）；新增 `reconcileUnresumableTasks` 在 bootstrap 将 queued/running/paused 的 agent/monitor 任务置 `stopped`/`server_restarted`（command/eval 走 pid 调和不受影响） |
| P1-8 | `tool-execution-observer.ts:61-80` | observer 抛异常会把已成功的工具结果替换为错误结果 | try/catch + `console.warn`；确认 observer 接口只有 `afterToolExecute`（无 before 路径，注释说明）。测试：reject/同步抛两种 observer 均不影响真实结果 |
| P1-9 | `agent-hooks.ts:341-347` | 失败循环守卫只看 `details.ok===false`，对抛异常的工具（`ctx.isError`）完全失明 | `isFailure = ctx.isError === true \|\| details.ok === false`；测试：重复抛异常的第三方工具第 3 次触发 `tool_loop_detected` |
| P1-10 | `run-tools.ts:127-130` + `lightweight-agent-runner.ts:129-131` + `domains/agent-loop/types.ts:115-121` | `abortController.signal` 从未接入 `buildAgentHooks`：abort 检查死代码、钩子进程在 run 中止后存活 | 两个调用点接入 signal；`LightweightAgentRunRequest` 新增可选 `abortSignal`。`shouldStopAfterTurn` 的 abort 检查生效，Pre/PostToolUse 钩子进程随 run 中止 |
| P1-11 | `symbol-tools.ts:209-232,308-334` | Python 函数体扫描遇 def 级缩进注释即截断，EditSymbol 留下孤儿行 | 体尾扫描跳过 `#` 注释；尾部注释 run 排除在 span 外（防止把下一函数的头部注释吞进 span）。顺带修复同类潜在 bug：`findStatementEnd` 对 `const f = () => 1; // note` 会把语句尾推入下一个符号导致 EditSymbol 删除它（新增 `stripJsLineComment`） |
| P1-12 | `lsp-diagnostics-adapter.ts:51-59,130-212` | 诊断缓存只在首次等待，之后每次写入返回陈旧诊断 | 每文档单调 `saveSeq`：缓存早于最近保存时等待新 `publishDiagnostics`（超时回退保留，超时路径同时注销 waiter）；URI 转换改 `pathToFileURL`/`fileURLToPath`（`#%?` 与 Windows 盘符修复）；重复保存发 `didChange`（版本递增）；`dispose()` 发 `didClose`。该适配器目前仅测试接线（无生产调用方），状态不变 |
| P1-13 | `search-tools.ts:28-43,78-96,176-180,477-553` | context 模式 `-<digits>-` 文件名解析错位；`pattern.trim()` 破坏缩进搜索；LSPTool 假 LSP | content 模式改 `rg --null` 分隔（对破折号日期/冒号/盘符无歧义；不用右锚解析——时间戳内容更常见）；trim 仅用于空检查；LSPTool：execute 包 try/catch 返回 `lsp_search_failed`、`missing_query` 带 `ok:false`、query 改 `--fixed-strings` 字面匹配、描述如实改写为基于 rg 的文本符号搜索（不再声称 LSP 语义） |
| P1-14 | `agent-tools/index.ts:31-45,52-93` | `safePath` 对悬空符号链接可被写穿 | `findExistingAncestor` 改 `lstat`；最终路径 `lstat` 命中符号链接一律拒绝（读/写/列，对齐 memory-provider 模式）。新建 `agent-file-ops.test.ts`（此前 file_ops 零测试） |
| P1-15 | `external-tools.ts:252,287,320` + `mcp-bridge-tools.ts:65,117-157,221,283,315-360` | `MCPTool` 通用桥绕过信任策略、无输出预算 | external-tools 导出共享门：`enforceMcpToolTrustPolicy` + `buildMcpTrustDenialResult`（concrete 路径同构，拒绝形状字节一致）；MCPTool 查 inventory 元数据执行同一策略（未声明工具按 open-world→high 处理）；ToolSearch/ListMcpResources/ReadMcpResource 全部接入同一截断/持久化预算（blob 落盘替代内联 base64） |
| P1-16 | `agent-tools/index.ts` + `browser.ts` + 新增 `stream-read.ts` | `agent_shell` 裸 `/bin/sh -c` 无沙箱、SIGTERM 不升级；file_ops 无上限；http 无超时；browser 整 body 入内存 | `agent_shell` 经 `wrapCommand` 沙箱包装（跨层引用有 domain-bootstrap 先例；非沙箱回退用共享 `scrubEnv`）；超时 SIGTERM→3s 宽限→SIGKILL（退出码恒 124 + `timedOut`）；race 败方接 `.catch`；stdout/stderr 改 8K+8K/2K+2K 首尾截断；file_ops 读 64KB 上限（带 `truncated/totalBytes`）、写 >1MB 拒绝；http 30s 整体超时；browser 与 http 共享流式 `readResponseBodyWithBudget`（256KB 预算）。新增 `agent-shell.test.ts`、`agent-http-request.test.ts` |

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

> **修复状态（2026-07-23）：P2 与遗留项已全部完成并验证（约 40 项）**。验证：server 全量测试 495 文件 / 5539 通过 / 0 失败；`tsc --noEmit` 零错误；ESLint 警告数与基线完全一致（308 = 308，零新增）；prettier 全部改动文件通过。实现要点与行为变化见文末 P2 附录。原始清单保留如下（全部 ✅）：

**文件工具（A，77 分）** ✅
- `workspace-paths.ts`：`..` 前缀合法名误拒 → 新增 `isOutsideWorkspace` 辅助（`=== '..' || startsWith('..' + sep)`），edit-write-tools 的同类判断一并修复；新建 workspace-paths 测试
- `text-io.ts`：混合换行采用多数派风格（注释记录取舍）；未编辑行字节不变，补 7 单测 + 2 集成
- `read-tool.ts:545`：描述已写明结构摘要触发条件（250 行/30% 可折叠）与 `full:true` 逃生口
- `file-history.ts`：备份与索引 0600；restore 重校验包含关系 + 拒绝符号链接目标；索引互斥串行化；每文件 20 份 + 7 天 TTL 修剪
- `write-lifecycle.ts`：deferred diagnostics 读取即删（终态）+ 10 分钟 TTL 懒清扫
- patch 预检不再双计 noop 失败（预检用空 guard，失败按内容指纹计一次）；`Edit` schema 声明 `preview_only`；patch 描述增加非原子警示；`*** Add File` 空行容错与 update hunk 对齐

**Bash/沙箱（B，65 分）** ✅
- grant widening：确认 `@anthropic-ai/sandbox-runtime` 的 allowedDomains 仅支持 host 级（运行时限制，无法端口/协议收窄）→ 批准文案如实披露"将开放该主机全部端口与协议"
- `stop()` 先 settle 再杀并确认死亡（2.5s 轮询 + 一轮升级，不可确认时注释结果）；reconcile 对 live-pid 任务挂退出监听（1s 轮询 watcher，去重、自动清理）
- 退出码结构化：`metadata.exitCode` 在 finalize 时落库，`command-task-runtime` 优先读字段、文本正则仅作 legacy 兜底
- task-logs 24h TTL 清扫（新增共享 `utils/data-dir.ts`：`resolveDataDir` + `sweepStaleLogs`）
- `sandbox-denial.ts` 死模块及其测试已删除；`SandboxNetworkAccess` 常量单源化（permissions.ts 导出，toolsets.ts 引用）；capability 重试失败携带 `recommendedNextStep`
- inflight-bash-registry 按 2×600s 龄期懒清扫；Windows shell 缺失返回结构化 `shell_not_found`（列出探测路径）；Bash 描述已注明 shell 控制语法会跳过 LS/Glob/Grep 路由引导

**搜索/Web（C，66 分）** ✅
- `web-tools.ts`：按 content-type charset 解码（GBK 等不再乱码，未知 label 回退 UTF-8）；`format:'raw'` 不再绕过二进制守卫；90s 整体重定向预算（`fetch_timeout`）；0 结果时继续 fallback 链；删除死参数 `use_cache`；`stripHtml` 去重；`missing_url`/`missing_query` 错误结构化
- `ast-bridge-tools.ts`：锁内重读比对（`file_changed_during_edit`）；逐文件 `validateMutationContent`；diff 80KB 截断 + 每文件 hunk 摘要
- `ast-tools.ts`：遍历改 `fs/promises` + realpath visited-set 防符号链接环 + 跳过 vendor
- `ripgrep-runner.ts`：stderr 8KB 上限（`stderrTruncated`）；所有 kill 路径 SIGTERM→1s→SIGKILL
- `search-tools.ts`：Grep content 模式 `total` 改为匹配行数（新增 `returned` 全部行数）；LS 用 `withFileTypes` + 32 路并发 stat
- registry-search JSDoc 归位

**编排/元工具（D，61 分）** ✅
- 后台 Eval 继承会话已授权域名（grants 从 `sandboxAllowedDomains` 映射）；grant 变化导致 kernel 重建时返回 `kernelRestarted:'grants_changed'`
- kernel 脚本 shutdown 删除、eval 日志 24h 清扫、已 settle 任务 payload/result 文件清理
- `skills.ts`：`loadSkillStructured` 结构化结果替代 `JSON.parse(text)`；fork 超时（`ZCLAUDIA_SKILL_FORK_TIMEOUT_MS` 默认 10 分钟）+ abort 传播（`run-tools.ts` 已接线 `abortSignal`）
- `worktree-tools.ts`：改走 `normalizeSessionWorkingDirectory` + 网关广播（与 run-bootstrap 同语义）
- AskUserQuestion deny/空 allow → `answered:false`
- `agentToolParameters` 全部 13 处单源化到 tool-common（D 组 6 处 + 集成时 7 处）；task-tools 缺失依赖错误改 `errorResult`；Agent/Monitor 参数描述补全；fork 系统提示按策略条件化；eval TaskOutput 显示真实 Cwd

**基础设施（E，69 分）** ✅
- `tool-result-store.ts`：0600 + 7 天 TTL + 256MB 总量上限（最旧先清），模块头写明保留策略
- MCP 输出默认目录迁到 `<dataDir>/mcp-output`（0700/0600 + 同款清扫），`ZCLAUDIA_MCP_OUTPUT_DIR` 覆盖仍有效
- `tool-bridge.ts`：enabled 归一化后去重；`tool-catalog.ts` 注释更新 + 30 个工厂运行时冒烟测试
- `tool-schema-compat.ts`：anyOf `required` 按交集合并（并集会过度约束），注释记录执行时校验兜底
- `extractTouchedPaths` 与 telemetry 统一为共享 `extractToolPathParam`（覆盖 AstEdit/AstGrep/EnterWorktree）
- persist+truncated 双标志保留（`truncatedOriginalSize`）；telemetry `outputBytes` 不计 advisory 文本
- `run-prompt.ts` 拼接加分隔符；`index.ts` wildcard 导出改 12 个具名导出；failure-loop-guard 注释说明取舍
- PostToolUse 钩子收到 `toolResponse`（8KB 截断、图片占位符；凭证重写的 args 永远不会进钩子）

**跨域加固（F）** ✅
- 子代理权限 override 改交集语义：新增 `narrowPolicy`（仅当 `sessionType === 'agent'` 时启用；常规/后台会话保持 merge——可信宿主的合法放宽不受影响）；子代理永远不超过 global+project 策略
- `agent_shell` 沙箱接入会话级授权域名（`loadSessionSandboxDomains` 同层复用）
- `process-supervisor.ts` 子进程 env 经 `scrubEnv`（显式 `spec.env` 仍优先）；terminal-manager（交互式 PTY）与 MCP client 经评估后有意保留完整 env（注释记录理由：PTY 是用户自己的登录 shell；MCP server 由用户配置且常需 env 凭证）
- lightweight runner 的 `abortSignal` 接入 agent-loop executor 的 LLM 流（链接式中止，可移除监听）
- `noop-edit-guard.ts` 字面 NUL 字节改为 `\u0000` 转义（文件恢复为合法 UTF-8 文本）

## 建议行动顺序（已全部执行完毕 ✅）

1. ~~本周（P0）~~ — 已于 2026-07-22 完成（commit `ca71614b`）。
2. ~~两周内（P1）~~ — 已于 2026-07-22 完成（commit `aadb2bd5`）。
3. ~~一个月内（主题治理/P2）~~ — 已于 2026-07-23 完成；主题 2-6 均已治理，主题 1（策略单点化）经 P0/P2 后仅剩设计层面建议，见 P2 附录遗留项。

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

## 附录：P1 修复引入的行为变化（2026-07-22）

1. patch 更新 hunk 内出现无前缀非空行现在会在解析期明确报错（此前静默损坏匹配文本）；对无尾换行文件的 EOF hunk 现在可以匹配成功。
2. 图片 > 50MB 被 `file_too_large` 拒绝（此前全量读入内存并 Jimp 解码）。
3. Bash spill 文件硬上限 64MB，超限输出丢弃并带标记，工具文本显示 `fullOutputCapped` 警告；adopt 后任务日志现在包含主进程退出后分离子进程续写的输出（此前在 exit 时丢弃），日志流可能延后最多 5s 关闭。
4. TaskOutput 超上限的非尾部读 `nextOffset` 指向日志中段（此前跳到 EOF）。
5. Monitor `start` 返回 `monitor_start_unsupported` 结构化错误（此前创建永不收敛的僵尸任务）；服务器重启后 bootstrap 将 agent/monitor 遗留任务标记 `stopped`/`server_restarted`。
6. observer 抛异常只记警告，不再破坏工具结果；抛异常的工具失败现在计入失败循环守卫；run 中止会停循环并杀用户钩子进程。
7. Python 符号 span 不再包含尾部注释 run；JS 行注释不再使语句尾越界到下一符号。
8. Grep `pattern` 不再被 trim——带缩进的搜索按字面生效；LSPTool 改字面匹配（`--fixed-strings`），描述不再声称 LSP 语义，错误结构化（`missing_query`/`lsp_search_failed` 带 `ok:false`）。
9. `agent_file_ops` 对最终路径为符号链接的一律拒绝；读上限 64KB（带 `truncated/totalBytes`）、写上限 1MB；缺 `content` 的写得到明确错误。
10. `agent_shell`：有沙箱时经 `wrapCommand` 执行、子进程 env 经密钥过滤、超时退出码恒 124（SIGTERM→3s→SIGKILL）、stdout/stderr 改 8K+8K/2K+2K 首尾截断并带 `timedOut`/`truncated` 标志。已知限制：SIGKILL 只作用于直接子进程（ProcessSupervisor 无法杀进程组），孙进程可能短暂存活。
11. `agent_http_request` 增加 30s 整体超时；browser 大 body 按 256KB 预算流式读取（不再整页入内存）。
12. `MCPTool`/`ToolSearch`/`ListMcpResources`/`ReadMcpResource` 与 concrete MCP 工具同一信任策略与输出预算；`ReadMcpResource` 的二进制内容改为落盘（不再内联 base64），details 新增 `permissionSummary`。
13. 新增环境变量（主要用于测试/调优）：`ZCLAUDIA_AGENT_SHELL_TIMEOUT_MS`、`ZCLAUDIA_AGENT_SHELL_KILL_GRACE_MS`、`ZCLAUDIA_AGENT_HTTP_TIMEOUT_MS`。
14. LSP 诊断适配器（目前仅测试接线、无生产调用方）：重复保存会发送 `didChange`（版本递增），`dispose()` 发送 `didClose`——未来接入真实 server 时会看到此前没有的文档生命周期流量。

**遗留跟进项（P2 或后续）**：~~`*** Add File` 空行容错~~、~~patch 预检双计~~、~~task-logs TTL~~、~~live-pid 退出监听~~、~~退出码结构化~~、~~agent_shell 会话域名~~、~~runner abortSignal 接 LLM 流~~、~~env 透传~~、~~override intersect~~ —— 以上已全部在 P2 批次完成（2026-07-23）。

## 附录：P2 修复引入的行为变化（2026-07-23）

1. WebFetch 删除死参数 `use_cache`；新增 90s 整体重定向预算（`fetch_timeout`）；按 charset 解码非 UTF-8 页面；WebSearch 中间 provider 0 结果会继续 fallback（末位 provider 0 结果返回 `ok:true` 空集而非 `provider_error`）。
2. Grep content 模式 `total` 语义变为匹配行数（原口径移入新字段 `returned`）——消费 `total` 的调用方需注意。
3. AstEdit 新增失败码 `file_changed_during_edit`/`secret_detected` 等；`details.diff` 上限 80KB（`diffTruncated`）。
4. 混合换行文件按多数派风格写回（此前遇任意 `\r\n` 即全文 CRLF）。
5. 文件备份 0600、每文件 20 份 + 7 天 TTL；restore 拒绝符号链接/越界目标；deferred diagnostics 结果变为单次读取 + 10 分钟过期。
6. `stop()` 后台任务最长约 3.5s（确认死亡 + 一轮升级），不再对终态任务的 pid 发信号（PID 复用安全）；沙箱网络授权批准文案披露"开放该主机全部端口与协议"。
7. tool-results 0600 + 7 天/256MB 保留；MCP 输出默认目录迁至 `<dataDir>/mcp-output`（原 `/tmp/zclaudia-mcp-output`）。
8. PostToolUse 钩子 stdin 新增 `toolResponse` 字段；telemetry `outputBytes` 不再计入 advisory 文本（数值略降）。
9. `stop()`/reconcile 接入退出监听后，重启前启动的 live-pid 任务会在进程退出时自动 settle（此前需轮询）。
10. 子代理（agent 类型会话）的权限 override 只能收窄不能放宽；宿主会话级放宽不再传播进子代理。
11. process-supervisor 派生进程默认过滤密钥类 env（显式 `spec.env` 优先）；terminal PTY 与 MCP server 有意保留完整 env。
12. 新增环境变量：`ZCLAUDIA_SKILL_FORK_TIMEOUT_MS`（默认 10 分钟）。
13. `noop-edit-guard.ts` 恢复为合法 UTF-8 文本（git/rg 不再当二进制）。

**P2 已知遗留（设计层面，非缺陷）**：`lastPrivilegeKeyByKernelBase` 随会话数微增（无清扫，量级可忽略）；`removeSettledTaskFiles` 仅清理计算路径（自定义 `metadata.resultPath` 遗留行不清理，有意保守）；Glob 10k 流式上限时的 `total` 为下界（已在描述中钉住）；DNS 解析耗时不计入 WebFetch 90s 预算。

**范围外跟进项 — 已修复（2026-07-23）**：~~`interfaces/http/commands.ts` 与 `application/plugins/skill-tools.ts` 的 `..` 前缀误拒~~ —— 两处边界判断已改为仅拒绝 `..` 本身与 `..<sep>…` 逃逸，`..data` 类合法名不再误拒，各补 1 个回归测试；~~`check:architecture` 预存失败（`domains/sessions/message-routes.ts` 裸 SQL）~~ —— `message_version` 查询已移入 `SessionRepository.getMessageVersion()`，路由改为注入调用，架构检查恢复全绿，补 2 个分支测试（有/无会话）。
