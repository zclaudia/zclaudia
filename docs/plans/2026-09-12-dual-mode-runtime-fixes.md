# 双模式 Runtime 修复与验证

修复日期：2026-09-12。对应 Claude/Codex 双模式实现的七项评审意见。

- 会话绑定在 bootstrap 解析 Agent 时生效，先于 runtime、权限策略、上下文和 LLM 选择。新 CLI 会话也创建绑定；重复插入不能覆盖原身份，SDK 准备阶段拒绝模式不匹配。
- supportedProtocols 经 HTTP 校验、SQLite 写入和读取完整保留；省略更新保持原值，null 恢复推断，空数组明确禁用。LLM 编辑器可声明 Responses 能力。
- SDK 环境以宿主白名单为基础，叠加本轮允许字段，不因 bridge-only env 丢失 PATH/HOME。外部 provider 凭据仍不会继承。
- Codex env_http_headers 使用 header 名到环境变量名的映射；配置写入 CODEX_HOME/config.toml。
- plugin-sdk 使用 npm 已发布的精确版本 0.2.0，lockfile 记录完整性；根 pnpm override 将直接及间接依赖统一到该版本。发布包完整性与此前验证的临时包一致，已移除 vendor 包，不依赖相邻 checkout。
- Codex 内置引擎锁定 0.154.0，artifact URL、SHA-256 和大小来自官方该版本 release 元数据；bundledRuntime 引用同一 artifact 记录。原候选 0.144.1 未通过当前协议检查（缺 cacheWriteInputTokens），没有通过删减检查使其过关。
- 发布 staging 自动准备完整引擎资源，校验下载/缓存、版本与本机协议；启动仅验证本地资源，不下载。缺资源、摘要或版本不符时失败。外部 Managed CLI 推荐版本的策略未随之改动。

构建本机 Codex 资源：`node scripts/plugins/bundled-codex-engine.mjs`。可传目标平台参数，例如 `linux-x64`。构建缓存位于 `.cache/runtime-artifacts/`，开发资源位于 `plugins/agents/codex/engine/`；两者均不提交。正常 server bundle 调用 staging 时自动完成该步骤。

已在 darwin-arm64 验证：数据库/运行入口/编辑器回归，两个插件与 server/desktop 类型检查，Claude 本地引擎探针，实际交付的 Codex 0.154.0 的双 header、MCP 配置读取和恢复探针，三种内置插件 staging，以及 SDK 固定包在独立目录中的离线安装和导入。

测试模型请求使用本地 HTTP fixture 与合成凭据。此轮不等同于真实 provider 或其他目标平台的完整安装包验收。

切换 npm SDK 0.2.0 后追加验证：锁文件冻结的离线安装（跳过 lifecycle scripts）、shared 与 Claude/Codex/Cursor 三个插件构建，以及模式描述、协议声明、模式校验和模型连接相关的 45 项测试全部通过。
