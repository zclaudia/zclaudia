# 第二梯队轻量批（台账 32–38）实现 · 验收报告

实现：2026-10-18 动态工作流（8 条目并行实现 + 多轮门禁修复），实现 sub-agent 为 GLM-5.3-Flash
验收：2026-10-19 验收 sub-agent（GLM-5.3-Flash）——工作流自报证据逐条核对，并对可复跑的门禁/测试实际复跑（见 §3）
台账：[docs/reports/2026-10-18-open-items-ledger.md](../../reports/2026-10-18-open-items-ledger.md)（已同步更新）

## 结论：8 项中 7 项通过验收 ✅、1 项带缺陷通过 ⚠️（条目 37，验收复跑发现 server tsc 新增 1 个类型错误）

- 功能与测试面：8 个条目的实现内容、单测、归属登记均核实为真；验收人复跑 9 个关键测试套件共 **537 用例全部通过**。
- 发现 1 个**本批引入的新缺陷**（工作流自报 tsc 通过与最终树不符）：`server` 包 `tsc --noEmit` 当前 **exit 1**，错误在条目 37 的路由代码，见 §2 条目 37 与 §5 遗留 R1。
- 三个仓库级门禁的残留失败（format:check 17 个 docs、check:architecture 1 条 desktop 越界、test:desktop 1 个用例）经归因均为 **main 既有/他人未提交改动**，非本批引入；归因证据链见 §4。

## 1. 范围与编号说明

工作流条目编号 32/33/33d/34/35/36/37/38 是工作流内部任务号，对应台账（[2026-10-18-open-items-ledger.md](../../reports/2026-10-18-open-items-ledger.md)）§5「工具集缺口」与 §2「P2 摘要」中的条目：

| 条目 | 内容                                                                                                          | 台账出处               |
| ---- | ------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 32   | 危险命令规则补强（bash-guards 双层守卫 + permission-evaluator）                                               | §5 工具集缺口 P1       |
| 33   | Grep `multiline`/`type`/`offset`；Read 视频 + 缺文件 Did-you-mean；Agent 同步返回附 `<usage>`（a/b/c 三子项） | §5 工具集缺口「仍缺」  |
| 33d  | Bash `cd` 持久 + 图片输出                                                                                     | §5 工具集缺口「仍缺」  |
| 34   | 连接级能力协商 + host capability 票据                                                                         | §2 P2（T2 §2.8）       |
| 35   | 重试预算档位 + env 可调                                                                                       | §2 P2（T6 §2.8）       |
| 36   | skills-lock 锁定格式                                                                                          | §2 P2（T5 §2.4）       |
| 37   | 外部技能一键导入（Claude Code / Codex / Cursor）                                                              | §2 P2（T5 §2.5）       |
| 38   | 官方技能内容直接分发（superpowers / zcode-guide）                                                             | §2 P2（T5 §2.2/§2.11） |

## 2. 逐条目验收

以下每条的 summary / filesChanged / testsRun / notes 为工作流自报材料，验收人在「验收复跑」列标注本人实测结果（未复跑的如实标注「未复跑，采信工作流自报」）。

### 32 · 危险命令规则补强 ✅

- **summary**：按双层守卫架构补强危险命令规则。关键命令闸门（bash-guards）新增：rm 递归删 home/通配、find -delete（根路径）、su/sudo 提权 shell、dd of=设备、diskutil 擦盘、任意管道入 shell、eval+base64、sh -c 包裹远程抓取；normalize.ts 新增 expandAssignedVariables 变量展开，findCriticalBashPattern 与 findBashSensitivePathAccess 均对展开后文本重匹配，关闭了测试中原被 pin 的两个已知绕过（变量间接 `~/.$K/id_rsa`、`printf|bash`）。permission-evaluator.ts 的 DANGEROUS_BASH_PATTERNS 补 su、find -delete、git clean -f、rsync --delete（排除 dry-run）、chmod -R 777/a+rwx、dd of=/dev/、diskutil、fork 炸弹、管道入 shell、base64/eval 执行，format 收窄到命令位置（npm run format 不再误报）。
- **filesChanged**：`server/src/infra/providers/pi-runtime/bash-guards/normalize.ts`、`bash-guards/patterns.ts`、`bash-guards/detect.ts`、`bash-guards.ts`、`server/src/application/conversation/agent/permission-evaluator.ts`、对应两个测试文件。
- **testsRun（工作流自报）**：bash-guards.test.ts 155/155；permission-evaluator.test.ts 140/140；8 文件 577/577（guards/敏感路径/集成/bash-tool/eval-tool/evaluator/bash-readonly）；server tsc 通过。**验收复跑**：guards + evaluator 两文件 295/295 通过（本人实测）；fork 炸弹、diskutil 擦盘、fetch 入 shell、eval+curl 等模式在 patterns.ts:75-114 实际存在（本人抽查）。
- **notes（工作流自报）**：误报控制有反例测试 pin（rm -rf build、rm -f \*.log、find . -delete、dd of=/dev/null、diskutil list、rsync -n、git clean -n、chmod 755、npm run format 均不拦）；sudo/shutdown/mkfs 在分类层保持不锚定（让引号载荷仍归类 destructiveOps），命令位置锚定放关键闸门层；base32/openssl 解码与无抓取标记的进程替换仍属已知 UX 层缺口，已 pin 在测试里；Windows CMD 方言（rd/del/robocopy）超出本仓 POSIX Bash 工具范围，未做。
- **归属登记**：规则语义参考 ZCode guarded/\*（argv 解析器），实现为本仓正则表——语义参考、未复制代码，按约定**未登记** third-party-licenses inventory。核实：无登记需求。

### 33 · Grep/Read/Agent 三子项 ✅

- **summary**：(a) Agent 工具 `wait: true` 同步返回末尾附 `<usage>` 块（subagent_tokens/input/output/cache/tool_uses/duration_ms），数据源取子代理 run_completed 自带 wire usage，经 runner→executor→TaskResult.usage 新链路透传并随任务行持久化；(b) Grep 补齐 multiline（-U --multiline-dotall）/type（--type）/offset（采集后切片，三种 output_mode 均支持，响应带 offset/nextOffset 分页字段），shared tools.ts 元数据同步更新；(c) Read 对视频扩展名返回明确 video_not_supported 错误（pi-ai 0.84.1 无 video content block，已在 node_modules 类型里核实），缺文件返回 file_not_found + Did-you-mean 候选（同词干优先、编辑距离 ≤3、目录扫描优先、rg --files 兜底、最多 3 个）。
- **filesChanged**：`shared/src/core/task.ts`、`shared/src/core/tools.ts`、`server/src/domains/tasks/executors/agent-runner-contract.ts`、`agent-executor.ts`、`server/src/application/orchestration/agent-task-runner.ts`（+测试）、`server/src/infra/providers/pi-runtime/task-tools.ts`、`search-tools.ts`、`read-tool.ts`（+各自测试）、`third-party/inventory.json`。
- **testsRun（工作流自报）**：task-tools/search-tools/read-tool 3 文件 79 测试全过；8 个相关测试文件 108 测试全过；shared 33 文件 245 测试全过；server tsc 全仓干净通过；licenses:check 通过。**验收复跑**：task-tools/search-tools/read-tool/bash-tool/bash-session-cwd/retry-stream 6 文件 166/166 通过；agent-task-runner + agent-task-executor 5/5 通过（本人实测）；read-tool.ts:67 有 ZCode attachment-video 来源注释（本人抽查）。
- **notes（工作流自报）**：(a) 本仓异步完成通知无 `<usage>` 输出，故对齐 ZCode aac47556 同步格式并加仓内 UsageInfo 明细行，结构化数据同时进 details.usage；(b) 底层为本仓直调的原生 ripgrep 15.2.0，实测 -U/--type 均可用，rg 无 offset flag 故在工具内切片；(c) 视频按条目要求走「上游不支持」路径并附 ffmpeg 抽帧指引，Did-you-mean 阈值与 ZCode 相同但为自写实现。遗留：仓库级 tsc 与 check:architecture 各有一个非本条目预存问题。
- **归属登记**：视频 mime 映射从 ZCode 移植——已登记 `third-party/inventory.json` copiedComponents 条目 **zcode-read-video-mime**（Apache-2.0，含适配说明）；Did-you-mean 为语义参考自写，不登记。核实：inventory 实有该条目（本人读取）。

### 33d · Bash cd 持久 + 图片输出 ✅

- **summary**：① cd 持久：现有会话模型是每次调用新起 `bash -c` 进程（bash-runner.ts:301-370），故实现 session→cwd 映射——命令末尾追加探针（保留退出码、打印 `pwd -P`），成功后回写、下次调用恢复；语义参照 ZCode bash-cwd-policy（仅成功才持久、离开工作区重置回根并提示），pwd -P 物理路径做去 symlink 归一。② 图片输出：stdout 整体为 data URL、含 iTerm2 inline-image 转义序列、或打印了存在的图片文件路径时，转为 image content block（复用 Read 的 5MB/50MB 限制与 compressImageToLimit 降采样，最多 3 张，gated on supportsVision）；sixel 检测后以占位符+说明返回（运行时无 sixel 解码器）；全部内存解码，无临时文件，转义序列从输出清除。
- **filesChanged**：`server/src/infra/providers/pi-runtime/bash-tool.ts`、`bash-session-cwd.ts`（新）、`bash-image-output.ts`（新）、对应三个测试文件（两个新增）。
- **testsRun（工作流自报）**：3 文件 56 tests 全过；7 文件 343 tests 全过（确认条目 32 规则未破坏）；server tsc 无错误；prettier 已格式化。**验收复跑**：bash-tool/bash-session-cwd/bash-image-output 三文件随 §3 复跑通过（166 中含前两者 43 用例 + bash-image-output 13 用例，均本人实测）；bash-image-output.ts:83-88 的 no-control-regex eslint-disable 及理由注释在位（本人抽查）。
- **notes（工作流自报）**：探针随前台命令执行，守护规则仍分析原始命令；超时转后台的命令探针行留在后台日志尾部；含裸 `exit`/`exec` 的命令不更新 cwd；失败命令不更新 cwd。sixel 无法成块（无解码器）。
- **归属登记**：cd 持久与 data-URL 图片检测为 ZCode 语义参考、自行实现，按约定**未登记** inventory（文件头注明语义参照来源）。核实：无登记需求。

### 34 · host capability 票据 ✅

- **summary**：按 T2 §2.8 移植 ZCode 一次性 host capability 票据机制：`server/src/auth.ts` 新增 createHostCapabilityStore（签发/消费即作废/30s TTL/防重放）；`interfaces/http/middleware/auth.ts` 新增 createHostCapabilityUpgradeGuard + rejectUpgrade（依赖注入式，遵守 interfaces 不得 import root 的分层）；`server.ts` 接线 POST /api/host-capability 签发路由 + /ws/host upgrade 分支（无效/过期/重放一律 401）；连接标记 isTrustedHost（仅 upgrade 路径可设，客户端消息无法自升）。
- **filesChanged**：`server/src/auth.ts`、`server/src/interfaces/http/middleware/auth.ts`、`server/src/server.ts`、`server/src/utils/connected-client.ts`、对应两个测试文件、`third-party/inventory.json`。
- **testsRun（工作流自报）**：auth + middleware auth 2 文件 63 测试全过（新增 12 store 测试 + 7 guard 测试）；server tsc 通过（修正 upgrade socket 为 Duplex 类型）；eslint 0 告警；licenses 登记校验通过。**验收复跑**：`HOST_CAPABILITY_HEADER = 'x-zclaudia-host-capability'` 在 auth.ts:31 确认（本人抽查）；auth.ts:4-8 ZCode 归属头在位（本人抽查）；中间件/auth 相关测试未整体复跑，采信工作流自报。
- **notes（工作流自报）**：guard 改注入式以遵守 SERVER_LAYER_ORDER 分层裁定；header 常量由 x-zcode-rpc-host-capability 改名；签发路由未配集成测试（createServer 启动需 DB/workspace，仓内无启动 harness），票据语义与 guard 已单测覆盖；签发路由按 ZCode 同款不做鉴权（一次性+TTL+消费即作废约束风险）；宿主专属能力消费留待后续条目。
- **归属登记**：已登记 `third-party/inventory.json` copiedComponents 条目 **zcode-host-capability**（Apache-2.0，ZCode packages/server/src/hostCapability.ts）。核实：inventory 实有该条目、auth.ts 文件头归属注释在位（本人读取）。

### 35 · 重试预算档位 + env 可调 ✅

- **summary**：retry-stream.ts 内移植 ZCode 重试预算档位（default/unbounded/single-attempt；unbounded 只放宽 attempt 循环与失败放弃两处闸门）与环境变量可调策略（显式 options > ZCLAUDIA*MODEL_RETRY*\* env > 默认值，env 按请求时解析）。默认值保留本仓历史硬编码（5 次总尝试/1s 基数/2x 退避/60s 封顶/250ms 加法 jitter），行为与移植前一致；jitter 为毫秒量级而非 ZCode 布尔乘法；ZCLAUDIA_MODEL_RETRY_MAX_ATTEMPTS 计总尝试数（ZCode 的 MAX_RETRIES 不含首次），偏差已写入文件头来源注释。
- **filesChanged**：`server/src/infra/providers/pi-runtime/retry-stream.ts`、对应测试文件、`third-party/inventory.json`。
- **testsRun（工作流自报）**：retry-stream.test.ts 44/44（移植前 28 + 新增 16）；server tsc 无错误；eslint 0 问题；inventory 校验通过。**验收复跑**：retry-stream.test.ts 44/44 通过（含在 §3 复跑的 166 用例内，本人实测）；ZCLAUDIA*MODEL_RETRY*\* 常量与文件头 adapted-from 注释在 retry-stream.ts:23-24/111-114 确认（本人抽查）。现有调用方（agent-stream.ts:125、pi-agent-loop-executor.ts:121）零改动保持原行为（工作流自报，未复跑）。
- **notes（工作流自报）**：落地点全部在 retry-stream.ts（未另建文件）；unbounded 下 onRetry.maxAttempts 用哨兵 0；登记时保留并行条目 zcode-host-capability。遗留：budget 档位目前仅以 API 形式暴露，尚无上游配置源传入（属后续条目）。
- **归属登记**：已登记 `third-party/inventory.json` copiedComponents 条目 **zcode-retry-budget-policy**（Apache-2.0）。核实：inventory 实有该条目（本人读取）。

### 36 · skills-lock ✅

- **summary**：自建最小 skills-lock 生成/校验：新模块 `server/src/application/plugins/skills-lock.ts` 采纳 ZCode 锁文件记录字段（name/source/sourceType/computedHash + 可选 version），在 skill-tools.loadAndCacheSkills 装载流程内对 external 技能做「先校验后刷新」——hash 不一致产出 skill_lock_hash_mismatch 诊断后把锁刷新为当前状态；workspace（内置）与插件技能不入锁。锁文件固定写 `~/.zclaudia/skills-lock.json`；启动/HTTP 技能写删/skill-dirs 更改/SKILL.md 变更监视器均汇经该装载函数；锁为 best-effort，损坏或不可写只告警不阻断。
- **filesChanged**：`server/src/application/plugins/skills-lock.ts`（新）、`skill-tools.ts`、对应两个测试文件（一新增）。
- **testsRun（工作流自报）**：skills-lock + skill-tools 2 文件 32 用例全过（含 4 个新集成用例：external 入锁且排除 workspace、插件技能不入锁、篡改产生 hash_mismatch 诊断且自愈、删除后锁条目移除）；邻近 3 测试文件 16 过 1 跳过（既有 skip）；server tsc exit 0；eslint 0 错误。**验收复跑**：skills-lock.test.ts 11/11 通过（含在 §3 复跑的 71 用例内，本人实测）；skills-lock.ts 头注释注明格式出处（本人抽查）。
- **notes（工作流自报）**：锁写入时机挂在唯一装载汇聚点 loadAndCacheSkills（skill-tools.ts:414）；校验语义为「检测而非阻断」，诊断经 GET /api/workspace/skills 可见；hash 取 SKILL.md 原文 sha256；version/source/sourceType 从 frontmatter 声明读取。
- **归属登记**：本实现为原创代码，仅采纳 ZCode skills-lock.json 数据格式的字段形状（T5 报告 §2.4 已确认 ZCode 仓库内无该文件的生成/消费代码），按约定**未登记** inventory，模块头注明格式出处。核实：inventory 无对应条目（本人读取，共 5 条均为其他条目）。

### 37 · 外部技能一键导入 ⚠️（功能完成、测试全过，但验收复跑发现最终树 server tsc 失败）

- **summary**：Claude Code（~/.claude/skills）、Codex（~/.codex/skills）、Cursor（~/.cursor/skills）三来源扫描+导入，软链（Windows junction）或复制两种方式，同名目录/name 冲突跳过不覆盖，结果按来源汇总。server 新增 skill-import.ts（纯模块，经 skills-lock.ts API upsert 锁条目）+ workspace 路由 GET /skills/import/scan、POST /skills/import（导入后 refreshSkillCache + 刷新锁 + upsert 导入来源）；desktop Skills 库工具栏加 Import 按钮打开 SkillImportModal（来源清单、全选/单选、软链/复制切换、结果页逐技能状态）。拷贝导入在副本 SKILL.md 注入 source/sourceType frontmatter 使来源经锁重建保留。
- **filesChanged**：`server/src/application/plugins/skill-import.ts`（新）、对应测试（新）、`server/src/interfaces/http/workspace.ts`（+测试）、`apps/desktop/src/services/api/workspace-skills.ts`、`SkillImportModal.tsx`（新，+测试）、`BrowseView.tsx`、`AgentsContent.tsx`。
- **testsRun（工作流自报）**：skill-import.test.ts 19 passed；4 文件 62 passed（含 5 个新路由用例）；SkillImportModal.test.tsx 6 passed；desktop 既有 agents 用例 86 passed 无回归；server/desktop tsc 均通过；eslint 0 errors。
- **⚠️ 验收复跑发现（本人实测，2026-10-19 01:18）**：`cd server && ./node_modules/.bin/tsc --noEmit` **exit 1**：

  > src/interfaces/http/workspace.ts(183,9): error TS2322: Type '{ agent: string; name: string; }[]' is not assignable to type 'ExternalSkillSelection[]'. Types of property 'agent' are incompatible. Type 'string' is not assignable to type 'ExternalSkillAgentKey'.

  路由在 workspace.ts:183 将 selections 断言为 `{ agent: string; name: string }[]`，而 skill-import.ts:101-108 的 `ExternalSkillSelection.agent` 是受限字面量联合 `'claude-code' | 'codex' | 'cursor'`（skill-import.ts:47）。该错误为**本条目引入**：HEAD 上无该路由（`git show HEAD:server/src/interfaces/http/workspace.ts | grep -c "skills/import"` = 0，skill-import.ts 为新增未跟踪文件）；四个相关文件 mtime 均为 01:07（末轮 prettier 之后无外部改动），推测工作流自报的 tsc 通过发生在引入受限联合类型的改动之前。功能本身不受影响（运行时有字符串校验 + skill-import 内 isSelection 守卫，19+5 个相关测试实跑全过，本人复跑 19/19 通过），但 server 包 tsc 门禁当前为红，需一行修复（改用导出的类型守卫或断言为 `ExternalSkillSelection[]`）后复跑 tsc。**已列入 §5 遗留 R1。**

- **notes（工作流自报）**：只做 3 个用户级来源（≥3 即达标），导入目标固定全局 ~/.zclaudia/skills；ZCode 规格的 Global/Project 范围切换、工作区级扫描、向导式分栏树未包含；软链导入后锁刷新会按条目 36 语义把来源归一化为本地默认值（已在代码头注释说明）；测试全部用临时 fixture 目录，未对真实用户目录导入。
- **归属登记**：按 ZCode 设计文档（docs/external-agent-skills-import.md，Apache-2.0）语义自研、未复制源码，文件头注明设计来源，按约定**未登记** inventory。核实：无登记需求。

### 38 · 官方技能内容分发 ✅

- **summary**：以两个内容型插件分发进 plugins/skills/：superpowers（5 个通用方法论技能逐字复制 + frontmatter/宿主引用适配，MIT LICENSE 随插件附带）与 zcode-guide（五件套自诊断按本仓子系统事实重写）。10 个 SKILL.md 均带 license/source/sourceType/version 溯源 frontmatter，并以条目 36 的 SkillsLockFile 格式登记进 plugins/skills/skills-lock.json（sha256 实测新鲜）；superpowers MIT（© Jesse Vincent）、zcode-guide Apache-2.0（© Z.AI）已登记 third-party/inventory.json copiedComponents。
- **filesChanged**：`plugins/skills/`（README、skills-lock.json、superpowers/ 10 文件、zcode-guide/ 7 文件）、`server/src/application/plugins/__tests__/distributed-skills.test.ts`（新）、`third-party/inventory.json`。
- **testsRun（工作流自报）**：distributed-skills.test.ts 28/28（manifest 校验、pi frontmatter 规则、锁哈希新鲜性、来源分组、LICENSE 文本）；skills-lock + skill-tools 32/32 未破坏；licenses:check 通过；宿主引用残留 grep 仅剩有意的 sourceType: zcode 溯源值。**验收复跑**：distributed-skills.test.ts 28/28 通过（含在 §3 复跑的 71 用例内，本人实测）；plugins/skills/superpowers/LICENSE 为 MIT © 2025 Jesse Vincent（本人抽查）；skills-lock.json 含 10 条带 sha256 的记录（5 条 sourceType github + 5 条 zcode，本人读取）；两 plugin.json 均 activationEvents: ["onStartup"]（本人抽查）；brainstorming SKILL.md 带 `source: obra/superpowers` frontmatter（本人抽查）。
- **⚠️ 验收发现（本人核实）**：**plugins/skills/ 当前被 .gitignore 忽略**——.gitignore:134 的 `/plugins/*` 规则仅有 `!/plugins/agents/` 一个否定项（`git check-ignore -v` 实测 plugins/skills/superpowers/plugin.json、plugins/skills/skills-lock.json 均命中忽略规则）。工作流按约定未 commit，但在提交这批文件前必须给 .gitignore 增加 `!/plugins/skills/` 否定规则，否则 17 个插件内容文件会**静默不入库**（git status 也不显示）。已列入 §5 遗留 R2。
- **notes（工作流自报）**：① 任务给的源路径实为 ZCode 内部 plans/specs，superpowers 技能实际取自 apps/zcode-cli/packages/superpowers-plugin/skills（MIT，上游 obra/superpowers）；② zcode-guide package.json 声明 MIT 但包内无许可文件且从未脱离 Apache-2.0 仓库发布，按任务指示以 Apache-2.0 登记（README/inventory 已注明矛盾）；③ 未分发：superpowers 其余 9 技能强依赖 ZCode 宿主语义，zcode-guide 的 zcode-configuration-guide 无本仓可适配事实；④ 运行时加载边界：服务器只扫描 `<dataDir>/plugins` 与内置插件，仓库内 plugins/skills 需经 plugin_extra_dirs 设置被发现（loader.ts:214-216/337），发布包 staging 属后续工作；⑤ 插件技能不入运行时锁（skill-tools.ts:350-354 注释），plugins/skills/skills-lock.json 为仓库静态溯源登记。
- **归属登记**：已登记 `third-party/inventory.json` copiedComponents 两条：**superpowers-skills**（MIT，© Jesse Vincent）、**zcode-guide-diagnosing-skills**（Apache-2.0，© Z.AI）。核实：inventory 实有两条（本人读取）。

## 3. 验收复跑记录（验收人本人实跑，2026-10-19 01:07–01:21）

| 检查                     | 命令                                                                                                    | 结果                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 第三方许可               | `node scripts/licenses.mjs check`                                                                       | ✅ exit 0（1056 实装包，生产图 570，登记复核 3 项）                                                                   |
| 架构边界                 | `bash scripts/with-project-node.sh node scripts/dev/check-architecture-boundaries.mjs`                  | ❌ 仅 1 条违规：`apps/desktop/src/features/settings/ProjectSettings.tsx -> features/sidebar`（与本工作流无关，见 §4） |
| server 类型检查          | `cd server && ./node_modules/.bin/tsc --noEmit`                                                         | ❌ **exit 1**：workspace.ts(183,9) TS2322（本批条目 37 引入，见 §2-37/§5 R1）                                         |
| desktop 类型检查         | `cd apps/desktop && ./node_modules/.bin/tsc --noEmit`                                                   | ✅ 通过（无输出）                                                                                                     |
| 守卫双套件               | `pnpm --filter @zclaudia/server exec vitest run …/bash-guards.test.ts …/permission-evaluator.test.ts`   | ✅ 295/295（155+140，与自报一致）                                                                                     |
| 新增套件 ×4              | vitest run skill-import / skills-lock / distributed-skills / bash-image-output                          | ✅ 71/71（19+11+28+13）                                                                                               |
| 条目套件 ×6              | vitest run task-tools / search-tools / read-tool / bash-session-cwd / bash-tool / retry-stream          | ✅ 166/166                                                                                                            |
| runner/executor          | vitest run agent-task-runner + agent-task-executor                                                      | ✅ 5/5                                                                                                                |
| desktop 失败用例隔离复跑 | `pnpm --filter @zclaudia/desktop exec vitest run src/stores/__tests__/workspaceAnchorLifecycle.test.ts` | ❌ 1 failed / 12 passed——与门禁记录中 main 既有失败一致（归因见 §4）                                                  |
| 格式检查                 | `pnpm format:check`                                                                                     | ❌ 验收复跑时恰 17 个文件，全部 docs/\*.md（与门禁预测收敛一致，见 §4；验收更新台账并对其格式化后残留下修为 16）      |
| 归属抽查                 | git check-ignore、inventory 读取、文件头/LICENSE/frontmatter 抽查                                       | 见各条目「归属登记」与「验收发现」                                                                                    |

未复跑（采信工作流自报实跑记录）：server 全量套件、desktop 全量套件、shared 全量套件、各条目 eslint、门禁三轮的历史执行过程。

## 4. 门禁与全量测试结论

工作流门禁共 3 轮 + 1 轮全量，逐轮记录见工作流输出；收敛后的**最终门禁状态**：

| 门禁                                   | 最终结果  | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                            | ✅ exit 0 | 第 1 轮失败由 bash-image-output.ts 的 2 个 no-control-regex error 引起，已修（eslint-disable + 理由注释，85:18 处在位，本人抽查）；第 2 轮起 0 errors，check:lifecycle 首次真正执行输出 OK。其余 884 条 warning 均在本批改动集之外的存量文件。                                                                                                                                                                                                                                                                                                                          |
| `pnpm format:check`                    | ❌ exit 1 | 残留为 docs/\*.md（验收复跑时 17 个，见 §3）。归因：第 1 轮在干净 HEAD（e03bce22）worktree 实测这 17 个文件全部已失败——9 个属他人未提交改动（first-tier-implementation-plan、zcode-gap-analysis-plan、T1–T7），8 个是 main 已提交的失格式内容；本工作流的 18 个代码/数据文件已由 prettier --write 修复且第 2 轮起从失败列表消失。**非本批引入，待 docs 负责人单独处理。** 验收阶段更新台账时对其整体 prettier --write（该文件原在 8 个 main 失格式名单内），残留降为 16。                                                                                               |
| `pnpm check:architecture`              | ❌ exit 1 | 唯一违规 ProjectSettings.tsx → features/sidebar（验收复跑证实仅此 1 条）。该 import 与边界脚本在工作区均无改动，由 multi-dir 提交 c06fcbd0 引入（经 c95bbccb 合入 main）；第 1 轮在干净 HEAD worktree 复现同一失败。**main 既有问题，非本批引入。**                                                                                                                                                                                                                                                                                                                     |
| `pnpm test:server`                     | ✅ exit 0 | 第 1 轮通过（在全部 8 条目实现之后）。注：最终全量 `pnpm test` 中 server 包标 Failed 系连坐——desktop 失败后 pnpm 中止递归（ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL），server 仅打印起跑行、无用例失败。                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test:desktop` / 全量 `pnpm test` | ❌ exit 1 | 唯一真实失败：`workspaceAnchorLifecycle.test.ts:257`「real facade archive removes even the last chat…」期望 ['A','B'] 实得 ['B']，三轮门禁 + 全量完全一致；第 1 轮在干净 HEAD worktree 同命令复现同一断言失败，且被测文件与 stores 不在本批改动集（desktop 侧仅改 features/agents 两文件、workspace-skills.ts、新增 SkillImportModal\*）。验收人隔离复跑同样 1 failed / 12 passed（见 §3）。**main 既有失败，非本批引入。** 其余：shared 33/33、codex 15/15（153 tests）、agent-common 5/5、desktop 1738/1739 通过；claude/cursor/server 三包标 Failed 系连坐非真失败。 |
| `pnpm licenses:check`                  | ✅        | 见 §3 复跑。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 5. 遗留项清单

**本批引入、需处理（按优先级）：**

1. **R1 · server tsc 红**：workspace.ts:183 TS2322（条目 37 路由的类型断言与 skill-import.ts:47/101-108 的受限联合不匹配）。一行修复（用导出的类型守卫或断言为 `ExternalSkillSelection[]`）+ 复跑 server tsc 与 workspace 路由测试。这是最终树里唯一已知的本批引入缺陷。
2. **R2 · plugins/skills 被 gitignore 忽略**：.gitignore:134 `/plugins/*` 仅否定 `!/plugins/agents/`。提交条目 38 的 17 个文件前需增加 `!/plugins/skills/`（或调整规则），否则静默丢失；`git status` 不会提示。
3. **R3 · 插件分发运行时链路未闭环**（条目 38 自报）：服务器只扫描 `<dataDir>/plugins` 与内置插件，仓库内 plugins/skills 需用户配置 plugin_extra_dirs 才会被发现；发布包 staging（stage-builtin-agents.mjs/macos.sh）属后续工作。
4. **R4 · 功能级长尾**（各条目自报，均已 pin 或注明）：bash-guards 已知 UX 层缺口（base32/openssl 解码执行、无抓取标记的进程替换）与 Windows CMD 方言未做；重试预算档位尚无上游配置源传入（仅 API 形式）；host capability 签发路由无集成测试（无启动 harness）、宿主专属能力消费留待后续条目；sixel 无解码器仅文字说明；软链导入技能的来源经锁刷新会被归一化（条目 36 设计行为）；superpowers 其余 9 技能与 zcode-configuration-guide 未分发（强依赖 ZCode 宿主语义/无可适配事实）；外部技能导入仅 3 个用户级来源、无 Global/Project 范围切换。

**非本批引入、维持挂账（归因证据见 §4）：**

5. format:check 残留 16 个 docs/\*.md（9 个他人未提交 + 7 个 main 已提交；原 17，台账因验收更新已格式化退出名单），待 docs 负责人处理。
6. check:architecture：ProjectSettings.tsx → features/sidebar（main，c06fcbd0 引入）。
7. test:desktop：workspaceAnchorLifecycle.test.ts:257（main 既有，建议由 projects 域工作流跟进；first-tier 验收报告 §3-R3 已有同源记录）。
8. 存量警告（本批未触碰）：lint 884 条 warning、knip 461 项、desktop 413 条 eslint warning（first-tier 台账）。

## 6. ZCode Apache-2.0 归属登记总况

| 条目 | 登记情况                                                                                                                                                                      | 核实              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 32   | 语义参考未复制，不登记                                                                                                                                                        | ✅                |
| 33   | copiedComponents **zcode-read-video-mime**（Apache-2.0）；Did-you-mean 自写不登记                                                                                             | ✅ inventory 实有 |
| 33d  | 语义参考自写，不登记                                                                                                                                                          | ✅                |
| 34   | copiedComponents **zcode-host-capability**（Apache-2.0）+ auth.ts 文件头归属注释                                                                                              | ✅ inventory 实有 |
| 35   | copiedComponents **zcode-retry-budget-policy**（Apache-2.0）+ retry-stream.ts 文件头 adapted-from 注释                                                                        | ✅ inventory 实有 |
| 36   | 原创实现（ZCode 无生成/消费代码），仅格式出处头注释，不登记                                                                                                                   | ✅                |
| 37   | 设计文档语义自研不登记（文件头注明设计来源）                                                                                                                                  | ✅                |
| 38   | copiedComponents **superpowers-skills**（MIT，© Jesse Vincent）+ LICENSE 随插件；**zcode-guide-diagnosing-skills**（Apache-2.0，© Z.AI，重写非复制，README 注明上游许可矛盾） | ✅ inventory 实有 |

`node scripts/licenses.mjs check` 复跑 exit 0（1056 包；copiedComponents 共 5 条，与本表一致）。

## 7. 范围纪律核查

工作区共 59 个变更路径（48 修改 + 11 新增，本人 `git status --porcelain` 实数），零 git commit（本批按约定未提交；验收亦未提交）：

- **本批条目文件**：37 个修改 + 11 个新增（各条目 filesChanged 并集，全部在位——本人核对）。
- **他人/并行改动（未触碰）**：docs/plans 两个、docs/reviews/2026-10-16-zcode-gap-analysis 七个 T 报告、scripts/build/macos.sh、version.json（共 11 个）。
- **条目 38 的 17 个插件内容文件因 .gitignore 不出现在 git status**（见 §5 R2）——这是 git status 计数（59）与条目文件并集看似不齐的原因。
- 验收新增：本报告 + 台账更新（docs/reports/2026-10-18-open-items-ledger.md，更新时对该文件整体 prettier --write，使其退出 format:check 失败名单——该失格式系 main 既有，见 §4/§5）。
