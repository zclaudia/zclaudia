# 内置 Agent 工具集重评估：Pi runtime vs ZCode CLI（2026-10-12）

承接 [2026-09-23-zcode-tool-set-gap.md](2026-09-23-zcode-tool-set-gap.md)。

基线：

| 对象     | 上次                      | 这次                                |
| -------- | ------------------------- | ----------------------------------- |
| ZCode    | 872ad960（v3.14.0，脱敏） | aac47556（v3.15.1，含 docs / 测试） |
| zclaudia | c88ac8cb（2026-09-23）    | 84bc2976（2026-10-12）              |

ZCode 路径相对 `~/Code/ZCode/apps/zcode-cli/packages/`，记为 `Z/`。zclaudia 路径相对 `server/src/infra/providers/pi-runtime/`，记为 `PR/`。

核实方式：六个子代理分头读源码；本文中标「已复核」的条目由主会话再读过代码，其余沿用子代理给出的证据路径。

## 0. 结论

1. **上次 P1/P2 全部关闭。** 工具契约元数据、调度器、Bash 只读分类器、Agent `subagent_type`、SendMessage / RespondToCoordinator、Cron 四件套、ReadSessionContext、WebFetch `prompt`、Bash `description`、TodoRead、AskUserQuestion `preview` 都已在 zclaudia 落地。
2. **ZCode 的工具集本身几乎没变。** 三个月内（3.14.0 到 3.15.1）新增的只有动态工作流相关工具（FillWorkflowHole、AmendWorkflow retune，合计 11 个）、MCP App 页面工具 `app__<server>__<tool>`，以及 Agent 名单改成附件 delta。
3. **LSPTool 已反超。** 上次写的「预留入口」现在是真实现：`LanguageServerManager`、写后诊断、LSPTool、RenameSymbol（全或无多文件改名）。ZCode 根本没有 LSP 工具。
4. **剩下的差距都是小项**，上次没发现的最值得做的两条是：Agent 名单破坏 prompt cache 前缀、关键命令闸门太窄。

## 1. 逐项状态

| 项                                                                           | 上次结论       | 现在 ZCode                              | 现在 zclaudia                                                                                           | 判定                                  | 证据                                                                                                   |
| ---------------------------------------------------------------------------- | -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 契约元数据 + 调度器 + 超时                                                   | ZCode 大幅领先 | scheduler / call-runner / timeout 未改  | 已实现；pi 0.84.1 未 fork，靠最外层 execute 包装注入                                                    | 已关闭；上次 §5「能否注入调度器」已解 | `shared/src/core/tools.ts:139,151,234`；`PR/tool-scheduler.ts:10-30,207`                               |
| Bash 只读分类器                                                              | 缺             | 同旧                                    | 已有                                                                                                    | 已关闭                                | `application/conversation/agent/bash-readonly/index.ts:54`                                             |
| Bash `description`                                                           | 缺             | 有                                      | 已有                                                                                                    | 已关闭                                | `PR/bash-tool.ts:135`                                                                                  |
| Bash `cd` 持久、图片输出                                                     | 缺             | 有                                      | 仍缺                                                                                                    | 仍有差距                              | `PR/bash-tool.ts`                                                                                      |
| Agent `subagent_type`、SendMessage、RespondToCoordinator                     | 缺             | 有；名单移到 `agent_listing_delta` 附件 | 已有；名单仍在工具描述里                                                                                | 功能已关闭；名单位置见 §2.1           | `PR/task-tools.ts:88,108,438,591`（已复核）                                                            |
| Cron 四件套                                                                  | 缺             | 有，上限 20 条                          | 已有，无数量上限                                                                                        | 已关闭                                | `PR/automation-tools.ts:129`                                                                           |
| ReadSessionContext                                                           | 缺             | 有（多一个飞书专用 `topic` 策略）       | 已有                                                                                                    | 已关闭                                | `PR/session-context-tool.ts:86`                                                                        |
| WebFetch `prompt` + 缓存                                                     | 缺             | 同旧                                    | 已有                                                                                                    | 已关闭                                | `PR/web-tools.ts:814`；`PR/web-fetch-cache.ts`                                                         |
| TodoRead、AskUserQuestion `preview`                                          | 缺             | 同旧                                    | 已有；TodoWrite 无 `priority`                                                                           | 已关闭                                | `PR/interaction-tools.ts:116`                                                                          |
| LSPTool                                                                      | 有名无实       | ZCode 无                                | 真 LSP + RenameSymbol                                                                                   | zclaudia 反超                         | `PR/lsp-tool.ts:127`；`PR/rename-symbol-tool.ts:71`                                                    |
| Edit 匹配策略回报                                                            | 「可补」       | 有                                      | 早已有                                                                                                  | 旧报告误判                            | `PR/edit-write/edit-tool.ts:1049`                                                                      |
| resolveInput / prepareApproval                                               | 未做           | 更成熟（新增 applyInputAdjustments）    | 未做；靠 `pending-arg-overrides` 绕过 pi 丢 args                                                        | 仍有差距，低价值                      | `Z/core/src/tool/types.ts`；`PR/pending-arg-overrides.ts`                                              |
| PostToolUseFailure                                                           | 未做           | 有                                      | 未做，hook 只有 Pre / Post                                                                              | 仍有差距                              | `shared/src/interaction/user-hooks.ts:3`                                                               |
| 可暂停超时                                                                   | 未做           | ToolDeadline                            | 未做，但超时从拿到调度槽后才计时，排队不占时间                                                          | 基本作废                              | `PR/tool-scheduler.ts:226-233`                                                                         |
| Grep `multiline` / `type` / `offset`                                         | 可补           | 有                                      | 仍缺（已复核）                                                                                          | 仍有差距                              | `PR/search-tools.ts`                                                                                   |
| Read 视频、缺文件「Did you mean」                                            | 可补           | 有                                      | 仍缺                                                                                                    | 仍有差距（小）                        | `PR/read-tool.ts`                                                                                      |
| Task 别名、`providerVisible`、`modelInstructions`、`<persisted-output>` 信封 | 小项           | 有                                      | 都没有                                                                                                  | 仍有差距（小）                        | `shared/src/core/tools.ts`                                                                             |
| TaskStop 别名                                                                | 可补           | 有                                      | Monitor 仍保留 `start` 枚举                                                                             | 仍有差距（小）                        | `PR/task-tools.ts:333-342`                                                                             |
| 浏览器动作进工具集（上次 §5）                                                | 待核实         | 在 `js` 内注入 `agent.browsers`         | 有独立 `agent_browser` 工具，但 scope 只有 `agent-assistant`，不在 `ALL_TOOL_NAMES`，普通编码会话拿不到 | 部分关闭                              | `application/conversation/agent-tools/browser.ts:119-125`；`application/plugins/tool-catalog.ts:51-55` |

## 2. ZCode 有而 zclaudia 没有

### 2.1 Agent 名单走附件 delta，不写进工具描述（推荐借，★★★）

ZCode 在 `Z/core/src/subagent/listing.ts` 把 subagent 名单作为 `agent_listing_delta` 附件注入。zclaudia 把名单拼进 Agent 工具的描述（`describeSubagentTypes`，`PR/task-tools.ts:82-88`，已复核）。agent profile 一变，工具描述就变，整个 provider prompt-cache 前缀失效。10-07 刚做完前缀稳定性（`af344808`），这是它剩下的一个漏口。成本低。

### 2.2 危险命令规则目录（推荐借规则，不借实现，★★★）

ZCode 按 argv 解析匹配，覆盖批量 `rm`、`find -delete`、`git clean -f`、`rsync --delete`、CMD `rd` / `del`、robocopy（`Z/core/src/tool/handlers/guarded/*`，`docs/dangerous-command-approval-v1-plan.md`）。

zclaudia 的关键命令闸门 `bash-guards/patterns.ts` 里与删除相关的只有两条（`rm -rf /...` 与 `sudo rm`，已复核）。`permission-evaluator.ts` 里另有 destructiveOps 归类，本次没有逐条核对它是否已覆盖上述命令，动手前先看一遍。

### 2.3 其他

| 项                                                          | 是什么                                                                                                                                                    | 建议                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 流式提前执行只读工具                                        | 模型还在输出时就执行 readOnly + concurrentSafe + 无需审批的调用（`Z/core/src/runtime/methods/streaming-tool-coordinator.ts:360-382`）。上次漏了，旧版就有 | 待定。pi 的工具执行在 message_end 之后，要 fork，收益是延迟 |
| `app__<server>__<tool>`                                     | MCP App 页面提供的工具（`Z/core/src/mcp/app-tools.ts`）                                                                                                   | 待定。对应我们插件面板桥，先看插件 UI 路线                  |
| Agent 同步返回附 `<usage>`                                  | 上次已列，仍缺                                                                                                                                            | 顺手补                                                      |
| ApplyPatch handler                                          | 现已有完整实现，但 `handlers/index.ts:82` 仍注释掉；格式与我们相同                                                                                        | 不借                                                        |
| 动态工作流 11 个工具、ReplyToChannel、GoalRead、旧 Workflow | 商业形态或未注册                                                                                                                                          | 不借                                                        |

## 3. zclaudia 新增优势（上次没有）

- 完整 LanguageServerManager：TS / Pyright 随包，gopls / rust-analyzer 走 PATH，用户与插件可自定义 server；写后诊断、查看器 problem markers、RenameSymbol 全或无改名与逐文件还原。
- 子代理成为任务中心一等公民（详情抽屉、step lineage、完成 toast）。
- prompt cache 逐调用追踪与 miss 分类（`PR/cache-trace.ts`）。
- 沙箱网络授权按主机持久到会话（`PR/sandbox-network-memory.ts`）。
- 工具调度不因前序失败跳过后续调用，与 ZCode 新放宽的策略一致（`docs/agent-tool-relaxed-execution-policy.md`）。

## 4. 对上次报告的更正

1. §1.1 ApplyPatch：ZCode 现在有完整 handler，只是没注册。
2. §2 调度器：ZCode 的 `dependsOn` 恒为 `[]`（`Z/core/src/runtime/methods/tools.ts:42`），模型从不传依赖。所谓「拓扑排序」实际只是按原顺序、遇不可并行工具设屏障的分组。上次把它写成差距「大」，高估了。
3. Edit 的 `matchStrategy` 不是缺口，上次基线时就有。
4. 动态工作流是 11 个工具，不是 10 个；Workflow、GoalRead 是有 handler 未注册，不是被剥掉。
5. 「Agent 描述按名单生成」在 ZCode 已过时（见 §2.1）。
6. §3b 里 LSPTool「预留入口」已过时，现为真实现。
7. 两边都存在 NotebookEdit 死引用：`application/conversation/agent/permission-evaluator.ts:267` 的 `EDIT_TOOLS` 含 `NotebookEdit`，但没有这个工具（已复核）。

## 5. 新的优先级

| 优先级 | 项                                                                                            | 理由                                                                           | 落点                                                                |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| P1     | Agent 名单改为附件 delta                                                                      | 保护刚做完的 prompt-cache 前缀；成本低                                         | `PR/task-tools.ts`，附件注入点参考 `Z/core/src/subagent/listing.ts` |
| P1     | 危险命令规则补强                                                                              | 安全收益最直接；先核对 `permission-evaluator.ts` 现有 destructiveOps，再补缺口 | `bash-guards/patterns.ts`、`permission-evaluator.ts`                |
| P2     | Grep 补 `multiline` / `type` / `offset`                                                       | 高频工具，改动小                                                               | `PR/search-tools.ts`                                                |
| P2     | Bash 补 `cd` 持久与图片输出；Read 补缺文件提示                                                | 体验收益稳定                                                                   | `PR/bash-tool.ts`、`PR/read-tool.ts`                                |
| P2     | `agent_browser` 进普通编码会话，或注入 Eval                                                   | 先决定路线再动手                                                               | `application/conversation/agent-tools/browser.ts`                   |
| P3     | PostToolUseFailure hook、Task / TaskStop 别名、Agent 同步返回 usage、清掉 NotebookEdit 死引用 | 兼容与可观测性的小项，一次做完                                                 | 各处                                                                |
| 暂缓   | resolveInput / prepareApproval、可暂停超时、流式提前执行                                      | 收益低，或要 fork pi                                                           |                                                                     |
| 不借   | 动态工作流十一件套、ReplyToChannel、embedded-search、off-peak                                 | 同上次                                                                         |                                                                     |

## 6. 对上次「不能丢的优势」清单的补充

在上次清单之外，新增保留：LSP 全套（诊断、LSPTool、RenameSymbol、查看器标记）、prompt cache 追踪、子代理任务化。
