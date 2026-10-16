# T2 后端与服务架构 对比报告

- 日期：2026-10-16
- 探索范围：ZCode 侧 `packages/{server,services,rpc,zcode-server-cli}`；zclaudia 侧 `server/src/{application,domains,infra,interfaces}`
- 关键问题：会话与对话运行时管理、RPC/WS 传输层、后台任务与 bots 运行时、多端状态同步、服务端 CLI 化分发
- 方法：只读探索。先目录结构与 package.json，再入口文件（`http.ts`/`supervisor.ts`/`collection.ts`/`server.ts`），最后定向 grep。未通读 ZCode docs/，仅在标题层面确认了 `bots*.md`、`zcode-protocol.md`、`wsl-remote-workspace-design.md` 等文档存在。
- 合规提醒：ZCode 为 Apache-2.0（仓库根有 `LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`）。任何"直接移植"的代码必须保留原 Apache-2.0 许可声明与 NOTICE 归属，并在本仓库 THIRD-PARTY 清单登记。

---

## 1. 两侧结构对照（简表）

| 层面 | ZCode | zclaudia | 差异概述 |
| --- | --- | --- | --- |
| HTTP 框架 | Hono 4 + `@hono/node-ws`（`packages/server/src/http.ts:6-8`） | Express 4 + `ws`（`server/src/server.ts:1-4`） | 两者同级；Hono 更轻，非关键差距 |
| RPC/WS 传输 | 自研 `@zcode/rpc`：二进制 VSBuffer 分帧 → SocketProtocol → PersistentProtocol（ACK/心跳/重放）→ ChannelServer/ChannelClient → IPCServer(1:N) → ProxyChannel 自动服务代理（`packages/rpc/src/index.ts:1-29` 分层图） | JSON 文本消息 + correlationId 请求响应 + MessageRouter 中间件（`server/src/interfaces/websocket/index.ts`、`shared/src/wire/messages/*.ts`） | ZCode 有完整可靠传输层；zclaudia 是消息路由层，无 ACK/重放/背压 |
| 服务暴露 | `ServiceCollection.register()` + `exposeOnChannelServer()` 一行把服务全部变成 RPC channel，支持按连接 overrides 降级（`packages/services/src/collection.ts:30-41`、`packages/server/src/http.ts:100-129`） | handler 手工注册（`server/src/server-setup.ts` + `interfaces/websocket/index.ts`） | ZCode 服务面声明式，zclaudia 命令式 |
| 会话/对话运行时 | host 进程不跑 agent loop：`zcodeAgentProcessManager` 拉起 CLI 子进程，经 V4 wire 协议（stdio/websocket/memory 三种 transport）交换事件；host 侧做 snapshot、事件合并、task index sqlite 同步（`packages/services/src/zcode-agent/*` 40 文件） | Pi 运行时进程内嵌，`application/conversation/runtime/` 46 个 run-*.ts（reducer/delta-batcher/wire-projector/recovery 等）+ `domains/sessions/` | 两种范式：ZCode 进程隔离+协议化；zclaudia 单进程高内聚。zclaudia 运行时细节完整度不低 |
| 后台任务/自动化 | bots 多渠道运行时（Telegram/飞书/企业微信/webhook，`packages/services/src/bots/` 约 1.5 万行）+ automation cron（croner，`packages/services/src/session/automationService.ts`）+ offPeak 错峰任务 | automations 域（自研 cron 解析 + setInterval，`server/src/domains/automations/`）+ background-task-coordinator（`application/conversation/runtime/background-task-coordinator.ts`） | zclaudia 无 bots 渠道运行时；自动化两边都有 |
| 多端状态同步 | `state_heartbeat` 版本对账（`shared/src/wire/messages/core.ts:114-157`）+ 事件合并 + snapshot/stateRevision/eventSeq + V4 delivery profiles（continuous/replayable 双节奏）+ 跨窗口 broadcast claim | `state_heartbeat` 版本对账（`shared/src/wire/messages/core.ts`）+ run 内 seq（`shared/src/wire/messages/run.ts:154-155`）+ facade `catch_up_content` afterOffset（`server/src/infra/gateway/ws-hub.ts:37`） | 两边思路接近；ZCode 多了协议级帧组装/重放与双 delivery profile |
| 服务端 CLI 分发 | `@zcode/server-cli`：`zcode` bin，serve/status/stop/restart/update/uninstall + supervisor 常驻 + 不可变 release 原子更新/回滚 + launchd/systemd/计划任务注册 + 打包产出按 target 自带 Node 运行时（`packages/zcode-server-cli/`，约 5.3k 行） | 无 CLI（`package.json` 无 `bin`）；最接近的是 `application/managed-runtimes/`（agent runtime 二进制下载/校验/GC）与 `infra/services/process-supervisor.ts`（子进程监控） | 单方面差距：zclaudia 服务只能随桌面 app 或手工 node 启动 |
| 远程后端 | 服务端反向拨号 SSH/Docker/WSL，`IRemoteBackend` 抽象 + `/api/connect-remote` + `/ws/remote/:id` 桥接到浏览器（`packages/server/src/remote/` 37 文件） | gateway 多 backend facade（`server/src/infra/gateway/`），无 SSH/Docker/WSL 拨号部署 | 与 T4 维度重叠，此处只记传输架构层面 |

---

## 2. ZCode 领先点（核心章节）

### 2.1 自研分层 RPC 框架 `@zcode/rpc`（VS Code 同构，零运行时依赖）

- **解决的问题**：桌面宿主、浏览器、终端、远程机四种端要调同一批服务。ZCode 把 VS Code 的 IPC 体系抽成独立包：二进制分帧（VSBuffer）→ 传输协议 → Channel RPC（call/listen）→ IPCServer(1:N)/IPCClient(1:1) → ProxyChannel 自动代理 → Remote 连接。任何服务对象用 `ProxyChannel.fromService()` 即变成 server channel，客户端 `ProxyChannel.toService()` 后像调本地方法一样调用；`on*` 前缀属性自动映射为事件订阅并做事件缓冲（订阅前的事件不丢）。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/rpc/src/index.ts:1-29`（六层架构总览注释）
  - `/Users/zhvala/SourceCode/ZCode/packages/rpc/src/proxy-channel.ts:46-80`（fromService/toService 约定）
  - `/Users/zhvala/SourceCode/ZCode/packages/rpc/src/channels.ts`、`ipc.ts`（ChannelServer/ChannelClient、1:N 连接管理）
  - 依赖核查：`packages/rpc/package.json` 无 `dependencies` 字段（本会话 `grep -c '"dependencies"'` 输出 0），仅 devDeps。
- **zclaudia 现状**：缺失。WS 上是 JSON `request.type` 分发 + 中间件（`server/src/interfaces/websocket/index.ts`），服务调用手工写 handler，无通道抽象、无事件缓冲语义。
- **可搬运性**：**直接移植**。零运行时依赖、纯 TypeScript、约 3.3k 行、无业务耦合；Apache-2.0 需保留许可头与 NOTICE 归属。
- **体量估计**：rpc 包 15 文件 / 3,295 行，模块级移植。

### 2.2 `PersistentProtocol` 可靠传输层：ACK + 心跳 + 有界重放 + 拥塞水位

- **解决的问题**：WS 断线重连期间消息丢失、弱网下事件流洪峰。实现：每条消息带 msgId 等待对端 ACK；5s 心跳保活；20s 无 ACK 判死；重连时重放未确认消息（重放缓冲 8MiB / 45s 宽限，越界放弃会话让客户端走 snapshot 全量订阅）；未 ACK 字节高水位 1MiB 触发 `onSaturated`（上层暂停 drain，事件在通道层合并降级，接了 send 的帧绝不丢），回落低水位 `onDrained`。
- **证据（ZCode）**：`/Users/zhvala/SourceCode/ZCode/packages/rpc/src/persistent-protocol.ts:1-101`（头部注释即设计说明：ACK 队列、水位默认值、grace 窗口）。
- **zclaudia 现状**：仅 ws ping/pong 存活探测（`server/src/server.ts:305-315`）与 `state_heartbeat` 版本对账（`shared/src/wire/messages/core.ts:114-157`）；断线窗口内的事件流无协议级补偿，客户端重连后靠版本号差异全量拉取。注意 zclaudia 已有优点：客户端断开时保留 orphaned runs 等待重连（`server/src/server.ts:458`）。
- **可搬运性**：**直接移植**（与 2.1 同包，Channel 层完全不知道它的存在，见文件头注释"分层抽象的威力"，可单独叠加在现有 ws 之上）。
- **体量估计**：296 行单类 + 协议消息扩展，模块级。

### 2.3 服务端 CLI 化分发：supervisor + 不可变 release + 原子更新/回滚 + OS 服务注册

- **解决的问题**：把"服务端"从桌面 app 剥离成可独立安装/升级的守护进程。`zcode serve/status/stop/restart/update/uninstall --json`；Supervisor 常驻管理 Core 子进程（代际 generation 隔离）、CrashBudget 限崩溃重启频率、data-root 文件锁单实例、启动恢复（回写 current.json、清理 update 事务）、更新走"下载 candidate → 校验 ready → 切 current 指针 → 失败回滚"的不可变 release 状态机；注册 launchd/systemd/Windows 计划任务实现开机自启；`stageCli.ts` 按 target 打包并下载对应 Node 运行时，产出自包含发行包。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/zcode-server-cli/src/supervisor/supervisor.ts:42-100`（生命周期状态机、锁、启动恢复临界区注释）
  - `/Users/zhvala/SourceCode/ZCode/packages/zcode-server-cli/src/cli.ts:75-90`（子命令与 canonical layout 收敛）
  - `/Users/zhvala/SourceCode/ZCode/packages/zcode-server-cli/src/platform/serviceManager.ts:1-33`（launchd/systemd/task-scheduler 三平台 descriptor）
  - `/Users/zhvala/SourceCode/ZCode/packages/zcode-server-cli/src/packaging/stage.ts:1-43`（bare module 提取与 staging）、`stageCli.ts`（Node 运行时下载）
  - `/Users/zhvala/SourceCode/ZCode/packages/zcode-server-cli/src/runtime/releaseManager.ts`、`immutableRelease.ts`、`ipc/controlServer.ts`、`supervisor/crashBudget.ts`
- **zclaudia 现状**：缺失。根 `package.json` 与 `server/package.json` 均无 `bin`；最接近的资产是 `server/src/application/managed-runtimes/`（下载/校验/GC agent 运行时二进制，思路可复用到 server release）与 `server/src/infra/services/process-supervisor.ts`（被管理子进程的监控，方向相反：ZCode 是"服务自身被 supervisor 管理"）。
- **可搬运性**：**重写借鉴**。状态机、锁、release 布局、控制 IPC（unix socket 帧协议 `ipc/framing.ts`）的设计均可照抄思想，但代码与 ZCode 目录布局/`@zcode/shared` 强耦合，建议按 zclaudia 的 data-dir（`server/src/utils/data-dir.ts`）重写。
- **体量估计**：约 5.3k 行（cli 包全量），模块级重写；先做 `serve/status/stop` + 简单 release 目录即可起步（≈1.5k 行）。

### 2.4 Bots 多渠道运行时（Telegram / 飞书 / 企业微信 / Webhook）

- **解决的问题**：让会话可以被 IM 消息驱动：渠道长连接（Telegram polling / 飞书 WS / 企业微信回调 / webhook HTTP），消息→会话 topic 映射、群聊 @ 提及解析、回复格式化（飞书流式卡片）、任务流 hub、多渠道并发时的运行时文件锁（lease 30s + 心跳 10s 防多进程重复消费）、provider 回调失败时拒绝提交消费游标防消息丢失（`assertBotCallbackSucceeded`）。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/bots/botsService.ts`（9,924 行主服务，`createBotsService` 在 :743）
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/bots/channelRuntime.ts:7-10`（运行时锁 lease/心跳常量）、`:27-37`（回调失败不提交游标）
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/bots/providers/`（telegram/feishu/weixin/webhook provider + 群成员目录/输入态）
  - HTTP 回调入口与 503 透传防丢消息：`/Users/zhvala/SourceCode/ZCode/packages/server/src/http.ts:387-432`
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/bots/taskStreamHub.ts`、`groupReply.ts`、`topicContinuation.ts`
- **zclaudia 现状**：缺失（本会话 `grep -rln "telegram|feishu|lark|weixin|wechat"` 在 `server/src/` 零命中）。
- **可搬运性**：**重写借鉴**。渠道抽象（channelRuntime/provider 接口、锁、游标语义）值得整体借鉴；但 1.5 万行与 ZCode session/task 服务深度耦合，且部分为产品功能（哪几个 IM 渠道）需按 zclaudia 需求裁剪。建议先做一个渠道（如 Telegram）验证抽象。
- **体量估计**：bots 目录 34 文件 ≈ 14,676 行；重写借鉴量级 = 抽象层（channelRuntime + 一个 provider，≈2k 行）起步。

### 2.5 V4 wire 协议：delivery profiles 双节奏 + 帧组装/重放/洞检测 + snapshot/rows/rows-range

- **解决的问题**：桌面"连续打字机"与 Web"可重放"两类客户端对同一事件流的不同诉求。协议层定义 `DELIVERY_PROFILES.continuous`（30ms flush、文本直通、256KiB 流上限、无工具进度）与 `.replayable`（150ms flush、带工具进度、无流输出），由 CLI flush 管线执行；帧有 1MiB 上限，超限逻辑帧分片由 wire-assembler/reassembly 重组（带并发/字节/超时限额）；事件按会话保留 2000 条，客户端落后过多时走 snapshot+tail 窗口而不是逐条追。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/shared/src/zcode-protocol-v4/core.ts:12-96`（`V4_WIRE_PROTOCOL_VERSION`、`DELIVERY_PROFILES`、`PROTOCOL_V4_LIMITS`）
  - `/Users/zhvala/SourceCode/ZCode/packages/shared/src/zcode-protocol-v4/wire-assembler.ts`、`wire-reassembly.ts`、`snapshot.ts`、`rows.ts`
  - 消费端：`/Users/zhvala/SourceCode/ZCode/packages/services/src/zcode-agent/zcodeTaskIndexSyncer.ts:26-31`（sessionsIndex/workspaceConfig topic 帧 schema）
- **zclaudia 现状**：`shared/src/wire/messages/run.ts:154-155` 已有 run 内单调 seq，`state_heartbeat` 做版本对账，facade 有 `catch_up_content` afterOffset 续传（`server/src/infra/gateway/ws-hub.ts:37,166-167`）；但无帧分片重组、无双 delivery profile、事件保留/追帧策略未见协议化。
- **可搬运性**：**重写借鉴**（协议设计）。ZCode 把协议放在 shared 纯函数包（"禁止任何运行时/IO/传输逻辑"的纪律见 core.ts 头注释），值得照抄这个组织方式；具体参数需按 zclaudia wire 重新调参。
- **体量估计**：zcode-protocol-v4 目录 54 文件，重写借鉴取其 schema/limits/profiles 思想（≈数百行 schema）而非全量。

### 2.6 连接级服务 facade：clientHello 能力协商 + 订阅所有权 + 连接角色降级

- **解决的问题**：同一 agent service 被多端同时连接时，订阅生命周期、能力声明、信任级别必须 per-connection 隔离：每个 RPC attachment 独立持有 subscription ownership；`clientHello` 握手声明客户端能力（如是否认得 `workflowRun.*` 增量），且"认不认得增量是连接的事实，不是某次订阅可以自选的口味"（防客户端伪造降级/升级）；连接分 `desktop-continuous`（trusted-host-relay）与 `web-remote-replayable`（terminal-client）两种角色，非受信角色在 ServiceCollection overrides 里把高权限服务替换为抛错桩（如 ProviderProvisioningTargetService）。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/zcode-agent/zcodeAgentConnectionScope.ts:1-45`（V4 facade、`ZCodeAgentV4ConnectionContext`、TRUSTED_CONNECTION_FIELD carrier）
  - `/Users/zhvala/SourceCode/ZCode/packages/server/src/http.ts:89-136`（setupChannelServer：clientMode 决定 reverse client、overrides 注入、连接关闭清理）
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/zcode-agent/topicResourcePeers.ts:12-48`（共用 server 只维护已鉴权路由，资源返回路由必须由可信 carrier 登记）
- **zclaudia 现状**：有信任边界文件（`server/src/interfaces/http/trust-boundary.ts`、`middleware/auth.ts`、`middleware/local-only.ts`）与消息级中间件，但无连接级服务 facade/能力协商/服务降级机制（未发现等价物）。
- **可搬运性**：**重写借鉴**。思想（连接 = 独立作用域 + 握手写能力 + 高权限服务按角色 stub）可落在现有 MessageRouter/中间件上，无需 rpc 框架先行。
- **体量估计**：思路级→小模块（数百行）。

### 2.7 后台会话事件合并与任务索引同步（bots/后台会话的流量整形）

- **解决的问题**：后台会话（bots、automation 驱动）产生的高频流事件不能原样洪泛给远端消费者：`zcodeSessionEventCoalescer` 按会话 key 合并 text/reasoning/tool_input delta（默认 1500ms / 96 条上限），`continuousStreamCoalescer` 对前台连续流做 16ms/4096 字符合并；`zcodeTaskIndexSyncer` 把 v4 帧摄入 sqlite 任务索引并广播 `workspace_task_list_changed`，保证侧边栏排序实时收敛。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/zcode-agent/zcodeSessionEventCoalescer.ts:1-14`（常量与合并种类）
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/session/continuousStreamCoalescer.ts:1-17`
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/zcode-agent/zcodeTaskIndexSyncer.ts:1-31`
  - `/Users/zhvala/SourceCode/ZCode/packages/services/src/zcode-session/zcodeSessionService.ts:34-45`（taskIndexSyncer 注入点注释）
- **zclaudia 现状**：已有同思想的 `run-delta-batcher`（50ms/512 字符，`server/src/application/conversation/runtime/run-delta-batcher.ts:1-21`），但仅覆盖 run 文本 delta；后台会话/任务列表的合并与索引广播无等价物（`session-sync-port.ts` 只广播单会话更新）。
- **可搬运性**：**重写借鉴**。zclaudia 已有 50% 思想，差距在"后台会话事件通道"与"任务索引投影"两块。
- **体量估计**：单文件级（数百行/个）。

### 2.8 一次性 host capability 握手（受信升级）

- **解决的问题**：`/ws` 上任何客户端都不能自称 trusted host；桌面宿主先 POST `/api/rpc-host-capability` 领取一次性 capability，再带 header 连 `/ws/host`，服务端 consume 即作废——把"受信"从静态 token 升级为一次性票据，防重放与越权升级。
- **证据（ZCode）**：`/Users/zhvala/SourceCode/ZCode/packages/server/src/hostCapability.ts`（issue/consume store）、`/Users/zhvala/SourceCode/ZCode/packages/server/src/http.ts:333-363`（签发路由 + `/ws/host` 中间件校验 + 注释"浏览器设置旧 mode header 也不能再把自己提升为 trusted host"）。
- **zclaudia 现状**：静态 token/timing-safe 比较鉴权（`server/src/auth.ts:1-14`、`server/src/interfaces/http/middleware/auth.ts`），无一次性 capability。
- **可搬运性**：**直接移植**。与框架无关，几十行即可落地到现有 WS upgrade 路径。
- **体量估计**：单文件级（<100 行）。

### 2.9 远程后端抽象与反向桥接（SSH/Docker/WSL → 浏览器）

- **解决的问题**：Web 端要操作远程机器：`IRemoteBackend` 统一 detect/upload(SFTP 带进度)/exec/exists/readFile，SSH/Docker/WSL 三实现；服务端反向拨号后把远端 file/git/system/terminal 服务包装成 ServiceCollection，经 `/ws/remote/:id` 用同一套 ChannelServer 暴露给浏览器（一次连接一个客户端）；配套远端资产部署（remoteAsset* 系列：CDN 缓存、preflight、live identity、部署锁）。
- **证据（ZCode）**：
  - `/Users/zhvala/SourceCode/ZCode/packages/server/src/remote/backend.ts:1-40`（IRemoteBackend 接口）
  - `/Users/zhvala/SourceCode/ZCode/packages/server/src/remote/ssh-backend.ts:1-50`、`docker-backend.ts`、`wsl-backend.ts`
  - `/Users/zhvala/SourceCode/ZCode/packages/server/src/http.ts:366-385`（connect-remote）、`:435-464`（/ws/remote/:id 桥接）
  - `/Users/zhvala/SourceCode/ZCode/packages/server/src/remote/remoteAssetInstaller.ts` 等 37 文件
- **zclaudia 现状**：`server/src/infra/gateway/`（manager/embedded-adapter/standalone-adapter/ws-hub）已有多 backend hub 与 `catch_up_content` 续传，但 backend 仅限本机/已配置网关，无 SSH/Docker/WSL 拨号与远端资产部署。
- **可搬运性**：**重写借鉴**（与 T4 维度重叠，T4 应为主责；T2 结论：`IRemoteBackend` 接口 + "远端服务→ServiceCollection→同一暴露路径"的架构手法可直接套用）。
- **体量估计**：remote/ 目录 37 文件；先做 SSH backend + 桥接（≈2k 行）。

### 2.10 RPC 观测中间件：统一调用日志 + 网络遥测 sink

- **解决的问题**：所有 RPC 调用经 `LoggingChannelServer/Client` 装饰统一落日志；`network-telemetry-middleware` 把每次网络传输观测推给可插拔 sink（含 transport kind）。
- **证据（ZCode）**：`/Users/zhvala/SourceCode/ZCode/packages/rpc/src/logging-middleware.ts`（157 行）、`/Users/zhvala/SourceCode/ZCode/packages/rpc/src/network-telemetry-middleware.ts`（148 行）；使用点 `/Users/zhvala/SourceCode/ZCode/packages/server/src/http.ts:98-99`。
- **zclaudia 现状**：消息级 logging/error 中间件已有（`server/src/interfaces/http/middleware/logging.ts`、`error.ts`），网络级遥测 sink 缺失。
- **可搬运性**：**直接移植**（若 2.1 落地则顺带）；否则仅思路。
- **体量估计**：合计约 300 行。

---

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

- **进程内高内聚对话运行时**：`application/conversation/runtime/` 46 个职责单一的 run-*.ts（reducer、phase 机、delta batcher、terminal snapshot、overflow 压缩、steer 持久化、recovery），调试与演化比 ZCode"host 子进程 + CLI 协议"更直接；ZCode 的对应逻辑散在 CLI 包（T1 范围）+ services 之间。
- **多 backend gateway facade**：`infra/gateway/`（embedded/standalone 双 adapter、`catch_up_content` 按 offset 续传、backend 数据事件）——ZCode 没有等价的"一个 UI 管多个后端实例"抽象。
- **managed-runtimes 安装工程**：`application/managed-runtimes/`（平台 key、兼容性 descriptor、安装锁、provenance、GC）比 ZCode 的 remoteAsset* 更聚焦可复用。
- **SQLite 全量本地优先存储 + message 重投影**：`domains/sessions/reproject-messages.ts`、message-page-budget 等，ZCode 侧会话正文主要在 CLI 进程/文件侧（T1 范围），host 侧只有索引投影。
- **域事件驱动集成**：`domains/sessions/session-events.ts` 类型化域事件 + run-domain-dispatcher 解耦分发，边界比 ZCode services 内部直调更清晰（主观评估，供参考）。
- **进程级监管与 Env 洗涤**：`infra/services/process-supervisor.ts`（10s 扫描、6h GC、7 天终端记录保留）+ `infra/providers/pi-runtime/env-scrub.ts`，ZCode 的 process 管理偏 agent 子进程自身。

## 4. 不建议搬运的（及原因）

- **ZCode `packages/services` 整体**：410 个 TS 文件的"服务大杂烩"，与 `@zcode/shared`（ServiceChannels/descriptors）、Electron 宿主假设、coding-plan 商业服务（highspeed 加速卡、marketing-touch、coding-plan-subscription）强耦合。zclaudia 已有清晰的 domains/ 分层，整体照搬会破坏现有架构；只取 2.5–2.7 的具体机制。
- **bots 的产品级功能面**：飞书群协作卡片、群成员目录、企业微信注册等属于 ZCode 产品功能选择，不是架构优势；搬抽象不搬清单（见 2.4）。
- **offPeak 错峰任务 / highspeed 加速卡 / marketing-touch**：`packages/services/src/session/offPeak*.ts`、`highspeed/`、`marketing-touch/`——商业套餐专属（Coding Plan 双 JWT 契约），与 zclaudia 无对应商业模型。
- **ZCode `entry-stdio` 桌面内嵌形态**：`packages/server/src/stdio.ts` + `stdio-lifecycle.ts` 让服务端以 stdio 模式内嵌进 Electron 宿主。zclaudia 是 Tauri + sidecar，已有自己的生命周期管理；且该形态依赖 rpc 框架先行，收益存疑（仅思路，暂不动）。
- **`@zcode/rpc` 的 MessagePort 分支**：`protocol.ts` 中 MessagePortProtocol/createQueuePair 面向 Electron renderer<->host 场景，zclaudia 用不上；移植时可裁剪。
- **跨窗口 broadcast claim（`services/src/broadcast/`）**：token 预约互斥面向 Electron 多窗口同 host 场景；zclaudia 的多端拓扑是"server + 多客户端"，等价问题应由 gateway/锁服务解决，直接搬会错位。

---

## 未覆盖 / 未确认事项

见提交结果 `unverified`。主要局限：未通读 `botsService.ts`（9.9k 行）内部实现，bots 结论基于目录结构、channelRuntime、http 回调入口与文档标题；`packages/services/src/` 仍有约 30 个子目录未逐一定读（telemetry、usage-stats、plugin-ui-bridge、client-scenes 等，多数偏 T5/T6 维度）；zclaudia `apps/desktop` 侧未探索（T3 范围）。

---

## 5. 独立复核记录

复核人：复核员·T2（独立会话，未共享探索员上下文）；复核日期：2026-10-16；方法：只读工具逐条打开证据文件核对。以下针对第 2 章 P1/P2 领先点逐条给出结论（路径均相对 `/Users/zhvala/SourceCode/ZCode/`）：

- ✅ 自研分层 RPC 框架 `@zcode/rpc` —— 六层架构图 `packages/rpc/src/index.ts:1-29`；`fromService`/事件缓冲/`toService` 见 `packages/rpc/src/proxy-channel.ts:46-97,106`；IPCServer 1:N 连接集合 `packages/rpc/src/ipc.ts:95-101`；亲自 `cat packages/rpc/package.json` 确认仅有 devDependencies、无 `dependencies` 字段。
- ✅ `PersistentProtocol` 可靠传输层 —— `packages/rpc/src/persistent-protocol.ts:1-14` 头注释明言"Channel RPC 层完全不知道 PersistentProtocol 的存在"；`:77` KEEP_ALIVE_INTERVAL=5000、`:81` ACK_TIMEOUT=20000、`:92-96` 高水位 1MiB/重放缓冲 8MiB/宽限 45s、`:123-140` send 入未 ACK 队列并做水位判定。
- ✅ 服务端 CLI 化分发 —— `packages/zcode-server-cli/src/supervisor/supervisor.ts:42-70`（Supervisor 持 DataRootLock/CrashBudget/ReleaseManager/Core 代际）、`:75-86`（先取单实例锁再启动恢复回写 current.json）；`src/cli.ts:75-90`（serve/status/stop/restart/update/uninstall 六子命令）；`src/platform/serviceManager.ts:7-12`（launchd/systemd/task-scheduler 三平台 descriptor）；`src/packaging/stage.ts:16-30`（bare module 提取）+ `stageCli.ts:62-68`（按 target 下载 Node dist 自带运行时）；`src/runtime/releaseManager.ts:32-42,61,137-145`（原子写、update 事务、current 指针回滚）+ `immutableRelease.ts:105-114`（rename 原子安装）。
- ✅ Bots 多渠道运行时 —— `packages/services/src/bots/channelRuntime.ts:7-9`（lease 30s/心跳 10s）、`:27-37`（`assertBotCallbackSucceeded` 回调失败抛错，注释明言游标只能 ok=true 后提交）；`botsService.ts:743` `createBotsService`（实测 9,924 行）；`providers/` 含 telegram/feishu/weixin/webhook 及群成员目录；`feishuProvider.ts:1179,1489`（流式卡片 PATCH）；`taskStreamHub.ts:5-6`（单实时源多渠道监听）、`channelMentionResolver.ts:42`（mentionName 解析）；`packages/server/src/http.ts:387-432` 回调入口、`:423-427` 注释明言业务失败必须 503 透传防误确认。
- ✅ V4 wire 协议 —— `packages/shared/src/zcode-protocol-v4/core.ts:34-59`（DELIVERY_PROFILES：continuous 30ms/256KiB 流上限 vs replayable 150ms/带工具进度）、`:64-76`（maxFrameBytes 1MiB、分片重组并发/字节/超时限额、eventRetentionPerSession 2000、snapshotTailWindowRows/rowsRangeMaxLimit）、`:1-2`（"只放 schema 类型 + 纯函数，禁止任何运行时/IO/传输逻辑"纪律原文）；`wire-assembler.ts:21-27` 与 `wire-reassembly.ts:1-2` 分片组装/重组实现，`snapshot.ts`/`rows.ts` 在目录中。
- ✅ 连接级服务 facade —— `packages/services/src/zcode-agent/zcodeAgentConnectionScope.ts:2-3`（每 RPC attachment 独立 subscription ownership）、`:28-38`（clientHello 写出 workflowRunDeltas，注释原文"认不认得增量是**连接**的事实，不是某一次订阅可以自选的口味"）；`packages/server/src/http.ts:89-136`（per-connection scope、`:110` 角色分配、`:117-128` 非受信角色把 ProviderProvisioningTargetService 替换为抛错桩、`:130-135` 关闭清理）；`topicResourcePeers.ts:12,28-29`（只维护已鉴权路由、仅可信 carrier 可登记返回路由）。
- ✅ 一次性 host capability 握手 —— `packages/server/src/hostCapability.ts:18-53`（issue/consume，`:46-48` consume 无论成败先删票据防重放，TTL 30s）；`packages/server/src/http.ts:333`（POST 签发）、`:335-336`（注释原文"浏览器/任意客户端设置旧 mode header 都不能再把自己提升为 trusted host"）、`:356-363`（/ws/host 中间件 consume 校验失败 401）。
- ✅ 远程后端抽象与反向桥接 —— `packages/server/src/remote/backend.ts:32-49`（IRemoteBackend detect/upload 带进度/exec/exists/readFile）；`ssh-backend.ts:1-40`（ssh2 Client + SFTP 上传进度）、`docker-backend.ts`、`wsl-backend.ts` 均在；`packages/server/src/http.ts:366-379`（connect-remote）、`:435-464`（/ws/remote/:id 把远端 file/git/system/terminal 包成 ServiceCollection 复用同一 setupChannelServer，`:450-451` 一次连接单客户端）。
- ✅ 后台会话事件合并与任务索引同步 —— `packages/services/src/zcode-agent/zcodeSessionEventCoalescer.ts:4-11`（1500ms/96 条、text/reasoning/tool_input 三种 delta）、`:37+` 按 key 合并；`src/session/continuousStreamCoalescer.ts:3-4`（16ms/4096 字符）；`zcodeTaskIndexSyncer.ts:22-37`（v4 帧摄入）、`:113,491`（sqlite 同步并广播 workspace_task_list_changed）；`src/session/taskIndexRepo.ts:43`（node:sqlite DatabaseSync 实证）。

复核备注：9 条全部通过。仅两处与报告体量估计的微小出入，不影响结论：`packages/server/src/remote/` 实际 38 个文件（报告写 37）；报告引用的 `channels.ts` 为 4 行 barrel 再导出，ChannelServer/ChannelClient 实体在 `channelServer.ts:13`/`channelClient.ts:19`。
