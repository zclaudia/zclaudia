# 三种 Agent Runtime 内置插件迁移计划

日期：2026-09-10。状态：实施中；当前进度与验收证据见 [实现状态](2026-09-10-builtin-agent-runtime-implementation-status.md)，发布门禁尚未全部满足。

计划复核：2026-09-11。工作区已包含迁移实现和测试草稿；下列阶段是交付与审查边界，不表示全部仍需从零实现。勾选完成项必须关联对应候选代码的证据，不能仅凭文件存在判定通过。本次复核完善计划和执行顺序，不重新执行或认证历史测试结果。

可行性结论：可行，适合沿用现有插件 SDK 和 `ExternalAgentAdapter`，将三个适配器纳入主仓库并由宿主内置目录加载。Claude 使用 SDK，Codex 使用 app-server，Cursor 使用 CLI 流式协议；保留各自实现与能力差异，不需要为内置化统一重写供应商协议。主要工程量在来源优先级、Profile 生命周期、旧数据兼容、生产依赖收集和完整应用验收。内置插件不等于供应商 CLI 已安装或账户已登录。

代码基线：`zclaudia@504b9874`、`zclaudia-plugins@9453561`。开始实施时记录两个仓库完整 SHA；如果基线变化，先复核差异。本计划以当前代码为依据，不把历史设计文档或供应商 CLI 的未验证能力当作实现事实。

## 1. 目标与范围

将 Claude、Codex、Cursor 的插件源码迁入 zclaudia，随应用构建和发布，默认注册为可选择的 coding agent runtime。保留现有 `ExternalAgentAdapter`、插件 SDK、事件归一化和 MCP bridge 边界。

交付后，用户无需下载 `.zplugin` 或添加开发目录，就能看到三种 runtime；完成对应 CLI 安装和登录后，可以创建 coding 会话。新用户无需先配置 ZClaudia 的 LLM Profile。旧用户的 Agent Profile、会话、项目默认 Agent、CLI 路径和 runtime pin 必须保留。

首期包含交互式 coding 会话，以及复用同一 run-start 链路的 agent task 路由回归。现有 ZClaudia runtime 和普通第三方插件保持可用。独立的 workflow agent-loop 仍有 LLM 专用接口，不能因这次迁移就宣称它支持三种外部 runtime；首期验证原行为，外部 runtime 接入该接口单独立项。

CLI 可执行文件仍通过现有系统路径／managed runtime 机制提供。首期不把所有供应商二进制塞进应用，不新增自动登录，不默认改变 runtime 下载策略，不补齐各供应商原本不支持的能力。

## 2. 迁移前基础和必须处理的缺口

本节记录上述代码基线的迁移前问题；工作区后续已实现的修复以实现状态文档为准，不能将此表直接作为当前未修复问题清单。

| 位置                                                                                | 当前事实                                           | 迁移要求                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `server/src/application/plugins/loader.ts`                                          | 从用户目录发现插件，同 ID 先发现者生效             | 增加宿主内置目录和明确的优先级                   |
| `server/src/index.ts`                                                               | 启动仅激活 `onStartup`，三种插件未声明该事件       | 内置 runtime 默认注册，并建立可等待的初始化状态  |
| `server/src/application/plugins/plugin-context.ts`                                  | 注册 API 依赖 `provider.register`                  | 内置来源由宿主认证，注册不可出现无权限但显示成功 |
| `server/src/application/plugins/loader.ts`                                          | 停用清理会删除插件所属 Profile；关闭应用也调用停用 | 分离停止 runtime 与删除配置                      |
| `server/src/application/plugins/agent-profile-service.ts`                           | 默认 Profile 依赖 LLM Profile 并继承其模型         | 外部 runtime 使用独立配置和自身模型默认值        |
| `server/src/domains/agent-readiness/check.ts`、`shared/src/core/agent-readiness.ts` | 就绪契约以 LLM 凭据和模型为基础                    | 按 runtime 判断安装、兼容性、登录和可执行性      |
| `server/src/application/plugins/package-service.ts`                                 | 来源只有 managed/development                       | 内置来源和管理动作需要端到端建模                 |
| `apps/desktop/src/features/plugins/PluginsContent.tsx`                              | Built-in 当前展示内置面板                          | 加入内置 runtime，并区分面板开关与运行时开关     |
| `pnpm-workspace.yaml`、`.gitignore`                                                 | workspace 未包含插件；`/plugins/*` 被忽略          | 更新 workspace 与精确的忽略规则                  |
| `server/scripts/bundle.mjs`                                                         | 动态加载的三种插件没有发布资源收集逻辑             | 显式构建、复制并验证完整生产依赖                 |

此前定向执行的插件侧 189 项、宿主侧 16 项测试全部通过。这只是迁移前接口基线，不计作迁移后的 E2E 验收。

## 3. 目标结构与产品规则

建议源代码结构：

```text
plugins/agents/claude/        # 保留 src、测试、manifest、兼容性描述和 LICENSE
plugins/agents/codex/
plugins/agents/cursor/
packages/agent-common/       # 三种插件的共用实现
scripts/plugins/             # 构建、边界检查、兼容性和产物验证
server/bundle/builtin-plugins/{claude,codex,cursor}/
                             # 发布资源；不提交生成物
```

插件包名、插件 ID、runtime type 和 contribution ID 保持不变。源仓库的构建脚本需要适配新路径，不能继续依赖 `../../scripts`、兄弟仓库或开发机绝对路径。`agent-common` 可以使用 workspace 依赖，发布时编译进入插件；继续禁止插件导入 server 内部模块。公开的 `plugin-sdk`、`agent-tool-bridge` 和独立 `agent-runtime` 包不在本次迁入范围。

主仓库成为三种适配器的唯一代码源。保留可独立加载的插件产物形态和 Playground 开发方式；源仓库的 `agent-dev` CLI 首期留在原仓库。外部插件的后续独立发布流程应指向主仓库产物，避免两边独立修改同一适配器；停止旧发布流程放在验收通过之后执行。

产品与宿主规则：

- 插件来源采用 `builtin | managed | development`；来源由宿主资源目录／内置目录清单确定，外部 manifest 声明无效。
- 三种插件默认启用，允许用户停用并持久化选择；缺少 CLI 或未登录不会隐藏 runtime，也不触发隐式下载。
- 内置插件不能通过单插件安装、更新、卸载或回滚 API 替换。更新跟随应用版本，按钮和后端规则一致。
- 区分“已发现”“已注册／停用／加载失败”和“CLI 缺失、版本不兼容、待登录、就绪、状态未知”。鉴权未知不得显示成已验证，也不能一律阻止供应商支持的首轮鉴权方式。
- runtime 初始化完成前，相关 API 返回明确的初始化状态；初始化后每个插件要么注册成功，要么有可见错误。CLI 检测不得无限阻塞整个 server 启动。
- 内置注册权限只授予宿主确认的内置模块，不把按 ID 保存的授权扩散给同名外部插件；用户的任务审批与 CLI 下载策略仍独立生效。
- Profile 模型值为空时由对应 runtime 使用自己的默认模型；不能补入其他 LLM Profile 的模型。已有用户明确设置的模型不被迁移覆盖。
- 停用、重载和 shutdown 均不删除内置 Profile、会话或 managed runtime pin。运行中停用／重载返回 `409 RUNTIME_BUSY`，用户先停止任务再操作；关闭应用则先停止接收新任务、取消并回收在运行任务，再释放插件。
- 找不到目标 runtime 时返回明确错误，不能静默改用 `zclaudia`。
- MCP 端点只在没有运行时按空闲期限回收，不能在长任务或审批等待中关闭；续聊重建端点后仍使用原会话身份，其他会话不受影响。
- 现有全局及项目默认 Agent 保持不变。全新用户的首次选择根据 runtime 就绪状态引导，不能把尚不可用的 CLI Agent 强行设为全局默认。

## 4. 分阶段实施

建议拆成六个可独立审查的 PR。每个 PR 附改动、测试结果与剩余限制；先完成依赖阶段再开启下一阶段。

### PR 1：迁入源码和建立构建基线

依赖：无。

- [ ] 记录源 SHA、插件版本、许可证及依赖版本；迁入三个 agent 和 `agent-common`，保留相关测试。
- [ ] 更新 workspace、锁文件、根脚本、TypeScript 配置和 `.gitignore`；确认新增源文件被 Git 跟踪。
- [ ] 迁入并调整构建、兼容性、conformance 和产物检查脚本；区分“内部 workspace 合法”与“外发产物不得含 workspace 依赖”。
- [ ] 修正 Playground 路径和 build/watch 行为，验证修改共用代码能够重建实际加载的 bundle。
- [ ] 保持原适配器行为，暂不切换默认加载。

完成条件：只 checkout 主仓库并安装依赖即可构建三种插件；相关单测、类型检查、边界检查通过；编译产物可被真实 PluginLoader／Playground 加载。

### PR 2：内置来源、注册与生命周期

依赖：PR 1。

- [ ] 定义内置目录清单与路径解析：源码开发、`server/dist`、桌面 bundle 均有确定入口，不能依赖启动 cwd。
- [ ] Loader 优先解析内置来源，处理同 ID 和不同 ID 抢占相同 runtime type 的冲突，记录被忽略的外部来源。
- [ ] 增加来源契约、默认启用和停用状态持久化；内置注册能力与第三方权限分开处理。
- [ ] 收敛激活事务：描述、managed metadata、adapter 和 Profile 只有成功后才对外作为完整可用注册；失败清理不删除既有数据。
- [ ] 为运行中停用／重载增加服务端忙状态保护，补齐 Claude、Codex、Cursor 的取消与进程清理。
- [ ] 在正常 shutdown、异常中断后的再次启动中保留 Profile 与 runtime pin；避免清理一个插件影响另外两个。
- [ ] 内置保留 ID 的安装／回滚／删除限制在服务端执行；普通第三方插件现有管理流程有回归测试。

完成条件：三种插件默认完成注册，停用后重启仍停用；注册失败可见且可恢复，无重复 runtime、无残留进程、无 Profile 删除。

### PR 3：Profile、就绪判断与旧数据迁移

依赖：PR 2。

- [ ] 外部 runtime 的 Profile 允许没有 LLM Profile；检查 API 校验、仓库写入、就绪判断、模型校验与 run-start 全链路。
- [ ] 默认 Profile 按 `(pluginId, pluginProfileId)` 幂等创建；已有记录保持主键和用户字段。
- [ ] 扩展就绪结果及 UI 引导，复用 managed runtime 检测；外部 runtime 不再被全局“未配置 API 模型”挡住。
- [ ] 实现下节迁移规则、迁移日志和失败恢复，构建脱敏的升级数据库 fixture。
- [ ] 检查历史自动填入模型的 Profile：仅对有明确来源证据、未被用户编辑的自动值清理；无法识别时保留，并允许用户清空为 runtime 默认。
- [ ] 验证显式会话 Agent、项目默认 Agent、全局默认 Agent 的优先级和 agent task 同链路路由。

完成条件：无 LLM Profile 的新用户通过已认证 CLI 完成一轮 coding；旧数据迁移重复执行两次没有额外修改，正常退出／重启保留关联。

### PR 4：内置 runtime 界面与操作

依赖：PR 2、PR 3。

- [ ] Built-in 展示三种 runtime、应用附带的插件版本、启用状态、CLI 来源／版本和就绪状态。
- [ ] 复用安装／登录／显式路径入口；缺少 CLI 时给出针对该 runtime 的下一步。
- [ ] 隐藏内置插件卸载／独立回滚操作；运行中停用展示忙状态及停止任务入口。
- [ ] Profile 编辑器和会话选择器正确显示已停用／未就绪 Agent；已保存会话保留其 runtime 身份。
- [ ] 根据能力描述显示权限模式与功能；Cursor 不呈现未实现的逐次审批能力。远程界面显示连接后端的 CLI 状态。
- [ ] 为关键交互补齐稳定的可访问名称或 `data-testid`，供 E2E 使用。

完成条件：首次使用、停用／恢复、升级后恢复会话都能通过 UI 完成；刷新页面后状态一致。

### PR 5：生产打包与跨环境验证

依赖：PR 1 至 PR 4。

- [ ] 在 server bundle 中收集插件入口、manifest、兼容性文件、许可证和生产依赖；验证 Claude SDK 的动态资源，不照搬开发机 node_modules 链接。
- [ ] 生产依赖转换为普通目录，保留已安装版本和依赖解析关系；在 Tauri 完成资源复制后，再验证实际桌面产物的资源清单。仅验证打包输入不足以证明安装产物完整。
- [ ] 接入 `browser:build`、server bundle、macOS／Windows／Linux 构建及相应发布工作流。
- [ ] 生成内置插件清单，记录源 SHA、版本和产物摘要；确保插件和应用升级同步。
- [ ] 可写状态只存放在应用数据目录和用户工作区，禁止向签名后的应用资源目录写配置、安装 CLI 或存日志。
- [ ] 从临时目录启动打包产物，源仓库和兄弟仓库不可见；使用随包 Node 验证真实加载。
- [ ] 验证带空格、中文和只读资源路径；Windows 路径与进程树清理按该平台实际行为测试。

完成条件：无源码、无全局 node_modules 的环境中三种插件能注册；受支持的 CLI 能运行；CLI 不支持的平台明确显示不可用，不算运行成功。

### PR 6：E2E 门禁和迁移发布

依赖：测试设施从 PR 1 开始建设，各 PR 增加对应用例；最终验收依赖 PR 5。

- [ ] 实现下述专用 E2E 配置、CLI 协议 fixtures、升级 fixtures 和产物验收脚本。
- [ ] 必需的确定性用例进入 PR CI；真实 CLI 和安装包用例成为迁移版本的发布门禁。
- [ ] 产出验收报告，逐项标记通过／失败／阻塞／不适用，并关联证据。
- [ ] 完成一次旧版到候选版升级和回退演练，按第 8 节确认可恢复范围。
- [ ] 验收全部满足后切换正式发行入口，更新使用文档和源仓库维护说明。

## 5. 旧安装与数据迁移规则

迁移在加载旧插件之前执行预检。SQLite 变更使用事务，文件系统动作使用持久化日志分阶段记录，不假设数据库事务能够回滚文件操作。

| 旧状态                                  | 新版本处理                                       | 必须保留／验证                               |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| 没安装过三种插件                        | 使用内置版本并幂等创建缺失默认 Profile           | 不依赖 LLM Profile，不覆盖原默认 Agent       |
| 已安装同 ID `.zplugin`                  | 内置版本生效，旧安装保留为被遮蔽的历史记录       | 原插件目录、版本档案、Profile 主键、CLI 配置 |
| 配置过开发目录                          | 目录记录保留，同 ID 外部实例不激活，展示来源冲突 | 不修改或删除用户源码                         |
| 其他插件声明 `claude/codex/cursor` 类型 | 拒绝其抢占，错误可见                             | 内置 runtime 身份稳定                        |
| 已有插件默认 Profile 或其用户副本       | 原地保留，只有缺失 contribution 才创建           | 用户名称、提示词、模型、工具、项目／会话引用 |
| 曾明确保存停用选择                      | 沿用停用状态                                     | 不因应用升级自动恢复启用                     |
| 旧版只有内存启用状态，无持久化选择      | 按新版本默认启用注册，CLI 仍按就绪规则运行       | 不把推测当成用户停用记录                     |
| 有 managed CLI 和 pin                   | 继续使用已有引用与显式路径                       | 不因插件来源变化重装或更换 CLI               |
| 外部同 ID 版本比内置版本新              | 记录版本差异，仍按宿主优先规则处理               | 不删除外部包；兼容性问题必须在发布前解决     |
| 中途崩溃／重复启动                      | 按迁移日志恢复，重复步骤幂等                     | 不重复建 Profile、不进入半注册状态           |

迁移不调用会触发 `deleteByPlugin` 的旧卸载流程。迁移完成标记只能在必需状态提交后写入；异常时记录具体步骤和恢复方式，不自动重置数据库。

## 6. E2E 设计与验收矩阵

### 6.1 测试设施和边界

现有 `playwright.config.ts` 只启动前端，依赖用户 shell；部分旧测试在前置条件失败时直接返回。Vitest 的 E2E include 也会匹配 Playwright 文件。新增专用 `e2e/playwright.agent-runtimes.config.ts`，使用明确的 testMatch，隔离两种 runner，不依赖旧套件的“通过率”。

拟新增文件，实施时允许等价命名，但必须保持职责和用例 ID：

```text
e2e/playwright.agent-runtimes.config.ts
e2e/helpers/agent-runtime-harness.ts
e2e/fixtures/agent-runtimes/{claude,codex,cursor}/
e2e/fixtures/agent-runtime-migration/
e2e/tests/agent-runtimes/builtin-lifecycle.playwright.spec.ts
e2e/tests/agent-runtimes/coding-flow.playwright.spec.ts
e2e/tests/agent-runtimes/migration.playwright.spec.ts
e2e/tests/agent-runtimes/live.playwright.spec.ts
scripts/dev/test-builtin-runtime-bundle.mjs
```

测试分三层，报告必须说明每项使用哪一层：

1. **确定性完整应用 E2E**：真实前端、HTTP／WebSocket、SQLite、PluginLoader、三个真实 adapter 和子进程边界；只替换供应商 CLI 为可控协议 fixture。Codex 模拟 app-server JSON-RPC，Cursor 模拟 stream-json，Claude 优先用真实 SDK 对接模拟 CLI 控制协议。不得直接伪造前端响应或替换 adapter.run 后称为该 runtime 的 E2E。E19／E22 的原生 LLM 链路在模型 HTTP 接口使用 fixture，宿主路由、读写文件、审批及 shell 工具仍真实执行。
2. **真实 CLI E2E**：使用受测版本和专用已登录账户，经过完整应用执行真实任务；覆盖模拟协议不能证明的认证、协议、恢复和取消能力。
3. **发布产物 E2E**：从实际 bundle／安装包启动，重复注册、基本 coding、重启恢复场景；源目录不可见。浏览器连接 packaged server 可以验证业务链路，但桌面原生壳启动、资源路径、退出及升级需在实际安装包额外验收。

如果 Claude 的模拟 CLI 协议无法在首阶段完整实现，可先用 SDK 传输替身覆盖宿主流程，但必须标记为集成测试；它不能替代真实 SDK／CLI 门禁，也不能使 Claude 完整 E2E 被判通过。

隔离与断言规则：

- 每次运行分配唯一 `ZCLAUDIA_DATA_DIR`、临时工作区、测试鉴权和受控 CLI 配置目录；启动自己拥有的后端和前端，不复用正在使用的应用或默认数据库。
- 通过子进程启动环境／测试配置隔离供应商目录，保持主进程系统环境不变；live 使用明确配置的测试账户，不拷贝日常账户凭据到测试报告。
- 端口由 harness 分配并验证服务实例标识；等待健康接口和 runtime 初始化结果，不用固定 sleep 判断启动成功。
- 上下文缺失、按钮不存在、后端未启动、CLI fixture 未执行均失败；禁止 catch 后直接 return。必需用例不得静默 skip。
- 除 UI 断言外，还校验持久化状态、目标 adapter／CLI 调用记录、工作区文件和终态。不能仅靠收到一段文字证明用了目标 runtime。
- 确定性用例默认禁外网；下载场景使用本地受控 HTTP 服务器和校验摘要。fixtures 不读取真实供应商配置。
- 清理只结束 harness 记录的进程及其子树；取消后 10 秒内 run 到达终态且该 run 不再执行工具，shutdown 后 10 秒内测试进程树退出。可复用 Codex 空闲进程允许在单次取消后保留，但 shutdown 后不得残留。
- 单项超时、网络／账户故障报告为失败或阻塞，不能记通过。live 不精确匹配模型措辞，以文件、工具事件、会话 ID 和终态为证据。

### 6.2 确定性必需用例

默认三种 runtime 参数化执行。标注“公共”的管理用例可共享一次流程，但需断言三个插件状态；权限等差异按 manifest 明确展开。

| ID  | 场景与操作                                                            | 必须断言                                                                            |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| E01 | 空数据目录，无 LLM、无 CLI，启动应用                                  | 三种内置 runtime 各出现一次；默认 Profile 创建；显示缺 CLI，不错误要求先填 API 模型 |
| E02 | 为每种 runtime 配置已认证 fixture CLI，UI 选择 Agent 并发送任务       | 不配置 LLM 也完成运行；调用目标 CLI；不存在跨 runtime 模型污染                      |
| E03 | 通过 UI 创建小项目，要求读取输入文件、修改文件并运行检查命令          | 工具调用及结果可见；文件内容、命令退出码正确；收到一次终态；刷新后消息仍在          |
| E04 | 一轮完成后继续对话，再关闭后端并重启继续                              | Profile／会话主键、provider session ID、cwd 保留；fixture 收到正确 resume 参数      |
| E05 | 两个 runtime 同时运行，其中一个取消                                   | 被取消 run 停止工具执行，另一个继续；没有串 session、cwd 或权限回答                 |
| E06 | Claude／Codex 发起审批，分别允许和拒绝；Cursor 选可支持模式           | 允许才执行、拒绝无副作用；审批与正确 run 关联；Cursor 不展示伪造的逐次审批能力      |
| E07 | 触发 MCP bridge 工具并调用真实本地桥接服务                            | 工具获得正确会话上下文；不可串用另一会话凭证；用户既有 MCP 条目保留                 |
| E08 | 空闲时停用、重启、重新启用                                            | 停用持久化；原 Profile、引用及 pin 保留；启用后不创建重复配置                       |
| E09 | 运行中经 UI 和 API 分别停用／重载                                     | API 返回忙状态且 UI 有解释；run 不被暗中拆除；停止后可操作                          |
| E10 | 激活失败、CLI 崩溃或输出非法协议，再修复重试                          | 失败可见、无永久 loading；既有配置不删除；重试成功且无残留注册                      |
| E11 | 显式无效 CLI 路径、版本不兼容、未登录                                 | 原因对应 runtime；不偷偷改用系统路径或其他 agent；修复后可运行                      |
| E12 | 新旧 `.zplugin` 和开发目录同时提供同 ID；另一个 ID 抢占相同 type      | 只有内置 adapter 执行；冲突来源可见；外部文件不变                                   |
| E13 | 尝试安装、回滚、卸载保留 ID，再管理普通第三方插件                     | 内置操作被服务端拒绝；普通插件安装／启停／卸载仍正常                                |
| E14 | 导入旧版 fixture，升级，重启，再重复迁移                              | 与第 5 节匹配；Profile ID、用户字段、会话、默认引用、CLI pin 不变                   |
| E15 | 在迁移步骤和注册步骤注入失败／中断后重新启动                          | 能恢复或给出可恢复错误；没有半完成标记、数据丢失或重复 Profile                      |
| E16 | 应用更新，插件版本变化但 contribution ID 不变                         | 新代码生效，用户配置保留；停用选择不变                                              |
| E17 | managed-ask 安装确认／拒绝、摘要不匹配、离线重启                      | 下载策略不变；未同意不下载；校验失败不激活；已有 pin 离线仍可解析                   |
| E18 | 显式会话 Agent、项目默认 Agent、全局默认 Agent 冲突                   | 优先级正确；明确选择的缺失 runtime 报错，不回退到其他 runtime                       |
| E19 | agent task 通过现有 run-start 入口运行；现有 workflow agent-loop 回归 | 前者使用实际选定 runtime；后者原有 LLM 语义不被迁移意外改变                         |
| E20 | 正常退出、长任务中退出、异常退出后再启动                              | 配置不删；正常退出无残留进程；异常运行显示中断／可重试，不伪造已完成                |
| E21 | 本地直连、远端后端连接和 Gateway 各走一轮会话／取消                   | 选择并运行的是目标后端 runtime；CLI 路径和认证状态来自该后端                        |
| E22 | 原 ZClaudia Agent 运行、Profile 编辑、普通内置面板切换                | 原有默认选择和功能无回归，面板切换不影响 runtime                                    |

E07 以实际实现和能力声明一致为准：迁移前 Claude adapter 已有 bridge 注入，但 manifest 声明不一致。本轮将 `tool.inject` 修正为 bridged／best_effort，并通过实际 SDK、stdio proxy 与宿主工具调用验证。供应商 CLI 仍以 fixture 替代，真实 CLI 的可用性继续由 L05 门禁确认，不能仅凭标签判定。

### 6.3 真实 CLI 验收

每个受支持 runtime 至少完成以下场景。使用候选版完整应用和专用临时 Git 项目，记录 CLI／SDK／模型版本；选取兼容性描述中可取得的受测版本，不凭 manifest 中的 URL 就断言版本可下载。

| ID  | 实际操作                                           | 成功证据                                                            |
| --- | -------------------------------------------------- | ------------------------------------------------------------------- |
| L01 | 无 LLM Profile，仅通过该 CLI 已登录状态启动 coding | 一轮真实回复、正确 provider 会话身份和正常终态                      |
| L02 | 读取项目、修改一个函数、运行预置单测               | Git diff 符合任务；测试进程退出码为 0；UI 展示工具执行过程          |
| L03 | 同会话第二轮继续，再重启应用继续                   | 恢复路径正确，既有任务上下文可用，Profile／会话引用不变             |
| L04 | 启动可观察的长任务，然后取消                       | 活跃工具停止，run 终止；不会继续写入检测文件；下一轮可运行          |
| L05 | 按支持能力测试审批／模式和 MCP 工具                | 审批结果与文件副作用一致；bridge 有真实调用记录；不支持项有明确降级 |
| L06 | 两种 runtime 并发，一边结束／取消                  | 输出与权限不会串会话，另一个 run 正常完成                           |

live 在受控机器或手动 CI job 执行，不进入无凭据 PR job。命令必须显式选择 runtime、CLI 路径和输出目录；为每例设置超时及轮数上限并记录用量。实际首次执行前核实测试账户和可用额度。缺少必要登录或版本时整项标记阻塞，不能用模拟结果替代。

### 6.4 发布产物与平台矩阵

| 环境                            | 必需验收                                 | 通过标准                                            |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| 开发模式／构建后 browser server | E01–E22，按是否需要 Gateway 拆 job       | 不依赖相邻插件仓库；关键路径完成真实应用链路        |
| Linux 构建后 server 与 bundle   | E01、E02、E03、E04、E08、E12、E14、E20   | 从临时目录启动，使用生产资源和受控 CLI fixtures     |
| macOS arm64 实际 `.app`／安装包 | 安装、首次启动、E01/E08/E14/E20、L01–L05 | 签名资源完整；无源码依赖；应用退出及再次启动正确    |
| Windows x64 实际安装包          | 同上，并覆盖空格路径、子进程树和只读资源 | 支持的 CLI 完成 live；不支持的平台组合显示不可用    |
| Linux 桌面产物及其他发行架构    | 对本次实际发布的目标执行相同产物验收     | 未运行的平台不得标记已认证；发布该目标前补齐        |
| 远程／Gateway                   | E21，并至少一种已认证 runtime 的真实会话 | 客户端无 CLI 也能使用后端 runtime；断连重连状态正确 |

平台兼容矩阵在 PR 1 中登记并在发布前复核。Cursor 等 CLI 的平台支持不能从“应用支持 Windows”推导；不适用项必须说明供应商边界和应用降级行为。缺测试机器属于阻塞，不属于不适用。

本机原生探针已发现并修复 Tauri 漏复制 pnpm 目录链接的问题。修复后的本地 ad-hoc `.app` 在源码禁读、资源只读条件下完成三种注册及公开 API coding；原生界面检查因 Mac 锁屏未执行。该结果不替代本表要求的正式安装包、界面退出或升级验收，详情与摘要见实现状态文档。

Linux arm64 已通过源码 core 61 项和产物故障／恢复 21 项确定性验收；另一个无源码挂载、网络关闭且产物只读的容器完成三种 runtime 的 API coding、MCP 与重启持久化探针。该探针使用随包 Node 和 CLI fixtures，不替代 Linux 桌面安装包、原生界面或真实 CLI 门禁。Linux catalog 中的提交为本地测试快照的合成提交，正式候选仍需按宿主真实提交重新生成并记录，详见实现状态的 Linux 节。

### 6.5 命令和报告契约

以下为命令契约；源码、migration 和 bundle 脚本已存在。live 执行器包含 L01–L03（coding）、L04（cancel）、L05（capabilities）和 L06（concurrency）四种场景及无凭据自测入口；执行器存在或其 fixture 自测通过，均不代表真实 CLI 已验收。最终候选版本仍需验证参数、超时和清理行为。脚本内部统一经过项目 Node 包装器，负责启动与回收服务。

```bash
pnpm test:e2e:agent-runtimes
pnpm test:e2e:agent-runtimes:migration
ZCLAUDIA_E2E_GATEWAY_ENTRY=/absolute/path/to/gateway-v3/dist/server.js pnpm test:e2e:agent-runtimes:gateway
pnpm test:e2e:agent-runtimes:bundle -- --artifact-dir /absolute/path/to/bundle
pnpm test:e2e:agent-runtimes:live -- --help
pnpm test:e2e:agent-runtimes:live-selftest
pnpm test:e2e:agent-runtimes:live -- --runtime codex --self-test --output-dir /absolute/path/to/new-self-test-report
pnpm test:e2e:agent-runtimes:live -- --runtime codex --cli-path /absolute/path/to/codex --account-root /absolute/path/to/test-account --output-dir /absolute/path/to/new-live-report --max-turns 3 --turn-timeout-ms 180000 --allow-live
pnpm test:e2e:agent-runtimes:live -- --scenario cancel --runtime codex --cli-path /absolute/path/to/codex --account-root /absolute/path/to/test-account --output-dir /absolute/path/to/new-cancel-report --max-turns 2 --turn-timeout-ms 180000 --allow-live
pnpm test:e2e:agent-runtimes:live -- --scenario capabilities --runtime claude --cli-path /absolute/path/to/claude --account-root /absolute/path/to/test-account --output-dir /absolute/path/to/new-capabilities-report --max-turns 3 --turn-timeout-ms 180000 --allow-live
pnpm test:e2e:agent-runtimes:live -- --scenario concurrency --runtime claude --cli-path /absolute/path/to/claude --peer-runtime codex --peer-cli-path /absolute/path/to/codex --account-root /absolute/path/to/test-account --output-dir /absolute/path/to/new-concurrency-report --max-turns 2 --turn-timeout-ms 180000 --allow-live
```

live 的账户目录必须预先准备专用账户所需的 `home/` 和对应 runtime 子目录；Cursor 使用 `home/.cursor`。concurrency 要求两个不同 runtime、两个显式 CLI 路径，账户目录同时含两个 runtime 子目录；可分别通过 `--model`／`--peer-model` 指定模型。先用 `--validate-only` 检查路径与参数，该模式不执行任何 CLI。输出目录必须尚不存在；当前执行器只支持 POSIX，Windows 验收需要补齐相应执行设施。coding／capabilities 要求 `--max-turns 3`，cancel／concurrency 要求 `--max-turns 2`（并发场景两边各一轮）；它们只限制用户轮数，不限制供应商内部工具轮数或金额，费用上限由专用账户配额另行约束。执行前必须清除其他 suite 的 `ZCLAUDIA_E2E_*` 覆盖变量，防止实际入口与报告不一致。

`live-selftest` 只使用私有 CLI fixtures，依次验证三种 runtime 的 coding／恢复、故意超时／清理、取消／下一轮、审批／模式／MCP，以及 Claude→Codex、Codex→Cursor、Cursor→Claude 三组并发。超时子用例必须产生失败验收报告，同时有超时与清理证据，自测汇总才算通过；不是将超时计作 live 成功。L04 的真实模式要求 CLI 自己启动持续写入的前台 Node 工具，取消后 10 秒内运行终止、工具 PID 退出，再观察 3 秒确认停止写入；fixture 模式只证明 fixture 写入停止和会话可继续，报告区分两种边界。CLI 透明启动器也会协助清理子进程，其结果不能单独证明未包装供应商 CLI 的应用退出行为。

Linux 只读产物 API 探针也可通过独立容器命令执行，PR workflow 已接入此步骤：

```bash
bash scripts/dev/test-builtin-runtime-container.sh server/bundle \
  apps/desktop/src-tauri/binaries/node-x86_64-unknown-linux-gnu \
  artifacts/agent-runtime-migration/container-acceptance
```

输入必须是与 Docker daemon 架构相同的 Linux bundle／随包 Node；arm64 使用对应的 `node-aarch64-unknown-linux-gnu`。输出目录须尚不存在，其父目录须存在并可供 Docker bind mount 使用。命令遵循显式 `DOCKER_CONTEXT`／`DOCKER_HOST`，不会创建 VM 或切换默认 context。仅将 bundle、Node、驱动及 CLI fixtures 复制到独立只读输入，报告挂载单独可写；关闭容器网络，不挂载完整项目。结束后保存挂载／退出状态并删除自有容器和临时输入，保留报告。此步骤覆盖 API coding、MCP、持久化与关闭，不代替原生桌面 UI、真实 CLI 或安装器升级验收。

L05 要求 Claude／Codex 的审批详情显示实际目标文件，允许后出现预期写入，拒绝后无写入；Cursor 通过 UI 选择 Plan／Ask，检查文件未变且没有宿主逐工具审批。随后使用真实插件注册的 MCP 工具，验证服务端记录中的当前会话、请求标记和随机 nonce。L06 在同一后端运行两个 runtime：取消主 runtime 时另一方仍活跃；若另一方支持审批，其待审批命令必须仍未执行，之后批准并放行前台任务，验证它独立完成 coding 和测试。两边的 MCP 记录、消息和 provider session ID 必须隔离。并发场景使用一个共享截止时间约束重叠的两轮，不允许一边失败后另一边无限运行。

建议报告目录：`artifacts/agent-runtime-migration/<run-id>/`。保存应用／源插件 SHA、插件版本和摘要、平台、CLI／SDK 版本、用例 ID、模式（fixture/live/package）、结果、耗时、失败原因、迁移前后关键字段对比、进程清理结果。确定性测试可保留 Playwright trace／截图、脱敏 server 日志和 CLI 调用记录；live 默认关闭原始 trace、录像和协议日志，保留结构化结果、工作区 diff、测试退出码和脱敏进程记录。报告不包含凭据，生成目录加入忽略规则。无用量数据应标记不可用，不能记为零费用。

## 7. 验收门禁与完成定义

PR 门禁：相关单元／集成测试、类型检查、架构边界检查、三种插件构建，以及该 PR 对应的确定性 E2E 必须通过。新增 suite 关键用例不依赖重试变绿；固定 fixture 的失败先修复，不以“模型不稳定”为理由豁免。E12 的包／目录输入还需覆盖异常 runtime 声明：包预览返回明确校验错误，目录发现及重启不受单个坏插件影响；E10/E15 要验证损坏的内置声明被隔离、其余 runtime 可用，并可保留 Profile 后重载恢复。

迁移版本发布门禁：

- [ ] E01–E22 的适用矩阵完成，无必需项静默跳过；Gateway job 可独立运行，但发布前必须有结果。
- [ ] 三种 runtime 在受支持平台完成 L01–L05，L06 至少覆盖一次跨 runtime 并发。
- [ ] 本次发布的各平台产物完成注册、资源加载、升级与退出检查；live 平台组合按受支持矩阵完成。
- [ ] 首次启动不要求 LLM Profile；旧 Profile、会话、默认引用和 CLI pin 全部保留。
- [ ] 无同名外部插件覆盖、静默 runtime 回退、运行中卸载、退出后残留进程。
- [ ] 旧版升级与回退演练有证据；无未解释的数据变更或未解决的阻断缺陷。
- [ ] 报告可追溯到最终发布候选 SHA；候选产物改变后重跑受影响门禁。

只有门禁满足才称“迁移完成”。测试设施完成、单测通过或开发环境可聊天均不能单独替代安装包和真实 CLI 验收。

## 8. 发布、恢复与后续维护

1. 在脱敏旧数据 fixture 上验证，再用专用测试账户的数据副本演练升级。停写后通过 SQLite backup 或等价一致性备份生成回退快照，避免直接复制活动 WAL 数据库。
2. 采用可兼容的增量 schema 和原 ID；迁移不破坏旧 `.zplugin`、开发目录或 runtime store。预先验证旧版程序读取迁移后数据库的实际结果，不能仅凭“没有删列”认定可降级。
3. 候选版先进入测试发布渠道。发生 runtime 故障时可停用该内置 runtime、保留配置并切换其他可用 Agent；修复不要求重置数据。
4. 若旧版兼容迁移后的数据，按演练结果直接回退应用。若不兼容，只能在停写并导出新增数据后恢复迁移前快照，或发布前向修复；恢复快照会回退之后的消息，不能自动执行。
5. 回退仍需验证旧插件是否能重新发现及激活，CLI pin 是否可用；保留旧包是恢复条件之一，不等于已经证明回退成功。
6. 验收通过后，更新原仓库 README／发布流程，说明三种适配器的维护入口已迁入主仓库。移除旧发布入口前确认不再有消费者依赖该流程。
7. 后续每次供应商 CLI／SDK 更新，运行 conformance、受影响的确定性 E2E 和 live；应用发布保持按平台的 bundle 验收。

## 9. 排期参考

按一名熟悉项目的工程师估算，代码接入和生命周期约 3–5 个工作日，Profile／迁移／界面约 3–5 日，E2E 设施和产物／真实 CLI 验收约 4–7 日，总计约 10–17 个工作日。测试随各 PR 编写，该估算不是在迁移结束后再追加一轮测试时间。

最大不确定性是 Claude SDK 模拟 CLI 控制协议、Windows 子进程／路径行为和可用的真实 CLI 测试账户。PR 1 应尽早完成这些技术探针；如有阻塞，更新排期和平台认证范围，保持验收标准不降级。

上述 10–17 日是从迁移前基线开始的总工作量估算，不是当前剩余工期。当前工作区的后续执行顺序如下：

| 顺序 | 下一项交付               | 退出条件                                                                                   |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------ |
| 1    | 对齐代码、计划与历史报告 | 记录当前差异和候选 SHA；逐项标明已有实现、需回归和缺失项；历史局部通过不合并成最终全量通过 |
| 2    | 完成 live 测试设施       | 三种 L01–L06 执行器自测及超时／中断清理通过；PR CI 执行无凭据测试                          |
| 3    | 验证最终候选的确定性链路 | E01–E22 适用项通过，包括升级故障、原生 Agent 回归和实际兼容的 Gateway 链路；生成独立报告   |
| 4    | 执行真实 CLI 与平台验收  | 专用账户完成 L01–L06；本次发布平台的安装包完成安装、路径、资源、重启和进程清理验收         |
| 5    | 升级／回退与发布切换     | 实际旧版升级及回退演练通过；报告绑定最终候选；之后才切换原仓库的维护与发布入口             |

开始第 4 步前需要明确本次发布平台、受测 CLI 版本、专用账户配置和配额，以及可用的旧版安装包。这些输入不妨碍先完成测试设施与确定性验收。若 Gateway 协议版本与宿主不兼容，单列为集成缺口；历史兼容版本的通过结果不能代替目标部署版本的验收。
