# Tool 实现问题清单（来自 session tool call 审计）

**来源**：`/tmp/zclaudia-dev/data.db` 中 session `019f1b8f-b9bf-71af-a6d2-1ac167969d4c`（"Test"，auto title「SSO 成功但 gen_csms_token 失败」），2026-07-03 最后一次运行，共 185 条 `tool_call_records`（id 341–526）。下文引用的 id 均为该表的记录 id。

**状态标记**：`[ ]` 待处理 / `[x]` 已修复 / `[~]` 部分修复或有意保留。

---

## P0-1 [x] Read/Edit 的 read-state 在 turn 边界被重置

> **已修复（2026-07-03）**：根因是 `buildEffectiveToolOptions`（tool-options.ts）在每次 `buildTools` 时新建空 store，而 tool bundle 按 run（= 每条用户消息）重建。修复：`read-file-state.ts` 新增 session 级 LRU 注册表 `getSessionReadFileStateStore(sessionId)`，`buildEffectiveToolOptions` 有 `sessionId` 时复用同一 store。staleness 仍由 `assertEditable` 的内容比对兜底（跨 run 文件变了照样报 `file_modified_since_read`）。测试：`__tests__/read-file-state-session-scope.test.ts`。

**症状**：Edit/EditSymbol 只有和 Read 处于同一条 assistant message 时才能成功；跨 message 一律失败 `file_not_read`，即使文件 digest 完全没变。

**证据**：

- 同 message：Read(406, full) → Edit(407) ✅ → Edit(408) ✅
- 下一条 message：Edit(412) ❌、Edit(413) ❌ `file_not_read`，agent 补 Read(414, full, digest `2725a7a00bad`)
- 再下一条 message：Edit(416) ❌ 仍报 `file_not_read`，且错误 `state.currentSnapshotId = token_manager.py#2725a7a00bad` —— 恰好是上一 turn 刚读过的 snapshot，自相矛盾
- 同类失败共 5 次：405、412、413、416、485，全部跨 message；所有成功的 Edit 均有同 message 的前置 Read

**后果**：`[fix] Read the full file before editing` 引导 agent 反复全量重读。`token_manager.py`（~700 行 / 27–30KB）在该次运行中被 full read 至少 6 次（406/414/420/447/463/498），仅此一项浪费约 180KB 上下文。

**疑似位置**：`server/src/infra/providers/pi-runtime/read-file-state.ts`（read 状态生命周期）、`edit-write-tools.ts`（freshness 校验）。

**修复方向**：read-state 应以 session（或 run）为生命周期，按 file digest 校验新鲜度，而不是随 turn/message 丢弃；错误信息中 `currentSnapshotId` 与"未读"的矛盾说明状态其实在、只是查询 key 或生命周期错了。

---

## P0-2 [x] Sandbox 分类器把 loopback 连接失败误判为 sandbox denial，引发提权雪崩

> **已修复（2026-07-03）**：实证依据——同 session 中 id 401/440 是 sandboxed 状态下 curl 127.0.0.1 成功（exit 0），证明沙箱不拦 loopback 连接。修复：classifier.ts 新增 `isLoopbackHost`，loopback/unspecified 主机不再进入 candidateGrants；只引用 loopback 目标的失败直接分类 `not_sandbox_denial` 并提示"检查本地服务是否在监听"。loopback *bind* 被拒仍由 HOST_ONLY_FAILURE_PATTERNS 单独覆盖（不受影响）。注意：原有 classifier/controller 测试里有 4 个用例把 loopback 误判行为固化为预期，已改用外部域名表达原意。

**症状**：`curl -s http://127.0.0.1:8000/health` exit 7（服务未启动，普通 connection refused）被分类为 `probable_sandbox_denial`。

**证据**：

- id 457：`matchedSignals: []`（零证据），`inference: "Sandboxed Bash failed while referencing ungranted network target http://127.0.0.1:8000"`，建议 sandbox escalation
- 后果链：自 474 起 agent 携带 `privilege_reason` 请求 unsandboxed；此后 476/477/478/506/510/511/516/518 等十几条**纯脚本 bug 导致的 exit 1** 全部跑在 `unsandboxed` + `escalationRequested: true` 下——一次误分类污染了整个后半程的权限决策

**疑似位置**：`server/src/infra/providers/pi-runtime/sandbox-execution/classifier.ts`（candidateTargets 提取与推断逻辑）。

**修复方向**：loopback / 私有地址不应计入 "ungranted network target"；`matchedSignals` 为空时不应给出 `probable_sandbox_denial` 这种高置信度分类。

---

## P1-3 [x] 与 sandbox 无关的失败也被注入提权建议

> **已修复（2026-07-03）**：classifier.ts fallback 分支现按"是否存在 sandbox 形态证据"（matchedSignals 或 candidateGrants 非空）切换文案：完全无信号时返回 "No sandbox-denial signals detected. Debug this as an ordinary command failure."，不再提 escalation。

**症状**：明显的参数校验错误被建议往 sandbox escalation 方向排查。

**证据**：id 470，`--ttl abc` 报 "Invalid duration format: 'abc'"（输出完整、语义明确），分类 `ambiguous_failure`，`recommendedNextStep: "Gather more diagnostic output before requesting sandbox escalation"` —— 在无关错误上持续提示"提权"这个概念。

**疑似位置**：`sandbox-execution/classifier.ts` / `remediation.ts`（remediation 文案挑选）。

**修复方向**：`ambiguous_failure` 且无任何 sandbox 信号时，remediation 文案不应提及 escalation。

---

## P1-4 [x] ReadSymbol 对多行签名函数的范围解析错误

> **已修复（2026-07-03）**：根因是 `pythonSymbols` 的 body 扫描从 `def` 行下一行找缩进回落，多行签名的闭合行 `) -> str:` 缩进回到 def 列位，被误判为符号结束。修复：新增 `pythonHeaderEnd`（按括号深度找到 header 闭合行，忽略字符串/注释内的括号），dedent 扫描改从 header 结束行之后开始。EditSymbol 共用同一范围计算，一并修复。测试：symbol-tools.test.ts 新增多行签名函数/方法两个用例。

**症状**：多行参数列表的函数，symbol 范围只覆盖签名的参数行，函数体全丢，但 `ok: true`。

**证据**：

- id 383：`ReadSymbol(_build_and_generate_jwt)` 返回 lines 445–449 —— 只有 `def ...(` 加 4 个参数行，连签名右括号 `):` 都没包含；`kind: "function"`、`ok: true`
- 对比 id 381：单行 `def` 的 `startup` 正常返回 80–108（含 decorator 与完整 body）
- 连带效应：383/384 出现连续两次完全相同的调用（模型拿到残缺结果后重试）

**风险**：EditSymbol 的 `previousBodyDigest` 基于该错误范围计算；对这类 symbol 做 EditSymbol 一旦成功可能直接损坏文件。

**疑似位置**：`server/src/infra/providers/pi-runtime/symbol-tools.ts`（symbol end 位置计算）。

**修复方向**：符号范围应至少覆盖到签名闭合再到 body 结束（缩进回落处）；对 Python 多行签名补测试用例。

---

## P1-5 [~] `bash_file_read_blocked` 与 Read 互相踢皮球，可将 agent 卡死

> **核心已修复（2026-07-03）**：`findBashFileBypass` 现返回 `target` 路径，bash-tool 在 `file_read` 拦截前先检查目标是否存在——不存在直接放行（`cat f 2>/dev/null || echo` 探测自然执行），存在才引导去 Read（此时 Read 必然可读，死锁消除）。**未处理**：复合命令因尾部 read 片段被整体拒绝（id 490 场景）——保留现状，属有意的保守设计，若实际摩擦大再放宽。

**症状**：Bash 读文件被拦并提示 "Use Read"，但目标文件不存在，Read 随即 ENOENT，最终触发 loop detector；session 卡在这个循环上结束。

**证据**：

- id 482：`cat models_output.md | head -80` 被拦 → agent 改用 Read → 501/512 ENOENT → 519 `tool_loop_detected`
- id 526（**该 session 最后一条记录**）：`cat models_output.md` 再次被拦；session `last_run_status` 停留在 `running`
- id 490：整条命令因尾部 `cat gen_csms_token.py | head -3` 被整体拒绝，前面的 `python3 -c` 主体也未执行

**疑似位置**：`server/src/infra/providers/pi-runtime/bash-tool.ts`（file-read 拦截 heuristic）。

**修复方向**：拦截前先 stat 目标文件——不存在时直接返回 "file does not exist"（而不是让模型去 Read）；考虑对 `2>/dev/null` 探测式用法放行或降级为警告；复合命令只因尾部 read 片段整体拒绝的行为值得重新权衡。

---

## P2-6 [x] `tool_call_records.is_error` 恒为 0

> **已修复（2026-07-03）**：根因是 pi-core 只在工具**抛异常**时置 `isError`，而 zclaudia 工具以正常返回 + `details.ok:false` 表达失败。修复：`tool-event-translator.ts` 在 `tool_execution_end` 翻译时把 `details.ok === false` 也映射为 `isToolError: true`，DB、UI 标记、loop guard 一并受益。注意：ExitPlanMode 被拒（ok:false）现在也算 tool error——语义上一致（模型需修正）。

**症状**：37 条结果含 `"ok": false` 的记录（file_not_read、ENOENT、bash 失败等）`is_error` 全部为 0，该列实际未被写入。

**影响**：基于该列的统计、检索、UI 标红全部失真。

**疑似位置**：`server/src/infra/storage/metadata-extractor.ts`（tool_call_records 写入路径）。

---

## P2-7 [x] Edit 成功结果携带两份全文，payload 膨胀

> **已修复（2026-07-03）**：确认 `details.originalContent`/`updatedContent`/`contentTruncated` 在 server、desktop、shared、e2e 中零消费方（写生命周期钩子拿的是进程内参数，不受影响）。已从 Edit/Write/MultiEdit/EditSymbol 的序列化 details 中移除，`text-io.ts` 相关 helper 一并删除。diff/structuredPatch/backup/state 保留。每次编辑节省 ~50KB 落库与协议流量。

**症状**：id 407 的 Edit 结果共 73KB：发给模型的 content 只有 7KB diff，但 `details` 同时存了 `originalContent`（23KB）+ `updatedContent`（25KB）+ `diff` + `structuredPatch` —— 每次编辑向 DB/协议塞约 48KB 冗余全文。

**疑似位置**：`server/src/infra/providers/pi-runtime/edit-write-tools.ts` / `text-io.ts`（details 组装）。

**修复方向**：details 里保留 diff/structuredPatch 与 digest 即可；全文如需回滚已有 backup 机制（`details.backup`）。

---

## P2-8 [x] 背景任务缺少阻塞等待原语，agent 靠 sleep + 轮询

> **已修复（2026-07-03）**：TaskOutput 新增 `wait_ms` 参数（上限 60s）：任务运行中且相对 `output_offset` 无新输出时，内部以 250ms 间隔轮询，直到出现新输出、任务到达终态或超时，然后返回。工具描述同步更新引导模型使用（"Prefer this over sleep-and-poll loops"）。增量读取（`output_offset`/`nextOffset`）原本就有，两者组合即可替代 sleep+轮询模式。

**症状**：为等待 uvicorn 启动，agent 使用 `sleep 3` / `sleep 5` / `sleep 20`（id 455 甚至把 sleep 挂 background）+ 21 次 TaskOutput 轮询；TaskOutput 每次返回 1.6–5KB 重复历史日志。

**疑似位置**：`server/src/infra/providers/pi-runtime/task-output-window.ts` / `tool-catalog.ts`（TaskOutput 定义）。

**修复方向**：TaskOutput 支持 `wait`/timeout 阻塞语义（等到新输出或状态变化再返回），并支持增量输出（offset/since），避免重复回放历史日志。

---

## P3-9 [x] 记录时序失真：同 message 的 tool call 共享同一 created_at

> **已修复（2026-07-03）**：`ToolCall`（shared）新增 `startedAt`/`completedAt`；run-reducer 在 tool.started/tool.finished 时打点；run-lifecycle 将其写入 message metadata；metadata-extractor 落库时优先用 `completedAt ?? startedAt ?? message.created_at`。历史数据不受影响（fallback 保持旧行为）。

**症状**：同一 message 的所有 tool_call_records 时间戳完全相同（如 381–394 全为 08:36:28.568），真实执行顺序与单次耗时无法还原（本次审计只能靠自增 id 推断顺序）。

**疑似位置**：tool_call_records 批量写入路径（`metadata-extractor.ts`）。

**修复方向**：记录每个 call 的实际开始/结束时间（或至少 start 时间），而非落库时间。

---

## P3-10 [~] Loop detector 触发时机与计数口径（观察项）

- `bash_failure_loop_detected`（id 518）在同一命令第 ~5 次失败才触发，偏晚；
- `tool_loop_detected`（id 519）把参数不同（`limit: 40`）的 Read 也计入同一 loop —— 方向没错但口径可议。

优先级低，可在修 P1-5 时顺带审视（`server/src/loop-detection.ts`）。

---

## 处理进度（2026-07-03 全部完成）

除两项有意保留（P1-5 复合命令整体拒绝、P3-10 loop detector 口径）外，P0-1 至 P3-9 全部修复并有测试覆盖。验证：server 全量测试 4930 passed（21 个失败为本机缺 ripgrep/bwrap 的环境基线，与改动无关），`tsc --noEmit` 通过。

改动文件一览：

- `read-file-state.ts` + `tool-options.ts`（P0-1，session 级 store）
- `sandbox-execution/classifier.ts`（P0-2 + P1-3）
- `symbol-tools.ts`（P1-4，pythonHeaderEnd）
- `bash-guards.ts` + `bash-tool.ts`（P1-5，target 存在性检查）
- `tool-event-translator.ts`（P2-6，details.ok=false → isToolError）
- `edit-write-tools.ts` + `text-io.ts`（P2-7，移除全文字段）
- `task-tools.ts`（P2-8，wait_ms）
- `shared/src/core/message.ts` + `run-reducer.ts` + `run-lifecycle.ts` + `metadata-extractor.ts`（P3-9，per-call 时间戳）
