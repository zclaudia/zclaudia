# T7 工程实践与质量基建 对比报告

> 竞品差距分析 · 维度 T7（架构治理 / 死代码检测 / 形式化验证 / 遥测 / 国际化 / 三方合规 / 发布工程）
> 探索方式：只读。ZCode 仓库：`/Users/zhvala/SourceCode/ZCode`；本仓库：`/Users/zhvala/SourceCode/zclaudia`。
> 所有 ZCode 侧结论均来自本次实际读到的文件；行号为探索当日快照。

## 1. 两侧结构对照（简表）

| 维度 | ZCode | zclaudia 现状 |
| --- | --- | --- |
| 架构治理策略文件 | `architecture-policy.yaml`（17 个模块、9 个受管模块、全局阈值、带过期时间的例外） | 无 policy 文件；规则硬编码在 `scripts/dev/check-architecture-boundaries.mjs`（ratchet 式 allowlist，server 分层 + desktop store/feature/services 规则） |
| 架构检查器 | `scripts/architecture/`（index.mjs 399 行 + policy.mjs 193 行），带 281 行自测 | 有检查器（535 行），CI 第一步执行（`.github/workflows/ci.yml:28`）；无自测，无 fingerprint 基线 |
| 依赖可视化 | `dependency-graph.mmd`（544 条边，`pnpm dep:graph` 生成）+ `scripts/dep-refs.mjs`（导出引用查询） | 缺失 |
| 死代码检测 | knip 6（`knip.json`）+ `pnpm knip`，AGENTS.md 列为日常命令 | 缺失（无 knip/madge/depcheck，`grep knip package.json` 无命中） |
| 形式化验证 | `packages/formal-proof`（状态空间枚举器）+ 会话 e2e case 转正审计（catalog/coverage/fault matrix 一致性门禁） | 缺失 |
| E2E 规模与报告 | desktop e2e 417 个 spec 文件 + `packages/e2e-report`（chart.js 趋势/覆盖率看板）+ 容器化 e2e（`harness/remote`、`test:e2e:container`） | e2e/tests 74 个 spec；vitest+playwright 双栈、local/remote/gateway 多模式；报告依赖 playwright 内建 report |
| 遥测 | `apps/zcode-cli/packages/telemetry`（OpenTelemetry OTLP trace+metrics，含 error-sanitizer、cost-controls，10 个测试文件）+ 桌面端 ARMS RUM | 缺失（workspace 无 @opentelemetry 依赖） |
| 国际化 | `apps/zcode-cli/packages/i18n`（en-US/zh-CN 全量文案目录、env locale 探测、契约类型） | 缺失（desktop/src 下无 i18n/locale 模块） |
| 三方合规 | `scripts/licenses.mjs`（green/yellow/red 分类门禁 + `check --strict`）自动生成 2MB `THIRD-PARTY-NOTICES.md`；`third-party/inventory.json`；`NOTICE.md` 29KB 风险披露 | 缺失（仅根目录 `LICENSE`，无 NOTICES/盘点） |
| 发布工程 | release-it + conventional-changelog、`specs/zcode-unified-distribution.md`（含验收场景与已记录验证）、ADR 0004 发布平台契约、SEA 打包、smoke 脚本 | GitHub Actions 四条 workflow + `scripts/release/{macos.sh,version-bump.sh,validate-updater-signing.mjs}`（含 `__tests__`）、Android versionCode 推导 |
| 文档体系 | docs/ 共 1866 个 md（含 `docs/adr/` 4 篇、`docs/testing/` 覆盖率矩阵），AGENTS.md 明文「先 spec 后代码」 | docs/ 233 个 md；`docs/plans`(30)、`docs/specs`(6)、`docs/reviews`、`docs/quality-audit`（00–07 分批审计 + PROGRESS）；无 ADR 目录 |
| 工具链锁定 | `mise.toml`（node 24.14.0 + pnpm 10.33.2）+ `.nvmrc` + `ci:assert-node` | `.node-version` + engines + `scripts/hooks/ensure-node-version.mjs`（preinstall） |
| 依赖补丁 | `patches/` 6 个 pnpm patchedDependencies（vitest/wdio-electron-service/@arms rum/@ai-sdk×2/@open-pencil） | 无 pnpm overrides/patchedDependencies |
| CI 可见性 | 仓库内无 `.github/`/`.gitlab-ci.yml`（CI 在内部平台，ADR 0004 提及 GitLab runner） | `.github/workflows/{ci,release,_release-build,builtin-agent-runtimes}.yml` + dependabot，全部在库内可审计 |

## 2. ZCode 领先点（核心章节）

### 2.1 模块契约产物门禁：policy-as-code 的模块清单制

**解决的问题**：架构规则不靠口头约定，而是声明式 YAML + 独立检查器。受管模块（managed: true）必须自带五件套产物——`module.ts`（manifest，可内联声明 requires）、`contract.ts`、`contract.example.ts`、`contract.test.ts`、`CONTRACT.md`，缺一件即违规；每个模块声明 owner、requires、publicEntrypoints、分层（domain/app/adapters/ui）。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/architecture-policy.yaml:26-33`（storage 模块：requires/publicEntrypoints/layers/owner 全声明）、`architecture-policy.yaml:179-186`（全局：maxFileLines 400、maxContractLines 300、maxPublicMethods 12、forbidCycles、forbidDeepImports、managedOnly）
  - `/Users/zhvala/SourceCode/ZCode/scripts/architecture/index.mjs:113-134`（missing-module-artifact 检查）、`:260-274`（deep-import：跨模块只能走公开入口）、`:193-209,276-286`（domain-io：domain 层禁 IO/定时器/fetch）、`:36-71`（DFS 环检测）、`:91-99`（公开入口匹配）
- **zclaudia 现状**：`scripts/dev/check-architecture-boundaries.mjs:1-42` 有 server 六层方向规则与 desktop store/feature/services 规则（ratchet allowlist 已清零），但**没有**模块契约产物要求、公开入口白名单、domain 纯度、公开方法数上限；规则不可配置（硬编码），也无策略文件。
- **可搬运性**：重写借鉴。ZCode 检查器约 800 行、零第三方依赖（仅 typescript + yaml），核心思想（契约五件套、deep-import、domain-io、fingerprint 基线）可直接映射到 zclaudia 的 shared/server/apps/desktop/plugins 布局；但模块拓扑需按本仓重写，不能照抄 policy 文件。
- **体量估计**：策略 schema + 检查器移植 2–4 天；为首批模块补 contract.example/contract.test 产物另计（每模块 0.5–1 天）。

### 2.2 违规基线指纹与增量检查（--changed + 反向依赖闭包）

**解决的问题**：存量违规不阻塞增量开发——每条违规按 sha256 指纹登记进 `.architecture-baseline.json`（ZCode 当前基线为空，说明全绿），`architecture:check --changed` 只对「改动文件 + 反向依赖闭包」内的违规判失败；例外可带 `expires` 过期日，过期自动变违规。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/scripts/architecture/index.mjs:20-34`（fingerprint 生成）、`:90-103`（expired-exception）、`:292-315`（--changed 反向闭包 + baseline 对比）、`:318-323`（baseline:update）
  - `/Users/zhvala/SourceCode/ZCode/.architecture-baseline.json`（空基线）
  - `/Users/zhvala/SourceCode/ZCode/package.json:38`（`verify:pre-push = lint + architecture:check -- --changed + test:unit:affected`）
- **zclaudia 现状**：`scripts/dev/check-architecture-boundaries.mjs:10-39` 用「allowlist Set 注释已清零」达到同样效果（ratchet），但基线是源码内常量而非数据文件，无指纹、无过期机制、无 --changed 增量模式（CI 每次全量）。
- **可搬运性**：重写借鉴。指纹基线 + 过期例外是对现有 ratchet 的自然升级；`--changed` 闭包还能把架构检查塞进 pre-push（zclaudia pre-commit-guard 目前不含架构检查）。
- **体量估计**：1–2 天。

### 2.3 治理工具自带测试 + 面向 Agent 的「模块阅读包」

**解决的问题**：(a) 架构检查器本身有 281 行 node:test 自测，在临时 git 仓库夹具里验证 policy 解析、基线、增量路径；(b) `architecture:context <module-id>` 一条命令生成该模块的受控阅读包（manifest、contract 文件清单、公开入口、直接依赖的 contract），配合 `.agents/skills/architecture-governance/SKILL.md` 让 AI/新人改代码前先跑检查、再读最小上下文。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/scripts/test/architecture-governance.test.mjs:1-50`（git 夹具 + POLICY fixture；共 281 行）
  - `/Users/zhvala/SourceCode/ZCode/scripts/architecture/index.mjs:333-367`（generateContext）
  - `/Users/zhvala/SourceCode/ZCode/.agents/skills/architecture-governance/SKILL.md:1-30`（「先跑检查、再读上下文、先定 owner/path/boundary/time 再写码」）
- **zclaudia 现状**：检查器无自测；无 context 生成器；`CLAUDE.md` 有结构说明但无「改码前生成阅读包」的流程化技能（缺失）。
- **可搬运性**：直接移植（generateContext 函数自包含，换成本仓模块清单即可）；SKILL.md 做重写借鉴。
- **体量估计**：context 生成 0.5–1 天；治理 skill 半天。

### 2.4 三方合规流水线：license 分类门禁 + 声明自动生成 + 溯源清单

**解决的问题**：`scripts/licenses.mjs` 递归扫描 workspace 实装包（含嵌套版本），按 SPDX 表达式分为 green（MIT/ISC/BSD/Apache-2.0 等）/yellow（LGPL/MPL/EPL，需登记复核理由）/red（GPL/AGPL/SSPL/CC-NC 直接失败）；`check --strict` 还要求 third-party/inventory.json 中 reviewRequired 材料清零。`notices` 命令从锁文件生产图收集真实 license 原文，生成 2MB 的 `THIRD-PARTY-NOTICES.md`（记录精确版本、来源与哈希）。许可证文本变更后可复核（PROD_REVIEWED 绑定许可类别）。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/scripts/licenses.mjs:60-90`（GREEN 正则 + classify：AGPL/LGPL/MPL/BSL/CC-NC 分桶）、`:91-99`（PROD_REVIEWED 登记 libvips LGPL、elkjs EPL 复核结论）、`:113-136`（check/--strict 门禁与提示语）
  - `/Users/zhvala/SourceCode/ZCode/THIRD-PARTY-NOTICES.md:1-5`（生成方式声明）、`/Users/zhvala/SourceCode/ZCode/third-party/inventory.json`、`/Users/zhvala/SourceCode/ZCode/NOTICE.md`（29KB 功能风险与数据流披露）
- **zclaudia 现状**：缺失。仅根目录 `LICENSE`（MIT），无 NOTICES、无盘点、无门禁；桌面/服务端分发时（尤其捆绑 ripgrep、better-sqlite3、sharp、Chromium 等原生/外部组件）存在合规缺口。
- **可搬运性**：直接移植。脚本自包含（node + 锁文件解析），Apache-2.0 允许复制，**移植时须保留原文件头版权与许可声明、并在 NOTICES/NOTICE 中保留 ZCode 归属**；分类正则与 PROD_REVIEWED 需按 zclaudia 实际依赖树调整。
- **体量估计**：脚本移植 1 天 + 首次盘点/复核 1–2 天；NOTICE.md 类风险披露文档另需产品侧写作（2–3 天）。

### 2.5 死代码检测：knip + 导出引用查询

**解决的问题**：monorepo 里未使用导出/依赖/文件随时间累积。ZCode 用 knip 6（`tags: ["-lintignore"]`，忽略 docs 与 UI 组件目录）作为日常命令，另有 `dep:refs --list-exports <file>` 回答「这个文件的导出被谁引用」，`dep:graph` 生成 544 边的 mermaid 全仓依赖图（19KB，入库可 diff）。

- **证据（ZCode）**：`/Users/zhvala/SourceCode/ZCode/knip.json:1-10`、`/Users/zhvala/SourceCode/ZCode/package.json:22-23`（dep:graph/dep:refs）、`:61`（knip）、`/Users/zhvala/SourceCode/ZCode/scripts/dep-refs.mjs`（387 行）、`/Users/zhvala/SourceCode/ZCode/dependency-graph.mmd`（544 条边）、`/Users/zhvala/SourceCode/ZCode/AGENTS.md:24`（把 knip 列为标准命令）
- **zclaudia 现状**：缺失（`ls node_modules/.bin | grep knip|madge|depcheck` 无命中；package.json 无相关 script）。
- **可搬运性**：直接移植。knip 是现成 npm 工具，加配置即可；dep:refs 脚本（ts-morph）可照搬；ZCode 侧 Apache-2.0，保留声明。
- **体量估计**：0.5–1 天（含首次清理误报 ignore 列表）。

### 2.6 CLI 遥测包：OpenTelemetry OTLP + 错误脱敏 + 成本控制

**解决的问题**：把 agent 运行时（CLI/桌面共享）的 trace、metrics、模型 API 调用记录标准化：`@zcode/telemetry` 封装 OTLP exporter（trace + metrics 双协议）、agent-trace-runtime（span 生命周期）、model-api-recorder、provider-endpoint 归类，且内置 error-sanitizer（上报前脱敏）与 otlp-cost-controls（采样/批量上限），10 个测试文件覆盖集成与成本路径。桌面端另有 ARMS RUM 前端监控（经 patches 修正）。vitest 配置注入 `__ZCODE_TELEMETRY_REPORT_ENDPOINT__` 使上报链路在单测可验证；CI 还有 `scripts/ci/ci-telemetry-keyword-guard.test.mjs` 防止敏感关键字进入遥测。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/apps/zcode-cli/packages/telemetry/package.json`（@opentelemetry/sdk-trace-base/sdk-metrics/otlp-exporter 依赖）与 `src/index.ts:1-6`（导出面：agent-trace-runtime、bootstrap、error-sanitizer、model-api-recorder、provider-endpoint）
  - `/Users/zhvala/SourceCode/ZCode/apps/zcode-cli/packages/telemetry/src/error-sanitizer.ts`、`src/agent-metrics.ts`、`tests/otlp-cost-controls.test.ts`
  - `/Users/zhvala/SourceCode/ZCode/vitest.config.ts:46-49`（define 注入上报端点）
- **zclaudia 现状**：缺失（workspace 各 package.json 无 @opentelemetry 依赖；`grep -rl opentelemetry apps server shared plugins packages` 无命中）。服务端问题排查目前靠日志。
- **可搬运性**：重写借鉴。包结构与技术选型（OTLP + sanitizer + cost controls）可整体参考，但它依赖 `@zcode/contracts` 类型，直接复制需先解耦接口；自托管产品还要先决定上报端点与开关策略。
- **体量估计**：核心包移植/改写 3–5 天（含测试），接入 server/desktop 另计。

### 2.7 CLI 国际化包：全量文案目录 + 环境 locale 探测

**解决的问题**：CLI/TUI/UI 共享一套 `getZCodeCopy(locale)` 文案目录，en-US 与 zh-CN 各约 360 行、类型受 `ZCodeCopy` 契约约束（缺 key 即编译错误）；`locale.ts` 按 LC_ALL→LC_MESSAGES→LANG→LANGUAGE 顺序解析环境并处理 `@modifier`/编码后缀，DEFAULT_LOCALE=en-US。配套 `tests/i18n.test.ts`。

- **证据（ZCode）**：`/Users/zhvala/SourceCode/ZCode/apps/zcode-cli/packages/i18n/src/index.ts:20-27`（CATALOGS + getZCodeCopy）、`src/locale.ts:1-14`（env 探测）、`src/locales/zh-CN.ts`（361 行）、`src/locales/en-US.ts`（364 行）
- **zclaudia 现状**：缺失（desktop/src 无 i18n/locale 模块；grep 'i18n' 于 services/stores/utils 无命中），UI 文案硬编码中文。
- **可搬运性**：直接移植。包几乎自包含（唯一依赖 @zcode/contracts 的两个字符串字面量类型，可内联）；ZCode Apache-2.0，保留版权声明。若 zclaudia 面向国内用户为主，可只借架构、暂缓 en-US 补全。
- **体量估计**：包移植 0.5 天；把现有 UI 文案迁入目录体系按页面计（初步 2–5 天）。

### 2.8 形式化状态空间：产品行为枚举器 + e2e case 转正审计

**解决的问题**：对话产品（compact/fork/goal/队列/编辑组合）行为组合爆炸，靠人写用例覆盖不全。ZCode 的做法是：`packages/formal-proof` 用 ~900 行 model.ts 把产品上下文（runPhase/queue/compactMemory/goal/…）× 用户动作枚举成状态空间，guard/effect 剪枝后输出可人工 review、可转 e2e 的 trace case（模型里每个 case 带 `e2e` 字段）；配套 `scripts/audit-conversation-session-case-coverage.mjs --check/--require-complete` 维护 case catalog、e2e 覆盖率矩阵、环境故障目录三者一致性，并由 4 个 `scripts/test/conversation-session-formal-admission*.test.mjs` 审计转正流程。审计明确注释「必须显式命令触发，不挂默认单测」避免阻塞提交。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/formal-proof/src/model.ts:1-60`（ProductContext/Decision/TraceNode 类型与 case 统计）、`README.md`
  - `/Users/zhvala/SourceCode/ZCode/docs/conversation-product-state-space.md:1-50`（状态维度表、笛卡尔积+guard 剪枝方法论）
  - `/Users/zhvala/SourceCode/ZCode/scripts/audit-conversation-session-case-coverage.mjs:1-46`（catalog/matrix/fault 目录一致性口径）、`scripts/lib/conversation-session-formal-admission*.mjs`（5 个审计模块）
- **zclaudia 现状**：缺失。zclaudia 有 `docs/quality-audit/06-e2e-scripts.md` 之类的人工审计，但无状态空间模型、无 case 转正门禁。
- **可搬运性**：仅思路（当前对话状态机与 ZCode 产品强耦合）。可借鉴的方法论：高阶组合行为先建模枚举、再产出带 e2e 映射的 case 清单、用一致性审计脚本守住 catalog 与实现的同步。
- **体量估计**：方法论落地（针对 zclaudia 的 automations/runtime 生命周期）约 1–2 周；直接移植不可行。

### 2.9 E2E 结果资产化：报告查看器 + 全量覆盖率运行器 + 容器化 harness

**解决的问题**：e2e 不止 pass/fail：`packages/e2e-report` 把 wdio/覆盖率运行器的 summary JSON 渲染成 chart.js 看板（趋势、覆盖面板、样本统计），`pretest:e2e` 先构建其 node 侧库；`test:e2e:all:coverage` 用 `run-all-e2e-coverage.mjs` 按 env/故障注入选择 spec 全量跑并产出汇总；另有 `harness/remote`（SSH e2e 的 Docker 化 ssh-server）与 `test:e2e:container` 脚本族、`e2eSummarySpecCoverage.test.ts` 防止 spec 脱离汇总口径。desktop e2e 共 417 个 spec 文件（zclaudia 74 个）。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/e2e-report/src/node/index.ts:1-30`（readE2EReportSummary/createE2EReportViewerUrl）、`src/viewer/App.tsx`、`package.json`（chart.js）
  - `/Users/zhvala/SourceCode/ZCode/packages/desktop/package.json:31-36`（pretest:e2e / test:e2e:all:coverage / windows sharded）、`packages/desktop/scripts/run-all-e2e-coverage.mjs:1-40`（env 选 spec、provider key 校验）
  - `/Users/zhvala/SourceCode/ZCode/harness/remote/`（Dockerfile/build.sh/README）
- **zclaudia 现状**：e2e/ 有 vitest+playwright 双栈与多模式（local/remote/gateway，`e2e/README.md`），但报告用 playwright 内建 HTML report，无趋势/覆盖率看板，无容器化 harness；`playwright.resource-sync.config.ts` 是最接近的自定义运行器。
- **可搬运性**：仅思路（ZCode 看板绑定 wdio summary 格式）。借鉴点：把 e2e 汇总持久化成 JSON + 轻量看板页，跟踪 74 个 spec 的通过率趋势与覆盖映射。
- **体量估计**：最小可用（summary JSON + 静态页）3–5 天。

### 2.10 发布工程：规格先行 + 记录化验收 + 签名/分发契约

**解决的问题**：ZCode 把「发布」当成 spec 对象：`specs/zcode-unified-distribution.md` 定义统一 Node 发行版的规则/所有权/打包/验收场景，文末记录 2026-09-20 的真实验证结果（5 个 process/installer 测试、真实 release 解包 smoke、`--web` 启动验证）；`scripts/zcode-distribution-smoke.mjs` + `zcode-distribution.test.mjs` 固化该验收；`deterministic-tar-archive.mjs` 保证归档可复现；ADR 0004 定义 `release-candidate.v1` 契约（对象存储 + 幂等 + 审批 + digest 校验），并给出被否方案及理由（继续扩展 GitLab CI、只传压缩包、平台只审批——均「拒绝」+ 理由）。日常 changelog 由 release-it + conventional-changelog 自定义 writer（`scripts/release-it/changelog-writer.mjs`）生成。

- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/specs/zcode-unified-distribution.md`（验收与 Recorded validation 节）
  - `/Users/zhvala/SourceCode/ZCode/docs/adr/0004-release-packaging-platform-contract.md:1-60`（Context/Decision/Alternatives 全流程）
  - `/Users/zhvala/SourceCode/ZCode/.release-it.mjs:1-33`、`/Users/zhvala/SourceCode/ZCode/scripts/release-it/changelog-writer.mjs`
  - `/Users/zhvala/SourceCode/ZCode/scripts/zcode-distribution-smoke.mjs`、`scripts/zcode-distribution.test.mjs`、`scripts/deterministic-tar-archive.mjs`
- **zclaudia 现状**：`scripts/release/version-bump.sh`（从 git tag 推导版本 + Android versionCode + dev 后缀，有 `__tests__`）、`validate-updater-signing.mjs`（且 CI 里跑其 preflight 测试，`.github/workflows/ci.yml:43-44`）、4 条 GitHub workflow。差距：无发布规格文档、无 ADR、无发布后 smoke 流程记录、无 changelog 自动生成（无 release-it/conventional-changelog）。
- **可搬运性**：重写借鉴。ADR 模板与「验收场景 + 记录化验证」格式直接可抄（半天）；release-it changelog 流程可直接引入（1 天）；发布平台契约（ADR 0004）现阶段过重，不建议。
- **体量估计**：ADR + 发布 spec 模板 0.5–1 天；changelog 自动化 1 天；smoke 脚本 2–3 天。

### 2.11 补充领先点（小项）

- **pre-push 质量闸门**：`.husky/pre-push` 缓存 stdin、清理 GIT local env 后跑 `verify:pre-push`（lint → 架构增量检查 → affected 单测），且 affected 基线选择函数（`scripts/affected-unit-test-baseline.mjs:1-8`）处理了新分支无 remote SHA 的边界。zclaudia 的 pre-commit-guard（`scripts/hooks/pre-commit-guard.mjs`）不含架构检查与 affected 测试。→ 重写借鉴，1–2 天。
- **测试运行时的进程隔离分组**：`vitest.config.ts:19-53,96-125` 把会真实 spawn git/回收进程树的 20+ 个测试列入 fork-isolated 项目串行跑，其余 threads 并行，并解释每个决定（stdout 256KB CI 门禁 → `silent: "passed-only"`）。zclaudia 无对应分组。→ 直接移植思路，0.5–1 天。
- **pnpm patchedDependencies 体系**：`patches/` 6 个补丁集中管理上游修复（vitest、wdio-electron-service、@arms rum、@ai-sdk anthropic/openai-compatible、@open-pencil core），升级依赖时补丁冲突可见。zclaudia 无此机制。→ 直接移植（pnpm 原生能力）。
- **dev-docs 站**：`apps/dev-docs`（react-flow + elkjs）提供能力地图与特性边界图的可视化文档站，`src/data/featureBoundaryGraph.ts` 以数据驱动图结构。zclaudia 缺失。→ 仅思路。

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

- **库内可审计的 CI**：`.github/workflows/{ci,release,_release-build,builtin-agent-runtimes}.yml` + dependabot；ZCode 仓库内无任何 CI 定义（内部 GitLab，见其 ADR 0004 背景描述），外部无法审计其流水线。
- **签名/更新器安全的测试前置**：`scripts/release/validate-updater-signing.mjs` 带 `__tests__` 且 CI 强制执行（`ci.yml` "Updater signing preflight tests" 步骤）；ZCode 仓库内未见等价物（其签名链在内部平台）。
- **多平台构建脚本覆盖 Android**：`scripts/build/{android.sh,macos.sh,linux.sh,windows.ps1}` + versionCode 推导；ZCode unified distribution 明确只覆盖 macOS/Linux/Windows。
- **质量审计的分批留痕**：`docs/quality-audit/00-baseline.md`（58/100 基线 + 每个门禁的证据行）至 `07-agent-tools.md` + `PROGRESS.md`，形成可追踪的整改台账；ZCode 的审计分散在其 1866 篇文档中，无单一台账。
- **E2E 连接模式矩阵**：`e2e/` 对 local/remote/gateway 三种部署形态有显式模式划分（`package.json` test:e2e:local/remote/gateway/modes），ZCode 的 e2e 以桌面形态为主。
- **agent-runtime 兼容性矩阵**：`plugins:compat`（`scripts/plugins/test-runtime-compatibility.mjs`）+ 5 个 playwright agent-runtime 配置，针对多 agent 运行时的回归防护，是 ZCode 单一运行时不需要的维度。

## 4. 不建议搬运的（及原因）

| 项 | 原因 |
| --- | --- |
| ARMS RUM 前端监控 + `patches/@arms__rum-electron@0.0.3.patch` | 绑定阿里云 ARMS SaaS 端点；zclaudia 主打自托管/私有部署，引入云上报面不合适。若做遥测，走 2.6 的 OTLP 开源自建路线。 |
| ADR 0004 的发布平台契约（release-candidate.v1 + 独立打包平台服务） | 需要长期运行的状态服务 + 对象存储 + 审批流，为 ZCode 的内部多平台发布规模服务；zclaudia 用 GitHub Releases + 现有签名校验已够，照搬是负资产。 |
| `THIRD-PARTY-NOTICES.md` 2MB 成品入库 | 应移植的是生成器与门禁（2.4），不是产物；成品随依赖树漂移，入库只会制造 diff 噪音。生成后按需提交即可。 |
| oxlint/oxfmt 替换 eslint/prettier | ZCode 选 oxlint/oxfmt 追求速度并配套 architecture disable-count 规则；zclaudia 的 eslint 配置已含 react-hooks v7 编译器规则集且团队熟。换工具是纯迁移成本，除非 lint 时长成为瓶颈。 |
| formal-proof 的 Vite 可视化应用本体 | 强耦合 ZCode 对话产品状态机；值得带走的只是「枚举→剪枝→case 清单→一致性审计」方法论（见 2.8）。 |
| mise 工具链管理 | zclaudia 已有 `.node-version` + engines + preinstall 校验钩子，覆盖了同一问题；再引入 mise 是双轨制。 |
| 1866 篇 docs 的规模本身 | ZCode 文档治理（spec-first + 每特性一篇）与其团队规模匹配；zclaudia 的 plans/specs/reviews/quality-audit 四目录已覆盖同一生命周期，扩充应随需求增长而非复制体量。 |
| `test:e2e:windows:sharded` 十分片 Windows e2e 基建 | 依赖 ZCode 内部 CI 的 Windows runner 编排；zclaudia 当前 CI 只有 ubuntu-latest，先有 Windows CI 再谈分片。 |

## 附：探索中未能确认的事项（unverified）

- ZCode 的实际 CI 流水线内容（触发器、缓存、通知）不在仓库内，仅有 `docs/ci-build-platform-selection.md`、`docs/ci-cache-strategy.md`、`docs/ci-feishu-card2-notification.md` 等描述性文档，本次未逐篇阅读，其流水线与文档的一致性未验证。
- `packages/e2e-report` 看板的实际数据生产端（wdio summary 生成脚本）未读到完整链路，只确认了 node 侧读取 API 与 desktop 的运行器入口。
- `apps/dev-docs` 的能力地图数据（`productCapabilityMap.ts` 等）覆盖是否与 architecture-policy 模块清单自动同步，未验证（初读为手工维护的数据文件）。
- ZCode `CHANGELOG.md` 不在仓库根目录（`.release-it.mjs` 配置了 infile），其提交策略未确认。
- zclaudia 侧 `docs/plans/2026-10-16-zcode-gap-analysis-plan.md` 为本分析的计划文档，未作为证据源深读。

## 5. 独立复核记录

> 复核人：独立复核员（与探索员无共享上下文）。复核日期：2026-10-16。逐条以只读方式重新打开证据文件核对，以下行号为复核当日实测；8 条 P1/P2 领先点全部复核。

- ✅ 三方合规流水线：license 分类门禁 + 自动生成 THIRD-PARTY-NOTICES + inventory 溯源 —— `scripts/licenses.mjs:60-84`（GREEN 正则与 green/yellow/red 分类，AGPL/GPL/SSPL/CC-NC 入红桶、LGPL/MPL/EPL 入黄桶）、`:91-102`（PROD_REVIEWED 登记 libvips LGPL、elkjs EPL）、`:113-136`（check 门禁 + `--strict` 要求 inventory.json 的 reviewRequired 清零）；`THIRD-PARTY-NOTICES.md:3` 声明由 `licenses.mjs notices` 生成、实测 2,031,323 bytes ≈ 2MB；`third-party/inventory.json:5-6` 含 noticesSha256 与逐文件 sha256 溯源；`NOTICE.md` 实测 28,872 bytes ≈ 29KB 风险披露。
- ✅ 死代码检测：knip + dep:refs + dep:graph —— `knip.json:2-9`（knip@6 schema、tags `-lintignore`、ignore docs 与 UI 组件目录）、`package.json:22-23,61`（dep:graph/dep:refs/knip 脚本）及 `:96`（knip ^6.0.6 依赖）、`scripts/dep-refs.mjs:5,264`（ts-morph 实现、`--list-exports` 模式，实测 387 行）、`dependency-graph.mmd` 实测 544 条 `-->` 边、19,985 bytes；`AGENTS.md:24` 确将 `pnpm knip` 列为标准命令。
- ✅ 模块契约产物门禁 —— `architecture-policy.yaml:26-33`（storage：managed/requires/publicEntrypoints/layers/owner 全声明）、`:179-186`（maxFileLines 400 / maxContractLines 300 / maxPublicMethods 12 / forbidCycles / forbidDeepImports / managedOnly）、`scripts/architecture/index.mjs:113-133`（五件套 module.ts/contract.ts/contract.example.ts/contract.test.ts/CONTRACT.md 缺一即 missing-module-artifact）、`:260-274`（deep-import）、`:197-208,276-286`（domain-io）。勘误：报告 2.1 所引「公开入口匹配 index.mjs:91-99」处实际是 expired-exception 检查，`publicEntrypointMatches` 实现在 `scripts/architecture/policy.mjs:91`（index.mjs:262 调用）；功能本身属实。
- ✅ 架构检查自测 + architecture:context —— `scripts/test/architecture-governance.test.mjs` 实测 281 行，`:23-43` 临时 git 仓库夹具、`:45-60` POLICY fixture、node:test；`scripts/architecture/index.mjs:333-367` generateContext 输出 manifest/contract 文件清单/公开入口/直接依赖契约；`.agents/skills/architecture-governance/SKILL.md:12-19` 印证「先跑检查 → 再读阅读包 → 先定 owner/path/boundary/time 再写码」。
- ✅ 违规基线指纹 + 过期例外 + --changed 反向闭包 + pre-push —— `index.mjs:20-22`（sha256 fingerprint）、`:90-103`（expires 过期例外自动转违规）、`:292-315`（--changed 反向依赖闭包 BFS + baseline 指纹对比）、`:318-323`（baseline:update）；`.architecture-baseline.json` 实为空基线 `{"version":1,"violations":[]}`；`package.json:38` verify:pre-push = lint + `architecture:check -- --changed` + test:unit:affected，`.husky/pre-push` 缓存 stdin、清理 GIT local env 后调用之。
- ⚠️ CLI 遥测包 —— 核心属实：`apps/zcode-cli/packages/telemetry/package.json:23-33`（@opentelemetry sdk-trace-base / sdk-metrics / exporter-trace-otlp-proto / exporter-metrics-otlp-proto 双协议）、`src/index.ts:1-6`（导出 agent-trace-runtime/bootstrap/error-sanitizer/model-api-recorder/provider-endpoint）、`src/error-sanitizer.ts` 与 `src/agent-metrics.ts` 存在、`tests/otlp-cost-controls.test.ts:16-18`（trace 采样 10% + metric 周期 5 分钟成本控制）、`vitest.config.ts:47-50`（define 注入 `__ZCODE_TELEMETRY_REPORT_ENDPOINT__`，报告标 ：46-49 系快照偏差）。勘误：报告所称「10 个测试文件」全包实测 9 个 `.test.ts`；`scripts/ci/ci-telemetry-keyword-guard.test.mjs` 不存在（`scripts/ci/` 目录不存在，全仓 `*keyword-guard*` 无命中），该句应视为失实。
- ✅ CLI i18n 包 —— `apps/zcode-cli/packages/i18n/src/index.ts:25-32`（CATALOGS en-US/zh-CN + getZCodeCopy，报告标 ：20-27 系快照偏差）、`src/locale.ts:3-9`（DEFAULT_LOCALE=en-US、LC_ALL→LC_MESSAGES→LANG→LANGUAGE 顺序、`.` 编码与 `@` modifier 分隔符处理）、`src/locales/zh-CN.ts` 实测 361 行、`en-US.ts` 实测 364 行、`tests/i18n.test.ts` 存在、契约类型 `ZCodeCopy`（`index.ts:12`，UiLocale/SupportedLocale 来自 @zcode/contracts）。
- ✅ 发布工程规格化 —— `specs/zcode-unified-distribution.md:47-54`（Acceptance and validation 六条验收场景）、`:56-63`（Recorded validation 2026-09-20：5 个 process/installer 测试、真实 release 解包 smoke、`--web` 启动验证；文末另有 2026-09-24 一节，比报告所述更多）、`docs/adr/0004-release-packaging-platform-contract.md:13,27`（release-candidate.v1 契约 + 对象存储/幂等/digest）与 `:35-45`（三个被否方案均标注「拒绝」及理由）、`.release-it.mjs:23-33`（conventional-changelog 插件 + `scripts/release-it/changelog-writer.mjs` 自定义 writer）、`scripts/zcode-distribution-smoke.mjs:1-18`（仓库外解包验证）与 `scripts/deterministic-tar-archive.mjs`（确定性 tar 条目收集 + sha256）均属实。

复核结论：8 条中 7 条完全属实（✅），1 条部分属实（⚠️，遥测包核心能力成立但测试文件数与 CI keyword guard 两处细节失实），无完全不属实条目。另注：报告第 1 章称 architecture-policy.yaml「17 个模块」，实测该文件定义 25 个模块（其中 9 个 managed 属实），因第 1 章不在本次复核范围，仅在此备注。
