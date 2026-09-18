# Claudia 统一入口实现审查 — 2026-09-18

本次为用户授权的六小时后一次性审查与修复。审查基线为 `refactor/architecture-cleanup` 分支、HEAD `be9e5cca3`，以及执行开始时的未提交实现。相关 Claudia P0 实现主要位于工作区；未将其他架构整理提交算作 Claudia 的新增能力。

`docs/specs/2026-09-17-claudia-agent-entry-design.md` 在审查开始和结束时均为 0 字节。因此依据本任务先前已确认的产品约束及实际代码审查，不能宣称逐条验证了最新版设计文档。空文件未恢复或覆盖。

## 已修复的问题

| 优先级 | 复现条件与影响 | 修复 |
| --- | --- | --- |
| P1 | 多个 Claudia 虚拟客户端同时收到 run 广播，可能把其他会话的文本、完成事件归到当前请求 | 服务端按 session 和已绑定 run 过滤，并在终态后停止投影 |
| P1 | 请求 ID 相同但线程、新话题标志、模型或附加项目发生变化，仍被当成相同请求重放 | 幂等指纹覆盖执行目标和上下文；改变目标返回冲突 |
| P1 | 显式线程不存在或跨项目时自动新建，破坏原讨论连续性 | 拒绝无效线程，不隐式分叉；客户端也保留指定的线程 ID |
| P1 | 第一条接受回执未把新线程加入列表，后续发送可能再次新建 session | 回执建立线程与完整运行身份；旧列表快照不能抹掉刚接受的线程 |
| P1 | 网关 ID 未规范化，权限、profile 查询或 session 导航可能引用错误后端 | 使用 canonical backend ID；查询、迟到响应、权限和输入提示按 backend/session 隔离 |
| P2 | 已完成运行收到重放回执后又显示运行中；断线丢接受回执后永久 submitting | 保留终态；重连重发同一请求；通过标准 session 快照恢复运行与完成状态 |
| P2 | 刷新后缺少当前运行的内容和取消入口；旧快照覆盖新 delta | 消息 API 返回当前 run/content/message ID/sequence/status；客户端按序号合并，取消绑定精确 run |
| P2 | 持久化消息到达后重复渲染回复，多个 run 共用活动回复文本 | 按消息 ID 去重，每个 run 使用自己的文本 |
| P2 | 拒绝后草稿消失；切换讨论不恢复草稿；输入框附件未透传 | 恢复按后端/讨论保存的文本和附件；预填只在 composer 挂载时应用；附件通过标准消息 envelope 传递 |
| P2 | 桌面打开 work session 后仍停留在 Claudia；缺少返回原讨论入口 | 切换主视图，并记录源 backend/project/thread/session；桌面和移动端均可返回 |
| P2 | 新话题已启用时点击 Resume 会在新 session 上继续 | Resume 显式继续原 session；中断状态操作也路由到该后端 |
| P2 | 附加参考项目改变工作目录 | 新会话执行目录保持为宿主项目；参考项目仅作为上下文 |
| P2 | 待输入请求没有操作入口；桌面已读和权限提示不准确 | 增加前往 work session 回答的提示；桌面打开时更新已读；权限徽标按所属后端/session 判断 |

## 修改文件

实现：

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/features/claudia/ClaudiaChat.tsx`
- `apps/desktop/src/features/claudia/ClaudiaReturnLink.tsx`（新增）
- `apps/desktop/src/hooks/useClaudiaStatus.ts`
- `apps/desktop/src/stores/claudiaStore.ts`
- `apps/desktop/src/services/message-handlers/claudia-messages.ts`
- `server/src/application/conversation/claudia-inline-session-allocation-service.ts`
- `server/src/application/conversation/handlers/claudia.ts`
- `server/src/domains/sessions/message-routes.ts`
- `shared/src/wire/messages/claudia.ts`

回归测试：

- `apps/desktop/src/features/claudia/__tests__/ClaudiaChat.test.tsx`（新增）
- `apps/desktop/src/stores/__tests__/claudiaStore.test.ts`
- `server/src/application/conversation/handlers/__tests__/claudia.test.ts`
- `server/src/application/conversation/handlers/__tests__/run.test.ts`
- `server/src/interfaces/http/__tests__/sessions.test.ts`

用户原有的其他改动、删除和未跟踪文件均保留；没有提交或推送，也未发现需要覆盖的并行编辑冲突。

## 验证结果

使用 `scripts/with-project-node.sh` 运行项目工具：

- 服务端：Claudia handler、run handler、Claudia HTTP、sessions HTTP，4 个文件共 **149 项通过**。
- 桌面单元测试：Claudia store 和 messageHandler，2 个文件共 **122 项通过**。
- 桌面 UI 测试：ClaudiaChat，**11 项通过**。包括首次会话、新话题、桌面/移动端返回、忙碌拒绝保留草稿、远端权限隔离、刷新取消、回复去重、中断恢复、重连重放和无效线程。
- Shared build、桌面/服务端 `tsc --noEmit`、React lifecycle 检查、修改文件格式检查及 `git diff --check` 通过。
- ESLint 未报 error；检查文件中仍有 warning，主要为已有 App refs、类型导入/any，以及 Claudia 中的 effect 状态同步。未把 warning 称为无告警通过。

## 范围与剩余限制

- 本次按已实现 P0 审查；没有为补齐 P1/P2 增加 coordinator、`discussionSessionId` 委派关系或结果回流。
- UI 测试模拟连接、API 和输入组件，服务端测试使用隔离数据；未触发真实模型工具执行、未对生产数据库做迁移，也未做真实手机/网关端到端验收。
- Claudia 内的消息读取仍取最近 100 条；更早的完整记录可进入标准 work session 查看。没有在本次审查中增加分页产品交互。
- 输入请求通过明确入口进入标准 work session 回答，Claudia feed 没有复制完整输入表单。
- 冷刷新/重连恢复依赖 session 快照，运行期间最多有约 4 秒的轮询延迟。丢失接受回执后重放只保证 run/session 身份；已结束运行的历史回执不一定包含消息 ID，极端丢包时仍需关注临时气泡的去重显示。
- 附件保留并透传，但 Claudia 现有 100KB 输入上限仍适用于整个 envelope；超限会明确拒绝并恢复草稿。
- 空设计文档仍需作者补回最新版本，才能进一步做逐条验收。

本次一次性审查已完成，不安排周期性重跑。
