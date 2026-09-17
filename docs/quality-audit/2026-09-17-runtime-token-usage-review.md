# Runtime token usage 实现 Review

日期：2026-09-17，上海时间。此次为用户安排的两小时后一次性检查。

对照 `docs/specs/2026-09-16-runtime-token-usage-design.md` 检查当前工作区的未提交实现；直接修复明确缺陷，保留原有工作，没有提交、推送或发布。邻接 `zclaudia-plugins` 工作区存在 Cursor 迁移改动，本次未改写它们。

## 已修复的问题

| 优先级 | 触发条件及原有影响 | 修复 |
| --- | --- | --- |
| P1 | Claude pump 在 result/error 之后才 yield 最终 usage；host 看到终态就关闭 iterator | 最终快照移到终态之前；回归测试模拟消费者在终态立即退出 |
| P1 | Claude 崩溃结果带零化计数，覆盖之前已观察到的消耗；仅有中间消息也被标 complete | 崩溃保留已观察消耗，assistant-only 回退及模型范围冲突标 partial，所有非 success result 按错误证据处理 |
| P1 | Codex 把同 thread 的旧检查点视为可信起始值；外部 CLI 或未报告的崩溃尾部可能已增加计数 | 恢复会话在没有实时基线时使用保守的 missing/partial 统计；新 thread 仍可从 0 开始 |
| P1 | Codex 计数回退后又收到旧高水位，会重复累计；Claude 部分字段回退可能破坏消息去重基线 | Codex 保留可证明的前缀，缺少明确新 epoch 时停止新增归属；Claude 不用回退观测降低已有去重基线 |
| P1 | overflow/session-reset 自动重试提前 return，上一 invocation 未结算，长期停留 running | 在进入任何重试分支前结算失败调用；重试仍创建独立 invocation |
| P1 | 原生流交接后台消费者后，后续 usage 没有原始 invocation 关联，甚至在创建 follow-up UI run 前被忽略 | 将原 invocation ID 传给后台消费者，单独持久化累计快照并在流结束结算；合成 UI 消息不提前结算整次调用 |
| P1 | 用量落库依赖全局可失败的公开 listener，且多个数据库可能同时注册 | 当前 run 的 host handler 直接向所属数据库持久化；usage.updated 保持内部事件，不公开原生 checkpoint |
| P1 | 未启动调用进入完整上报率分母；运行中 token 混入 runtime 历史排行但 Overview 不包含它 | 排除 not_started，历史与运行中数据分离，非 final complete 快照按 partial 保存 |
| P1 | All 查询忽略 asOf 上界；未知调用总量的模型分配仍计入 Models | 所有范围使用同一时间边界；只有已知调用总量参与模型分配，冲突归 Unknown |
| P1 | 回填重跑可能将新账本关联消息再生成 legacy 记录 | 同时排除 usageRef 和 assistant_message_id 已关联的消息，并检查总量非负整数 |
| P2 | Pi 缺少 totalTokens 但分类完整时丢失已知用量；有一条缺失用量也可能整体标 complete | 从完整分类推导总量；区分 observed zero、未知与失败占位计数，缺失调用令整体 partial |
| P2 | 非法数值被静默转成 null 后仍可作为 complete 入库 | 拒绝提供了非法数值的快照；总量未知不能保持 complete |
| P2 | 只有 Runtimes 按 datasetId 去重，Overview/Models 可将同库多连接重复求和 | 兼容响应携带 datasetId，三个聚合入口都去重；新旧服务混合时不伪造全局覆盖率 |
| P2 | Overview/Models 未传客户端时区；Models 缓存忽略 asOf；缓存键随 asOf 无界增长 | 传递本地时区、修正缓存身份并限制缓存条目数 |
| P2 | Runtimes 只用成功响应数作为来源总数；切换范围显示旧值；All 图截去 60 天以前数据 | 来源计数对比请求目标，切换范围清除旧结果；图表分桶保留全部日期 |

## 验证

新增回归用例先复现了终态顺序、崩溃清零、覆盖率分母、All 上界、模型对账等失败，再验证修复。

按不同测试文件去重后，本次相关测试共 **404 项通过**：

- server：219 项，覆盖账本、迁移、查询、HTTP、执行事件、重试、后台交接、启动、恢复及 Pi。
- agent-common：36 项，覆盖累计器、重复事件、回退及共享辅助逻辑。
- Claude：16 项；Codex：47 项；Cursor：45 项。
- desktop：首页相关 41 项，覆盖聚合、Overview、Models、Runtimes、来源缺失与范围切换。

shared 构建、server/desktop/agent-common 类型检查通过；Claude/Codex 类型检查通过。针对修复代码的 ESLint 检查没有 error，仍有 warning（主要是既有类型导入、非空断言及 effect 内更新状态）。`git diff --check` 通过。

未启动真实模型请求，未进行费用或订阅账单对账，未修改任何生产数据库，也未执行全量项目测试。

## 实现中仍待完成的验收项

这些是设计尚未完成的接入或发布工作，不能用本次离线测试替代：

1. **P0 真实协议探测**：固定版本 Claude 的 streaming-input / modelUsage / 子代理范围，Cursor ACP 是否返回消费用量，以及 Codex 原生恢复基线与 counter epoch，仍需脱敏真实 fixtures。当前累计器测试主要验证本地规则，不证明所有 CLI 都满足规则。
2. **公共 SDK 契约**：当前仍在 agent-common/shared 维护同构类型，通过 cast 桥接 `provider_usage_updated`；`@zclaudia/plugin-sdk@0.4.0` 尚未原生发布该事件。需按 SDK 发布流程补齐；本次没有擅自发布包。
3. **统一快照与性能**：三个视图已统一时区、时间范围及数据集去重，但仍分别请求自己的接口，并非一次共享 asOf 的原子 UI 快照；大规模账本仍需做查询计划与实际延迟验收。现有查询会取出窗口记录后在 JS 聚合。

Codex 恢复会话的保守处理意味着第一条通知之前的消耗可能无法计入；计数器回退后无法证明属于新 epoch 的部分也不会继续累计。页面应将此显示为 partial/missing，直到实时基线/epoch 能力得到验证，不能据此宣称完整上报。
