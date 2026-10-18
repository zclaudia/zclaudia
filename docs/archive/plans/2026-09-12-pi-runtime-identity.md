# Pi 内置 Runtime 更名

ZClaudia 是宿主产品；Pi 是由宿主基于 Pi 组装 Agent 循环、工具与上下文的内置 runtime。Claude、Codex、Cursor 通过插件接入各自的完整 Agent 引擎。CLI/SDK 是插件 runtime 的运行模式，与内置/插件的交付方式独立。此次不将 Pi 拆成插件，也不为其增加 CLI/SDK 模式。

正式标识为 `pi`，显示名称为 `Pi`。默认 runtime 由 shared 的 `DEFAULT_AGENT_RUNTIME` 集中定义；Pi 专属行为由 `PI_AGENT_RUNTIME` / `isPiAgentRuntime` 识别，避免把所有其他引擎一概当作外部 CLI。

`zclaudia` 保留为兼容输入别名，归一化为 `pi`。旧名称始终指向 Pi，不随未来默认 runtime 的变化而变化。两套注册表读取旧名称时返回同一个 Pi 对象，列表只展示 Pi；插件不得占用 `pi` 或 `zclaudia`。Agent Profile 的读写、API、插件 Profile 导入、会话绑定及 MCP scope 读写也执行归一化。未知插件名称在归一化时保留，由现有注册校验决定是否允许使用。

数据库迁移 042 在一个事务中：

- 更新 Agent Profile 的 runtime 标识，并将 SQL 列默认值改为 `pi`。替换该列而不删除 Agent Profile 表，保留会话/项目外键、其他列和索引。
- 更新 session_runtime_bindings 中的旧 runtime 标识；不修改模型连接摘要、配置目录或会话 ID。
- 更新 MCP provider_scope 数组中的精确旧标识，保留其他 runtime、NULL 和空范围。

产品名、包名、Gateway namespace、环境变量、LLM providerType、用户自定义名称、历史消息和引擎会话 ID 不属于更名范围。历史方案文档中的 ZClaudia runtime 指现名 Pi；本记录为当前命名约定。升级在下次正常启动时自动执行迁移，不需要重建数据库。

验证包括有会话历史的旧数据库升级、外键与索引保留、失败回滚及重复启动；旧 API 和 MCP scope 导入；Pi 注册身份保护；Profile 编辑器及插件 SDK 模式能力隔离；Pi 执行、预压缩、溢出恢复与会话续接。使用隔离数据库和模拟模型，不调用真实 provider。

本轮结果：server 21 个文件 / 287 项、desktop 4 个文件 / 38 项、shared 3 个文件 / 15 项，共 340 项测试通过；shared 构建及 server/desktop TypeScript 检查通过。尚未进行完整桌面安装包或真实模型服务的端到端验收。
