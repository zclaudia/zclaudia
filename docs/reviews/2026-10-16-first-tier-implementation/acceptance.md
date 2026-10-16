# 第一梯队借鉴项实现 · 验收报告

验收人：主会话（GLM-5.3）· 日期：2026-10-16
计划：[docs/plans/2026-10-16-first-tier-implementation-plan.md](../../plans/2026-10-16-first-tier-implementation-plan.md)
执行：动态工作流（A/B/C 并行 → D → E → 回归），实现 sub-agent 为 GLM-5.3-Flash，门禁全部由脚本 `world.run` 实跑。

## 结论：5/5 任务通过验收 ✅（其中 1 项回归失败经归因为外部因素，见 §3）

## 1. 逐任务验收

### A · Provider 重试加固 ✅
- 文件：`server/src/infra/providers/pi-runtime/{retry-stream.ts, provider-business-codes.ts(新), __tests__/retry-stream.test.ts}`
- 代码审查：归属头齐全；三大不变量保持（已转发内容绝不重试 / aborted 直通 / MAX_ATTEMPTS=5 不变）；`x-should-retry: false/0` 绝对否决、业务码优先于状态码（200+可重试码重试、5xx+终止码不重试）、Retry-After ≤5min 完整采用不截断、`retry-after-ms` 头优先。
- 门禁：server 全量测试 **6576 passed / 1 skipped**（skip 为存量）、`retry-stream.test.ts` 28/28、tsc 通过、eslint 0 error。
- 值得注意的偏差（合理）：① ZCode `isReasonableRetryAfterMs` 的"超上限但短于本地指数延迟仍采用"子句因我方指数封顶 60s < 5min 不可达而省略（有测试证实）；② x-should-retry 实现为绝对阻断（ZCode 仅中和 retry-after），语义更强且已在注释注明。

### B · Markdown 类型标度 ✅
- 文件：`apps/desktop/scripts/tokens/config.mjs`、`gen-tokens.mjs`、`src/styles/index.css`（生成块）、`src/features/chat/message-list/assistantMarkdown.tsx`
- 代码审查：`--font-ui-base` 锚定既有 `--chat-font-prose`（跟随用户 small/medium/large 字号预设），xl/lg/sm/xs 以 calc 派生；h1→xl、h2→lg、h3–h6→base+字重区分（对齐 ZCode message.tsx:440-447）；`not-prose` 退出 `.prose.prose-sm :where(h*)` 高特异性兜底是正确做法（该规则本就保留了此逃生口）；设计规则写入 config.mjs 头注释并注明参考 ZCode DESIGN.md。
- 门禁：gen:tokens:check clean、desktop 构建（tsc+vite）通过、eslint 0 error + lifecycle/radius 检查通过、tokens 单测 9/9、dist CSS 验证变量与工具类均生成。

### C · 三方合规流水线 ✅
- 文件：`scripts/licenses.mjs` + `scripts/licenses/`（3 个兄弟脚本）、`third-party/`（inventory + npm-overrides + 14 份上游许可文本）、package.json、.gitignore、`docs/development/third-party-licenses.md`
- 代码审查：pnpm 隔离布局适配（`.pnpm` 虚拟 store 扫描，实测 116→1037 包）；锁文件生产图/实装图一致性断言；`copiedComponents` 数组为未来搬入 ZCode 源码预留登记位（合规前置达成）；负面测试（bucket 不匹配/清空登记/缺数组均正确 exit 1）。
- 门禁：`licenses:check` exit 0（1035 实装包，570 生产）；`--strict` 与 notices 生成（992,847 字节）后复检通过。
- ⚠️ **合规发现（需产品侧知悉）**：`@anthropic-ai/claude-agent-sdk`（生产依赖）为 Anthropic 专有许可（保留所有权利），已按新增 `review-proprietary` 分类登记放行——**若随产品分发需单独复核 Anthropic 的再分发条款**；sharp-libvips（LGPL-3.0，dev）与 lightningcss（MPL-2.0，dev）已登记复核。

### D · knip 与依赖图工具 ✅
- 文件：`knip.json`、`scripts/dep-refs.mjs`、`scripts/dependency-graph.mjs`、`dependency-graph.mmd`（入库）、package.json/pnpm-lock（+knip 6.41、ts-morph）
- 代码审查：归属头与适配差异注释齐全（文件级图→包级图的偏离有说明）；"只记录不删除"纪律遵守——461 项存量发现在 knip.json 逐文件挂账，台账见 [knip-findings.md](knip-findings.md)（含 1 个高危：`invocations.test.ts` import 不存在的 `../types.js`）。
- 门禁：`pnpm knip` exit 0；依赖图生成（7 包 8 边）；dep-refs 对 `shared/src/core/project.ts:ProjectType` 实测返回 5 处引用，功能真实。

### E · 单命令分发 runner ✅
- 文件：`scripts/distribution/{runner,build,installer}.mjs` + testdata、package.json（`build:distribution`）
- 代码审查：runner 零依赖；非本机监听自动 token、空闲端口、SIGINT/SIGTERM 优雅退出均沿用 ZCode 语义；build 取 server 自包含 bundle（优于 tsc dist）；installer **超出规格补了 sha256 校验**（ZCode 原版没有）。
- 门禁：--help/--check/负例全过；**端到端冒烟**：--skip-build 复用现有产物真实打出 `zclaudia-0.1.1220-darwin-arm64.tar.gz` + sha256 校验 OK + 解包后 --check/--version 全过 + install.sh 语法检查过 + --web 子进程拉起冒烟过。
- 已知半程（记录在 runner 头注释）：runner 生成/传递 `ZCLAUDIA_SERVER_AUTH_TOKEN`，但 **server 侧尚无消费该变量的鉴权中间件**——服务端强制鉴权列为后续项。

## 2. 门禁执行方式说明（可信度）

所有"通过"均为脚本 `world.run` 实跑退出码判定，非 agent 自述；实现员另附自跑证据。验收人复跑并确认了 R1（修复后）与失败测试的隔离复现。

## 3. 全仓回归结果

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| R1 根 eslint（--quiet） | ❌→✅ | 20 个 error 全部来自 `.zcode/workflow-runs/*.mjs`（工作流基础设施写进仓库的机器生成脚本被 eslint 扫到）。**验收修复**：eslint.config.mjs ignores 增加 `.zcode/**`，复跑 exit 0。非任务代码问题。 |
| R2 server 全量测试 | ✅ | 569 文件 / 6576 用例通过（1 skipped 为存量）。 |
| R3 desktop 单测 | ❌（外部） | 113 文件中 1 个失败：`src/stores/__tests__/workspaceAnchorLifecycle.test.ts`「real facade archive removes even the last chat…」期望 sessions `['A','B']` 实得 `['B']`。**归因**：① 隔离复跑确定性失败；② 该测试主题（项目/会话锚定、chat-card workspace）与 5 个任务落点零交集（属 a8fbc9d7 功能线）；③ 工作区同期存在并行工作流对 projects 域/shared project.ts 的大批未提交改动（multi-directory projects），主题完全重合。判为并行工作流或存量问题，**不由第一梯队承担**，建议该工作流跟进。 |
| plugins:test（工作流外，验收人执行） | ✅ | claude 插件 12 文件 87 用例通过（含并行工作流未提交的 permissions 改动）。 |

## 4. 遗留与后续项

1. **E 后续**：server 侧消费 `ZCLAUDIA_SERVER_AUTH_TOKEN` 的鉴权中间件（token 语义闭环）；`latest.json` 多平台索引。
2. **knip 台账**：461 项存量待人工分批清理（含 1 个失效 import 高危项）；清理后删除 knip.json 对应挂账。
3. **合规**：claude-agent-sdk 专有许可的分发复核；413 条 desktop 既有 eslint warning（存量，本次未处理）。
4. **B 后续（可选）**：标题行内 code 失去 prose 药丸底色（与 ZCode 行为一致，若在意可补样式）。
5. 完整 `build:distribution`（真实重构建全链路）未跑——E 的 --skip-build 端到端已覆盖打包/校验/安装/运行路径，首次真实发布前建议跑一次。

## 5. 范围纪律核查

工作区 52 个变更文件精确分为三组，零越界、零回退他人改动、未执行任何 git commit：
- 第一梯队（5 任务 + 验收修复 eslint.config.mjs）：见上文文件清单
- 会话开始前已存在的未提交改动：plugins/agents/claude permissions 三件 + fixtures、server conversation/runtime 六件（原样未动）
- 并行工作流：projects 域 / sandbox.ts / migrations 048 / sensitive-paths.ts / shared project.ts / spike 文档（非本任务，未触碰）
