# 多聊天工作区实施决策（2026-10-11）

主方案：[聊天卡片化与统一 Pane 编排](./2026-10-11-chat-card-workspace-plan.md)。本文记录 S3 的实现接口和兼容存储策略。

## 已确认的交互

- 布局按项目保存。项目中的聊天选择改变当前项目工作区，不切换到另一个 session 的布局。
- 普通点击替换聚焦聊天 pane 的活动会话；非活动 session tabs 保留。Cmd / Ctrl 点击在聚焦聊天右侧并排打开。
- 会话已经在当前工作区打开时，只激活对应 tab 并聚焦其 pane，不重复创建聊天 ref。
- 聚焦工具时保留“最近聚焦的聊天”，随后选择会话仍作用于这个聊天位置。

## 布局归属和兼容存储

S3 新增 `projectWorkspaceStore.byProject`，保存 `{ workspaceId, focusedChatSessionId, toolBindings }`，persist key 为 `claudia-project-workspace`，版本为 1。`workspaceId` 是固定的布局锚点，不随选中的 session 改变。

首次进入项目时，从该项目实际会话集合中选择 `rightWorkspaceStore.order` 最靠前的已保存布局；没有历史布局时以当前会话创建锚点。迁移保留完整树、pane ID、拆分比例、完整工具 refs 和其余会话旧布局。已有锚点直接复用；不能因为锚点会话的聊天已被替换或关闭而重新插入它。

这是有意采用的兼容桥接：项目归属已由 `byProject` 管理，但树仍通过 `rightWorkspaceStore.bySession[workspaceId]` 保存。S3 不把已有持久化格式直接改成破坏性的 v3 `byProject`，避免关闭实验开关时旧消费者失去布局，也不需要在 hydration 阶段猜测尚未加载的项目归属。项目会话目录和两个 store 完成 hydration 后调用 `resolveProjectWorkspace` / `migrateSessionLayouts`。S4 对独立 placeholder 节点所需的树版本迁移由布局 store 自身处理，与项目归属元数据版本独立。

布局 store 的 50 项 LRU 上限只适用于旧的工具布局缓存；含聊天 ref 的项目锚点和独立会话工作区不参与淘汰，不能因浏览其他会话丢失仍保存的布局。删除原锚点会话时，ownership 清理保留项目采用的树，随后由目录 reconciliation 只移除已删除的聊天 ref，并保留其余聊天和工具；独立会话 scope 可以随该会话删除而清理。项目 session ID / project ID 沿用现有跨后端全局唯一和所有权协调规则。

## 聊天引用和原子动作

聊天完整身份为 `('chat', sessionId)`；同一工作区内只能出现一次。session tabs 和 pane 移动复用完整 ref，内容宿主以完整 ref 为 key，pane 外壳与内容身份分开。

- `selectProjectChat`：替换活动聊天或右侧拆分。
- `openSessionTab`：追加聊天 tab；已打开时只聚焦。
- `focusProjectChat`：激活对应聊天 ref、修复可见性，更新最近聚焦聊天。
- `closeChatRef`：可关闭聊天 ref，但至少留下一个真实聊天；关闭最后 tab 时折叠其空 pane，修复焦点和最大化状态。
- `moveProjectChatToEdge`：一次更新完成源 ref 移除、空 pane 折叠和目标 / 根边缘插入；单 tab pane 复用原 ID，多 tab 拆出创建新 shell，但复用内容 ref。
- `moveProjectChatToTab`：聊天 tab strip 是独立合并目标；支持同 pane 重排和跨 pane 合并，原子搬运完整 ref，保留目标 pane ID。它只接受纯聊天 pane，普通聊天 pane 的中心区仍禁止放入工具或合并聊天。
- `reconcileProjectChats`：依据项目所属后端的完整目录快照清理失效聊天，保留完整工具 refs。尚未收到完整快照时，REST 目录暂缺会话不作为删除证据；明确删除 / 归档事件立即移除对应 ref、解除失效固定绑定。完整空快照清除所有聊天订阅，保留工具和项目锚点。

目录协议没有服务端 revision，因此快照竞态使用有界保护：REST 创建的会话可跨过第一份缺少它的完整快照，live created / updated 只更新保护中的内容；完整快照确认存在、明确删除或第二份缺失快照结束保护。明确删除优先于第一份仍包含该 ID 的迟到快照，后续完整快照或真实创建 / 更新事件可以重新确认其存在。未获正向目录证据的任意已保存 ref 不享受创建宽限。删除最后聊天后焦点持久化为空字符串，重载不会回退到旧锚点会话。

所有布局编辑在一次 `rightWorkspaceStore.setState` 中完成，不调用聊天创建、工具 `onOpen` / `onClose`。项目焦点元数据另存；不会改变内容宿主身份。

## 工具绑定

绑定按完整工具 ref 的 JSON tuple key 保存，而非 pane ID：同 toolId 的不同实例有独立绑定；聊天移动、合并 tabs 和应用预设后绑定仍指向相同会话。

- 默认 `mode: 'follow'`，工具上下文使用最近聚焦聊天的 session / worktree。
- `mode: 'fixed'` 保存 `sessionId`，工具仍使用该会话，即使聊天当前关闭了 pane 或成为非活动 tab。
- 真实会话被删除时，将失效固定绑定改成动态跟随；仅关闭工作区中的聊天不会解除固定绑定。
- 工具上下文的 `projectRoot` / `workingDirectory` 从绑定会话解析；绑定芯片固定 / 解除的 UI 使用同一元数据动作。

全局 singleton 编辑器 / 文件查看器不复制实例；S3 保留单工具实例语义，跟随目录切换时沿用既有的上下文更新与重置路径。终端完整 scope key 和已有状态保留。需要并排打开不同 worktree 的独立编辑器时，后续应扩展工具自身实例模型，不把 pane shell 的复制当成工具状态隔离。

草稿发送回调只由当前草稿所属会话注册，清理时检查回调身份。锁、保存、完成和丢弃操作的异步结果不能覆盖后来切换的草稿。文件查看器以 backend / root / path 区分缓存和请求；切换绑定或隐藏工具后，旧请求不能更新当前显示。

## 订阅、快捷键和窗口

统一工作区的每个聊天内容宿主负责自己 session 的流式订阅；外层按选中会话的订阅需要关闭，避免同一会话重复订阅。快捷键只对最近聚焦聊天生效；工具调用和终端动作从聊天自身 context 取 session ID。

移动、折叠、最大化、切换活动 tab 和预设应用保持仍打开内容宿主挂载。普通替换和显式关闭会话 ref 会结束旧内容宿主的生命周期。

`SessionChatLayout.workspaceScope` 默认 `project`；会话弹出窗口使用 `session`，以 JSON tuple `['session-workspace', sessionId]` 为布局键，聊天 ref 仍是实际 session ID。弹出窗口只有自己的聊天，不读取项目锚点或工具固定绑定。工具与快捷键通过窗口内非持久化的 workspace route 注册表路由到当前实际会话；注册按 owner 清理，旧 effect cleanup 不会清掉新的路由。

主窗口、会话弹出窗口、独立 Dashboard 窗口各自保存布局，避免多个 Tauri window 把同一个持久化 map 的旧快照互相覆盖。存储 key 在创建 store、首次 hydration 前按 URL 选择：主窗口保留原 key；`sessionWindow` 使用 `:session:<encoded sessionId>` 后缀；`projectDashboard` 使用 `:dashboard:<encoded projectId>` 后缀。workspace 树和项目归属元数据同时使用对应 namespace；弹出窗口的单会话 scope 不写项目归属元数据。主窗口仍按项目记住多聊天布局。

自定义预设定义仍保存到全局 `claudia-layout-presets`；每个窗口的项目预设选择保存到对应 namespace 的 `claudia-layout-preset-selection`。选择变化不重写全局预设库；预设 CRUD 先读取最新定义，避免旧窗口覆盖其它窗口新增的预设。旧主窗口选择在首次读取时迁入独立选择 key。

持久化树逐节点恢复有效内容，修复重复 ID、重复完整 ref、无效活动 tab 和混合聊天 / 工具 pane。损坏的 JSON 保留备份并完成 hydration，避免整个工作台卡在加载状态。已采用的项目锚点保持持久属性，删除最后聊天后保留的工具不进入旧布局的 LRU 淘汰范围。

`syncSelection` 默认 `true`。Dashboard 嵌入及会话弹出窗口设为 `false`：内容聚焦、session tabs、比较、关闭和预设填槽可以更新本工作区的焦点，但不修改全局选中会话。这样点击 Dashboard 里的 supervisor composer 不会触发 App 的“选中会话后退出 Dashboard”逻辑。

聊天拖放支持 pane 边缘和工作区视口最外侧 8px gutter；后者插入到根边缘，避免被解释为嵌套 pane 的边缘。左栏可把尚未打开的同项目有效会话拖入边缘，动作在一次布局更新中创建聊天 ref；外项目和无效会话拒绝。pointerup / pointercancel 落在工作区外会清理拖放状态，不遗留 overlay 或在下次点击时误提交。

## 验证

已覆盖项目 MRU 历史迁移、v1 session 布局真实 hydration、项目元数据重载和坏数据过滤、普通替换、并排打开、去重、session tabs、聚焦工具后的聊天记忆、最后聊天保护、原子四边移动、完整 ref 身份保持、失效动作零副作用和固定绑定保持。新增真实 workspace UI 集成验证：独立聊天草稿和输出、tab / 移动 / 折叠 / 最大化的 DOM 和订阅保持、异步 hydration 门槛、实验开关往返、同实际 session ID 的主窗口与独立 scope 隔离、Dashboard 聚焦不导航、根 gutter 拖放、外部 pointerup / cancel 清理。独立 window namespace 的真实 hydration 和写回验证确认不覆盖主窗口布局或项目元数据。

稳定宿主与预设 UI 集成已验证草稿、选区、滚动、工具编辑内容、插件 iframe、订阅和渲染计数。隔离后端人工验证三个会话同时流式输出及工具调用，并截图全部八种预设，包括 Compare、Main + watcher、Session tabs；验证记录与未人工遍历的范围见主方案。

共享 WindowRouter 为主窗口和所有独立窗口初始化内置工具目录；初始化按 panel ID 幂等，不重置已经打开的面板。终端关闭生命周期接收完整 scope，关闭一个 ref 不关闭其他后端 / 项目的 drawer；不存在或仍在使用的 ref 不触发生命周期。

关闭统一工作区开关或进入移动端后，旧工具关闭路径不读取项目聊天绑定。旧终端恢复仍使用保存的 backend scope。工具启动菜单、快捷键和文件搜索取当前工作区的实际会话、目录和后端，不依赖其它窗口或全局选中聊天。
