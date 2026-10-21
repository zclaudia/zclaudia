# T6 Provider/模型/订阅计费 对比报告

对比日期：2026-10-16
对比范围（分工）：ZCode 侧 `packages/provider`、`packages/provider-node`、`packages/model-option-map`、`docs/bigmodel-*.md`；zclaudia 侧 `server/src/auth.ts` 及 provider/模型相关配置（自行定位到 `server/src/domains/llm-profiles/`、`server/src/infra/providers/pi-runtime/`、`shared/src/core/llm-profile.ts`）。
关键问题：① 多 provider 抽象与自定义模型 ② coding-plan 订阅与用量配额管理 ③ 业务错误重试策略 ④ 模型选项映射与降级。

---

## 1. 两侧结构对照（简表）

| 能力 | ZCode | zclaudia 现状 |
| --- | --- | --- |
| Provider 配置领域模型 | `packages/provider`（~5700 行，含 config/schema/resolver/registry/model-selection/account-provider 七个子域，纯函数无 IO） | `shared/src/core/llm-profile.ts` + `server/src/domains/llm-profiles/repository.ts`：单张 `llm_profiles` 表（providerType/baseUrl/apiKey/models[]/compat/protocols） |
| Provider 运行时落地 | `packages/provider-node`：远端 builtin release 下载、bundled+LKG 双文件、多进程同步、个人配置仓库 | 缺失（无 builtin provider 概念；profile 即全部，存 sqlite） |
| 模型选项映射 | `packages/model-option-map`（867 行）：受限 CEL DSL → JSON Merge Patch，per-model 声明式下发 | `shared/src/core/llm-profile.ts:111-170`：固定 `thinkingLevels` 枚举 + per-model `dialect` 预设，字段映射由 pi-ai 硬编码 |
| 业务错误重试 | `apps/zcode-cli/packages/adapters/src/model/failure-*.ts` + `runner-retry.ts` + `retry-budget.ts`：40+ 业务码分类表、Retry-After 信任策略、预算档位 | `server/src/infra/providers/pi-runtime/retry-stream.ts`：HTTP status 集合（408/429/5xx/529）+ Retry-After（封顶 60s）+ 5 次硬编码上限 |
| coding-plan 订阅购买 | `docs/bigmodel-coding-plan-subscription.md`：`/api/biz/pay/*` 全链路（batch-preview/preview/create-sign/update-sign/check）+ Z.AI Stripe/PayPal 收银台 | 缺失（仅有 openai-codex OAuth 登录，`server/src/domains/llm-profiles/codex-oauth-*.ts`） |
| 用量配额查询 | `packages/services/src/usage-stats/providers/bigmodelUsageQuotaProvider.ts`（1691 行）+ 4 个 monitor 接口映射 | 缺失（`shared/src/core/usage-stats.ts` 只有本地 session 统计） |
| 自定义模型 | Personal Provider/Model Config（手动模式白名单叶子，`packages/provider/src/config/manual-model-config.ts`） | `LlmProfileModelEntry`（contextWindow/maxTokens/dialect/thinkingLevels）+ `/models` 拉取 + 探活（见 §3） |
| 鉴权层 | OAuth 账号体系（zhipu-account access 类型）+ API key + 请求安全验证重试 | `server/src/auth.ts` 仅 17 行 `safeCompare` 时序安全比较（网关代理鉴权用），无 provider 鉴权逻辑 |

---

## 2. ZCode 领先点（核心章节）

### 2.1 Provider 业务错误码驱动的重试分类表 ⭐ P1

**解决的问题**：BigModel / Z.AI 等 OpenAI 兼容网关会把可恢复失败包装成业务错误码，甚至出现在 HTTP 200 的 SSE error frame 中（message 前缀 `[1302][...][request_id]`）。只按 HTTP status 重试的服务会把这些"并发过高/平台过载"的请求直接判死，或反过来对"日调用上限/套餐到期"这类终止型错误无意义重试、浪费预算并加重平台限流。

**证据路径（ZCode 侧）**：
- `packages/` 之外的核心实现：`/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts`（402 行映射表：`1120/1230/1234/1302/1303/1305/1312` 可重试；`1113/1304/1308/1309/1310/1311/1313` 终止；另有 `insufficient_quota`、`credit_balance_exhausted` 等 OpenAI 风格 code 的终止映射，`3008/3009/3010` 并发上限走升级引导不重试）
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/failure-classifier.ts`（633 行：HTTP status / 网络 / TLS / AI SDK error chunk 统一分类，Retry-After 提取）
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/provider-finish-business-error.ts`（从 SSE finish/error chunk 重建业务错误）
- 设计文档：`/Users/zhvala/SourceCode/zcoder/docs/bigmodel-business-error-retry.md`（含"已产出 text_delta/tool_call/finish 后不自动重放"的安全边界）

**zclaudia 现状**：缺失。`server/src/infra/providers/pi-runtime/retry-stream.ts:15` 只有 `RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504, 529}`，HTTP 200 SSE 错误帧不进入重试判定；无任何业务码解析。`server/src/utils/retry-window.ts` 有 `extractRetryDelayMsFromError()` 可从错误文本解析时长/绝对时间（含时区），但 grep 显示生产代码无 importer（仅 `server/src/utils/__tests__/retry-window.test.ts` 引用），属于已备而未接线的能力。

**可搬运性**：**重写借鉴（映射表本身可近乎直接移植）**。映射表是纯数据（code → {code, reason, retryReason, retryable}），可直接抄表并保留 Apache-2.0 归属；接线层需适配 zclaudia 的 `withStreamRetry`（在 `scheduleRetryOrGiveUp` 前解析 pi-ai error event 的 message/code）。zclaudia 的 pi-ai 流错误事件里带有 provider 错误文本，可作为业务码提取源。

**体量估计**：表 + 解析器约 300–500 行 + 测试；retry-stream.ts 改动约 50 行。

### 2.2 Retry-After 信任策略与 x-should-retry 阻断 ⭐ P1

**解决的问题**：provider 返回的 `retry-after-ms` / `retry-after` 常达数十秒到数分钟；zclaudia 把所有等待封顶 60s，会把合法限流等待截断成短退避、放大失败率。同时 OpenAI 风格 `x-should-retry: false` 表示 provider 明确拒绝重试。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/runner-retry.ts:38-56`（`calculateRetryDelay`：Retry-After 合理（≤5 分钟）则直接采用，否则指数退避 2s→60s + jitter）
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/runner-retry.ts:81-108`（`logRetryDelayDecision`：`retryAfterSource` 区分 `provider_header` / `blocked_by_x_should_retry` / `missing`，结构化落日志，专门排查"Retry-After 在 header 保留、错误归一化或 delay 计算任一层断链"）
- `/Users/zhvala/SourceCode/zcoder/docs/bigmodel-business-error-retry.md:40-44`（三条路径 header 必须贯穿：fetch 层抛错、error chunk 重建、APICallError.cause 包装）

**zclaudia 现状**：`server/src/infra/providers/pi-runtime/retry-stream.ts:45-54` 已支持 Retry-After（秒数或 HTTP-date）但 `Math.min(..., MAX_DELAY_MS=60_000)` 封顶截断；无 `x-should-retry` 处理；无 retry-after 断链诊断日志。

**可搬运性**：**直接移植**（约 50–100 行改 `computeDelay` + 补 header 透传），注意保留 `MAX_REASONABLE_RETRY_AFTER_MS = 5min` 的合理上限与 `x-should-retry` 覆盖语义。

### 2.3 Coding Plan 用量配额查询与展示口径 ⭐ P1

**解决的问题**：订阅制用户需要看到 5 小时 prompt 池、周池、MCP 月额度的真实剩余与重置时间，而不是本地估算。ZCode 完整接入了 BigModel/Z.AI 官方 monitor 四接口，并定义了严格展示口径（缺失额度项隐藏、不按下标兜底、percentage 反转成剩余百分比、双品牌来源切换）。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/packages/services/src/usage-stats/providers/bigmodelUsageQuotaProvider.ts`（1691 行：`/api/monitor/usage/quota/limit`、`/api/monitor/credit-usage/activity`（365 天活动）、`/api/monitor/credit-usage/usage-detail`（积分/Token/调用序列 + Cache 命中率）、`/api/monitor/usage/model-performance-day`（系统健康度）；zod envelope 解析；API key 来源按 `builtin:zai` → `builtin:bigmodel` → 自定义 endpoint 匹配降级）
- `/Users/zhvala/SourceCode/zcoder/docs/bigmodel-coding-plan-usage-quota.md`（接口契约、字段语义表 `TOKENS_LIMIT/TIME_LIMIT + unit=3/5/6`、错误处理、架构边界）
- 测试：`/Users/zhvala/SourceCode/zcoder/packages/services/test/bigmodelUsageQuotaProvider.test.ts`

**zclaudia 现状**：缺失。`shared/src/core/usage-stats.ts` 只有本地 session/token/活跃天统计，无任何远端配额查询。

**可搬运性**：**重写借鉴**（接口契约与字段语义表可直接照抄；实现需接到 zclaudia 的 llm-profile credential 体系，且 zclaudia 目前没有 builtin:zai/builtin:bigmodel provider id 概念，来源降级链需重设计）。

**体量估计**：只做 `quota/limit` 剩余额度卡约 400–800 行（provider + zod schema + 路由 + 前端）；完整四接口 + 使用详情图表是 ZCode 多个迭代的工作量，建议分期。

### 2.4 Coding Plan 订阅购买全链路（P2）

**解决的问题**：应用内直接购买/续费/升级套餐：远端静态商品目录 + 运行时 batch-preview 实时价格合并、试算 → 签名 → 轮询支付结果、未完成订单检查、支付宝二维码 / Z.AI 海外 Stripe+PayPal 单页收银台、购买埋点（冻结 preview 金额字段，不上报模糊 amount）。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/docs/bigmodel-coding-plan-subscription.md`（接口链路 `POST /api/biz/pay/batch-preview|preview|create-sign|update/sign`、`GET /api/biz/pay/check|check-pending-orders`；鉴权规则——`/pay`、`/api/biz` 不加 Bearer 前缀；UI 降级行为：batch-preview 失败仍展示静态价格快照）
- `/Users/zhvala/SourceCode/zcoder/docs/bigmodel-api-environment-origin.md`（环境域名解析收敛在 `/Users/zhvala/SourceCode/zcoder/packages/shared/src/zcodeEndpoint.ts`）

**zclaudia 现状**：缺失（无任何支付/商品/订单代码；`server/src/auth.ts` 无 OAuth 业务态）。

**可搬运性**：**仅思路**。支付链路强依赖 BigModel/Z.AI 品牌后端与账号体系；可借鉴的是"静态目录 + 运行时预览合并""可购状态不本地推断""埋点金额字段冻结"这些工程原则。

**体量估计**：ZCode 侧为多月迭代（含 e2e mock server `packages/desktop/test/e2e/helpers/coding-plan-upgrade-mock-server.ts`）；如 zclaudia 未来接自有计费，参考其分层即可。

### 2.5 受限 CEL 模型选项映射 DSL（model-option-map）⭐ P2

**解决的问题**：不同 provider/模型对"推理档位 / 最大输出"的请求字段表达完全不同（`thinking.type`、`reasoning_effort`、`max_completion_tokens`…）。ZCode 不在源码里特判每个模型，而是把映射作为模型配置的一部分声明（受限 CEL 表达式 → JSON Merge Patch 程序），编译一次、每请求只绑定冻结的 option value，新增模型零代码改动。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/packages/model-option-map/src/`（867 行：tokenizer/parser/evaluator/compiler 带程序缓存；`merge-patch.ts` 的 `applyOrderedJsonMergePatches` 检测两个 option 写同一路径时抛冲突错误）
- schema 校验即编译：`/Users/zhvala/SourceCode/zcoder/packages/shared/src/model-config.ts:2-40`（option map 字符串在 zod refine 里 `compileModelOptionMap`，配置下发时即验证可编译）
- 执行边界：`/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/model-option-map-fetch.ts`（fetch 包装器重写请求 body，非 JSON 文本 body 时 fail-closed 拒发，防止静默丢 option）

**zclaudia 现状**：`shared/src/core/llm-profile.ts:111-131` 的 `dialect` 预设（moonshotai/deepseek/zai/together/openrouter/xai/openai）走 pi-ai 内置 compat 表；`thinkingLevels` 是固定枚举（`shared/src/core/agent-profile.ts:5`），字段映射硬编码在 pi-ai。对未收录的新网关 quirks 无法配置化表达。

**可搬运性**：**重写借鉴**。DSL 本身（tokenizer/parser/evaluator）可近乎直接移植（纯函数、零依赖、Apache-2.0）；但 zclaudia 的请求构造在第三方包 pi-ai 内部，需要在 outbound fetch 边界（类似 retry-stream 的包装层）插入 patch 步骤才有落点。

**体量估计**：包本身 867 行 + fetch 包装 100 行 + 每模型配置若干条 map 表达式。

### 2.6 三层 Provider 配置解析 + Registry 视图（P2）

**解决的问题**：内置配置、账号权益配置、个人自定义配置三层的叠加语义（builtin → account → personal，个人最后生效），配合模型规则表（按 providerId/templateId/modelId/apiType/baseUrl 条件解析），产出带 revision 的只读 Registry 视图供 UI/runtime 消费；每个模型有 enabled/executable/selectable 三态与结构化校验 issue。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/packages/provider/src/resolver.ts:182-344`（`ProviderConfigResolver.resolve`：模板 overlay、账号投影、owned-order 排序、registry 发布只含 executable 模型）
- `/Users/zhvala/SourceCode/zcoder/packages/provider/src/registry.ts:47-126`（revision 化冻结视图 + `validateSelection` 四种结构化失败码：provider-not-found/model-not-found/reasoning-level-missing/not-supported）
- `/Users/zhvala/SourceCode/zcoder/packages/provider/src/config/manual-model-config.ts`（手动模式只开放白名单叶子字段，新增系统字段默认不可编辑）

**zclaudia 现状**：单层。`server/src/domains/llm-profiles/repository.ts` 的 `llm_profiles` 表 + `recordStatus`（hasModel/hasCredential 推导 draft/ready），无 overlay、无规则表、无 registry 视图。

**可搬运性**：**重写借鉴**。overlay/规则表/registry 的分层思想值得借鉴，但 zclaudia 是单用户自托管形态，账号权益层不存在；直接搬 5700 行包不划算。可挑 `resolveOwnedOrder`（builtin/personal 顺序合并）与结构化 selection 校验码两小块。

**体量估计**：若只搬 order 合并 + 校验码约 200 行；完整三层包 5700 行（不建议）。

### 2.7 远端下发 builtin Provider 配置与多进程同步（P2）

**解决的问题**：模型/供应商能力变更（新模型、endpoint 迁移、reasoning 档位调整）不需发版：服务端 `/api/v1/client/configs` 下发 CDN 上带 revision 的 builtin release；客户端 bundled 基线兜底 + Active LKG 缓存 + 文件锁 + fs watch 热更新；多进程（Desktop host + CLI Worker）通过控制文件 lease 合并刷新，失败指数退避。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/packages/provider-node/src/zcode-builtin-release.ts`（schemaVersion/revision/退出 provider 黑名单校验，不兼容 release 整份拒绝回落 bundled）
- `/Users/zhvala/SourceCode/zcoder/packages/provider-node/src/zcode-builtin-download.ts`（20s 总预算、https-only URL 校验、错误日志不泄漏带凭据 URL）
- `/Users/zhvala/SourceCode/zcoder/packages/provider-node/src/zcode-builtin-provider-config-source.ts`（bundled/Active/LKG 三级、`applyRemoteRelease` revision 单调 + 同 revision 异内容报错）
- `/Users/zhvala/SourceCode/zcoder/packages/provider-node/src/zcode-builtin-remote-synchronizer.ts`（多进程 lease 控制文件、endpoint 维度隔离）

**zclaudia 现状**：缺失（无 builtin provider 层；模型能力靠 pi-ai 注册表 + profile 手工声明）。

**可搬运性**：**重写借鉴**。多进程 lease + LKG 兜底的工程模式通用；但 zclaudia 自托管无远端配置服务，仅在引入"官方模型目录服务"时有意义。

**体量估计**：provider-node 相关约 1900 行；最小可用（下载 + LKG + revision 比较）约 400–600 行。

### 2.8 Retry 预算档位与环境变量可调（P2）

**解决的问题**：自动化任务需要"无限重试只放宽瞬态失败"，交互场景需要"单次尝试快速失败"；部署环境需要不重编译调整重试参数。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/retry-budget.ts`（`Unbounded`/`SingleAttempt` 两档：unbounded 只放宽闸门，退避曲线/分类/边界事件一律不动——防止无限重试放大故障）
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/retry-policy.ts`（默认 10 次重试、2s 基数、2x 退避、60s 封顶、jitter；`ZCODE_MODEL_RETRY_MAX_RETRIES/BASE_DELAY_MS/BACKOFF_FACTOR/MAX_DELAY_MS` 环境变量覆盖，入参显式传 env 不读全局）

**zclaudia 现状**：`server/src/infra/providers/pi-runtime/retry-stream.ts:10-13` `MAX_ATTEMPTS=5/BASE_DELAY_MS=1000/MAX_DELAY_MS=60000/JITTER_MS=250` 全部硬编码常量导出，无档位、无 env 覆盖。

**可搬运性**：**直接移植**（约 100 行；两个纯函数文件无依赖）。

### 2.9 模型选择降级链（初始推荐 + legacy 档位归一）（P2）

**解决的问题**：配置的默认模型失效（provider 删除/模型下线/档位改名）时，会话不应报错：新草稿按 Registry 顺序自动推荐；已有选择解析为"意图"而非硬绑定（账号型 provider 解析到当前连接的账号；`low-effort` 之类旧档位名自动映射到新档位）。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/packages/provider/src/model-selection-config.ts:24-60`（`resolveInitialModelSelection`：configured-default 失效 → 遍历 registry 跳过 hidden provider 的 `registry-fallback`）
- `/Users/zhvala/SourceCode/zcoder/packages/provider/src/effective-model-selection.ts:21-66`（`resolveEffectiveModelSelection`：account-plan 绑定当前账号、`selectionIssue` 结构化失败原因、legacy reasoning level 归一化后再校验）
- `/Users/zhvala/SourceCode/zcoder/packages/provider-node/src/legacy-reasoning-level-renames.ts`（旧档位名迁移表）

**zclaudia 现状**：缺失 registry 层；模型选择存于 agent-profile（`shared/src/core/agent-profile.ts`），无失效降级/档位改名归一机制（未确认运行时是否有兜底，本维度 server 侧未见）。

**可搬运性**：**重写借鉴**。"选择=意图、解析时降级"的模型与结构化 selectionIssue 可直接借用设计；实现需先有 §2.6 的 registry 形态，否则无处降级。

### 2.10 长尾重试策略：空补全 / 流空闲超时 / Off-Peak 票据续跑（P3）

**解决的问题**：模型返回空轮次（无文本无工具无 usage）自动重试一次；流式连接空闲超时检测；Off-Peak 闲时任务票据过期后"同 task_id 重新取号 → resume 续跑"而非落 failed。

**证据路径（ZCode 侧）**：
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/empty-completion-retry.ts`（`EMPTY_COMPLETION_MAX_RETRIES=1`）
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/stream-idle-timeout.ts`
- `/Users/zhvala/SourceCode/zcoder/apps/zcode-cli/packages/adapters/src/model/offpeak-retry.ts` 与 `/Users/zhvala/SourceCode/zcoder/packages/shared/src/off-peak-types.ts:36-49`（票据过期 marker 跨包同值，靠错误文本传递）

**zclaudia 现状**：均缺失（grep 无 off-peak/空补全重试；`retry-stream.ts` 无空闲超时）。

**可搬运性**：空补全重试与流空闲超时**重写借鉴**（通用价值）；Off-Peak 票据体系**仅思路**（深度绑定 ZCode 服务端协议）。

---

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

- **通用多 provider 形态**：`anthropic / openai / openai-codex` 三种 providerType + 任意自定义 baseUrl + 三种 wire protocol（`shared/src/core/llm-profile.ts:16-27`），面向"任何 OpenAI/Anthropic 兼容端点"；ZCode 是 BigModel/Z.AI 双品牌账号中心化，第三方 provider 面窄（builtin 模板仅 zai-api/bigmodel-api）。
- **`/models` 目录拉取与探活**：`server/src/domains/llm-profiles/models-fetch.ts`（按 providerType 生成 /models URL + header，10s 超时）、`models-probe.ts`（max_tokens=1 ping 测延迟，15s 超时）。ZCode 侧未发现等价的通用探活能力（未确认）。
- **per-model dialect 预设**：`LLM_MODEL_DIALECTS`（moonshotai/deepseek/zai/together/openrouter/xai/openai）强制 pi-ai compat 行为，是"被代理掩盖真实上游"场景的逃逸舱（`shared/src/core/llm-profile.ts:118-131`）。
- **openai-codex OAuth**：带刷新锁（防 refresh token 双花）、terminal error 清除凭证（`server/src/domains/llm-profiles/codex-oauth-service.ts`）。
- **显式协议能力声明**：`supportedProtocols`（null=推断 / []=显式不可用）与 prompt cache retention（none/short/long）+ cache trace 诊断（`agent-stream.ts:103-113`）。
- **首 token 安全重试已内建**：`withStreamRetry` 保证已转发内容后绝不重放（`retry-stream.ts:97-103`），与 ZCode 的"产出 text_delta/tool_call 后不重放"是同一安全边界，zclaudia 已具备。

## 4. 不建议搬运的（及原因）

- **订阅购买/支付链路本体**（`/api/biz/pay/*`、Stripe/PayPal 收银台、支付宝二维码轮询）：强依赖 BigModel/Z.AI 品牌后端、OAuth 业务 token 换取（`/api/auth/z/login`）与支付资质；zclaudia 无对应后端，搬来即死代码。只借鉴其降级与埋点原则。
- **Off-Peak 闲时任务票据体系**：取号/废票/续跑协议是 ZCode 服务端私有契约（400/3102 错误码、active 3h / ready 5min 票据生命周期），脱离其服务端无意义。
- **完整 `packages/provider` 三层包整体移植**：5700 行且其中约一半服务"账号权益/团队连接/Start Plan"这类 zclaudia 不存在的产品概念；只摘 order 合并、校验码、selection 降级三小块。
- **`account-provider-service` 账号投影 overlay 与 fail-closed 快照**：服务于多账号切换/团队权益，zclaudia 单用户 API-key 形态用不上。
- **ZCode 环境体系**（`ZCODE_ENV=test/production`、`BIGMODEL_API_BASE_URL` 覆盖链）：绑定其双环境发布流程，zclaudia 自托管无此需求。
- **远端 builtin release 的退出 provider 黑名单**（ZAPI 等）：ZCode 产品史特有，无通用价值（revision 单调与不兼容拒绝的通用模式已并入 §2.7 借鉴项）。

## 附：许可与移植注意

ZCode 为 Apache-2.0（`/Users/zhvala/SourceCode/zcoder/LICENSE`，另有 `NOTICE.md` 与 `THIRD-PARTY-NOTICES.md`）。凡"直接移植"项（§2.2、§2.8、§2.5 的 DSL 部分、§2.1 的映射表数据），需在 zclaudia 仓库保留原许可声明与 NOTICE 归属；映射表中的业务码语义摘自 BigModel 公开文档（docs.bigmodel.cn），不构成 ZCode 独有表达，但代码组织仍受 Apache-2.0 约束。

## 附：未覆盖 / 未确认项

见提交结果 `unverified` 字段：ZCode 的 usage-quota UI 消费端（useUsageEntitlement hook）、`docs/coding-plan/*` 各 spec、`failure-classifier.ts` 全文逐行、zclaudia UI 侧（apps/）模型选择 UI、pi-ai 内部 compat 表细节。

## 5. 独立复核记录

复核日期：2026-10-16。复核员独立打开全部证据文件逐条核对，7 条 P1/P2 领先点全部属实。

- ✅ Provider 业务错误码驱动的重试分类表（HTTP 200 SSE 错误帧也可重试/明确终止）—— 可重试码 1120/1230/1234/1302/1303/1305/1312 与终止码 1113/1304/1308/1309/1310/1311/1313 逐一对上（`failure-provider-business-codes.ts:139-273`），`insufficient_quota`/`credit_balance_exhausted` 等终止映射在 `failure-provider-business-codes.ts:297-314`，3008/3009/3010 并发上限不重试在 `failure-provider-business-codes.ts:108-136`；HTTP 200 SSE error frame 场景由 `docs/bigmodel-business-error-retry.md:7-9` 明确记载且分类器在无 HTTP status 时仍走业务码映射（`failure-classifier.ts:339-362`），AI SDK error chunk 入口在 `failure-classifier.ts:151-158`，"产出 text_delta/tool_call/finish 后不自动重放"安全边界在 `docs/bigmodel-business-error-retry.md:38`。
- ✅ Retry-After 信任策略（provider 值优先、5 分钟合理上限）与 x-should-retry 阻断 —— `runner-retry.ts:38-56` 的 `calculateRetryDelay` 在 Retry-After 合理时直接采用（`isReasonableRetryAfterMs`，上限 `MAX_REASONABLE_RETRY_AFTER_MS = 5 * 60_000` 于 `runner-retry.ts:15`），`logRetryDelayDecision` 与 `retryAfterSource`（provider_header / blocked_by_x_should_retry / missing）在 `runner-retry.ts:81-108, 235-250`；x-should-retry 阻断的实际实现（false/0 时 retry-after 不驱动等待）在 `failure-inspection.ts:286-294`，header 贯穿三条路径的要求见 `docs/bigmodel-business-error-retry.md:40-44`。
- ✅ Coding Plan 用量配额查询（quota/limit + credit-usage 四接口与统一展示口径）—— `bigmodelUsageQuotaProvider.ts` 实测 1691 行，四接口分别命中 `/api/monitor/usage/quota/limit`（`:73`）、`credit-usage/activity`（`:938`）、`usage-detail`（`:955`）、`model-performance-day`（`:1608`），zod envelope 解析在 `:86-89`；`builtin:zai` → `builtin:bigmodel` → 自定义 endpoint 降级链、缺失额度项隐藏/不按下标兜底、percentage 反转成剩余百分比、`TOKENS_LIMIT/TIME_LIMIT + unit=3/5/6` 字段语义表均见 `docs/bigmodel-coding-plan-usage-quota.md:23,72-77,106,125`。
- ✅ 受限 CEL 模型选项映射 DSL（reasoningLevel/maxOutputTokens → JSON Merge Patch，per-model 配置化）—— `option-maps.ts:20-34` 编译一次、每请求绑定冻结 value 并走 `applyOrderedJsonMergePatches`；"受限 CEL" 由 `parser.ts:1-4` 的 `RestrictedCelExpression`/`parseRestrictedCel` 类型与语法（literal/input/array/object/unary/binary/conditional）证实；schema 校验即编译在 `model-config.ts:5-19`（zod superRefine 内 `compileModelOptionMap`）；fetch 包装器对非 JSON 文本 body fail-closed 抛错在 `model-option-map-fetch.ts:38-42`。
- ✅ 重试预算档位（Unbounded/SingleAttempt）与环境变量可调参数 —— `retry-budget.ts:16-18` 两档哨兵与 `:32-39` `resolveRetryOptionsForBudget`（SingleAttempt 仅收敛 maxAttempts=1），`:4-13` 注释明确 unbounded 只放宽闸门、退避曲线/分类/边界事件不动；`retry-policy.ts:13-21` 默认 10 次重试/2s 基数/2x 退避/60s 封顶与四个 `ZCODE_MODEL_RETRY_*` 环境变量，env 为显式入参不读全局（`retry-policy.ts:32-35`）。
- ✅ 模型选择降级链：失效默认按 Registry 顺序 fallback + legacy 推理档位改名归一 —— `model-selection-config.ts:28-55` configured-default 失效后跳过 hidden provider 遍历 registry（`:45`）产出 registry-fallback（`:51`）；`effective-model-selection.ts:17-77` account-plan 绑定当前账号（`:29-40`）、selectionIssue 结构化失败码、legacy 档位归一化后再校验（`:51-60`）；改名表 `legacy-reasoning-level-renames.ts:2-103` 经 `legacy-reasoning-level.ts:71` 将旧档位归一到 "disabled"。小瑕疵：报告正文举例 "`low-effort` 之类旧档位名" 不准确，实际旧档位名为 `off`/`nothink`（`legacy-reasoning-level.ts:18`），机制本身属实。
- ✅ 三层 Provider 配置解析（builtin→account→personal overlay）+ revision 化 Registry 视图 —— `resolver.ts:182-344`（引用行号精确命中）：账号投影 `:184-189`、模板 overlay `:192-197`、personal 最后 overlay `:208`、`resolveOwnedOrder` `:244-248`、registry 只发布 executable 模型 `:312-313`；`registry.ts:47-126` revision 化冻结视图（`:94-99` revision+1、`:161-177` freeze）与 `validateSelection` 恰好四种结构化失败码（provider-not-found `:78` / model-not-found `:87` / reasoning-level-missing `:143` / reasoning-level-not-supported `:151`）；`config/manual-model-config.ts:5-27` 白名单叶子 pick，注释明确"新增系统字段默认不属于个人手动配置"。
