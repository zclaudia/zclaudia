# ZCode 竞品差距分析 · 总报告

日期：2026-10-16
方案：[docs/plans/2026-10-16-zcode-gap-analysis-plan.md](../../plans/2026-10-16-zcode-gap-analysis-plan.md)
分维度报告：本目录 `T1`–`T7`（每份末章附独立复核记录）
执行方式：7 个 GLM-5.3-Flash 探索 agent 并行 + 脚本级证据路径存在性核对 + 每维度 1 个独立复核 agent 二次核对 P1/P2 条目（path:line 实读依据），主会话（GLM-5.3）汇总。

## 0. 可信度说明

- 53 条 P1/P2 领先点全部经独立复核：**0 条不通过**；3 条 ⚠️ 细节勘误（T1 hooks 为 7 类事件非 8 类；T4 手机远控 11 个文件非 13 个；T7 遥测包 9 个测试文件、CI keyword-guard 脚本不存在），均已写回各报告第 5 章，不影响结论。
- 所有引用的 ZCode 证据路径经 `node fs.statSync` 批量核对存在；主会话另抽查了 `@zcode/rpc` 零依赖（package.json 无 dependencies 字段）与 hooks 7 事件枚举（`apps/zcode-cli/packages/contracts/src/hooks/index.ts:7-15`），均属实。
- 未覆盖：P3 条目未逐条复核；ZCode `docs/`（1866 篇）为选择性阅读；各报告第 3 章「zclaudia 已有优势」未复核。

## 1. 总体判断

ZCode 与 zclaudia 是同一赛道的两种范式：**ZCode = 单一自研引擎 + 全形态分发（TUI/Web/桌面/CLI 服务）+ 商业化基建**（BigModel 订阅、支付、遥测、合规流水线），仓库体量约 3–4 倍于 zclaudia；**zclaudia = 多引擎插件运行时（Claude/Codex/Cursor/Pi）+ 自有 gateway 中继 + Tauri 全端（含 Android 原生）**。

差距集中在四个层面，zclaudia 并非全面落后：

| 层面 | 判断 |
| --- | --- |
| Agent 运行时内核（循环、工具、权限主干） | **基本相当**。zclaudia 复用 pi-agent-core 与多引擎抽象不弱于对手；差距在「外围规范化」（hooks 事件面、压缩分层、子代理一等化、rewind 模型） |
| 传输与服务架构 | **ZCode 明显领先**。自研 RPC 框架 + 可靠传输（ACK/重放/背压）是 zclaudia 完全没有的层；服务 CLI 化分发单方面空白 |
| 扩展生态 | **ZCode 明显领先**。插件可分发 hooks/MCP/agents、Marketplace、16 个外部工具技能导入、官方插件 15+；zclaudia 有 3 个 runtime 插件与很好的 .zplugin 安装治理，但无分发渠道 |
| 工程与合规基建 | **ZCode 领先**。架构治理 policy-as-code、knip、三方合规流水线、i18n、遥测均缺失于 zclaudia；但 zclaudia 的库内可审计 CI、质量审计台账、签名前置测试是对手没有的 |

zclaudia 独有优势（详见各报告第 3 章）：多引擎运行时即插件、自有可自托管 gateway（对手依赖闭源 `wss://zcode.z.ai` relay）、Tauri Android 一等公民 + ntfy 推送、Agent Playground、.zplugin inspect/rollback 版本治理、managed-runtimes 安装工程。

## 2. P1 借鉴清单（尽快，跨维度去重后 12 项）

按「性价比 = 价值 ÷ 体量」排序；搬运方式与证据详见对应报告。

### 第一梯队：小体量直接移植（合计约 1–2 周）

| # | 项 | 搬运方式/体量 | 证据报告 |
| --- | --- | --- | --- |
| 1 | **Retry-After 信任策略 + x-should-retry 阻断**：provider 值优先（5 分钟合理上限）、重试来源结构化日志；我们现封顶 60s 会放大失败率 | 直接移植 50–100 行 | T6 §2.2 |
| 2 | **Provider 业务错误码重试分类表**：40+ 业务码（含 HTTP 200 SSE 错误帧）可重试/终止分类，`[1302]` 类并发错误不再误判死刑 | 映射表近乎直接抄 + 接线 300–500 行 | T6 §2.1 |
| 3 | **Markdown 类型标度 text-ui-\***：h1–h6 显式映射 UI 字号 token + DESIGN.md 级强制规范；我们已有 gen-tokens 管线，接入顺滑 | 直接移植 ~50 行 + 规范 | T3 §2.2 |
| 4 | **三方合规流水线**：`licenses.mjs` green/yellow/red 门禁 + 自动生成 THIRD-PARTY-NOTICES + inventory 溯源。这是后续一切「从 ZCode 搬代码」的前置动作（Apache-2.0 归属登记） | 直接移植 1–2 天 | T7 §2.4 |
| 5 | **死代码检测**：knip + `dep:refs` 导出引用查询 + `dep:graph` 依赖图入库 | 直接移植 0.5–1 天 | T7 §2.5 |
| 6 | **单命令多形态分发 runner**：`runner.mjs`（272 行、零依赖）把 server bundle + web dist 收敛为一个发行命令，非本机监听自动签发 token | 直接移植 ~1 天 + 打包脚本 2–3 天 | T4 §2.1/§2.8 |

### 第二梯队：中等体量、独立可落地（各 ~3 天–2 周）

| # | 项 | 搬运方式/体量 | 证据报告 |
| --- | --- | --- | --- |
| 7 | **@zcode/rpc 分层 RPC 框架 + PersistentProtocol**：二进制分帧 → Channel RPC → 自动服务代理；ACK + 5s 心跳 + 断线有界重放（8MiB/45s）+ 字节水位背压。零运行时依赖、无业务耦合，Channel 层对协议层无感知，可单独叠加在现有 ws 之上 | 直接移植 3.3k 行（15 文件）+ 296 行 | T2 §2.1/§2.2 |
| 8 | **Hooks 生命周期扩展 + workspace hook 信任准入**：2 事件 → 7 事件（补 PermissionRequest/SessionStart/Stop/PostToolUseFailure/UserPromptSubmit）；不可变摘要 + 显式 Trust 的准入状态机是未来开放项目级 hooks 的安全前提 | 重写借鉴：事件 2–3 天、信任准入 1–2 周 | T1 §2.1、T5 §2.10 |
| 9 | **Microcompact 工具结果定点清理**：超限前先清旧工具结果（保留最近 5 条、9 类白名单、阈值比 0.9），避免动辄全量摘要 | 重写借鉴 3–5 天 | T1 §2.3 |
| 10 | **Coding Plan 用量配额查询**：`/api/monitor/usage/quota/limit` 等四接口 + 严格展示口径。我们若主用 GLM coding plan（本开发环境即是），这是用户可直接感知的功能 | 重写借鉴：额度卡 MVP 400–800 行 | T6 §2.3 |
| 11 | **Streamdown 流式 Markdown 渲染**：streaming/static 双模式 + 未闭合语法补全 + 每块错误边界 + 单 `$` 数学启发式；事故注释是现成避坑清单 | 重写借鉴 600–900 行 | T3 §2.1 |
| 12 | **架构治理升级**：policy-as-code 模块清单（契约五件套/deep-import/domain-io）+ 违规指纹基线与 `--changed` 增量检查 + `architecture:context` 模块阅读包（配 Agent 使用） | 重写借鉴 2–4 天 + 直接移植 context 生成器 0.5–1 天 | T7 §2.1–2.3 |

## 3. P2 借鉴清单（规划内，摘要）

- **服务端 CLI 化分发**：supervisor + 不可变 release 原子更新/回滚 + launchd/systemd 注册（T2 §2.3，重写 5.3k 行，可 1.5k 行起步）
- **子代理运行时一等化**：runtime-task 注册表快照 + 子代理工具事件镜像回父会话时间线 + 运行中 SendMessage 导向收敛（T1 §2.2，1–2 周）
- **Turn 状态机 + Runtime Command Queue**：五类可排队命令收敛 steering/后台通知（T1 §2.5，1 周）
- **会话 fork/rewind 契约模型**：RewindScope/Strategy + 消息↔checkpoint 匹配（T1 §2.6）
- **权限长尾**：授权跨 resume 恢复、审批竞态、审批建议（T1 §2.7）
- **V4 wire 协议思想**：delivery profiles 双节奏（continuous/replayable）+ 帧分片重组（T2 §2.5）
- **连接级能力协商 + 一次性 host capability 票据**（T2 §2.6/§2.8，后者 <100 行可直接移植）
- **桌面体验**：双间隔轮询 + release notes 投递 + 强更门（T3 §2.3）；快捷键纯函数内核 bindings.ts 可近乎直接移植（T3 §2.4）
- **远程工作区**：IRemoteBackend（SSH/WSL/Docker）+ 反向桥接，SSH MVP 1–2 周（T4 §2.2，与 T2 §2.9 同源）
- **插件资产扩展顺序**：mcpServers → agents → hooks 进插件清单（T5 §2.1）；Marketplace 分发闭环分期（T5 §2.3）；外部 Agent 技能一键导入 16 来源（T5 §2.5，小体量）；skills-lock 锁定格式（T5 §2.4，极小）
- **官方技能内容直接可用**：superpowers 方法论（MIT）、zcode-guide 五件套自诊断，改 frontmatter 即可分发（T5 §2.2/§2.11）
- **受限 CEL 模型选项映射 DSL**：867 行纯函数，新模型零代码改动（T6 §2.5）；重试预算档位 + env 可调（T6 §2.8，~100 行直接移植）
- **发布工程**：ADR 模板 + 验收场景记录化 + release-it changelog 自动化（T7 §2.10）；pre-push 质量闸门（架构增量检查 + affected 单测，T7 §2.11）

## 4. 仅思路 / 远期

TUI 终端形态（借「协议客户端」架构而非 OpenTUI 栈）、Dynamic Workflow 最小切片（facade 单一事实源 + 编译期校验 + journal 重放三原则）、node_repl 共享宿主 + browser-use/CUA、Bots 多渠道（Telegram MVP 约 2k 行，抽象蓝图可抄）、UI Plugin（等 MCP Apps 协议稳定）、移动「任务首页」信息架构与 snapshot 字节预算、桌面 E2E 容器化模式（先把现有 Playwright E2E 容器化，2–3 天）、形式化状态空间枚举方法论。

## 5. 明确不搬运（跨维度汇总）

Electron 专属栈（Chrome 凭据/CUA helper/ARMS RUM/electron-updater 细节/WDIO）、`packages/services` 与 `@zcode/ui` 整包、支付链路与 Off-Peak 票据（商业后端私有契约）、Dynamic Workflow 全栈（5 万行）、OpenTUI 整栈、闭源 relay 依赖、ZCode 环境体系与发布平台契约、SEA 单文件打包。理由分见各报告第 4 章。

## 6. 建议的落地顺序

1. **先铺合规**（第 4 项）：THIRD-PARTY 流水线就位后，一切「直接移植」才有登记去处。
2. **一周内清掉第一梯队**（1/2/3/5/6）：全部小体量、独立、无架构依赖。
3. **季度内做第二梯队中与现有痛点半径最小的**：若痛在弱网/多端同步选 7（rpc）；若痛在 token 超限选 9（microcompact）；若痛在 hook 生态选 8。
4. 第 10 项（配额查询）取决于是否将 GLM coding plan 作为主力 provider——是则提升到第一梯队。

## 7. 产出物索引

- T1 [Agent 核心运行时与终端形态](T1-agent-runtime.md) · T2 [后端与服务架构](T2-server-architecture.md) · T3 [桌面客户端与 UI 体系](T3-desktop-ui.md) · T4 [多形态与远程能力](T4-multiform-remote.md) · T5 [扩展体系](T5-extension-system.md) · T6 [Provider/模型/订阅计费](T6-provider-billing.md) · T7 [工程实践与质量基建](T7-engineering-practices.md)
