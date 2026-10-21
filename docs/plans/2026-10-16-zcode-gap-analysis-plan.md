# ZClaudia × ZCode 竞品差距分析与借鉴方案

日期：2026-10-16
性质：只读探索（不改任何产品代码），产出分析报告
执行模型：主会话 GLM-5.3 汇总，7 个维度探索 sub-agent 使用 GLM-5.3-Flash

## 1. 背景与目标

| | zclaudia（本仓库） | ZCode（竞品，`/Users/zhvala/SourceCode/zcoder`） |
| --- | --- | --- |
| 定位 | 跨平台桌面 + gateway 的多 Agent 编程工作台 | AI 编程工作台：桌面 + 浏览器 + 终端 Agent（TUI/CLI） |
| 技术栈 | Tauri + React，Node 后端，SQLite 本地优先 | Electron + Web + Node 后端，Agent CLI 源码完整入库 |
| Agent 运行时 | Pi 内置运行时 + 插件运行时（Claude/Codex/Cursor） | 自研 Agent 内核（`apps/zcode-cli/packages/core`）+ 31 个子包 |
| 顶层包 | apps/desktop、server、packages/agent-common、plugins/agents | 18 个 packages（android/web/rpc/provider/ui/cua/formal-proof…）+ apps/zcode-cli |
| 工程配套 | e2e/、docs/、scripts/ | harness/、specs/、docs/（数百篇设计文档）、adr/、architecture-policy.yaml、knip、formal-proof |

目标：识别 ZCode 具备而 zclaudia 缺失或明显较弱的能力，逐项评估**可搬运性**，形成按优先级排序的借鉴清单。不实际搬运代码。

## 2. 合规前提（先决条件）

- ZCode 为 **Apache-2.0**（附 `NOTICE.md`、`THIRD-PARTY-NOTICES.md`）；zclaudia 为 **MIT**。
- Apache-2.0 → MIT 方向兼容：后续真实搬运代码时，被搬运部分须保留 Apache-2.0 许可声明、原 NOTICE 与归属说明（混合仓库常规做法：被搬运文件保留原版权头 + 仓库级 THIRD-PARTY 清单登记）。
- 本轮探索仅产出分析与路径证据，不复制代码，无合规风险。

## 3. 对比维度与范围映射

| # | 维度 | ZCode 侧 | zclaudia 侧 | 要回答的关键问题 |
| --- | --- | --- | --- | --- |
| T1 | Agent 核心运行时与终端形态 | `apps/zcode-cli/packages/{core,cli,tui,bootstrap,contracts,adapters}` | `plugins/agents/*`、Pi 运行时（server 侧）、`packages/agent-common` | agent loop、工具系统、权限/审批、hooks、会话恢复、上下文管理、TUI 形态哪些更强 |
| T2 | 后端与服务架构 | `packages/{server,services,rpc,zcode-server-cli}` | `server/src/{application,domains,infra,interfaces}` | 会话管理、conversation runtime、传输层（RPC/WS）、后台任务模型的差距 |
| T3 | 桌面客户端与 UI 体系 | `packages/{desktop,client,ui,share-ui,web-share,stream-animate}` | `apps/desktop/src/*`（React） | Electron vs Tauri 的功能代价、聊天渲染（markdown/流式动画）、组件库复用价值 |
| T4 | 多形态与远程能力 | `packages/{web,android}`、SSH/WSL 远程工作区、`harness/remote`、`zcode --web` 分发 | 移动 web、本地 browser 模式、gateway | Android 原生应用、远程工作区（SSH/WSL）、单二进制多形态分发是否值得跟进 |
| T5 | 扩展体系 | `UI_PLUGIN.md`、`apps/zcode-cli/packages/*-plugin`（31 包中的插件族）、`dynamic-workflow`、`zcode-cua`、`node-repl-host`、`browser-use`、`superpowers`、skills-lock、bots/automations（`docs/bots*.md`、mailbox） | `plugins/agents`（运行时插件）、agent playground | 插件形态广度（skills/命令/hooks/工作流/CUA/自动化 bot）、技能分发与锁定机制 |
| T6 | Provider / 模型 / 订阅计费 | `packages/{provider,provider-node,model-option-map}`、`docs/bigmodel-*.md` | `server/src/auth.ts`、provider 相关配置 | 多 provider 接入、coding-plan 订阅与用量配额、模型选项映射的成熟度 |
| T7 | 工程实践与质量基建 | `harness/`、`specs/`、`docs/adr`、`architecture-policy.yaml`、`dependency-graph.mmd`、knip、`formal-proof`、`e2e-report`、telemetry、i18n | `e2e/`、`scripts/`、eslint、`docs/{specs,plans,reviews}` | 架构治理（policy+graph+check）、形式化验证、遥测、i18n、发布工程哪些值得引入 |

## 4. 执行方式

1. **新建 sub-agent 定义**：项目级 `.zcode/agents/gap-explorer.md`，frontmatter `model: account:bigmodel-individual-coding-plan/GLM-5.3-Flash`，工具限 `Read/Grep/Glob/Bash/Write`（Write 仅允许写报告目录），系统提示约束只读探索 + 报告模板。
2. **并行派出 7 个 gap-explorer**，每个负责一个维度，互相独立；单 agent 建议搜索深度 "very thorough"，但以读关键文件为主、不逐文件通读。
3. **报告落盘**：`docs/reviews/2026-10-16-zcode-gap-analysis/T{1..7}-*.md`，由 sub-agent 直接写文件。
4. **主会话汇总**：抽查各报告的证据路径（防 flash 模型幻觉），写 `00-summary.md`——按 P1（尽快借鉴）/P2（规划内借鉴）/P3（仅思路）排序的借鉴清单 + 差距总览。

## 5. 统一报告模板（每个维度）

```markdown
# T{n} {维度名} 对比报告

## 1. 两侧结构对照（简表）
## 2. ZCode 领先点（核心章节，每项必含）
- 名称 / 解决什么问题
- 证据：ZCode 文件路径（可多列）+ zclaudia 现状路径
- 可搬运性：直接移植 | 重写借鉴 | 仅思路（+ 理由：依赖耦合度、体量、License）
- 预估搬运量级：文件数/模块级/思路级
## 3. zclaudia 已有而 ZCode 没有的优势（简列）
## 4. 不建议搬运的（及原因）
```

硬性要求：**每个"领先点"至少给出一个真实存在的 ZCode 源文件路径**；不确定的结论标注 `（未确认）`，禁止编造路径。

## 6. 风险与边界

- 只读探索，两仓库代码零修改；zclaudia 侧只新增 `docs/plans/`（本方案）与 `docs/reviews/2026-10-16-zcode-gap-analysis/` 下报告。
- flash 模型深度有限 → 用模板强制证据路径 + 主会话抽查缓解。
- ZCode docs/ 体量巨大（数百篇），允许按目录名/标题选择性阅读，不要求通读。
- 若项目级自定义 agent 无法在当前会话注册，回退方案：改用 general-purpose sub-agent 并在报告中注明（模型不可指定时），或改用动态工作流显式指定 `subagent_model`。
