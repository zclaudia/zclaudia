# T5 扩展体系（插件/技能/工作流/自动化） 对比报告

> 探索日期：2026-10-16。只读探索，所有路径均已在本会话中实际读取验证。
> 竞品仓库：`/Users/zhvala/SourceCode/ZCode`（下文 ZCode 侧路径均相对其根目录，除非写绝对路径）；本仓库：`/Users/zhvala/SourceCode/zclaudia`。

## 1. 两侧结构对照（简表）

| 维度 | ZCode | zclaudia |
|---|---|---|
| 插件清单可分发资产 | `PluginManifest`：agents / channels / commands / dependencies / hooks / lspServers / mcpServers / outputStyles / settings / skills / ui.surfaces / userConfig（`apps/zcode-cli/packages/contracts/src/plugins/index.ts:142-164`） | `PluginManifest`：commands / tools / workflowSteps / triggerSources / agentRuntimes / agentProfiles / skills / lspServers / panels / uiExtensions / menus / keybindings / notchTabs（`shared/src/plugins/manifest.ts:26-58`）；无 hooks、mcpServers、agents、outputStyles、userConfig、channels |
| 插件分发 | Marketplace 体系：`marketplace add/install/update/remove`，git / GitHub archive / CDN zip（sha256 强制）/ `git-subdir` 源；Claude Marketplace 三 manifest 兼容；依赖闭包解析；`installed_plugins.json`（`docs/claude-code-marketplace-plugin-compat.md`、`docs/plugin-cdn-zip-source.md`） | 本地 `.zplugin` ZIP 安装：inspect→token→install→rollback 闭环 + 严格校验边界 + 版本保留（`docs/plugin-packages.md`）；URL 安装 / 目录 / 签名元数据明确列为后续工作（`docs/plugin-packages.md:56-57`） |
| 技能（Skills） | workspace/user/plugin/bundled 四级来源 + `$` 选择器 + 设置页管理；从 16 个外部 Agent 一键导入（`docs/external-agent-skills-import.md`）；`skills-lock.json` 哈希锁定第三方技能 | 插件贡献技能目录 + `<available_skills>` XML 注入 + Read 工具按需读 SKILL.md（`server/src/application/plugins/loader.ts:1069-1074`、`server/src/infra/providers/pi-runtime/skills.ts`）；invocations catalog 承载 provider 原生技能（`server/src/application/invocations/catalog-service.ts`）；无外部导入、无锁定文件 |
| 官方插件生态 | 15+ 官方插件：browser-use、zcode-cua、documents、pdf、presentations、spreadsheets、visualize、image-search、skill-creator、plugin-creator、zcode-guide、superpowers、ios-simulator、android-emulator、restore-legacy-sessions 等（`apps/zcode-cli/packages/` 目录清单）；另有不可卸载的 bundled-skills 层（`apps/zcode-cli/packages/bundled-skills/README.md`） | 3 个 agent-runtime 插件：claude / codex / cursor（`plugins/agents/`） |
| Hooks | 7 个事件（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop），process/command 双类型，workspace hook Trust 信任门，`.agents`/`.claude` 只读展示（`docs/hooks-runtime-contract.md:7-13`） | user hooks：global（agent_config.hooks）+ project（projects.hooks_override）两层 DB 配置（`server/src/application/conversation/runtime/resolve-user-hooks.ts:10-30`）；无插件 hooks 注入与信任门 |
| 工作流编排 | Dynamic Workflow：模型写 TypeScript 程序编排多子代理，静态分析 4 图 + journal/resume/amend + 确认窗 + 自适应限速（`docs/dynamic-workflow.md`；源码约 2.45 万行 + 测试约 2 万行） | workflows + automations domain：cron/interval/once/event 触发绑定预定义 Workflow/Activity，经 workflow engine 产生 Run（`server/src/domains/automations/service.ts:33-48`）；无"模型即席写程序"式编排 |
| CUA / 浏览器操控 | `node_repl` 共享 MCP 宿主（单 `js` 工具）+ browser-use（Playwright DOM 快照→locator→act）+ CUA（无障碍树 + 栅格截图操控原生 App）（`apps/zcode-cli/packages/node-repl-host/README.md` 等） | 缺失 |
| Bots 消息通道 | Telegram / Weixin / Feishu / Lark / Webhook（DingTalk 规划中），`/bind` 绑定 + 9 条命令 + 权限交互回传 + Feishu 流式卡片 + 跨进程锁（`docs/bots.md`、`docs/bot-channel-runtime-split.md`） | 缺失（`server/src` 中 grep telegram/larksuite/dingtalk 无结果） |
| 插件开发体验 | plugin-creator / skill-creator 插件自举创建 + 本地市场测试（`docs/plugin-creator.md`）；插件开发在独立 `zcode-plugins` 仓库 | Agent Playground：独立 Dev Host + React UI，真实插件入口与适配器回环调试（`docs/agent-playground.md`） |
| UI 插件 | MCP Apps 交互页面：工具结果带可交互页面（Excalidraw）、侧栏 surface、页面↔对话双向（`UI_PLUGIN.md`） | 有静态 UI 贡献（panels/uiExtensions/notchTabs），无 agent 驱动的交互页面协议 |

## 2. ZCode 领先点（核心章节）

### 2.1 插件清单的资产广度：一个插件分发 skills/commands/hooks/agents/MCP/LSP/UI 全家桶

- **解决的问题**：让一个第三方插件同时携带能力（MCP servers）、知识（skills）、交互（commands、UI surfaces）、自动化（hooks）、子代理（agents）与展示（outputStyles），并在 loader 阶段统一投影成 runtime 可消费的 `PluginLoadOutcome`（commandRoots + hooks + mcpServers + skillRoots + diagnostics）。
- **证据路径**：ZCode 侧 `apps/zcode-cli/packages/contracts/src/plugins/index.ts:142-164`（manifest 字段）、`:272-281`（PluginLoadOutcome）、`:115-140`（PluginStoreListing 商店展示元数据，含多语言、hero 图、示例提示词、requiresPaidPlan）。zclaudia 现状：`shared/src/plugins/manifest.ts:26-58` 已有 commands/tools/workflowSteps/triggerSources/agentRuntimes/skills/lspServers，但**缺 hooks、mcpServers、agents（子代理）、outputStyles、userConfig、ui.surfaces**；插件技能注册在 `server/src/application/plugins/loader.ts:1069-1074`。
- **可搬运性**：重写借鉴。字段模型可直接抄形状（JSON schema 级别），但 hooks/mcpServers 注入需要 zclaudia runtime 先有对应执行面；建议顺序：mcpServers（复用现有 MCP 管理器）→ agents → hooks。
- **体量估计**：清单 schema 与 loader 投影约数百行；配套设置页/诊断较大。

### 2.2 官方插件生态 + "bundled 不可卸载层"双轨制

- **解决的问题**：生态插件走市场可装卸；而产品功能依赖的技能（如 dynamic-workflows 教程）必须与 runtime 同生共死——bundled 层不进商店、无开关、SEA 二进制内嵌按内容哈希解压（`apps/zcode-cli/packages/bundled-skills/README.md`）。官方插件则覆盖办公（documents/pdf/presentations/spreadsheets）、可视化（visualize）、自动化操控（browser-use/cua）、自举（skill-creator/plugin-creator）、自诊断（zcode-guide 的 diagnosing-plugins/skills/hooks/mcp/commands 五件套）与方法论（superpowers：14 个技能 + SessionStart hook 注入开场指令，`apps/zcode-cli/packages/superpowers-plugin/hooks/hooks.json:3-14`）。
- **证据路径**：ZCode 侧 `apps/zcode-cli/packages/bundled-skills/README.md`、`apps/zcode-cli/packages/superpowers-plugin/`（skills 14 个、hooks/）、`apps/zcode-cli/packages/zcode-guide-plugin/`；zclaudia 现状：`plugins/agents/`（仅 claude/codex/cursor 三个 runtime 插件），办公/浏览器/自诊断技能全部缺失。
- **可搬运性**：直接移植（分档）：内容型技能包（superpowers 方法论、zcode-guide 诊断系列为 Markdown，superpowers 包声明 MIT 许可）改造 frontmatter 后即可作为 zclaudia 技能目录分发；bundled 双轨机制重写借鉴（zclaudia 已有插件技能加载通道，加一个 system 级 source 即可）。**注意**：ZCode 根仓库为 Apache-2.0（含 `NOTICE.md`、`THIRD-PARTY-NOTICES.md`），直接复制其文件需保留原许可声明与 NOTICE 归属；superpowers 包自带 MIT LICENSE 可单独引用。
- **体量估计**：superpowers 约 7.2k 行（多为 Markdown）；bundled-skills 约 3.5k 行；机制代码为 bootstrap 解析 + SEA 资产脚本。

### 2.3 Marketplace 分发闭环与 Claude 生态兼容

- **解决的问题**：插件从"哪里来"到"怎么装"的完整链路：市场源（git/GitHub archive 匿名 HTTPS/CDN zip 强制 sha256）、安装缓存（`~/.zcode/cli/plugins/cache/{marketplace}/{plugin}/{version}/`）、依赖闭包解析与跨市场依赖 allowlist、Claude Marketplace 插件的 `.claude-plugin/plugin.json` 三 manifest 兼容与能力降级诊断（不支持的能力"可识别、可展示、可诊断，不静默运行"），第三方 hooks 默认只解析不注入、过信任门后才启用。
- **证据路径**：ZCode 侧 `docs/claude-code-marketplace-plugin-compat.md`（分阶段 V1a/V1b/V1c/V2）、`docs/plugin-cdn-zip-source.md`（zip 源 schema：url/type/sha256/path/stripRoot）、`docs/plugin-github-archive-source.md`、`apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts`、`apps/zcode-cli/packages/adapters/src/plugins/zip-source.ts`。zclaudia 现状：`docs/plugin-packages.md`（本地 .zplugin 闭环，校验边界已很完整——ZIP 结构/CRC/符号链接/路径穿越/manifest schema/SHA-256），但 URL 安装、目录、签名元数据、无人值守更新明确未做（`docs/plugin-packages.md:54-57`）；无 marketplace 概念。
- **可搬运性**：重写借鉴。CDN-zip + sha256 的"物化"思路与 zclaudia 现有 .zplugin 校验边界天然同构，可作为"URL 安装"的第一步直接对齐；市场目录模型（marketplace 与 source 两轴分离、pluginId=`name@marketplace`）值得照抄语义。Apache-2.0 归属要求同上。
- **体量估计**：市场源解析 + 安装缓存 + 依赖解析约数千行（adapters/src/plugins 多个文件）；可分四期落地。

### 2.4 skills-lock.json：第三方技能的来源锁定与哈希校验

- **解决的问题**：把 GitHub 上的第三方技能 vendored 进仓库（`.agents/skills/`）时，用锁文件记录 `source`（owner/repo）、`sourceType`（github）、可选 `skillPath` 与 `computedHash`（sha256），使技能可溯源、可复现安装、可检测上游或本地篡改。ZCode 自身用它锁定了 `vercel-labs/agent-browser`、`vercel/ai-elements`、`vercel-labs/agent-skills` 等上游技能。
- **证据路径**：ZCode 侧 `/Users/zhvala/SourceCode/ZCode/skills-lock.json`（4 条记录）、`/Users/zhvala/SourceCode/ZCode/apps/zcode-cli/skills-lock.json`（3 条，含 skillPath）、`docs/vercel-react-best-practices-skill.md`（安装位置与边界说明）、`.agents/skills/` 目录。zclaudia 现状：缺失（仓库内无 skills-lock 或等价的技能来源清单）。
- **可搬运性**：直接移植。锁文件格式 25 行、纯 JSON；注意：仓库内未发现生成/消费它的代码（推测由外部 skills CLI 维护，见 unverified），移植时需决定"只采纳格式 + 自建校验脚本"还是引入同一外部工具。
- **体量估计**：极小（格式 + 一个校验脚本）。

### 2.5 外部 Agent 技能/插件一键导入（16 个来源）

- **解决的问题**：Claude Code / Codex / OpenCode / OpenClaw / Augment / Continue / Goose / Qwen / Qoder / Windsurf / Trae / Kiro / Roo / CodeBuddy 等竞品工具的本地 `skills/`、`plugins/` 目录被扫描枚举，用户勾选后以软链（Windows 用 junction）或复制方式导入 zclaudia 的 global/project 目录，同名跳过、结果按来源汇总计数——迁移成本近乎为零。
- **证据路径**：ZCode 侧 `docs/external-agent-skills-import.md`（来源范围 16 个、软链/复制策略）、`docs/external-agent-plugins-import.md`（manifest 优先级 `.zcode-plugin`→`.claude-plugin`→`.codex-plugin`，导入后追加 `plugins.dirs`）。zclaudia 现状：缺失（仅在测试数据里出现 `.codex/skills` 路径：`server/src/application/invocations/__tests__/catalog-differentiation.test.ts:67`，非导入功能）。
- **可搬运性**：直接移植。纯文件扫描 + 链接/复制 + 设置页向导；zclaudia 的技能目录约定不同（`.zclaudia` 数据目录），只需换目标路径与去重键。Apache-2.0 归属要求同上（若照抄文档级设计则只需思路注明）。
- **体量估计**：小到中（扫描器 + 导入对话框 + 设置页入口）。

### 2.6 Dynamic Workflow：模型写 TypeScript 程序编排多子代理

- **解决的问题**：宽 fan-out（"找每个 TS 文件的 bug"= 一个 glob + 一个 map）与固定流程（Programmer/Prover 循环到收敛）两类任务，用"模型写程序、harness 供严谨"取代对话式手拉子代理：单份 facade `.d.ts` 同时喂编译器与技能文档（防漂移）、TS strict 编译拒绝坏脚本、静态分析产出 site/因果/控制流/交接四图供确认窗预览、每个 facade 调用是带稳定 id 的 site、journal 全量落盘支撑 resume（同脚本重放）与 amend（新 run 导入旧结果作缓存）、子代理可 `escalate` 向主代理提问、共享 governor 从 provider 拒绝中学习真实限速、skill gate 强制先读技能再写脚本（428 业务码）。
- **证据路径**：ZCode 侧 `docs/dynamic-workflow.md`（总 spec）、`docs/dynamic-workflow/authoring.md`（facade/skill gate/编译选项）、`apps/zcode-cli/packages/dynamic-workflow/`（src 约 2.45 万行：analysis 1.36 万、engine 6.3 千、facade 866 等；tests 约 1.98 万行）、`apps/zcode-cli/packages/dynamic-workflow-runtime/`（约 5 千行，vm 沙箱子进程 + wire 协议）、`apps/zcode-cli/packages/bundled-skills/skills/dynamic-workflows/`。zclaudia 现状：有 automations/workflows domain 的预定义工作流（`server/src/domains/automations/service.ts`、`server/src/domains/workflows/`），无模型即席编程式编排。
- **可搬运性**：仅思路（全套）+ 重写借鉴（切片）。44k+ 行与 ZCode 的 journal、权限确认窗、限速器、时间线 UI 深度耦合，整体移植不现实；但其"facade 单一事实源 + 编译期校验 + journal 可重放"三原则，可先在 zclaudia 现有 workflow engine 上做一个最小"脚本化编排"切片（如：TS 脚本 + 子代理 ask + 人工确认，不含静态分析）。
- **体量估计**：全套约 5 万行（含测试）；最小切片约 2-3 千行。

### 2.7 node_repl 共享宿主 + Browser Use + CUA（计算机操控）

- **解决的问题**：给模型一个只有 `js` 一个工具的 JS 执行面（每次调用全新 Worker 内核、仅允许 node:* 内建与技能根下 file:// 导入），其上挂两个领域桥：Browser Use（显式 bootstrap `agent.browsers`，DOM 快照→locator→act 的 Playwright 工作流，支持桌面 IAB 与 CLI 托管 headless CDP 两种后端、`web-gui-tester` 纯 GUI 黑盒测试技能）与 Computer Use（无障碍树状态 + 栅格截图 + 点击/拖拽/滚动/按键，`get_app_state` 显式观察协议，主代理专用、禁子代理）。宿主独立成包的动机本身就是一条架构教训：能力共用面不能长在单个插件里。
- **证据路径**：ZCode 侧 `apps/zcode-cli/packages/node-repl-host/README.md`（宿主与双桥）、`apps/zcode-cli/packages/browser-use-plugin/README.md`（js 工具语义、双运行时、两技能）、`apps/zcode-cli/packages/zcode-cua-plugin/docs/computer-use.md`（CUA API 与 bootstrap 约定）、`apps/zcode-cli/packages/node-repl-host/src/`（browser-bridge/cua-bridge/cua-broker）。zclaudia 现状：缺失（无等价 JS 执行面与浏览器/桌面操控桥）。
- **可搬运性**：重写借鉴。`js` 工具 + 每调用全新内核 + 导入白名单的安全模型可直接采纳；浏览器桥依赖 ZCode 的 browser-client 与桌面 IAB 运行时，需按 zclaudia 桌面壳重写；CUA 依赖 macOS AX 桥（swift-bridge 包），工程量最大。
- **体量估计**：宿主约 2.8k 行 + browser-use 插件约 1.2k 行 + cua 插件约 2.1k 行，另有 ZCode 桌面侧运行时与 `packages/browser-client`（未计入）。

### 2.8 UI Plugin：MCP Apps 交互页面（Agent 与用户共编一份内容）

- **解决的问题**：工具结果不再只是文本卡片——插件可声明 `ui.surfaces` 侧栏面板与工具级 `_meta.ui.resourceUri`，页面经 MCP Apps 协议与宿主通信：Agent 调工具生成画布/表单/图表，用户直接操作后把选区"引用到对话"，页面可回调插件 MCP 服务、发送下一条消息、在插件界面内采样模型。Excalidraw 演示了"Agent 画初稿→用户改→Agent 按选区局部修改"的共编闭环（版本冲突检查、撤销/重做共享）。
- **证据路径**：ZCode 侧 `/Users/zhvala/SourceCode/ZCode/UI_PLUGIN.md`（能力表、Excalidraw 工具表、API 速查）、`/Users/zhvala/SourceCode/ZCode/UI_PLUGIN.en.md`；清单解析在 `apps/zcode-cli/packages/contracts/src/plugins/index.ts:160-181`（ui/uiSurfaces）。zclaudia 现状：有静态 UI 贡献（panels/uiExtensions/notchTabs，`shared/src/plugins/manifest.ts:218-223`），无 agent 驱动的交互页面协议。
- **可搬运性**：仅思路（短期）/重写借鉴（长期）。页面协议基于官方 `@modelcontextprotocol/ext-apps`（SDK 2.0.0），方向可跟随上游标准；但宿主侧加载、surface 管理、Gen UI 差异需要按 zclaudia 桌面架构重做。Apache-2.0 归属要求同上。
- **体量估计**：宿主侧页面加载/通信/状态保持估计数千行（本次未逐行统计）。

### 2.9 Bots：第三方聊天通道驱动同一套任务流

- **解决的问题**：把 Telegram / Weixin / Feishu / Lark / Webhook（DingTalk 规划中）变成 zclaudia 式任务入口：每个 bot 是完整访问实例（provider、凭据引用、单绑定 actor、workspace 白名单、命令策略、回复粒度）；`/bind <code>` 绑定、9 条命令（status/new/workspace/model/mode/think/cli/reply/stop）、普通消息等同输入框（草稿→建任务→续发）、权限/AskUserQuestion/Plan 审批回传到聊天、Feishu/Lark 用 Card JSON 2.0 流式卡片原地更新且交互卡片同步渲染为唯一权威写入、远程 workspace 断连时消息不执行只回提示、跨进程按 token/域+AppID 加心跳租约锁防双消费。架构上 BotsService（产品语义）与 channel runtime（provider 事件循环）分离。
- **证据路径**：ZCode 侧 `docs/bots.md`（v3 配置/绑定/命令/回复模式/卡片协议）、`docs/bot-channel-runtime-split.md`（三层 runtime 模块与不变量）、`docs/bots-feishu-group-collaboration.md` 等 6 篇子文档（本次未逐篇读）。zclaudia 现状：缺失（`server/src` 中无 telegram/feishu/lark/dingtalk 代码；有 notification-feed 但非双向通道）。
- **可搬运性**：重写借鉴。产品语义层（绑定、命令面、回复粒度、权限回传）与 zclaudia 的会话/权限模型可直接对应，是设计文档级别的可抄蓝图；通道 runtime 需按 zclaudia server 重写（Feishu SDK 懒加载、按批确认 offset、锁与租约这些不变量值得照搬）。注意 ZCode 文档明确 Feishu/Lark 走 BigModel/Z.AI 双域，属其商业环境细节。
- **体量估计**：按文档口径估计数千行（BotsService + 3 个 channel runtime + 设置 UI）；MVP（单通道 Telegram + 权限回传）约 1-2 千行。

### 2.10 Hooks 运行时闭环：7 事件 + 项目级信任门

- **解决的问题**：hooks 不只是配置——每个事件形成"配置可加载、matcher 明确、stdin/stdout 与 Claude Code 兼容、stdout 能影响 runtime、失败可观测、有独立测试"的闭环；workspace 级 hooks 走隔离发现 + 不可变摘要 + rollout gate + Trust 信任准入，未准入不产生可执行回调；`.agents/settings.json` 与 `.claude/settings.json` 只读展示并可显式导入；插件 hooks 随插件启停注入。
- **证据路径**：ZCode 侧 `docs/hooks-runtime-contract.md`（7 事件、状态所有权、合并规则）、`docs/plugin-hooks-compat.md`、`docs/settings-hook-list.md`；zclaudia 现状：`server/src/application/conversation/runtime/resolve-user-hooks.ts:10-30`（global+project 两层、JSON 存 DB、禁用/损坏条目丢弃）——已有钩子概念但无事件面、无插件来源、无信任门（zclaudia hooks 支持的事件类型本次未逐项核对，见 unverified）。
- **可搬运性**：重写借鉴。事件集合与 Claude 兼容的 stdin/stdout 契约可照抄语义；信任门机制（不可变摘要 + 显式 Trust）对 zclaudia 未来开放 workspace hooks 是安全前提，建议先于功能落地。
- **体量估计**：runner + 信任门 + 设置页估计 2-4 千行。

### 2.11 zcode-guide 自诊断技能 + plugin-creator/skill-creator 自举

- **解决的问题**：扩展体系自身的可支持性：五个 diagnosing-* 技能（plugins/skills/hooks/mcp/commands）把"插件不显示、技能不触发、hook 不执行、MCP 连不上、命令被遮蔽"排障流程写成技能；skill-creator/plugin-creator 让模型按规范创建新技能/新插件并配本地测试市场，"创建插件"入口只是预填官方 skill 引用的新任务草稿。
- **证据路径**：ZCode 侧 `apps/zcode-cli/packages/zcode-guide-plugin/`、`apps/zcode-cli/packages/skill-creator-plugin/`、`apps/zcode-cli/packages/plugin-creator-plugin/`、`docs/plugin-creator.md`（产品合同与搜索规则）。zclaudia 现状：缺失。
- **可搬运性**：直接移植（内容型，改造 frontmatter 与其中引用的配置路径/命令名即可）。Apache-2.0 归属要求同上。
- **体量估计**：每技能数百行 Markdown。

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

- **Agent Playground**：不启动完整应用即可调试单个 agent-runtime 插件（真实入口 + 环回 Dev Host + 独立 React UI + TS watcher 热重载 + 权限决策面板），`docs/agent-playground.md`；ZCode 侧未见等价独立调试面（其插件开发在独立 zcode-plugins 仓库 + plugin-eval-docker 评估，未确认有交互式 playground）。
- **多 Provider 运行时即插件**：agentRuntimes/agentProfiles + engineModes（cli 外部 / sdk 托管 LLM profile 双模）+ PCP capability manifest（chat.stream/tool.call/interaction.approval 等 14 项能力逐项声明降级），`plugins/agents/claude/plugin.json`；ZCode 的多 CLI 支持走外部导入 + 子代理路由，形态不同。
- **插件扩展工作流引擎**：`contributes.workflowSteps` 与 `contributes.triggerSources` 让插件为 workflow/automation 引擎提供步骤与触发源（`server/src/application/plugins/loader.ts:994-1032`）；ZCode 插件清单无此概念。
- **.zplugin 安装的完整版本治理**：inspect（不执行代码的静态校验）→ 15 分钟 token → install → 版本保留/回滚/卸载，失败自动回退目录交换（`docs/plugin-packages.md`）；ZCode 的安装缓存有版本目录但无同等显式的 inspect/rollback API 闭环（基于本次阅读范围）。
- **invocations catalog 对 provider 原生命令/技能的统一抽象**：稳定哈希 id、会话冻结快照、指纹绑定（`server/src/application/invocations/catalog-service.ts:13-27`）。

## 4. 不建议搬运的（及原因）

- **Dynamic Workflow 全栈直接搬运**（约 5 万行含测试）：与 ZCode 的 journal、确认窗、governor、时间线 UI、bundled skill gate 深度耦合，且 zclaudia 已有 automations/workflows 引擎，双轨并行会分裂心智。只借鉴"facade 单一事实源 + 编译期校验 + journal 重放"原则做最小切片。
- **Claude Marketplace 兼容的高权限部分**（第三方 marketplace hooks 注入、跨市场依赖放行、auto-update daemon）：ZCode 自己也将其放在 V1b/V1c/V2 并要求显式信任门；zclaudia 若做，应沿用"先诊断后信任门"而非一步到位。
- **Bots 的历史配置迁移链**（bot-config v1/v2/v3、bots-model-cache 废弃路径）：只搬 v3 语义与 channel runtime 不变量。
- **superpowers 整包作为方法论默认**：其 subagent-driven-development/TDD 流程强假设宿主有子代理与 plan 审批语义，zclaudia runtime 能力面不同；先按内容型技能移植其中通用部分（brainstorming/writing-plans/verification-before-completion），验证触发效果后再考虑 hook 注入。
- **UI Plugin 立即跟进入生产**：依赖 MCP Apps SDK 具体版本（页面 SDK 2.0.0 / MCP 1.29.0）且仅桌面本地工作区支持，上游标准仍在演进；建议先以 Gen UI/静态面板承接需求，待协议稳定再做宿主。
- **skills-lock 的外部工具链依赖**：锁文件格式可直接采纳，但 ZCode 仓库内无生成/消费代码（推测外部 CLI 维护，未确认）；zclaudia 若无意愿引入该第三方工具，应自建最小校验脚本而非空搬格式。

## 附：证据与覆盖说明

- 本报告所有 ZCode 侧路径均在 `/Users/zhvala/SourceCode/ZCode` 下实际读取；zclaudia 侧路径均在 `/Users/zhvala/SourceCode/zclaudia` 下实际读取或 grep 验证。
- 体量数字来自 `find … | xargs wc -l` 实测（dynamic-workflow src 44,312 行含 testing 1,619 行、tests 19,761 行；runtime 4,972；node-repl-host 2,816；browser-use-plugin 1,165；zcode-cua-plugin 2,124；superpowers-plugin 7,212；bundled-skills 3,495）。

## 5. 独立复核记录

> 复核日期：2026-10-16。复核员与探索员无共享上下文，逐条亲自打开证据文件核对；以下 path:line 均为本次实际读取。ZCode 侧路径省略前缀 `/Users/zhvala/SourceCode/ZCode/`。

- ✅ 插件清单资产广度（P1）：`PluginManifest` 的 agents/channels/commands/dependencies/hooks/lspServers/mcpServers/outputStyles/settings/skills/ui/userConfig 与 `PluginLoadOutcome`、`PluginStoreListing`（多语言/hero 图/示例提示词/requiresPaidPlan）逐字段相符（contracts/src/plugins/index.ts:142-164、:272-281、:115-140）；zclaudia 侧 `shared/src/plugins/contributions.ts:139-161` 确无 mcpServers/agents/outputStyles/userConfig/ui.surfaces，`hooks?: HookContribution[]`（contributions.ts:144）虽存在类型声明但无任何运行时消费者（server loader grep 零命中），报告"缺 hooks"在运行时语义上成立。
- ✅ Marketplace 分发闭环与 Claude 生态兼容（P1）："可识别、可展示、可诊断，不静默运行"与第三方 hooks 默认只解析待信任门（docs/claude-code-marketplace-plugin-compat.md:8、:31-32、:250-251）；zip 源 schema url/type/sha256/path/stripRoot 且 sha256 必填、校验先于解压（docs/plugin-cdn-zip-source.md:40-66、:223-225）；实现属实：marketplace.ts 的 add/update/remove/install 与依赖闭包 + 跨市场 allowlist（adapters/src/plugins/marketplace.ts:400/:699/:742/:790、resolveDependencyClosure :1268、allowCrossMarketplaces :1275-1285），zip-source.ts 与 github-archive-source.ts 均存在。
- ✅ Bots（P1）：Webhook 可用、DingTalk 仅为 coming-soon（docs/bots.md:82）、/bind 单绑定（:64）、status/new/workspace/model/mode/think/cli/reply/stop 九条命令均列出（:86-105，另有 /reconnect 等别名）、权限/AskUserQuestion/Plan 审批单交互消息（:78）、Feishu/Lark streaming_card + Card JSON 2.0（:34、:78）、远端断连不执行只回提示（:22）；跨进程锁按 token（Telegram/Weixin，docs/bot-channel-runtime-split.md:16、:20）与域+AppID（Feishu/Lark，:27）+ 心跳租约（:37），BotsService 与 channel runtime 分层（:3-6）；运行时代码实际存在（packages/services/src/bots/telegramChannelRuntime.ts、weixinChannelRuntime.ts、feishuChannelRuntime.ts、botsService.ts），zclaudia `server/src` grep telegram/larksuite/dingtalk 零命中。
- ✅ Dynamic Workflow（P2）：模型写 TS 程序编排多子代理、facade .d.ts 同时喂编译器与文档、site/因果/控制流/交接四图、journal 全量落盘支撑 resume/amend、escalate、共享 governor 从拒绝学习限速，均与 spec 相符（docs/dynamic-workflow.md:10-16、:63-65、:74-77、:92-101）；skill gate 428 业务码与 strict 编译（docs/dynamic-workflow/authoring.md:42、:95）；实测 `dynamic-workflow/src` 24,551 行、`dynamic-workflow-runtime` 全包 4,972 行，四图渲染器在 dynamic-workflow/src/projections.ts:96-101。
- ✅ node_repl 共享宿主 + Browser Use + CUA（P2）：单 `js` 工具、每调用全新内核、导入仅限 node:* 内建与技能根下 file://（browser-use-plugin/README.md:8-9）、Playwright DOM 快照→locator→act 与桌面 IAB/CLI headless CDP 双后端（:14、:16）、control-browser/web-gui-tester 两技能（:14-15）；CUA 主代理专用禁子代理、get_app_state 显式观察（zcode-cua-plugin/docs/computer-use.md:15、:162）；宿主独立包动机与 browser-bridge/cua-bridge/cua-broker 源文件（node-repl-host/README.md:8-16、src/ 目录）均属实；zclaudia 无等价执行面。
- ✅ 官方插件生态 + bundled 双轨（P1）：bundled 层不进商店、无开关、不可卸载、SEA 按内容哈希解压到 `~/.zcode/cli/bundled-skills/<content-hash>/`（bundled-skills/README.md:7-9、:21-23）；superpowers 恰 14 个技能且 hooks/hooks.json:3-14 为 SessionStart（matcher startup|clear|compact）；zcode-guide 含 5 个 diagnosing-*（plugins/skills/hooks/mcp/commands）+ zcode-configuration-guide；官方插件包实数 15 个（packages/ 目录清点）。
- ✅ skills-lock.json（P2）：根锁文件 4 条记录含 source/sourceType/computedHash（skills-lock.json:4-24），cli 锁文件 3 条含 skillPath（apps/zcode-cli/skills-lock.json:4-22），vercel 文档确认 `.agents/skills/` 安装位置（docs/vercel-react-best-practices-skill.md:13-19）；全仓库代码文件 grep "skills-lock" 零命中，证实报告"无生成/消费代码"的推断；zclaudia 无等价锁文件。
- ✅ 外部 Agent 技能/插件一键导入（P2）：技能导入恰 16 个来源、软链（Windows junction）/复制、同名跳过、按来源汇总计数（docs/external-agent-skills-import.md:11-26、:37-43）；插件导入 manifest 优先级 `.zcode-plugin`→`.claude-plugin`→`.codex-plugin` 并追加 `plugins.dirs`（docs/external-agent-plugins-import.md:32-35、:42-43；注意插件侧来源为 15 个、无 Trae CN，报告"16 个"锚定技能文档，成立）；zclaudia 侧 `external-agent-shim.ts` 为 provider 上下文适配器而非导入功能，报告引用的测试行 `catalog-differentiation.test.ts:67` 精确。
- ✅ Hooks 运行时闭环（P2）：恰 7 事件、process/command 双类型、workspace 隔离发现 + 不可变摘要 + Trust 信任门未准入不产生可执行回调、`.agents`/`.claude` 只读展示可导入、插件 hooks 随启停注入、stdin 与 Claude Code 兼容（docs/hooks-runtime-contract.md:9-17、:23-26、:38-42、:64-65、:74、:20；docs/plugin-hooks-compat.md 信任边界节）；zclaudia 现状引用相符（server/src/application/conversation/runtime/resolve-user-hooks.ts:11-34：global+project 两层 DB 配置、禁用/损坏条目丢弃）。

复核结论：9/9 条通过，0 条不通过。两处措辞级备注（不构成不通过）：条目 1 中 zclaudia 清单类型层存在未被消费的 `hooks` 死字段；条目 8 中插件导入来源为 15 个（技能导入才是 16 个）。
