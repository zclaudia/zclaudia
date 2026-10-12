# ZCode 功能对比重评估（2026-10-12）

承接 [2026-09-23-zcode-feature-comparison.md](2026-09-23-zcode-feature-comparison.md)。工具集部分见 [2026-10-12-zcode-tool-set-reassessment.md](2026-10-12-zcode-tool-set-reassessment.md)。

基线：ZCode aac47556（v3.15.1，2026-10-10），上次是 872ad960（v3.14.0）；zclaudia 84bc2976，上次是 c88ac8cb，期间 85 个 commit。
路径：`Z:` = `~/Code/ZCode`，`C:` = `apps/desktop/src`。其余相对本仓库根。
核实方式：六个子代理分头读源码。标「已复核」的条目由主会话再读过代码，其余沿用子代理给的证据路径。

推荐度沿用上次：★★★ 缺口明显且收益直接；★★ 有价值但要取舍；★ 可做可不做。

## 0. 先读这个

**上次的前提变了。** 上次 ZCode 是脱敏导出，只有 2 个 commit。现在它带上了 docs（约 2235 个文件）、测试（约 3180 个单测文件、约 1216 个 E2E 文件）、`specs/`、`.husky`，以及 15 个内置插件包。「ZCode 没有测试 / CI / 插件内容」这类判断作废；`.gitlab-ci.yml` 仍没导出，CI 只能读文档。

**上次对 zclaudia 现状的判断错了不少。** 以下条目被写成「无」，实际早就有：

| 项                                 | 实际                                                                                                             | 证据                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Steer 进行中的 turn（★★★）         | 2026-06-30 起有：队列项「Steer now」，发 `run_steer`                                                             | `C:features/chat/SendQueueBar.tsx`；`server/src/application/conversation/handlers/run.ts:256-340` |
| 架构门禁（★★★）                    | 仓库第一个 commit 起就有                                                                                         | `scripts/dev/check-architecture-boundaries.mjs`，`package.json:26`                                |
| 上下文用量分解（★）                | 2026-06-12 起有：系统提示 / 工具 / skills 分项、缓存命中、逐调用时间线                                           | `C:features/chat/ContextUsageCard.tsx`                                                            |
| AI commit message（★★）            | 2026-05 起有                                                                                                     | `C:features/git/components/GitStatusView.tsx:81`                                                  |
| 权限 `prefix:*` + 会话级允许（★★） | 有 `Tool(glob)` 规则语法与两级记忆，比前缀规则更强                                                               | `shared/src/interaction/tool-rule-syntax.ts`；`PermissionModal.tsx:268-291`                       |
| 计划审批反馈（★）                  | 驳回理由作为 `plan_rejected` 工具结果回给模型，功能等价                                                          | `server/src/infra/providers/pi-runtime/mode-tools.ts:239`                                         |
| 模型重试与失败分类（★）            | 有首 token 前安全重试（5 次、1s 到 60s、抖动、retry-after 优先）与 overflow 恢复；缺稳定错误码与 stream 空闲超时 | `retry-stream.ts`                                                                                 |
| 重连 / 可回放语义（★★）            | 有等价机制，形态不同（见 §4）                                                                                    | 见 §4                                                                                             |
| Run owner / lease（★★）            | 作废：zclaudia 每个 session 只有一个 owner backend（带 `ownershipVersion`），不存在多 host 抢同一 task           | `server/src/server.ts:380-388`                                                                    |
| CronCreate（★★）                   | 2026-09-23 已补                                                                                                  | `pi-runtime/automation-tools.ts`                                                                  |

## 1. 先处理的三件卫生问题

> 处理进展：**1.1 已修**（3 条违规已清除，`check:architecture` 已加到 `ci.yml` 的 lint job 最前面）；**1.3 已出方案**，见 [plugin-frontend-origin-isolation-plan](../plans/2026-10-12-plugin-frontend-origin-isolation-plan.md)，未实现；1.2 未处理。（不是对标项）

调研过程中发现的、与 ZCode 无关但应该先处理的问题，均已复核。

1. **主干架构门禁是红的，且没接进主 CI。**
   `bash scripts/with-project-node.sh node scripts/dev/check-architecture-boundaries.mjs` 当前报 3 条违规：
   - `server/src/infra/providers/pi-runtime/cache-trace.ts` → `server/src/domains/usage/cache-trace-repository.ts`（infra 到 domains）。
   - `apps/desktop/src/features/chat/BackgroundTaskChip.tsx` → `features/task-center`。
   - `apps/desktop/src/features/task-center/TaskDrawer.tsx` → `features/chat`。

   后两条是任务中心引入的跨 feature 互相依赖。`pnpm check:architecture` 只在 `.github/workflows/builtin-agent-runtimes.yml` 里跑，`ci.yml` 没有。
   建议：清掉 3 条违规（或显式进 allowlist 并写理由），再把检查加进 `ci.yml` 的 lint job。

2. **直连 WebSocket 的 `auth` 消息不校验凭据。** `server/src/server.ts:365-370`：未认证 client 只要发一条 `type: 'auth'` 就被置为 `authenticated = true`。默认只绑 127.0.0.1，且本机连接另有 `isLocal`，风险有限；但设了 `ZCLAUDIA_ALLOW_LAN=1` 后，局域网内任何人都能直接连上并拿到全部权限。gateway 路径有凭据分级与 30 秒一次性 ticket，缺口只在直连口。
   建议：非回环绑定时强制 token，复用 gateway 的 ticket 机制。
3. **插件面板 iframe 同源且带 `allow-same-origin`。** `C:components/plugins/PluginPanelRenderer.tsx` 的 iframe 用 `sandbox="allow-scripts allow-same-origin allow-forms"`。浏览器壳模式下 `src` 的 base 取 `window.location.origin`（`utils/browserShellRuntime.ts:13`），即与主应用同源，插件前端可以直接操作 parent，沙箱等于没有。桌面 Tauri 模式 origin 不同，风险小一些。
   建议：浏览器壳模式下给插件前端单独的 origin，或去掉 `allow-same-origin`。

## 2. 运行时与会话内核

| 项                             | 上次       | 现在 ZCode                                                                                                                                                                      | 现在 zclaudia                                                                                                                                                | 判定                                                           |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 工作区文件 checkpoint / rewind | ★★★        | 每 turn 文件 checkpoint；预览 safe / unsafe 后整体回滚；多文件写入有补偿 journal。**消息级 cascade rewind 的 UI 已于 2026-06 下线**，改为 editUserQuery、retryTurn 加文件级撤销 | 每次 Edit / Write / Patch 有备份（每文件 20 份、7 天）；工具卡片有单文件 Restore；RenameSymbol 可逐文件还原。没有 turn 级聚合、外部改动预检，Bash 改动不覆盖 | 部分关闭，**降为 ★★**。ZCode 自己也放弃了消息级 rewind，不必追 |
| pending-command 恢复           | ★★★        | 前端 `pendingCommandRegistry` 对账，依赖 v4 协议的命令账本                                                                                                                      | 无账本；发送队列只在内存，会话必须挂载才会 drain                                                                                                             | 仍缺。账本等协议层重构时再做                                   |
| 队列暂停 + Continue            | ★★         | 停止或报错后队列挂起；可编辑、拖动排序                                                                                                                                          | `useSendQueueConsumer` 在任意 idle 转换后都发下一条，**报错或取消后也继续发**；只有 Steer 与删除                                                             | **仍缺，升为 ★★★**（报错后乱发是行为问题，不只是缺功能）       |
| Microcompact                   | ★★         | 已落地：清旧工具结果保留最近 5 条；空闲 60 分钟或 0.9 阈值触发                                                                                                                  | 仍只有摘要式压缩；熔断已有                                                                                                                                   | 仍缺 ★★。可与 prompt-cache 追踪联动，在缓存过期点清理          |
| Headless `-p` + stream-json    | ★★         | 仍是单轮 deny-all；新增 `--target` 与 workflow 模式                                                                                                                             | 仍无 CLI 入口                                                                                                                                                | 仍缺 ★★                                                        |
| Trajectory 查看器              | ★★         | 有完整设计 `docs/model-trajectory-viewer.md`                                                                                                                                    | 有缓存指纹与逐调用 miss 分类，无原始模型 I/O                                                                                                                 | 仍缺，性质不同，与 cache 时间线互补 ★★                         |
| Dynamic workflow               | ★          | 已是完整子系统（类型检查、数据流分析、journal 可恢复、amend / retune）                                                                                                          | 图式 workflows + meta-workflow                                                                                                                               | 差距扩大但路线分歧，需产品决策                                 |
| Auto 权限模式                  | 声明未实现 | `service.ts:157` 仍返回 `mode.auto.unimplemented`                                                                                                                               |                                                                                                                                                              | 旧结论成立                                                     |

**ZCode 新增而 zclaudia 没有：**

| 项                                     | 是什么                                                                                                                                                                                                                                                                                                | 推荐度 | 建议                                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **后台任务完成后空闲唤醒**             | 父 turn 结束后，子代理或 Bash 完成会自动触发一次 model-only turn；命令队列带优先级，同类通知按快照批量合并，至多一次消费（`docs/cli-background-subagent-wake-plan.md`、`apps/zcode-cli/docs/design/v2/loop/runtime-command-queue-plan.md`）。注意 `docs/agent-background-subagent-join.md` 是废弃方案 | ★★★    | **借**。zclaudia 的 `task-settlement-notifier.ts` 只处理 `command`，run 存活时 steer 注入，否则进内存队列等下次 run；Agent 子代理靠 `TaskOutput` 轮询。goals 域已有 `ContinueTurnPort.appendAndRun`，接口现成；goal 的 verifier 延后判定可并入 |
| 输出 token 截断自动续写                | `turn-output-token-continuation.ts`，最多 3 次                                                                                                                                                                                                                                                        | ★★     | 借，成本小；与 stream 空闲超时、稳定失败码一起做                                                                                                                                                                                               |
| Hooks 事件扩展                         | SessionStart、UserPromptSubmit、Stop，兼容 Claude 的 stdin / 退出码语义                                                                                                                                                                                                                               | ★★     | 借事件；trust 层降为 ★（见 §5）                                                                                                                                                                                                                |
| `/btw` 旁路提问                        | 复用主请求前缀、禁用工具、不写入主对话                                                                                                                                                                                                                                                                | ★★     | 待定，先摸清 prompt-cache 前缀复用接口                                                                                                                                                                                                         |
| 项目记忆自动化（后台抽取、dream 整理） | `core/src/memory/*`                                                                                                                                                                                                                                                                                   | ★      | 待定；token 成本与隐私面都大，ZCode 自己也关了语义召回                                                                                                                                                                                         |

## 3. 桌面端产品 UI

| 项                                     | 上次 | 现在 ZCode                                                                              | 现在 zclaudia                                          | 判定                                                         |
| -------------------------------------- | ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| 命令中心                               | ★★   | Cmd+K 含动作、最近改动、最近任务                                                        | `SearchModal` 只搜消息与文件，无动作                   | **差距扩大** ★★                                              |
| 可重绑快捷键 + 会话内 Cmd+F            | ★★   | 24 个命令可改、冲突检测；会话内查找（高亮、流式追加、兼查 diff）                        | 只有硬编码的 Ctrl+\` 与 Cmd+P，无会话内查找            | **差距扩大** ★★。三者共用一张命令表，一起设计                |
| 选中文本 chip / side chat              | ★★   | 有，另有 `/side`、`/btw`                                                                | 无                                                     | 仍缺 ★★                                                      |
| 浮动状态面板                           | ★★   | Git / Goal / Progress / Run                                                             | Todo 浮层 + 后台任务中心 + 子代理抽屉                  | 基本关闭；Git、Goal 未汇入                                   |
| 每 turn 改动摘要                       | ★    | 有，可文件级撤销并预检                                                                  | 有 AI 摘要与 Changes 面板，无逐文件撤销                | 部分；随 turn 级文件撤销一起做                               |
| 导入                                   | ★★★  | **会话导入只支持 Claude Code**；Codex / OpenCode 只导 skills / MCP / commands / plugins | 无                                                     | 仍缺，**范围比上次写的窄**，降为 ★★                          |
| Task group / 未读 / 自动归档           | ★★   | 7 色分组、`unreadAt`、自动归档、置顶                                                    | 无分组；`archivedAt` 有类型，UI 入口未核实             | 仍缺 ★★                                                      |
| 切分支脏树辅助                         | ★★   | 检测会被覆盖的文件，提示先提交                                                          | 仅 `confirm` 警告（`GitBranchesView.tsx:46`）          | 仍缺 ★★                                                      |
| Git graph、文件树 git 着色、Mermaid    | ★    | 有                                                                                      | 无（Mermaid 已确认无）                                 | 仍缺 ★                                                       |
| 任务前进后退、Prompt enhance、队列拖拽 | ★    | 有                                                                                      | 无                                                     | 仍缺 ★                                                       |
| i18n                                   | ★★★  | en-US 7395 行 + zh-CN 7039 行                                                           | 无                                                     | 仍缺，**越晚越贵**；但属产品决策，不是工程债，见 §6          |
| DESIGN.md 字号档位                     | ★★   | `text-ui-*` 六档强制                                                                    | 只有颜色 / 字体 / 图标 / 行规范；`radius` 已有机器检查 | 仍缺 ★★。照 `check-radius-conventions.mjs` 做 font-size 检查 |

**ZCode 新增 UI 能力（值得借的）：**

| 项                          | 说明                                                                | 推荐度           |
| --------------------------- | ------------------------------------------------------------------- | ---------------- |
| 输入框 ↑ / ↓ 历史           | `docs/ui/composer-prompt-history.md`；成本很低                      | ★★               |
| 长文本粘贴转附件            | `docs/ui/chat-long-paste-text-attachment.md`                        | ★                |
| `::code-comment` 审查卡片   | 点击打开只读 viewer 并定位行；与我们的 local-pr 和 LSP 查看器衔接好 | ★★               |
| Turn 导航 rail              | 长会话跳转                                                          | ★★，待定         |
| 窗口缩小自动收起右栏 / 侧栏 | 我们的多卡片布局更需要                                              | ★                |
| Gen UI / MCP Apps           | 见 §5                                                               | ★★，待做设计评估 |

**不借：** Highspeed 动效、marketing / rewards / Coding Plan 计费、cloud-content、会话分享页、白板、PPTX、workflow 时间线（我们工作流是图式）。

## 4. 远程、移动与传输

| 项                            | 上次 | 现在                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 判定                                                                                                         |
| ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 可回放流语义                  | ★★   | ZCode 基本没变（订阅带 seq 与 logEpoch，缓冲 500 ops / 1 MiB，超限发 snapshot）。zclaudia **有等价机制**：持久化消息 offset 加 `afterOffset` 追补（`message-repository.ts:108`、`ws-hub.ts:37`）、`state_heartbeat` 带 `activeRuns[].lastSeq` 与 pending 权限 / 提问（`broadcast.ts:75-135`）、`messageVersion` 补漏、backend epoch 与 transport generation、恢复状态机 opening_stream → catching_up → hydrating_tail → live（`recoveryStore.ts`）、前后台切换触发 `forceReconnect` | **大部分关闭**。不应再按「完全缺失」推荐。短板：run 内增量流没有重放缓冲                                     |
| Run owner / lease             | ★★   | 作废（见 §0）                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 作废                                                                                                         |
| 权限请求来源徽章              | ★★   | ZCode 的徽章只对子代理来源渲染，没有「手机」来源；上次写法不实                                                                                                                                                                                                                                                                                                                                                                                                                      | 作废。zclaudia 有 `permission_resolved`（其他设备已处理）                                                    |
| 特权连接 ticket               | ★    | 直连口缺认证（§1.2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **升 ★★**，且应拆开看：gateway 路径已有一次性 ticket，缺口在直连口                                           |
| SSH / WSL / Docker 远程工作区 | ★★   | 不变                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 仍缺，但 zclaudia 的路径不同（目标机常驻 server + gateway，多 backend 是一等公民），降为 ★；除非出现明确需求 |
| 远程资源同步                  | ★    | 不变                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 不借：每个 backend 自管资源                                                                                  |
| Headless `-p`                 | ★★   | 见 §2                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 仍缺                                                                                                         |

**ZCode 新增：**

| 项                                                      | 说明                                                                                                                                                                                                     | 建议                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bots 渠道（飞书 / Lark、Telegram、微信 iLink、webhook） | `packages/services/src/bots/`（44 个文件）；一个 bot 绑定一个私聊用户，`/bind <code>` 配对，工作区白名单与命令白名单；飞书走流式卡片，权限和提问以卡片回复。三家均为出站长连接或长轮询，不需要公网入站口 | ★ 待定，倾向不进核心。我们已有 ntfy 推送与出站 webhook，覆盖了大半「离开电脑被通知」；若做，做成插件，限定「通知 + 审批回执」。可借细节：出站请求截止时间覆盖响应体、回调 3 秒 ACK 后降级为新消息、runtime 锁带心跳租约 |
| Web 远控（经官方 relay，二维码配对）                    | relay 闭源、官方托管                                                                                                                                                                                     | 不借 relay。**借二维码 / deep link 配对**：手机端目前要手填 gateway URL 与 secret（`MobileSetup.tsx`），★★                                                                                                              |
| Android 壳                                              | WebView + 扫码 + 前台服务，只开官方 `/remote` 域                                                                                                                                                         | 不借；我们的 Tauri Android 是完整客户端                                                                                                                                                                                 |
| zcode-server-cli                                        | serve / update / 崩溃预算 / systemd 注册                                                                                                                                                                 | ★，待定，有无头部署需求再做                                                                                                                                                                                             |
| 统一分发                                                | 同一 `zcode` 命令；tar.gz + `install.sh` + `latest.json`                                                                                                                                                 | ★★。借「server + 浏览器壳打成单包 + 安装脚本」，TUI 不借                                                                                                                                                                |

## 5. 插件与生态

| 项                       | 上次 | 现在 ZCode                                                                                                                                                        | 现在 zclaudia                                                                                                                                                | 判定                                                                                         |
| ------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 插件商店                 | ★★★  | 已成体系：官方市场由内置插件和 CDN 插件（sha256 zip）组成；支持 github 归档；Public / Personal 两段；Featured 由远程目录控制；内置插件可恢复；Example Prompt 预填 | 仍只有本地 `.zplugin`；`docs/plugin-packages.md` 自己写明「目录发布者固定、签名元数据、URL 安装」是后续工作                                                  | 缺口未变且更明确。**先做目录与来源，UI 分段留到有内容之后**                                  |
| CONTEXT.md 词汇表        | ★★★  | 仍在，头部声明「商店术语唯一裁决来源」，每条带 Avoid                                                                                                              | 无                                                                                                                                                           | 降为 ★★：成本极低，但对我们的价值在于遏制插件 / runtime / agent profile 术语漂移，而不是商店 |
| Workspace hook trust     | ★★   | 已实现一整套                                                                                                                                                      | zclaudia 的 user-hooks 只存数据库，不读仓库文件，不存在「仓库自带 hook 被执行」的攻击面                                                                      | **降为 ★**。引入仓库级 hooks 或兼容 Claude 插件 hooks 时再做                                 |
| Skills 从其他 agent 导入 | ★★   | 文档列出 16 个来源                                                                                                                                                | 部分具备：已扫 `~/.zclaudia/skills`、`~/.agents/skills`，且有 `skill_extra_dirs` 手填；没有 `~/.claude/skills`、`~/.codex/skills` 自动发现，也不扫项目级目录 | 缺口缩小，仍 ★★，成本低                                                                      |
| 插件脚手架               | ★    | 现为内置 `plugin-creator` 插件（scaffold + validate + dev marketplace）                                                                                           | 无；manifest 校验已有                                                                                                                                        | 升 ★★，投入小                                                                                |
| skills-lock.json         | ★    | 只锁 3 个开发期 skill                                                                                                                                             | 无 vendored skill                                                                                                                                            | 不借                                                                                         |

**ZCode 新增（上次是空壳或未覆盖）：**

| 项                                                                | 说明                                                                                                                                                                                                                                                                                                                        | 推荐度 | 建议                                                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude marketplace 兼容**                                       | 读 `.claude-plugin/marketplace.json`，来源支持 github / git / url / git-subdir；清单探测顺序 `.zcode-plugin` → `.claude-plugin` → `.codex-plugin`；落地 skills、commands、`.mcp.json`、非敏感 userConfig；hooks 仅官方来源运行；agents / LSP / outputStyles 只记录不执行（`docs/claude-code-marketplace-plugin-compat.md`） | ★★★    | **借，生态杠杆最高**。我们已有 skills 与 `McpServerConfig`，只需一个只读的声明式导入适配器；顺手把 `~/.claude/skills`、`~/.codex/skills` 加进 well-known 目录 |
| plugin-creator / zcode-guide                                      | 创作脚手架；6 个诊断 skill                                                                                                                                                                                                                                                                                                  | ★★     | 借：做一个 zclaudia 自诊断 skill 与插件创作 skill，没有内容商店是空的                                                                                         |
| Gen UI（visualize）                                               | 模型写 HTML，桌面端在对话内 webview 渲染并可交互                                                                                                                                                                                                                                                                            | ★★     | 借轻量版，复用现有插件 iframe；**前提是先解决 §1.3 的沙箱问题**                                                                                               |
| MCP Apps / 插件 UI                                                | 官方 ext-apps 2.0.0，合同 1200 多行                                                                                                                                                                                                                                                                                         | ★      | 暂不借，我们的 iframe + postMessage 面板够用                                                                                                                  |
| android-emulator / ios-simulator 插件                             | 内置 MCP server（构建、运行、截图、UI 自动化）                                                                                                                                                                                                                                                                              | ★★     | 待定。前提是先定「插件自带 MCP server」是否纳入 `contributes`                                                                                                 |
| superpowers 5.1.0、documents / pdf / spreadsheets / presentations | 流程 skill 与办公 skill 包                                                                                                                                                                                                                                                                                                  | ★      | 不内置；将来可作为目录里的内容                                                                                                                                |
| zcode-cua                                                         | 插件层已有；宿主侧 `packages/zcode-cua` 仍是 fail-closed 占位                                                                                                                                                                                                                                                               |        | 不借，Computer Use 实际不可用                                                                                                                                 |

zclaudia 在这一层的优势：插件权限模型（14 项权限分 4 级、逐插件授予，ZCode 只靠官方 / 第三方来源信任）；插件可贡献 `agentRuntimes`、`agentProfiles`、`workflowSteps`、`triggerSources`、`tools`、`lspServers`；`.zplugin` 的 zip 安全校验、sha256、多版本回滚；受管运行时（`docs/managed-runtimes.md`）；skill 的 fork / inline 执行与条件路径激活。

## 6. 工程实践

| 项                                             | 上次 | 现在 ZCode                                                                                             | 现在 zclaudia                                                              | 判定                                               |
| ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------- |
| 架构门禁                                       | ★★★  | `architecture-policy.yaml` 26 个模块，仅 10 个 `managed:true`，baseline 违规数为 0，实际主要保护新模块 | **已有**，覆盖全部现有 server 与 desktop 代码；但主干红、未进主 CI（§1.1） | 上次误判；降为 ★，改做 §1.1                        |
| i18n                                           | ★★★  | en-US + zh-CN 约 14.4k 行                                                                              | 无                                                                         | 缺口属实，但是产品决策                             |
| check-workspace-freshness                      | ★★   | 94 行脚本；落后自己的 upstream 就失败                                                                  | 无                                                                         | ★★，约 90 行，多 worktree + agent 并行场景有价值   |
| 400 行文件上限                                 | ★    | oxlint `max-lines` 400                                                                                 | 无上限；`.ts` / `.tsx` 超 1000 行的有 40 个                                | 升 ★★：eslint `max-lines` 加棘轮，存量进 allowlist |
| knip / dep-refs                                | ★    | `knip.json`、`scripts/dep-refs.mjs`                                                                    | 无                                                                         | knip 升 ★★（先 report 模式），dep-refs 不借        |
| formal-proof                                   | ★★   | 独立包，穷举对话状态空间                                                                               | 无                                                                         | 降 ★：需要先有 E2E case catalog                    |
| feature-boundary-planner、第三方声明、API stub | ★    | 有                                                                                                     | 有 `.superpowers/sdd` + `docs/plans`；无 NOTICE                            | 维持 ★ / 不借                                      |

**ZCode 新暴露的做法：**

| 做法                                                                                                                                                                  | 推荐度 | 建议                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| E2E 的 provider replay fixture（录制回放模型输出，对话 E2E 可复现、不烧 token；`packages/desktop/test/e2e/`、`scripts/audit-conversation-session-case-coverage.mjs`） | ★★     | 借。我们是 Playwright + vitest，不借 WDIO                      |
| AGENTS.md 写法（读取条件表、先 spec 后实现、调查类请求默认只读、完成条件、场景验收表）                                                                                | ★★     | 借写法。我们的 CLAUDE.md 只有结构与命令，没有行为规范          |
| pre-push：lint → `architecture:check --changed` → 受影响单测                                                                                                          | ★★     | 待定。我们只有 pre-commit 守卫，CI 做全量                      |
| `.agents/skills`：architecture-governance、e2e-case-lifecycle、dogfood、zcode-large-task-fixture                                                                      | ★★     | 借 architecture-governance 的设计检查单和 dogfood（探索式 QA） |
| docs/working-memory、docs/superpowers（上百份 spec / plan）                                                                                                           | ★      | 不借；我们已有等价物且体量小得多                               |
| GitLab 发布链路（approve → validate → upload → preload → publish 灰度）                                                                                               | ★      | 不借，绑定内部 OSS / CDN / 灰度 API                            |

zclaudia 的工程优势：lint / format 清零并全量门禁；专项检查（`check-react-lifecycle-invariants.mjs`、`check-radius-conventions.mjs`）；`builtin-agent-runtimes.yml` 的 deterministic / artifact / gateway / live 四层；`docs/quality-audit/` 55 项可审计治理；pnpm 12 + 项目 Node 守卫；E2E 覆盖 local / remote / gateway 三种模式。

## 7. zclaudia 这段时间的新优势（上次没有）

- **LSP 全套**：随包 TS / Pyright、用户与插件自定义 server、写后诊断、LSPTool、RenameSymbol、查看器问题标记与 Check types。ZCode 没有。
- **Prompt cache 追踪**：逐调用 trace、miss 分类、provider 前缀保持、Home Cache tab。ZCode 只有命中率聚合。
- **后台任务中心 + 子代理一等任务**：header pill、完成 toast、跨会话跳转、详情抽屉、step lineage。
- **聊天卡片工作区**：多聊天并排与布局预设。
- **浏览器面板**：设备模拟、console、network、元素拾取到聊天。
- **gateway 自建**：凭据三级（`zgd_` / `zgb_` / `zga_`）、可吊销、30 秒一次性 channel ticket、HTTP 代理穿透 NAT、多 backend 同时在线。ZCode 只能走官方 relay。
- **权限**：glob / regex 规则、沙箱升级协商、关键命令审批。

## 8. 新的落地顺序

0. **先清卫生问题（§1）**：架构门禁转绿并进 `ci.yml`；直连口认证；插件 iframe 沙箱。都不大，且 1、2 是安全相关。
1. **运行时体验**：后台任务完成空闲唤醒；发送队列「报错 / 取消后暂停 + Continue + 持久化」（先做廉价版，pending 账本留到协议重构）；输出截断续写；Microcompact。
2. **生态杠杆**：Claude marketplace 声明式导入适配器 + `~/.claude/skills` 等 well-known 目录；插件目录与来源（sha256、发布者固定）；首批第一方 skill（插件创作、自诊断）。
3. **桌面交互**：命令中心 + 快捷键设置 + 会话内 Cmd+F 共用一张命令表；composer 历史；turn 级文件撤销（基于现有 `file-history`，加外部修改预检）；会话导入（先做 Claude Code）。
4. **远程与分发**：手机二维码配对；server + 浏览器壳单包分发；headless `-p` + NDJSON。
5. **需要产品决策再动**：i18n、Gen UI、bots、dynamic workflow、trajectory 查看器、项目记忆自动化。i18n 越晚越贵，建议尽早定。
6. **工程小项一次做完**：CLAUDE.md 补行为规范、CONTEXT.md、knip（report 模式）、workspace-freshness、`max-lines` 棘轮、font-size 检查。

## 9. 不建议借（与上次一致，补充）

Office / Coding 界面模式、Coding Plan 计费、Off-peak、白板 / PPTX、会话公开分享页、官方 relay 形态的 Web 远控、Android WebView 壳、MCP Apps 全套（暂缓）、workspace hook trust（暂缓）、Computer Use、办公 skill 内置。

## 10. 本次未覆盖

- ZCode 3.14.3 到 3.15.1 两版之间的逐版本差异（UI 目录有约 986 个文件变动，大头是 plugin-ui、gen-ui、workflow-timeline、highspeed、bots 等新目录）。
- zclaudia 会话级归档的 UI 入口、AI commit message 的 include-unstaged 与 identity 检查。
- `permission-evaluator.ts` 里 destructiveOps 对危险命令的覆盖程度（见工具集报告 §2.2）。
- ZCode 的 CI 文件（`.gitlab-ci.yml`）仍未导出。
