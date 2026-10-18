# 内置 Agent Runtime 实现状态

更新：2026-09-11。状态：实施中，不能据此发布为“迁移全部完成”。

基线：宿主 `504b9874dbbd64ba3b1ee3dc7291c0173b09ce0b`；源码迁入自 `zclaudia-plugins@94535618352b88fd78a29b92bc6bc88fe09faa9a`。改动尚未提交，当前产物 catalog 标记 `sourceDirty: true`。相邻源码仓库尚未修改，旧发布入口尚未切换。

最新改动是 runtime manifest 结构校验：当前 server SHA 为 `8c4679b3585d1c1f5a339bf696b768b6ac322d43b4d298630b7c766704e6f2f7`，源码 core 62 项、隔离 bundle core 62 项和产物故障恢复 24 项整套均通过。下文保留各阶段报告；此前 `4d6023f7…` 的完整 bundle／Linux 结果不能直接作为本次改动后的全量验收。详见“Runtime manifest 异常隔离”一节。

## 已实现

- 三种 adapter 和 agent-common 迁入 workspace，保留公开 SDK 边界、插件身份、contribution ID 和许可证；支持构建与 Playground bundle watch。三种 watch 均实测共用源码变更后重建，并在恢复源码后恢复相同 bundle 摘要，记录于 `watch-2026-09-10T16-40-59-491Z/summary.json`。
- 宿主启动期间，runtime 相关 HTTP API 和两个 WebSocket 入口返回 `503 / RUNTIMES_INITIALIZING`，health 显示 initializing；三种插件注册尝试结束后开放访问。前端仅对该状态的 GET 请求进行有界重试，固定目标后端且支持取消；内部 agent task 收到初始化错误会及时失败，避免等待 30 分钟超时。独立产物测试延迟第三种 runtime，确认另两种已注册时仍不能访问半完成目录，放行后 UI 自动恢复。
- 宿主优先发现并注册内置插件；保留 ID 和 runtime type 不允许外部抢占。缺损资源有可见错误，修复后可重新加载。外部副本保留且在详情展示。
- `.zplugin` 预览和安装阶段显式拒绝三种保留 ID 或声明保留 runtime 的外部包，即使内置插件尚未发现也有效；普通包的 UI 安装、启用、重启恢复、停用及卸载已通过源码与隔离 bundle E2E，相关包服务 20 项单测通过。
- 内置权限由宿主来源授予，不沿用按 ID 保存的第三方权限。启用状态持久化，停用和关闭应用不删除 Profile；运行中停用／重载返回 409。
- 外部 runtime 默认 Profile 不要求 LLM 绑定，空模型交给 CLI；保留旧 Profile 的 ID 和用户字段。首次创建项目可显式选择 coding agent，并由目标后端校验。
- Profile 创建和迁移标记在同一个 SQLite 事务提交；默认贡献幂等。应用升级时增量继承原 CLI pin，保留旧版本引用。
- 升级 fixture 同时包含三种 runtime 的开发目录、managed 活跃副本及两个历史版本。应用启动前记录这些文件和旧 pin 的完整内容，首次迁移及两次重启后逐文件比较，并验证 UI 展示两个被遮蔽来源。安装记录为无凭据的合成数据，不代表实际旧安装包执行过安装。
- 三种 runtime 均通过真实 SQLite 迁移日志写入失败和事务中途 SIGKILL 的完整后端测试。前者回滚新 Profile、保留旧配置，并通过 UI 重载恢复；后者在实际 INSERT 后确认事务仍打开，终止私有后端，再检查新行与完成标记均未提交、4 个旧 Profile 保留、数据库完整性正常。修复后启动和再次重启仅创建一次新增贡献。故障只注入测试拥有的产物副本，没有加入生产故障开关。
- Built-in runtime 卡片、CLI 检测、显式安装和重载入口；运行中的停用／重载错误在 UI 可见，取消后可重试。禁止内置插件的独立卸载／回滚 API。
- 三种 runtime 的登录帮助可展开官方指引，按后端解析出的实际 CLI 路径生成可复制命令，支持 POSIX shell 与 PowerShell 选择；没有解析到 CLI 时提示先安装或配置路径。未登录时自动展开，鉴权未知时明确说明未验证。新增当前后端的 Agent Profile 配置入口；状态查询与安装固定到该后端。复制失败保留可选文本，Tauri 使用原有系统浏览器接口打开文档，失败时显示地址。
- 会话能力和命令按 Agent runtime 获取；外部 runtime 不再继承 LLM Profile 的能力缓存。Cursor 展示自身 Plan／Ask／Default 模式，隐藏未实现的宿主逐次审批设置。
- 修复 Supervisor 先于主 shutdown 调用 `process.exit` 导致跳过 runtime 清理的问题。
- 关闭应用先拒绝新 run、取消已有 run、等待运行链路回收，再停用插件。Cursor 跟踪尚未取得 session ID 的进程；Codex 停止时等待 CLI 退出；Claude SDK stream 显式关闭。
- MCP host 按会话绑定独立端点、凭据和 catalog；直接 HTTP 伪造 session ID 也被拒绝。端点在没有运行时闲置一小时后回收；宿主在完整 adapter 生成器生命周期保留端点，包括等待工具审批，重叠运行各自计数，正常完成、异常和生成器提前结束都释放保留。下一轮按需重建端点及凭据；关闭应用等待已创建和仍在创建的端点，并拒绝新入口。
- MCP stdio 脚本及 framing 依赖作为独立入口打包，隔离测试发现并修复了原先只复制入口的遗漏。Codex 不再打印包含 bridge 凭据的启动参数；历史自有测试日志已脱敏。
- server bundle 包含三种插件及 Claude SDK 生产依赖。原生打包发现 Tauri 漏复制 pnpm 目录链接后，改为从已安装依赖图复制普通目录，保留实际版本与 peer 上下文，冲突版本嵌套放置；不重新解析版本范围，不附带可选供应商 CLI。资源校验拒绝链接，并记录资源树摘要、依赖版本和许可证；macOS 构建脚本增加对实际 `.app` 的校验。
- 专用 Playwright harness 使用自有后端、临时 SQLite 和项目。Claude 使用实际 SDK，Codex 使用 JSON-RPC，Cursor 使用 stream-json；只在供应商 CLI 边界使用 fixture。
- 新增 POSIX live 执行器，提供 coding（L01–L03）、cancel（L04）、capabilities（L05）和 concurrency（L06）场景。真实模式要求显式 CLI 路径、专用账户目录、用户轮数、超时和 `--allow-live`；预检不执行 CLI，拒绝其他 E2E 入口覆盖。并发场景另需不同的 peer runtime 和 CLI 路径，同一专用账户根目录包含两个 runtime 的配置。报告记录各 CLI／SDK／模型信息以及实际适配器入口与 manifest 摘要。支持无凭据自测，但不将其视为真实 CLI 认证。
- L05 通过实际审批框验证 Claude／Codex 允许与拒绝的文件副作用，Cursor 验证 Plan／Ask 文件不变及无宿主逐工具审批；随后调用宿主真实 MCP 工具，校验服务端记录的会话、marker 和随机 nonce。L06 在同一后端的两个项目同时运行，取消主 runtime 时 peer 的审批仍待处理或任务仍运行；放行 peer 后验证其继续写入、完成 coding 与单测，并检查两边的消息、provider session ID 和 MCP 服务端记录不串会话。
- L05 发现并修复 Claude 审批详情丢失实际工具输入的问题：现在 Bash 显示命令，Edit 能显示差异，保留 SDK 描述作为补充；空输入仍使用原有标题。审批框新增可访问的分组名称。Claude 的 `tool.inject` manifest 已与其实际 SDK MCP 配置注入实现对齐为 bridged／best_effort，不再错误声明未支持。
- live 透明启动器记录进程边界与退出码，不记录参数和协议内容；测试其转发输入、信号升级、父进程死亡后的清理。执行器中断时清理自有进程组并记录失败；每轮超时停止后端，失败报告也保留清理证据。关闭自动 trace／截图／录像，并删除 Playwright 自动生成的页面错误上下文；只保留显式结构化证据。
- 增加 agent task 的公开 Workflow API 验收：三种 runtime 按项目默认运行，任务结果可在会话 UI 查看；停用目标 runtime 时失败且没有 CLI 副作用。原有 `ai_prompt` 继续使用显式 LLM，删除所有 LLM 后明确失败，不隐式改用项目 CLI。
- 原 ZClaudia runtime 通过本地模型 HTTP fixture 完成真实 Read／Write／Bash、人工审批、文件修复与测试通过；内置 Terminal 面板开关刷新后保留，不影响三种 runtime 注册与 Profile。Profile 编辑已通过源码与隔离 bundle E2E：原生 Agent 保留模型与工具配置后执行 coding；三种外部 Agent 在 UI 修复 CLI 路径、保存名称和描述，重启后保留身份且完成 coding，不要求 LLM 绑定。三种外部与原生 Agent 的 Profile 场景均纳入本轮整套验收。
- 新增独立产物故障 suite：每项复制并验证自己的 bundle，保留基线 server 摘要、catalog 中实际版本和资源树摘要；测试前后校验原始插件资源未变化。该 suite 与只读、禁止读取源码的产物验收分开记录。
- 修复全局确认框被插件详情弹窗遮挡的问题：确认框通过 portal 显示于详情之上，安装取消和确认均经过正常鼠标点击验收。
- 修复浏览器通过 Gateway 选择远端时的 API 地址解析：已有浏览器 origin 的场景不要求桌面 embedded port，项目、Agent 和 runtime 状态走目标后端代理。新增 API 回归，144 项 API 单测通过。
- 新增独立 Gateway E2E：两个私有后端、指定真实 Gateway 产物与 CLI fixture；客户端停用对应 runtime，验证三种任务只在远端执行、取消停止工具写入、后端重启后保留会话并续聊，以及远端 Profile 路径和 runtime 状态 UI。源码和隔离 bundle 各 3 项均已通过，重连后仍保持原 provider session ID。
- 新增 PR CI workflow，并接入产物故障 suite、live 执行器参数／清理测试和三种 runtime 的无凭据自测；尚未在远端 CI 执行。现有发布工作流通过 server bundle 接入资源，但各平台安装包和 live 门禁仍需补齐。

## 阶段验证证据

| 验证                                               | 本机结果                                       | 边界                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 三种插件和共用代码单测                             | 189 项通过                                     | 后续新增功能变更仍须重跑对应项                                                                                                            |
| 宿主插件、managed-runtime、Profile、readiness 测试 | 61 文件、658 项通过                            | 包含事务失败注入和跨版本 pin 继承；不替代完整应用 E2E                                                                                     |
| 前端插件与新建项目相关测试                         | 7 文件、36 项通过                              | 包含无全局默认、显式选择目标后端 Agent                                                                                                    |
| 会话能力、聊天界面和插件详情回归                   | 38 文件、704 项通过                            | 覆盖 runtime 能力独立缓存；不替代原 ZClaudia runtime 的完整应用验收                                                                       |
| TypeScript／架构边界                               | shared、server、desktop 构建通过；架构检查通过 | 前端构建存在既有动态 import 警告                                                                                                          |
| 源码构建后的完整应用                               | 61 项整套确定性 E2E 通过                       | 三种 runtime 均完成 UI 项目创建、coding、刷新和续聊恢复；部分矩阵仍待补充                                                                 |
| 旧数据 fixture                                     | E12/E14 通过                                   | 合成脱敏数据；managed 与开发副本共存，逐文件保留旧目录、历史版本和 pin；4 个 Profile 及项目／会话引用重复启动后不变；不是实际旧安装包升级 |
| 产物故障／安装与更新                               | 独立整套 21 项通过；确认框相关 25 项单测通过   | 包含三种 runtime 迁移日志失败与事务中途强制终止后的恢复；Claude／Codex 受控镜像安装／鉴权状态／离线 pin 更新；不是实际安装包升级          |
| macOS arm64 server bundle                          | 61 项 E2E 通过，资源树运行前后验证一致         | 随包 Node v22.20.0；临时路径有中文及空格；sandbox 禁止读取两源码仓库和写入产物目录；使用独立构建浏览器客户端，未验收 Tauri 原生壳         |

产物验证记录按 `artifacts/agent-runtime-migration/<run-id>/` 归档。确定性 suite 保存 Playwright HTML、JSON、日志和失败 trace；live 执行器只保留显式结构化证据。最新源码整套为 `2026-09-10T20-12-12-230Z-4e0e1cb4/summary.json`（61 项）；最新隔离 bundle 整套为 `bundle-2026-09-10T20-12-11-966Z-c0af84e5/{summary,bundle-summary}.json`（61 项，`suite: core`、`fullSuite: true`、`sourceReadDenied: true`、`resourceWriteDenied: true`）。最新产物故障／恢复 suite 为 `2026-09-10T20-12-30-835Z-6a9c478e/summary.json`（21 项，含三种 MCP 空闲回收与续聊）。三套均无重试。当前基线 server SHA 为 `4d6023f78873f0cbeba3b69ab0d290acc6c9a910d837d61604b327ce8d4128eb`，catalog SHA 为 `caad2f3c3f30ab69d9d52d56c3411e47856db3600126415423bdb3ba77d965dc`。下文较早报告独立保留：`2316ec82…` server 对应空闲回收之前；`ef31fe0d…` catalog 对应 pnpm 链接布局；`1999fef2…`／`a5793244…` 也属于历史基线，均不作为当前候选的全量验收。

本轮 server／desktop 构建和架构检查通过；启动中间件与任务 runner 相关 8 项、前端 API 与重试相关 165 项、包服务 20 项单测通过。包服务新增检查即使在内置插件尚未发现时也保留 ID 与 runtime 声明。

归档修复：源码与产物故障两进程曾在同一毫秒启动，默认时间戳运行 ID 冲突；源码进程最后结束并写入了 `2026-09-10T17-54-06-655Z/summary.json` 的 60 项结果，故障套件的独立报告被覆盖。默认运行 ID 已加入随机后缀，产物故障套件已在 `2026-09-10T17-57-50-352Z-6c7a8b07/summary.json` 独立重跑，11 项全部通过，基线 server／catalog 摘要与本轮 bundle 一致。被覆盖的旧报告不作为证据。此前启动保护版本的独立 11 项证据仍在 `2026-09-10T17-43-57-056Z/summary.json`。不同候选版本的通过结果不合并为一次完整发布门禁。

## 仍需完成

- E05 跨 runtime 并发、E20 长任务 shutdown 已通过，包含 CLI PID 和停止写入断言。三种 runtime 的异常终止／重启中断标记和恢复也通过本轮源码和 bundle 测试；SIGKILL 后由 harness 清理自身 fixture 进程，不将这项记为应用正常清理。
- E06 Claude／Codex 审批允许和拒绝、Cursor 支持模式均已通过。E07 已通过三种 runtime 的真实 stdio bridge、并发会话和 Cursor 用户配置保留；不同凭据跨端点拒绝由真实 HTTP 集成测试覆盖。
- E09 三种 runtime 的 UI 忙状态和取消后重载已通过；E10 三种内置模块激活失败和 manifest 缺失后通过 UI 修复重载，已通过独立产物故障套件；三种 CLI 崩溃及非法协议后重试已通过。E11 已接通 Profile 列表、全局 readiness、新建项目和会话的 CLI 检查；缺失／不兼容／修复通过。Claude／Codex managed CLI 未登录时的 UI 提示、Profile 不可用、复制登录命令、fixture 登录后刷新恢复已通过；Cursor 系统 CLI 的未知状态、首轮登录错误、登录后重试已通过，刷新仍保留未知状态，不伪造鉴权成功。登录帮助与 Profile 配置入口已补齐。上述均为确定性 fixture；实际供应商 OAuth 与桌面系统浏览器仍需 live／安装包验收。
- E12 同 ID／不同 ID 声明保留 runtime 的外部开发目录拒绝，以及 E13 普通开发插件启停／重载／移除已纳入完整应用测试。三种保留 ID／runtime 的 `.zplugin` 拒绝和普通包安装／卸载已通过源码与隔离 bundle E2E；既有 managed 副本与开发目录同时存在的合成升级 fixture 已补齐。E16 三种插件版本更新保留停用偏好和用户字段、重新启用后幂等已通过；Codex pin 在离线更新时增量继承且旧引用保留也已通过。E15 三种 runtime 的真实迁移事务失败与进程中断恢复已通过产物故障 suite；实际旧安装包升级和回退演练仍待完成。
- E17 Claude／Codex managed-ask 取消无下载、错误摘要不产生 pin、显式 UI 安装、离线升级保留 pin 并完成 coding 已通过；使用本地企业镜像和 CLI fixture，无供应商下载或付费请求。其他平台的分发差异仍需验证。Cursor 当前兼容性描述没有 managedInstall，托管下载分支对该描述不适用；本轮覆盖其系统 CLI 检测和登录失败恢复，不新增供应商下载元数据。
- E18 默认优先级（显式会话 > 项目默认 > 全局默认）和显式选中已停用 runtime 时拒绝回退，已纳入源码和 bundle 应用测试。E19 的 agent task 路由和 LLM workflow 回归、E22 的原 ZClaudia coding 与面板切换已纳入源码与隔离 bundle 各 60 项整套验收。E21 的本机 Gateway v3 确定性链路在源码和隔离 bundle 中均通过三种 runtime（各 3 项）；真实远端机器、Gateway 直连客户端和 live 仍待补充；E22 Profile 编辑 UI 已通过源码与隔离 bundle E2E，本轮隔离 bundle 中也已通过。
- Linux／WSL 和实际 macOS、Windows 安装包验收；macOS bundle 结果不能替代这些平台或原生壳测试。
- L01–L06 的 POSIX 执行器已实现，实际供应商 CLI 验收仍未执行。已询问专用 CLI 路径、账户配置目录及额度上限，尚未得到信息，未使用日常账户执行付费任务。Windows 执行设施、真实前台工具进程退出和供应商协议行为需对应机器与 CLI 实测。
- 最终 CLI 脚本参数、报告归档、全量适用矩阵、旧版升级／回退演练、最终候选 SHA 与发行门禁。通过后才能切换旧仓库发布入口。

## Live 执行器前轮证据（L01–L04）

源码完整应用回归 `2026-09-10T19-08-11-221Z-a9e22c01/summary.json`：61 项通过，无重试，覆盖共用 harness 的账户环境和进程组清理改动。报告为 macOS arm64、Node v22.20.0、`sourceDirty: true`，不替代最终发布候选及其他平台验证。

`live-selftest-2026-09-10T19-17-12.549Z-e1d4873d/self-test-summary.json`：9 项执行器检查通过，分别为三种 runtime 的 coding／恢复、故意超时／清理、取消／下一轮。每种 runtime 的 coding 执行三轮并保留同一 provider session ID；cancel 通过 UI 停止 fixture 写入、观察 3 秒不再变化，再完成同会话第二轮文件修复与单测。deadline 子报告仍是失败状态，只有确认 `timedOutTurn: 1`、没有成功轮次且进程清理通过，汇总才标记对应执行器检查通过。所有子报告均标记 CLI fixture，没有执行真实供应商请求。

9 项 Node 参数／进程测试通过：包括参数预检无 CLI 副作用、真实／fixture 模式互斥、两种场景的轮数约束、拒绝入口覆盖，以及透明启动器收到信号／父进程死亡时的进程组清理。执行器中断测试使用自己的假 pnpm 和忽略 SIGTERM 的父子进程，证明最终记录 interrupted／非零退出、回收该进程组并移除自动页面输出。架构边界与改动格式检查通过。

上述无凭据测试已接入 `.github/workflows/builtin-agent-runtimes.yml`，但远端 CI 尚未执行。L04 真实模式包含前台 Node 工具的 PID 退出断言；该分支仍需专用账户实测，fixture 的写入停止不能替代它。透明启动器会协助清理供应商子进程，不能将其结果单独视作未包装 CLI 的应用生命周期证明。后续新增 L05／L06 的证据另列；实际账户、各平台安装包、旧版升级／回退仍是未完成门禁。

## Live 执行器本轮证据（L01–L06）

`live-selftest-2026-09-10T19-38-58.921Z-b2e29065/self-test-summary.json`：15 项执行器检查全部通过。三种 runtime 各执行 coding／恢复、故意超时／清理、取消／下一轮、审批／模式／MCP、跨 runtime 并发五项；并发组合为 Claude→Codex、Codex→Cursor、Cursor→Claude。各子报告明确使用 CLI fixtures；三项故意超时的验收状态仍为 failed，仅其超时和清理检查通过。不将这些结果记为真实供应商 CLI 的 L01–L06 通过。

L05 首次 Claude 检查暴露审批详情只显示通用标题、没有实际 Bash 命令的问题，修复后通过。首次扩展自测 `live-selftest-2026-09-10T19-33-44.864Z-6e804280` 在 Codex 第二次审批检查失败：两次相同提示词间隔约 388 ms，触发界面已有的 400 ms 重复发送保护。执行器改为明确区分两次审批请求，并在点击发送后断言输入框已清空；没有增加固定等待或重试。失败报告保留，随后重新执行完整 15 项取得上述通过结果。

相关 Node 参数／进程测试 10 项、Claude 权限测试 26 项、前端审批组件测试 47 项通过；browser 构建、插件声明和架构边界检查通过。源码 core 61 项及新版隔离 bundle core 61 项通过；bundle 运行前后三种插件资源验证一致。此前针对 E06／E07 的 8 项 bundle 结果位于 `bundle-2026-09-10T19-35-03-312Z-dbd15f1d`，标记 `fullSuite: false`，不代替之后的完整 61 项报告。

无凭据执行器自测已接入 PR CI，远端 CI 尚未执行。真实账户、Windows 执行设施、实际安装包和旧版升级／回退仍未验收；当前 macOS arm64 报告也仍标记 `sourceDirty: true`。

## 原生 macOS 打包探针与修复

记录目录：`native-2026-09-10T19-47-16.728Z-17a3457c/`。以当前生产 Rust／客户端代码构建 release `.app`，仅覆盖独立应用标识、名称、客户端产物路径和本地 ad-hoc 签名，关闭自动更新；没有使用正式签名证书或执行发布。首次 `.app` 的 Claude 资源从 5474 项变为 5212 项，缺失的 262 项全部是 pnpm 符号链接；`initial-packaging-failure.json` 保留完整差异。这证明先前 server bundle 的资源校验不能替代实际桌面产物校验。

修复后，`portable-dependencies.mjs` 从已安装生产依赖图生成普通目录，已删除源目录的测试仍能加载同名不同版本、作用于不同 peer 上下文的包以及循环依赖，并保留可执行资源；可选／开发依赖不进入产物，越界依赖、必需依赖缺失与资产链接会失败。4 项 Node 打包测试通过并接入 CI。macOS 构建脚本在 Tauri 打包后验证 `.app` 内三种插件，防止资源复制遗漏仅在用户启动时暴露。

重新生成的 `.app` 已复制到带中文和空格的临时目录，实际验证 OS sandbox 拒绝读取两个源码仓库和写入应用资源。Claude／Codex／Cursor 分别有 5262／6／6 项资源通过校验，运行前后均一致；ad-hoc 签名的深度严格校验也通过。`native-input.json` 记录应用、Node、server 与 catalog 摘要。独立 HOME 下的应用标识目录被 Rust 实际选作数据目录，不使用日常数据库。

原生客户端已通过 Rust 启动随包 Node／server，health 为 ready，三种内置插件 active，三个默认 Profile 均无 LLM 绑定；`native-registration.json` 保存后端证据。随后通过此后端的公开 Workflow API，使用显式配置的三个 CLI fixtures 分别修复文件并执行预置单测；3 项通过，见 `native-coding-api.json`。这是原生壳启动后端的 API 路径验收，不能称为原生界面 coding 验收，也不是供应商真实 CLI 验收。

CUA 报告 Mac 锁屏且不能解锁，已请求用户手动解锁；没有改用其他方式操作受阻界面。界面点击、菜单退出、重启恢复仍未通过。测试结束由 harness 依次停止其后端和 `.app`，所有已记录进程在 1103 ms 内退出；`native-cleanup.json` 明确 `normalNativeQuitVerified: false`，不将清理动作算作原生退出门禁。正式签名／公证、DMG 安装、实际旧版升级回退及其他平台仍待执行。

`native-summary.json` 汇总上述原生探针，整体状态为 partial。普通目录布局的隔离 bundle core 61 项通过（`bundle-2026-09-10T19-54-46-914Z-85f62751`）；相同基线的产物故障、安装和迁移恢复整套 18 项也通过（`2026-09-10T20-01-52-610Z-ab02ef8b/summary.json`），均无重试。macOS shell 语法、构建共用脚本测试、插件声明、架构边界和改动格式检查通过。

## MCP 空闲端点生命周期

端点此前按历史会话长期累积，仅在应用退出时释放。本轮增加一小时空闲回收，该时限长于 Codex 已有的 30 分钟空闲进程回收及 5 分钟扫描间隔。接入点在宿主 adapter 包装层，不修改公开插件 SDK；UI 会话和 agent task 共用完整生成器的运行期保留，实际运行及审批等待不会触发空闲回收。

相关宿主／包装层 23 项测试通过：真实 HTTP 端点空闲后断开，重叠保留和其他会话不受影响，续用生成新凭据；关闭期间等待尚未完成的端点创建且禁止新入口。生成器正常完成、报错和提前 return 均验证恰好释放一次。

三种 runtime 的定向完整应用测试通过，记录为 `2026-09-10T20-11-36-463Z-9d6610f0/summary.json`。测试只在自己复制的 bundle 中将一小时时限改为 250 ms；运行任务超过 750 ms 后真实 HTTP 端点仍响应，UI 取消后确认监听器关闭，再次发送 MCP coding 请求成功，provider session ID 不变，宿主工具有两次正确会话／nonce 回执。没有新增生产超时覆盖变量或诊断 API。首次测试在 CLI 尚未写日志时读取不存在的审计文件失败；改为测试启动前创建自有空文件，仍要求实际 CLI 产生两次调用记录，保留原失败报告 `2026-09-10T20-10-57-846Z-0364e14a`。

此项仍使用供应商 CLI fixture。真实供应商在端点重建后恢复 MCP 的行为需随 L03／L05 验收；此前原生 `.app` 探针也属于改动前的 server 候选，不作为本轮原生生命周期证明。

本轮源码与隔离 bundle core 各 61 项、产物故障／恢复整套 21 项均通过，报告及同一候选摘要列于上文。server TypeScript 构建、架构边界和改动格式检查通过。随后使用独立 Colima profile 补充 Linux 验证，见下一节。

## Linux arm64 隔离验证

记录目录：`linux-2026-09-10T20-17-22.304Z-e2ce09c4/`。测试使用独立 Colima profile `zclaudia-e2e-e2ce09c4`，没有启动用户默认 VM 或切换默认 Docker context。容器基于官方 `node:22.20.0-bookworm`，镜像摘要为 `sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7`，仅挂载测试自有暂存目录。

源码快照包含宿主未提交改动，宿主基线仍为 `504b9874dbbd64ba3b1ee3dc7291c0173b09ce0b`；归档 SHA-256 为 `9b1157727b2f1afc3856e23aef749cba074de6e4cef278198f04e9e2fbc9fbd9`。容器内初始化测试仓库并产生合成提交 `702b0f14351117d0363620b9d952eeb397d15ca5`，仅用于构建 provenance。因此 Linux catalog 的 `sourceDirty: false` 不表示宿主改动已经提交，也不表示它是正式候选提交。首次归档夹带 macOS AppleDouble 文件，导致 Vitest 把 `._*.test.ts` 当作测试；保留失败记录后，禁用元数据导出并从干净容器工作区重跑。

Linux 源码 core 61 项、产物故障／恢复 21 项整套全部通过，无重试。三种插件及 common 共 191 项单测、4 项依赖打包测试、插件声明和架构检查通过。Linux bundle 完成 native module 校验，其 server SHA 与本轮 macOS 相同；Linux catalog SHA 为 `2726c90fa1fed77f807543ddda47995cba012478a830c892f8d4032bdc495bee`。

报告位于本记录目录的 `results/agent-runtime-migration/` 下：core 为 `2026-09-10T20-29-10-830Z-65419362/summary.json`，产物故障为 `2026-09-10T20-31-48-410Z-80610cac/summary.json`。live 执行器 10 项 Node 参数／清理测试和 15 项无凭据自测通过，后者为 `live-selftest-2026-09-10T20-34-14.817Z-44eea0db/self-test-summary.json`。三项故意超时仍保留 failed 子报告，由汇总验证其超时与清理符合预期。远端 CI 尚未执行。

新增 `scripts/dev/test-builtin-runtime-artifact-smoke.mjs`，使用 Node 内置模块驱动实际 bundled server 的公开 API。独立容器关闭网络，仅挂载 bundle、随包 Node、测试驱动和 CLI fixtures 为只读，另挂可写报告目录；没有挂载源码快照、应用工作区或宿主依赖。写入 canary 实际返回只读错误，运行前后完整资源树均与 catalog 一致。三种 runtime 全部完成真实文件修复、测试退出码 0、按会话／nonce 校验的 MCP 回执；后端重启后 Profile ID、停用选择和 provider session ID 保留，两次正常服务停止均检查无遗留 fixture PID。

该探针首次因测试插件 manifest 缺少必填 description 失败，宿主正确拒绝加载；修复测试声明后通过，保留两次独立报告。产物本身没有因此修改。通过报告为 `artifact-only-output/run-2/summary.json`，随包 Node SHA 为 `840d5ee21241ce964443ace2e1dd8224c84e51379b6202e3e93cc716325df356`。此项是 API coding 与重启持久化验证，没有在重启后追加续聊，不替代完整 E04，也不证明原生 UI、Linux 安装器、WSL 或真实供应商 CLI 已通过。

`linux-summary.json` 汇总本轮结果，`cleanup.json` 记录测试容器已退出、专用 VM 已停止；默认 VM 仍停止，默认 Docker context 仍为 `colima`。测试 VM 磁盘与源码暂存目录保留用于复现。测试驱动和两份文档通过格式检查，工作区 diff 无空白错误。

## Runtime manifest 异常隔离

检查发现，包服务与目录发现会直接对未经结构校验的 `agentRuntimes` 调用数组方法；对象或 null 元素会抛异常，损坏的内置 `[null]` 声明还会中断发现阶段。`package.json` 嵌套的 `claudia` 声明此前在合并后直接返回，也可能绕过检查。

shared 中增加共用结构校验，要求已声明的 contributes 是对象、agentRuntimes 是数组且各项包含非空字符串 type；保留未声明、空列表和自定义 runtime 的兼容性。包预览和目录加载复用此检查，合并后的 package.json 声明再次验证。无效包返回 `400 / INVALID_MANIFEST`，无效目录插件不进入发现结果；单个损坏的内置 runtime 显示资源错误，其他两个正常启动，修复资源后仍能通过 UI Reload 恢复且保留原 Profile。

最初回归复现 7 项失败，修复后宿主包服务／loader／内置生命周期 114 项和 shared manifest 9 项通过，均禁用重试。shared、server、desktop 构建及架构检查通过，格式和 diff 空白检查通过。证据汇总位于 `manifest-validation-2026-09-10T20-39/summary.json`，保留修复前后日志。

- 源码 core 整套 62 项：`2026-09-10T20-40-57-107Z-4d4e78aa/summary.json`。
- 源码禁读、产物只读的 bundle 包生命周期 3 项：`bundle-2026-09-10T20-41-39-779Z-3acb7f3d/{summary,bundle-summary}.json`，明确 `fullSuite: false`；包含普通包 UI 安装／卸载、保留 ID 拒绝，以及坏声明上传／发现／重启。
- 当前测试文件的产物故障恢复 9 项：`2026-09-10T20-43-01-918Z-098c5d37/summary.json`；三种 runtime 分别覆盖 activation、missing-manifest、malformed-runtime，验证另外两个保持 active。先前的同名定向报告 `2026-09-10T20-42-04-314Z-87fdca31` 不作为最终证据；加强“另外两个”的数量断言后重新运行。

上述 E2E 均无重试。当前 suite 定义为 core 62 项、产物故障／恢复 24 项；本次产物只执行受影响的 9 项，没有称为整套 24 项通过。三种插件资源和 catalog 未因宿主校验改动而变化，但 server 已改变；Linux、原生 `.app`、真实 CLI 及安装包升级回退尚未针对本次候选重新验收。

随后补齐同一 server 候选的整套产物回归：`bundle-2026-09-10T20-46-08-850Z-dc7860a9/{summary,bundle-summary}.json` 为 62 项完整 core，`fullSuite: true`、源码禁读、产物只读，三种插件资源在运行前后完整验证一致；`2026-09-10T20-46-09-310Z-b6a0405f/summary.json` 为 24 项完整产物故障／恢复，两者均无重试。此前 3／9 项定向报告独立保留，不累加为另一套结果。

PR workflow 补入 shared manifest 契约及宿主 runtime 边界单测，并显式 `--retry 0`。先执行 browser 构建，以确保 shared／server 的实际构建输出就绪，再执行单测和原有 core E2E，避免重复构建。新增宿主命令在本机执行 8 文件、140 项全部通过，shared 的 9 项已在同一实现候选通过；workflow 的 YAML 格式检查通过。此处是本机命令验证，远端 CI 尚未运行。

### 最新候选的 Linux 复验与容器 CI

记录目录：`linux-manifest-2026-09-10T20-49-e2ce09c4/`。独立 Linux arm64 构建产出的 server SHA 与当前 macOS 候选相同（`8c4679b3…`）。源码快照 SHA 为 `d97228cddada7e8df96400b03f3a1ea74580d0c93e8cbab8231da7d8cf704659`；容器中的 `2b88af06900426743e186fe89c10f2954ad98ca5` 仍是测试快照的合成提交，宿主改动未提交。Linux catalog SHA 为 `d2d9083e1ffe62c2b6e6e134406dccbc81332b58092e1e68e9dd6710a77e580b`。

本目录 `results/agent-runtime-migration/` 下保存：core `2026-09-10T20-51-34-777Z-d5211f5f/summary.json`（62 项）；产物故障 `2026-09-10T20-54-15-121Z-d2fdb5ee/summary.json`（24 项）；执行器 `live-selftest-2026-09-10T20-57-00.564Z-834a2d38/self-test-summary.json`（15 项）。全部通过，前两套没有重试；live 自测仍按约定保留三项故意超时的 failed 子报告。插件／common 191 项、宿主 140 项、shared manifest 9 项、依赖打包 4 项、live 参数／清理 10 项以及构建／架构检查通过。

新增 `scripts/dev/test-builtin-runtime-container.sh` 将只读探针封装为可复用命令，已接入 PR workflow。以刚生成的 Linux bundle 和随包 Node 实测：三种 runtime 的 API coding／MCP、重启持久化、资源完整性和退出检查全部通过，见 `readonly-container/run/summary.json`。`container.json` 验证网络为 none，只有只读 `/input` 和可写 `/output` 两个挂载；输入目录与输出目录分离，避免通过另一条可写路径修改相同资源。测试容器及临时输入自动删除，报告保留。

反向检查仅修改自有 bundle 副本的 catalog 摘要，验收正确失败，执行器返回 1；随后通过仍连接的 Docker daemon 确认测试容器不存在、临时输入已清理。`negative-runner-check.json` 只表示“失败传播与清理”检查通过，`invalid-readonly-container/run/summary.json` 保留 failed，不能将它视为产物验收成功。新 shell 驱动和 API 驱动的 SHA 单独记录在 `container-runner-input.json`，它们不冒充上述 Linux 构建快照的提交内容。

容器镜像固定到已有摘要；从 Docker Registry 读取的 OCI index 已核对 SHA，包含 Linux amd64 与 arm64 条目，记录于 `container-image-index.json`。本机实测仍仅为 arm64；不据此宣称 amd64 或远端 GitHub Actions 已运行。shell 语法、帮助命令及 workflow 格式检查通过。

CUA 再次报告 Mac 锁屏，原生界面仍无法操作，未绕过锁屏；见 `native-ui-recheck.json`。专用真实 CLI 账户／路径／配额仍未提供，实际安装包升级与回退、Windows／WSL 和目标 Gateway 部署验收仍是未完成门禁。当前本机 fixture 结果不能补足这些外部条件。

本轮所有测试进程已结束，专用 VM 已停止，默认 VM 仍停止、Docker context 仍为原来的 `colima`，见 `cleanup.json`。容器磁盘和输入快照保留用于复现，没有修改日常应用的数据或相邻插件仓库。

## 可执行命令

```bash
pnpm plugins:build
pnpm plugins:test
pnpm plugins:check
node --test scripts/plugins/__tests__/*.test.mjs
pnpm test:e2e:agent-runtimes
pnpm test:e2e:agent-runtimes:artifacts
bash scripts/with-project-node.sh node server/scripts/bundle.mjs
pnpm test:e2e:agent-runtimes:bundle -- --artifact-dir server/bundle
pnpm plugins:verify server/bundle/builtin-plugins
pnpm test:e2e:agent-runtimes:live -- --help
pnpm test:e2e:agent-runtimes:live-selftest
```

bundle 验收先构建前端和 server bundle，再执行隔离测试。只有 macOS 当前使用 OS sandbox 拒绝源码读取；其他平台的隔离证据需单独补齐。安装包发布审批不在本次已执行动作中。

产物故障命令会构建 browser 和 server bundle，再运行独立 suite；调试已有产物可执行 `pnpm exec playwright test --config e2e/playwright.agent-runtime-artifacts.config.ts`。`ZCLAUDIA_E2E_MUTABLE_ARTIFACT_DIR` 可指定待复制的 bundle，缺少资源会失败而不是跳过。该 suite 已在本机 macOS arm64 和独立 Linux arm64 容器执行，远端 CI 尚未验证；故障 suite 本身不宣称源码不可见或资源只读。

只读 API 探针可在 POSIX 隔离环境执行以下命令。必须先用容器挂载或 OS 权限实际将产物设为只读；输出目录须尚不存在。若要声明源码不可见，还须在环境层排除应用工作区及源码挂载，并保存实际隔离配置，脚本本身不提供通用沙箱。

```bash
/input/node /input/scripts/dev/test-builtin-runtime-artifact-smoke.mjs \
  --artifact-dir /input/bundle --node-path /input/node \
  --fixtures-dir /input/fixtures --output-dir /output/run
```

原生 shell 隔离证据：源码模式使用默认的逐命令 sandbox 与用户审批；macOS 外层产物 sandbox 内无法再次调用 `sandbox_apply`，因此该场景显式请求并审批单次命令例外，外层源码禁读和产物只读保持生效。Playwright 注释记录该差异。首次扩展 bundle 套件为 54／55 通过，失败定位为嵌套 sandbox 限制；修正测试调用方式后，`bundle-2026-09-10T17-30-18-838Z` 的单项通过，该过滤结果未记作整套通过；随后 `bundle-2026-09-10T17-30-53-915Z` 的完整 55 项重新通过。

bundle 脚本支持 `--grep <test-pattern>` 定向诊断，`bundle-summary.json` 明确记录 `fullSuite: false` 和过滤条件；正式整套验收不传该参数。

Gateway 验收说明：主项目当前 `peer_hello.protocolVersion` 为 3，相邻 Gateway 当前源码只接受 4。本轮测试输入来自 Gateway `6c28b721fb8effcc5ed365b3fdfedc7cfc0fba39` 的只读 tracked snapshot，经过 esbuild 打包，使用本机已有依赖；每项附 `gateway-artifact.json` 记录实际入口 SHA-256，不能将该本地组装产物称为已部署或官方发行版。当前 v4 不兼容是另一个集成缺口，此验收不宣称 v4 已通过，也不建议据此降级实际 Gateway。

专用命令要求明确提供兼容的 Gateway server 模块（导出 `createGatewayServer`，拥有运行所需依赖）。未提供或不能加载时失败，不跳过。测试始终创建自己的进程、端口、凭据与数据库，不连接现有 Gateway：

```bash
ZCLAUDIA_E2E_GATEWAY_ENTRY=/absolute/path/to/gateway-v3/dist/server.js pnpm test:e2e:agent-runtimes:gateway
pnpm test:e2e:agent-runtimes:bundle -- --artifact-dir server/bundle --gateway-entry /absolute/path/to/gateway-v3/dist/server.js
```

`--gateway-entry` 选择独立 Gateway suite，`bundle-summary.json` 的 `suite` 为 `gateway-v3`；默认仍为 `core`。`fullSuite: true` 只表示该 suite 全部执行，不能把 Gateway 的三项当成 core 的 60 项。Gateway 本身是外部测试服务；产物 sandbox 的源码禁读和资源只读约束针对两个应用后端。

本轮 Gateway 证据：源码 `2026-09-10T18-12-01-803Z-27c753c0/summary.json`；隔离 bundle `bundle-2026-09-10T18-12-01-321Z-b6c47b1f/{summary,bundle-summary}.json`。两者均为 3 项通过，Gateway server 模块 SHA-256 为 `1d9752c279c4e672c35718d1cf407898b666645da00b4795fdd6da7f7aa64a48`；bundle 的应用 server／catalog 摘要仍为上文的 `1999fef2…`／`a5793244…`，使用了修复浏览器远端 URL 解析后的客户端。较早的 `bundle-2026-09-10T17-54-06-177Z` 使用修复前的浏览器客户端；修复后的客户端现已另行完成下述 core bundle 整套回归。不同报告仍独立保留，不合并为一次正式发行验收。

浏览器远端解析修复后的 core 源码整套也已通过：`2026-09-10T18-12-01-800Z-5aeefed1/summary.json`，60 项，无重试。构建、144 项 API 单测、架构与改动格式检查通过。

本轮迁移故障证据：`2026-09-10T18-25-11-718Z-6b4ce9dd/summary.json`，17 项整套通过，无重试。基线 server／catalog 摘要仍为 `1999fef2…`／`a5793244…`。三项进程中断用例分别附 `migration-interruption.json`，保存终止前实际事务状态以及崩溃后实际 SQL 查询结果；三者均为事务内新增行数 1、事务打开，恢复数据库后新增行与迁移日志为空、旧 Profile 数量 4、`integrity_check: ok`。这些证据仅覆盖私有测试数据和产物，不证明安装器或真实供应商 CLI 的升级兼容性。

本轮隔离 core bundle 证据：`bundle-2026-09-10T18-25-11-248Z-60515a05/{summary,bundle-summary}.json`，60 项整套通过，无重试，`suite: core`、`fullSuite: true`、`sourceReadDenied: true`、`resourceWriteDenied: true`。包含增强后的 managed／开发目录共存迁移 fixture 和修复后的浏览器客户端；运行前后插件资源树验证一致。源端增强迁移用例的定向证据为 `2026-09-10T18-18-46-637Z-6042b43b/summary.json`（1 项），不将该定向结果称为源码整套重跑。

登录指引依据（2026-09-11 核对）：[Claude CLI reference](https://code.claude.com/docs/en/cli-usage)、[Codex authentication](https://learn.chatgpt.com/docs/auth)、[Cursor authentication](https://cursor.com/docs/cli/reference/authentication)。指引使用实际解析出的可执行文件和对应登录参数；当前官方文档不等于每个受测旧 CLI 版本均完成 live 验收。命令引用测试在 POSIX shell 实际执行包含中文、空格、单引号、反引号及命令替换字符的私有 fixture 路径；PowerShell 目前只验证生成语法与 UI 选择，未在 Windows 执行。

登录引导本轮整套证据：源码 `2026-09-10T18-39-14-550Z-7b860de7/summary.json`（61 项）；隔离 bundle `bundle-2026-09-10T18-39-14-063Z-e211697a/{summary,bundle-summary}.json`（61 项，源码禁读、资源只读）；产物故障 `2026-09-10T18-39-14-550Z-a7cd6646/summary.json`（18 项）；Gateway v3 源码 `2026-09-10T18-41-10-357Z-b64e2d6a/summary.json`（3 项，新增远端 Profile 配置入口断言）。均无重试。server 与插件 catalog 摘要保持不变，客户端新增登录帮助。组件及插件相关 16 项单测通过；构建、架构边界和 React 生命周期检查通过。

最后的代码整理将登录命令生成函数移入 `runtime-login.ts`，以字符码检查拒绝控制字符；行为由实际 shell 引用测试覆盖。重新构建后，受影响的隔离 bundle 登录／Profile 场景 4 项通过：`bundle-2026-09-10T18-43-59-532Z-74e8abd7/{summary,bundle-summary}.json`，明确 `fullSuite: false`；Claude／Codex 产物登录与安装场景 2 项通过：`2026-09-10T18-44-00-034Z-bd0aeca7/summary.json`。这两份是代码整理后的定向回归，不标记为再次完成 61／18 项整套。相关 16 项组件单测仍通过；ESLint 无错误，保留既有状态加载 effect 的一项提示。
