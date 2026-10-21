# 第一梯队借鉴项实现计划

日期：2026-10-16
依据：[ZCode 竞品差距分析](../reviews/2026-10-16-zcode-gap-analysis/00-summary.md) 第 2 节第一梯队 6 项
执行方式：动态工作流 + GLM-5.3-Flash 实现 sub-agent（A/B/C 并行 → D → E），每任务带确定性门禁与修复循环；主会话（GLM-5.3）做逐项验收
产出目录：`docs/reviews/2026-10-16-first-tier-implementation/`（验收报告 + knip 发现清单）

## 0. 任务拆分与执行拓扑

| 任务 | 对应差距分析项 | 内容 |
| --- | --- | --- |
| A | 第 1+2 项（T6 §2.1/§2.2） | Provider 重试加固：业务错误码分类表 + Retry-After 信任策略 + x-should-retry |
| B | 第 3 项（T3 §2.2） | Markdown 类型标度（语义字号 token + h1–h6 映射） |
| C | 第 4 项（T7 §2.4） | 三方合规流水线（licenses 盘点/声明生成/门禁） |
| D | 第 5 项（T7 §2.5） | 死代码与依赖工具（knip + dep:refs + dep:graph） |
| E | 第 6 项（T4 §2.1/§2.8） | 单命令分发（runner + 打包 + 安装脚本） |

拓扑：**A、B、C 并行 → D → E → 全仓回归**。串行 D/E 的原因是 C/D/E 都要写根 `package.json`（D 还写 `pnpm-lock.yaml`），并行会互相覆盖；A/B/C 文件集互不相交。

## 1. 任务规格

### 任务 A：Provider 重试加固（server）

**落点**：
- 改 `server/src/infra/providers/pi-runtime/retry-stream.ts`（现 239 行）
- 新增 `server/src/infra/providers/pi-runtime/provider-business-codes.ts`（分类表 + 解析器）
- 扩展 `server/src/infra/providers/pi-runtime/__tests__/retry-stream.test.ts`

**ZCode 参照**（可实读）：
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts`（402 行映射表：1120/1230/1234/1302/1303/1305/1312 可重试；1113/1304/1308-1313 终止；`insufficient_quota`/`credit_balance_exhausted` 等 OpenAI 风格 code 终止）
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/runner-retry.ts:15,38-56`（`MAX_REASONABLE_RETRY_AFTER_MS = 5 * 60_000`；合理则直接采用，否则指数退避）
- `/Users/zhvala/SourceCode/zcoder/docs/bigmodel-business-error-retry.md`（业务码出现在 HTTP 200 SSE error frame 的场景与"已产出内容不重放"边界）

**规格**：
1. 新模块 `provider-business-codes.ts`：业务码 → {retryable, reason} 表（对齐 ZCode 语义；表数据注明参考来源）+ 从错误文本解析 `[1302][…][request_id]` 前缀与 OpenAI 风格 `code` 字段的解析器。纯函数、无依赖。
2. `retry-stream.ts`：
   - `computeDelay`：新增 `MAX_REASONABLE_RETRY_AFTER_MS = 5min`；Retry-After 合理（≤5min）直接采用不再被 60s 截断；不合理（>5min/过去时间）回落指数退避；同时支持 `retry-after-ms` 头。
   - `isRetryable` 扩展：错误事件 `errorMessage` 命中可重试业务码时（即使 status 200）可重试；命中终止业务码时（即使 5xx）不重试；新增 `x-should-retry: false/0` 头阻断。
   - `RetryNotification` 增加 `businessCode?: string` 便于观测。
   - **不变量（绝对）**：已转发内容后绝不重试（`forwardedContent` 守卫）、aborted 直通、MAX_ATTEMPTS 总次数不变。
3. 测试新增用例：200+可重试业务码重试；503+终止业务码不重试；retry-after 120s 被完整采用；retry-after 1h 回落指数封顶；x-should-retry:false 阻断；retry-after-ms 头。

**门禁**：server `vitest run retry-stream` 通过；server `tsc` build 通过；server eslint 通过。

### 任务 B：Markdown 类型标度（desktop）

**落点**：
- `apps/desktop/scripts/tokens/config.mjs` + `gen-tokens.mjs`（新增静态字号标度段，产出 `--font-ui-*` CSS 变量）
- `apps/desktop/src/features/chat/message-list/assistantMarkdown.tsx`（h1–h6 与 p 接入标度 class）

**ZCode 参照**：`/Users/zhvala/SourceCode/zcoder/packages/ui/src/components/ai-elements/message.tsx:438-447`（h1→text-ui-xl、h2→text-ui-lg、h3–h6→text-ui-base 且以字重区分）与 `DESIGN.md:12-23` 的规则表述（禁止裸 px、全局缩放只允许根变量）。

**规格**：
1. 在 gen-tokens 管线中加一组语义字号 token（如 `--font-ui-xl/lg/base` 等，具体档位按现有 tokens 输出方式定义为静态段；**不改** html 根 font-size），`gen:tokens:check` 必须能校验。
2. `assistantMarkdown.tsx` 的 h1–h6 映射到标度（h1 最大 → h6 最小，h3–h6 可用字重区分），正文 p 给舒适行高（如 leading-relaxed 级别）；不动 code/table 等既有映射。
3. 标度规则写进 `config.mjs` 头部注释（该文件已有设计说明惯例）。
4. 这是设计规则借鉴而非复制代码，无需归属头；但需在注释中注明标度理念参考 ZCode DESIGN.md。

**门禁**：desktop `gen:tokens:check` 通过；desktop `build`（含 tsc + vite）通过；desktop `lint`（含 radius/lifecycle 自研检查）通过。

### 任务 C：三方合规流水线（repo 根）

**落点**：
- 新增 `scripts/licenses.mjs`（含其依赖的兄弟脚本，按需拆分）
- 新增 `third-party/inventory.json`（登记复核项）
- 根 `package.json` 增 `licenses:check` / `licenses:notices` scripts
- `THIRD-PARTY-NOTICES.md` 生成产物**不入库**（加入 .gitignore），按需生成
- 新增 `docs/development/third-party-licenses.md`（用法与口径说明）

**ZCode 参照**：`/Users/zhvala/SourceCode/zcoder/scripts/licenses.mjs` 及其 import 的 `generate-third-party-notices.mjs`、`third-party-npm.mjs` 等；分类口径 green（MIT/ISC/BSD/Apache-2.0…）/yellow（LGPL/MPL/EPL 登记复核）/red（GPL/AGPL/SSPL/CC-NC 失败）。

**规格**：
1. 适配 pnpm workspace：实装清单从 workspace `node_modules` 递归收集（含嵌套版本），prod 判定按 `pnpm-lock.yaml` 生产图。
2. `check` 门禁：allowlist 之外或 license 未知即退出码 1；yellow 需在 `third-party/inventory.json` 登记 `reviewRequired` 结论后放行。
3. `notices`：按生产依赖精确版本收集真实许可文本生成 `THIRD-PARTY-NOTICES.md`。
4. 在现有依赖树上跑到绿（允许合理登记，如 better-sqlite3 MIT 等正常绿；发现真实 yellow/red 时如实登记并在结果中报告，不擅自改依赖）。
5. 从 ZCode 移植的脚本文件头保留 Apache-2.0 归属：`Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/licenses.mjs (Apache-2.0)`。

**门禁**：`node scripts/licenses.mjs check` 退出码 0。

### 任务 D：死代码与依赖工具（repo 根）

**落点**：
- `pnpm add -D -w knip ts-morph`（需网络安装）
- 新增 `knip.json`、`scripts/dep-refs.mjs`、`scripts/dependency-graph.mjs`
- 根 `package.json` 增 `knip` / `dep:refs` / `dep:graph` scripts
- 新增 `dependency-graph.mmd`（生成产物，入库可 diff）
- 发现报告写 `docs/reviews/2026-10-16-first-tier-implementation/knip-findings.md`

**ZCode 参照**：`/Users/zhvala/SourceCode/zcoder/knip.json`、`scripts/dep-refs.mjs`（387 行 ts-morph）、`scripts/dependency-graph.mjs`、`package.json:22-23,61`。

**规格**：
1. knip 配置到 `pnpm knip` 退出码 0（可对 docs/e2e/生成产物等合理 ignore）；**发现的问题只记录不删除**——全部写进 knip-findings.md 供后续人工清理。
2. `dep:refs --list-exports <file>` 回答"此文件导出被谁引用"；`dep:graph` 生成全 workspace 包级 mermaid 依赖图到根 `dependency-graph.mmd`。
3. 移植脚本保留 Apache-2.0 归属头（同任务 C 格式）。

**门禁**：`pnpm knip` 退出码 0；`node scripts/dependency-graph.mjs` 成功且 `dependency-graph.mmd` 存在；`node scripts/dep-refs.mjs --list-exports server/src/index.ts` 退出码 0。

### 任务 E：单命令分发（repo 根）

**落点**：
- 新增 `scripts/distribution/runner.mjs`、`scripts/distribution/build.mjs`、`scripts/distribution/installer.mjs`
- 根 `package.json` 增 `build:distribution` script
- 用法说明写在各脚本头部注释（暂不加独立文档）

**ZCode 参照**：`/Users/zhvala/SourceCode/zcoder/scripts/zcode-distribution/runner.mjs`（272 行零依赖：`--web` 分流 `:256`、非本机强制 token `:101-111,173-174`、空闲端口 `:113-129`、子进程环境变量拉起 `:178-192`）、`scripts/build-zcode.mjs`（`stageZCodePackage` `:157-219`）、`scripts/zcode-distribution/installer.mjs`。

**规格**：
1. `runner.mjs`：命令名 `zclaudia`；`--web [--port N] [--host H]` 用系统 `node` 启动打包内的 server 入口并以打包内 web dist 为静态根；无 TUI——无参数时打印用法；非 127.0.0.1/localhost 监听自动生成访问 token 并打印（沿用 ZCode 的 token 逻辑）；自动选空闲端口；SIGINT 优雅退出。零依赖（node 内置模块）。
2. `build.mjs`：组装 `server` 产物（`server/scripts/bundle.mjs` 的输出或 `tsc` dist，按自包含性择优）+ `apps/desktop/dist` → `releases/<version>/zclaudia-<version>-<platform>-<arch>.tar.gz` + `sha256.txt` + `latest.json`；版本号读根 `package.json`。
3. `installer.mjs`：生成 `install.sh`（拉 `latest.json` → 校验 sha256 → 安装到 `~/.zclaudia/runtime` → 建 bin 链接，支持 `ZCLAUDIA_DIST_HOME`/`ZCLAUDIA_DIST_BIN_DIR`）。
4. runner 支持 `--check --staging-dir <dir>` 自检模式（校验目录结构完整，不起服务），供测试与门禁使用。
5. 移植代码保留 Apache-2.0 归属头（Copyright 2026 Z.AI Co., Ltd + 原路径）。
6. **不在工作流里跑完整打包**（重构建留验收阶段）；自测用临时目录伪造 staging 验证 `--check` 与 `--help`。

**门禁**：`node scripts/distribution/runner.mjs --help` 退出码 0；`node scripts/distribution/runner.mjs --check --staging-dir <临时伪造目录>` 退出码 0（agent 自建临时目录）；eslint 通过。

## 2. 通用纪律（所有实现 agent 必须遵守）

1. 只改本任务落点范围内的文件；仓库存在**他人未提交的改动**（git status 可见），一律不得回退、不得 stash、不得 commit/push。
2. 从 ZCode 移植的代码：文件头归属注释（Copyright 2026 Z.AI Co., Ltd — adapted from <原路径>, Apache-2.0）；表数据等重写内容注明参考来源。
3. 遵循所在目录的现有代码风格与注释密度；新逻辑配测试（A）或自检模式（E）。
4. 规格与仓库现实冲突、或门禁确认无法达成时，escalate 说明情况，不得绕过或降低门槛造假。
5. 最终只返回结构化结果（改动文件/摘要/偏差/门禁证据），不贴大段代码。

## 3. 验收流程（主会话执行）

1. 逐任务审查 diff（含归属头、范围外文件零改动、不变量保持）。
2. 全仓回归：`pnpm lint` + `pnpm test:unit`（全 5000+ 用例）+ `pnpm plugins:test`。
3. E 项手工 smoke（时间允许时跑一次完整 `build:distribution` 并解包验证）。
4. 验收报告写入 `docs/reviews/2026-10-16-first-tier-implementation/acceptance.md`，逐项给 ✅/❌ 与遗留项。
