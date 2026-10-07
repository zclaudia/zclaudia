# Prompt Cache 命中率统计与失效诊断 实施计划（草案）

> 状态：Phase 0b + Phase 1 已实现（2026-10-07，未提交）；Phase 2 / 3 待做。步骤用 `- [ ]` 跟踪。

**Goal:** 统一口径统计 prompt cache token 与命中比例（看成本），并能定位每次缓存失效的位置和原因（排查失效）。本轮聚焦 pi（及 cursor）；claude / codex 暂不考虑——统计层是 runtime 无关的，它们的账本行会照常显示，但不为它们做专门修复或逐调用采集。

**Architecture:** 统计完全建立在现有用量账本 `runtime_usage_records`（迁移 045）之上——`input_uncached / cache_read / cache_write` 已逐 invocation 落库，所有统计视图都是 JS 聚合内存行，加字段不需要迁移。诊断需要逐调用粒度，pi 走现成的 `session_log`（`appendRecord` 写 pi 原生 `UsageRecord`），外部 runtime 第一步只做逐 run 粒度。

**测试命令：** `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server test -- <files>`；桌面同理 `--filter @zclaudia/desktop`。

---

## 口径（2026-10-07 定）

1. **命中率 = `cacheRead / (inputUncached + cacheRead + cacheWrite)`，token 加权。** 分母含 write（否则 Anthropic 冷启动轮被隐藏、虚高）。只统计三项都非 null 的行（legacy 回填行、cursor 未分类行自然剔除）。
2. **payload 只下发原始求和，比率在最终端算。** 多后端合并（`aggregateUsageStats.ts`）按 datasetId 去重后求和再算，绝不平均比率——与现有 coverage rate 规则一致。旧版后端缺字段时显示 `—`。
3. **「不支持缓存」与「0 命中」：** pi-ai 与 codex 都用 `|| 0` 补零，源头不可区分。规则：窗口内 `read + write == 0` 时显示 `No cache activity`，不显示 `0%`。
4. **只展示 token 与比例，不做金额估算。** 每个维度给出 cacheRead / cacheWrite / inputUncached 三项 token 数及各自占输入侧的比例（命中率即 read 占比）。

## 核实结论（决定改法）

- **账本里 cache 字段可信度：** pi（pi-ai 已归一为互斥三项）✅；claude（Anthropic 原生互斥、能区分 null/0）✅；codex ⚠️ 只从 input 减了 `cachedInputTokens`、**没减 `cacheWriteInputTokens`**（`packages/agent-common/src/usage-accumulators.ts:329-335`，`app-server-client.ts:65-72` 同病），write>0 时分母虚胖；cursor 透传、ACP 语义未实测。
- **`model_breakdown_json` 写入时丢了 cache 拆分**：`summarizeModelAllocation`（`repository.ts:447`）把 read/write 折进 `input`；pi 与 claude 源头其实有逐模型拆分，codex / cursor 没有逐模型数据。
- **CacheAudit 只在内存、只打日志**（`context-observer.ts`，`ZCLAUDIA_CACHE_AUDIT=1`），每 run 一次；hash 不含 model id / thinking level / 运行中加载的 MCP 工具。
- **pi 不落逐调用 usage**：`session_log` 支持 pi `UsageRecord`，但 zclaudia 从未调用 `appendRecord`；每个 run 只写一条合并后的 assistant entry。
- **⚠️ 结构性失效嫌疑（独立问题，见 Phase 3）：** `buildAssistantTurnMessages`（`session-tree/write-path.ts:44`）把一个 run 内所有 LLM 调用压成「全部 thinking → 全部 text → 全部 toolCall」一条 assistant + N 条 toolResult；下一 run 新建 Agent、从树重建历史（`pi-agent/adapter.ts:270-306`），与上一 run 实际发给 provider 的交错序列不一致，缓存前缀只能命中到上一 run 的 user 消息为止；多工具 run 时该断点还可能落在 Anthropic 20-block 回看窗口之外。另有 `trimMessagesToBudget` 超预算后每 run 平移前缀、fork 后 `prompt_cache_key` 换新两处已知冷启动来源。

---

## Phase 0 — 数据正确性前置

- [ ] ~~**0a codex cacheWrite 双计修复**~~ —— 推后（codex 本轮不考虑）。在修复前 Runtimes 视图里 codex 的命中率在 write>0 时偏低，已知不修。
- [x] **0b 逐模型 cache 拆分**：`ModelAllocationRecord` 加可选 `inputUncached / cacheRead / cacheWrite`（JSON 内字段，无迁移）；`summarizeModelAllocation` 写入；`effectiveAllocations` 的 remainder / discrepancy 分支用行级值或 null；旧行视为未知。

## Phase 1 — 统计（全 runtime）

- [x] **1a shared 类型**（`shared/src/core/usage-stats.ts`）：`RuntimeUsageRuntimeRow`、`RuntimeUsagePayload.totals`、`AccountingSummary`、`ModelUsageTotal`、`RuntimeUsageSeriesPoint` 加 `cacheRead / cacheWrite / inputUncached` 可选求和字段（null = 未知）。
- [x] **1b server 聚合**（`usage-query.ts`）：`buildRuntimeRows`、`buildSeries`、`runtimeUsagePayload` totals（含 unavailable 分支）、`accountingSummary`、`modelUsagePayload`；ledger 未激活的 legacy SQL 路径不出字段。
- [x] **1c 桌面合并**（`aggregateUsageStats.ts`）：`mergeAccounting`、`aggregateModelStats`、`mergeRuntimeRows`、`mergeSeries` 求和，比率重算；版本偏差显示 `—`。
- [x] **1d Home UI**：新增 **Cache** 标签页（与 Overview / Models / Runtimes 并列）看总体：三段条（read / write / uncached 的 token 与比例）+ 每日命中率序列 + 按 runtime、按模型的明细表；Overview 加 "Cache hit" 卡并链接到 Cache 页（`UsageStatsStrip.tsx` cards）。按 runtime / 模型的明细集中在 Cache 页，Runtimes 与 Models 视图未改。三段条为共享组件 `components/usage/CacheBreakdownBar`（popover 复用）。
- [x] **1e session 级**：新 `GET /api/stats/sessions/:id/cache`（返回本 session 累计 + 最近一次 run）（`WHERE session_id = ?` 走 `idx_runtime_usage_session` 求和，重启不丢）；`ContextUsagePopover` 显示本 session 累计命中率 + 三段条 + 最近一次 run 命中率；外部 runtime 也显示；旧后端回退到原「本轮 read」行。逐调用粒度留给 Phase 2。

## Phase 2 — 失效诊断

- [ ] **2a pi 逐调用落库**：`agent_end` 时对本 run 每条 assistant message `appendRecord` 一条 pi `UsageRecord`（usage / model / timestamp / responseId），进现有 `session_log`，无 schema 变更。
- [ ] **2b 前缀指纹持久化**：CacheAudit 改为每 run 写一条 custom 记录（promptHash / toolsHash / modelId / thinkingLevel / cacheRetention / trim 丢弃条数），hash 补上 model id、thinking level、实际发送的工具集；`ZCLAUDIA_CACHE_AUDIT` 日志保留。
- [ ] **2c 失效原因分类器**（server，纯函数 + 单测）：相邻两次调用 / run 之间按优先级归因——prompt 变、tools 变、model 变、compaction、history trim、fork、间隔 > TTL（按 profile `cacheRetention`：5m / 1h）、未知。外部 runtime 只用 ledger 逐 run 数据（requested_model 变化、间隔、compaction）。
- [ ] **2d 时间线 API + UI**：`GET /api/sessions/:id/cache-timeline`；UI 放在 Context popover 内（1e 的 session 命中率下方展开）。
- [ ] ~~**2e 外部逐调用**~~ —— 推后（claude / codex 本轮不考虑；cursor 源头只有逐 turn）。

## Phase 3 — pi 结构性失效修复（独立立项）

- [ ] 先用 Phase 1 / 2a 的数据量化「run 边界命中率」坐实影响。
- [ ] 写回路径改为按真实 LLM 调用顺序保存交错的 assistant / toolResult（含 thinking signature），使下一 run 重建的历史与上一 run 发送的字节序列一致。
- [ ] trim 改为阶梯式（按块对齐而非逐条平移），减少前缀抖动。

---

## 待定决策

- ~~节省估算~~ —— 2026-10-07 定：不做金额，只给 cache token 与比例。
- ~~2e 外部逐调用~~ —— 2026-10-07 定：claude / codex 先不考虑。
- ~~时间线位置~~ —— 2026-10-07 定：Context popover；Home 另设 Cache 标签页看总体。
1. Phase 3 是否现在单开一条线先验证？
