# 会话模型与审批控件

## 目标与交互

输入框底部使用「模式」「模型 · 思考强度」「工作目录 / 分支」。模型弹层在同一个表单中选择模型与思考强度，点击 Apply 原子保存，下一个回合生效。运行中不可修改；后端也检查运行状态。桌面和手机共用组件，弹层通过 portal 避免被输入区裁剪，按可视区域调整位置，支持键盘关闭和焦点循环。

会话菜单增加「Session settings → Permissions & approvals」。已有宿主分类审批仍然保留，但明确它只决定进入 ZClaudia 的审批请求，并不构成引擎沙箱。原 Read Only 改为 Ask Before Edits；Bypass All 改为 Approve All Requests。原生 Bypass 时禁止编辑宿主覆盖并说明优先关系；Accept Edits 时说明文件修改可能已被引擎批准。权限覆盖继续沿用现有窗口内临时生命周期，与后端持久化的模型选择区别展示。

## 能力来源

| 运行时                 | 模型来源                                                      | 思考强度                                                            |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Codex CLI              | 实际选中的 app-server `model/list`，包含分页                  | 该模型返回的 supportedReasoningEfforts，与宿主支持值取交集          |
| Claude CLI             | 选定 CLI 的 SDK `supportedModels()`，只初始化、不提交用户消息 | 同时支持 adaptive thinking 和 effort 的模型所声明的档位             |
| Cursor ACP             | 短期 ACP session/new 返回的 availableModels                   | 保留完整 modelId（包括 thinking 等变体参数），不伪造独立档位        |
| Cursor 旧 stream-json  | 当前 CLI 的 `--list-models`，支持手动模型 ID                  | 由 Cursor 管理                                                      |
| SDK + LLM Profile / Pi | 当前绑定连接登记的模型                                        | LLM Profile 每个模型明确声明的 thinkingLevels；未知则只提供 Default |

外部 Codex/Claude 模型发现失败时保留默认与手动 ID，手动 ID 在实际运行时由引擎验证，失败不自动换模型。Cursor ACP 必须使用它返回的完整 ID。SDK 不读取外部 CLI 账号的列表。发现过程不调用推理、不接入宿主工具桥、不恢复用户对话，也不自动安装 CLI。发现有超时与短期、按后端数据库及会话上下文隔离的缓存。

## 保存与执行

新增 `session_model_settings` 表：session_id、model、thinking_level、revision，外键删除级联。完整替换接口使用 revision 乐观锁，避免两个窗口覆盖彼此设置。模型字符串与档位在后端校验；拒绝归档、只读、子代理和运行中的会话。异步发现后再次检查运行状态。

`GET /api/sessions/:id/model-settings` 返回保存值、继承值及能力；`discover=true` 触发原生发现，`discover=refresh` 强制刷新缓存。
`PUT /api/sessions/:id/model-settings` 原子保存模型与思考选择。
`GET /api/sessions/:id/capabilities` 返回会话实际链路的能力。Cursor 前端缓存以 session 和 provider session 身份隔离，旧会话仍然由 CLI 管理权限，新 ACP 会话启用宿主审批能力。

统一的 agent resolver 在绑定身份和连接解析完成后应用会话选择，所以普通消息、重试、URIP 快捷指令和后续回合共用同一模型。优先级为：会话显式选择 → 会话绑定的原始模型 / Agent 默认 → 引擎默认。更换模型时清除原模型的显式思考选择，不把旧模型的 Profile 思考值带到新模型。两个字段都为 null 恢复继承；Use defaults 即使发现失败也可清除已保存的覆盖。

模型可以更换，runtime、engineMode、LLM Profile、endpoint、auth 及连接身份校验继续保持原有绑定。首次运行前已有模型覆盖时，绑定仍记录原始默认，保证之后恢复默认可用。

Codex adapter/runner/app-server 协议补齐 effort。每回合显式传递 effort（默认时为 null），恢复模型默认时重新传递配置解析出的模型，避免 loaded thread 沿用上回合覆盖。Claude 已有 model/thinking/effort 链路保持使用；Cursor 使用 session/set_model。

## 验证与范围

回归覆盖：模型及档位保存、恢复继承、Agent Profile 不变、连接绑定不变、并发编辑冲突、运行中修改、只读限制、无效输入、Cursor 新旧链路与完整变体 ID、SDK 连接模型来源、Codex wire 参数及恢复默认、Claude 无推理发现与参数传递，以及桌面/手机控件和会话设置入口。

使用真实 React 组件与模拟接口检查桌面、手机布局；不以模拟模型调用冒充真实供应商验收。当前改动没有把宿主分类规则升级为覆盖所有工具调用的强制沙箱；该能力需要各引擎独立的执行前拦截支持。

## 实际环境反馈修复

继承选项改为 Follow runtime / Follow session default，区别于 Claude CLI 返回的 Default (recommended)，保留两者各自的保存语义。Cursor 的旧 stream-json 会话也进行模型发现，使用实际 CLI 的 `--list-models`；ACP 会话继续使用 session/new 的 models。发现时传递会话的 transport，但不恢复或迁移原对话。旧链路发现失败明确显示错误，不再静默返回空列表。

已通过本机真实 CLI 验证：Claude 返回推荐默认模型和命名模型；Cursor 旧 CLI 返回 223 个选项，ACP 返回 38 个选项。两份目录的 ID 形式不同，均原样保留。验证只读取目录，未提交推理请求。
