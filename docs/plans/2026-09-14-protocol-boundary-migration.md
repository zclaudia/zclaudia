# 公共协议包职责拆分与迁移计划

日期：2026-09-14  
状态：阶段 0–4 已实施（本地 tarball 联调通过）；阶段 5 待 npm 发布后执行。实施基线与类型迁移表见 `2026-09-14-protocol-boundary-migration-baseline.md`。

修订：已核对 Gateway 提交 `77e877b`、当前 validation/发送点、应用消费路径及评审意见；阶段 0 可独立实施，阶段 2 的网关协议发布按破坏性变更处理。

发布前待办（阶段 5，按顺序）：
1. 发布 `@zclaudia/gateway-protocol@0.2.0`（破坏性）与 `@zclaudia/protocol@0.2.1`（兼容）。
2. 按 lockstep 发布 `gateway-client` / `gateway-backend` 对应版本。
3. zclaudia 三包依赖已指向 `^0.2.0` / `^0.2.1`；发布后执行 `pnpm install` 重新生成锁文件（提交中锁文件未更新，因为候选版本发布前无法从 registry 解析）。
4. 0.3.0 删除兼容层（`/gateway`、`/agent`、dead wire、旧通知配置出口），删除清单见基线文档 §3。

## 目标

以“通用网关传输机制 / ZClaudia 应用语义”划分职责，结束按历史版本分散定义类型的状态。

- `@zclaudia/gateway-protocol`：网关为路由、连接管理和通用服务所需要的公开契约。
- `@zclaudia/protocol`：ZClaudia 各端共享的业务数据、事件与同步契约。
- 两个协议包最终互不依赖，均不依赖应用、SDK 或 Node 专属运行时。
- Gateway Server 与 Gateway SDK 最终只消费网关契约；应用适配层组合两类契约。
- 第一轮迁移保持实际线上消息字段、消息名、Topic 名、Channel kind 及行为一致，先调整契约归属与导入路径。

目标依赖：

```text
Desktop / ZClaudia Server / Shared 中的适配层
  ├── @zclaudia/protocol
  └── @zclaudia/gateway-protocol

Gateway Server / gateway-client / gateway-backend
  └── @zclaudia/gateway-protocol
```

本轮不更换包名，不整体重写连接实现，不要求应用改用 Gateway SDK，也不整体搬迁 `shared` 或重构 Agent 运行时。`docs/specs/2026-09-12-unified-runtime-invocation-protocol-design.md` 涉及的运行时设计保持独立；本轮只整理已有的跨端公共契约。

## 已确认的现状

| 仓库 | 当前情况 | 主要入口 |
| --- | --- | --- |
| `zclaudia-protocol` | 包版本 0.2.0；`/gateway` 包含 v3 常量、握手、资源同步、旧 HTTP 代理及通知请求；还有 `/core`、`/agent`、`/zclaudia`、`/notifications` | `src/gateway.ts`、`src/notifications.ts`、`src/index.ts` |
| `zclaudia-gateway` | `gateway-protocol` 0.1.0 只有 hello、ready、registry snapshot、error 和 Channel/Topic/HTTP；缺少完整控制面契约体系；Gateway 根包仍依赖旧 `protocol` | `packages/protocol/src/index.ts`、`src/validation.ts`、`src/server.ts`、`src/state.ts`、`src/push-notification.ts` |
| `zclaudia` | Server 同时消费两个包；Desktop、Shared 仍大量使用旧 `/gateway` 类型；Desktop 手写部分 v4 类型 | `server/src/infra/gateway/`、`shared/src/facade/`、`apps/desktop/src/hooks/transport/GatewayTransport.ts` |

额外事实：Gateway 当前实现拒绝非 v4 握手，但新包仍有 `3 | 4` 类型声明；部分文档仍描述 v3/v4 共存。旧式 `backend_server_message` 定向回退仍实际使用，不能仅凭命名判断可删除。通知配置包含 ntfy 服务参数、鉴权信息及过滤规则，不能全部视为应用用户偏好。

鉴权基线：Gateway 在 2026-09-04 的提交 `77e877b` 删除共享密钥认证，只接受签发凭据，`GATEWAY_ADMIN_TOKEN` 为启动必填项。握手 `gatewaySecret` 保留原 wire 名称，但值是 `zgd_` / `zgb_` / `zga_` 凭据；namespace 和注册权限由服务端凭据记录决定。管理员 token 是管理面凭证，不能用作 peer 登录凭据。应用 `server/src/index.ts` 仍读取 `GATEWAY_SECRET`，`server/src/interfaces/http/gateway.ts` 仍映射 `gatewaySecret` / `gateway_secret`；这些是旧配置命名，不代表服务端支持共享密钥。新包 hello 注释和应用根 `CLAUDE.md` 环境变量表均已过期。

## 契约归属决策

以下入口为拟定结构，实施时先以导出清单确认；现有可用入口在兼容阶段保留。

| 契约 | 目标位置 | 迁移方式 |
| --- | --- | --- |
| 握手、Registry、BackendPresence、心跳、传输错误 | `gateway-protocol` 根入口 | 补齐 v4 实际使用的字段、消息和方向联合类型；明确协议版本为 4 |
| 握手凭据与 admin/credential 管理 DTO | 握手字段留在根入口；新增 `gateway-protocol/auth`、`gateway-protocol/admin` | auth 定义公开凭据元信息与 `/api/backend/token` 交换 DTO；admin 定义 `/api/admin/session`、`/api/admin/overview`、`/api/admin/credentials` 及撤销接口 DTO；只导出公开请求/响应，不导出凭据存储、hash 或签发实现 |
| Channel、Topic、流式 HTTP | `gateway-protocol` 根入口 | 沿用现有定义，删除消费者手写副本 |
| 定向消息回退 | `gateway-protocol` 根入口 | 保留现有路由字段与 wire 名称，内部 `message` 为 `unknown` |
| Session、Project、SessionMessage、RunStatus | `protocol/zclaudia` | 维持已有业务模型与字段 |
| 资源快照、增量事件、业务流、内容补齐 | 新增 `protocol/sync` | 从旧 `/gateway` 迁移；首轮保留 wire 名称，包括名称中历史遗留的 `backend_` 前缀 |
| ZClaudia Topic 名、Channel kind、namespace | 新增 `protocol/transport` | 应用绑定约定，如 `resources`、`zclaudia`，不导入网关包 |
| `protocol/agent` 的事件、权限与交互契约 | 阶段 5 删除入口与根重导出 | 已检查 server/shared/desktop/plugins，无直接消费者；运行时契约归 plugin-sdk。先将包内仍被 `/zclaudia` 引用的 `AgentRunStatus` 迁为 `/zclaudia` 的 `RunStatus` 定义，保持状态取值不变，再删除旧模块 |
| `backend_subscribed` / `backend_unsubscribed` 本地事件 | `shared/src/facade/adapter.ts` 的 `FacadeAdapterEvent` | 保留现有事件名字并明确其为进程内 facade 事件；与旧 wire 类型脱钩，不迁入两个公开协议包 |
| 应用通知事件及用户偏好 | `protocol/notifications` | 仅保留应用语义，适配到通用推送请求 |
| Gateway 通用推送请求、通知管理 API 的公开 DTO | 新增 `gateway-protocol/notifications` | 明确为可选网关服务扩展，与核心 Channel/Topic 区分 |
| ntfy 连接、鉴权配置及默认值 | Gateway 通知服务内部模块 | 仅将实际跨端公开的管理 API 字段定义为 DTO，内部配置不整体导出为 wire 契约 |

通知例外说明：当前 Gateway 确实执行通知服务，因此此轮保留该服务，并给它定义通用扩展契约。应用事件名的含义仍归 ZClaudia；网关可按通用字段与过滤规则投递，但不解释会话或运行状态。公开 DTO 与内部配置先分类，再移动；首轮保持配置 API 与存储兼容。后续是否把通知服务移出 Gateway，可独立决定。

## 阶段 0：立即移除 Desktop 的 v4 帧副本

- [ ] 在 Desktop 声明已发布的 `@zclaudia/gateway-protocol@^0.1.0` 直接依赖并更新锁文件。
- [ ] `GatewayTransport.ts` 从该包导入 `ChannelReadyMessage`、`ChannelClosedMessage`、`TopicSubscribedMessage`、`TopicUnsubscribedMessage`、`TopicMessage`，删除五个本地 interface 及“等待发布 npm”注释。
- [ ] 检查 `ChannelClosedMessage.reason` 从本地 `string` 变成公开枚举后对当前代码及测试夹具的影响；接收未知网络数据的现有容错行为保持不变。
- [ ] 运行 Desktop 类型检查与相关 GatewayTransport 测试。

独立提交，无阶段 1–5 或新包发布前置依赖；仅使用 0.1.0 已有导出。退出条件：这五个帧只有包内定义，Desktop 有明确直接依赖。

## 阶段 1：冻结迁移清单与行为基线

已核实的清单直接作为基线，不再把归属判断留空：

| 类型 / 消息 | 已核实的路径与状态 | 处理决定 |
| --- | --- | --- |
| `catch_up_content`、`content_patch`、`content_patch_error` | Gateway switch 无分支；应用 `gateway-client.ts` 的 `catchUpOutgoingStream` 经 outgoing channel 发请求，`handleCatchUpRequest` 经原 channel 回复 | 活跃应用同步 payload，迁到 `protocol/sync`，保留消息名 |
| `backend_resource_snapshot`、`backend_resource_event` | 应用发布与解释 `resources` Topic 的 payload | 迁到 `protocol/sync`，网关只处理 Topic 外层 |
| `backend_stream_event` | Gateway switch 无分支；应用 `emitRunStreamEvent` 尚有顶层发送遗留，但被 `private readonly streamDemandActive = false` 永久拦住 | 属应用语义；删除不可达的旧发送/需求路径。单独追踪接收类型及实际运行事件 Channel 路径，再决定兼容类型是否进入 `/sync`，不标为已完成 Channel 迁移、不为它恢复网关分支 |
| `subscribe_backend`、`unsubscribe_backend`、`backend_stream_demand`（旧 stream_demand）、`request_backend_resource_snapshot` | Gateway 无处理分支；所查应用活跃源码也未命中这些 wire 名 | dead wire 候选；阶段 1 完成根导出、别名与其余已知消费者清点，阶段 5 删除，规范入口不续建 |
| `backend_subscribed`、`backend_unsubscribed` | Embedded adapter 本地 emit，Shared facade 自己定义并消费 | 保留本地事件名，明确进程内契约，与已死 wire 分开处理 |
| `minBackendProtocolVersion` | Gateway 无读取，当前 v4 hello 类型已省略 | dead 字段；新类型继续省略，清理旧兼容声明时删除 |
| `/agent` 及其事件、权限、交互类型 | 已知应用与插件无直接消费；包自身测试引用事件，`/zclaudia` 内部引用状态类型 | 无外部直接消费者；迁出 `RunStatus` 后在阶段 5 删除入口、事件和相应旧包测试 |

控制面清单以 `zclaudia-gateway/src/validation.ts` 的 `MESSAGE_SPECS`、`server.ts` 路由分支和全部发送点为依据。validation 对未知类型返回 null，随后由路由拒绝，因此不能把“通过字段检查”视为“支持该消息”。hello 单独校验。

| 方向 | 必须覆盖的消息 |
| --- | --- |
| Peer → Gateway 握手 | `peer_hello` |
| Backend → Gateway | `backend_heartbeat`、`backend_server_message`、`push_notification_request`、`topic_publish` |
| 已认证 Peer → Gateway（具体权限按 handler） | `request_registry_snapshot`、`ping`、`channel_open`、`channel_reject`、`channel_close`、`topic_subscribe`、`topic_unsubscribe` |
| Gateway → Peer | `peer_ready`、`registry_snapshot`、`gateway_error`、`heartbeat_ack`、`pong`、`channel_ready`、`channel_offer`、`channel_closed`、`topic_subscribed`、`topic_unsubscribed`、`topic_message`、定向转发的 `backend_server_message` |

字段清单保留实际宽容性：`backend_heartbeat.observedAt` 可选；`ping.ts` 可选、`pong.ts` 原样回传；`heartbeat_ack` 当前带 `streamDemand: false`，该字段不能与已移除的需求消息混同。定向回退 `targetPeerSessionId` 在字段校验中可选，但 handler 缺少它时直接返回；分别记录“可解析”与“会被投递”的条件。

- [ ] 扫描三个仓库和 Gateway 两个 SDK 的旧包引用、根入口导出及类型重复；检查已知其他消费者，记录无法核实的外部消费者范围。
- [ ] 为旧 `/gateway` 每个导出记录：实际发送方、接收方、传输路径、目标位置、是否仍存活。区分顶层控制帧、Topic payload、Channel payload、HTTP 管理 DTO。
- [ ] 逐项核对上述控制面基线的字段、方向、权限与发送点，补充公开 HTTP DTO；文档与运行代码冲突时记录并修正文档。
- [ ] 为 `/api/backend/token` 和全部 `/api/admin/*` 列出方法、请求/响应、错误、Bearer/管理 session cookie 前提及凭据种类；以 `CredentialInfo` 的实际公开序列化字段为准，不直接导出数据库记录。
- [ ] 记录应用旧环境变量、API 字段、DB 列名到签发凭据的映射；首轮保留旧持久化/API 名称作为兼容边界，不自动把旧共享密钥转换为有效凭据。
- [ ] 记录通知配置 API、默认值、存储及 Desktop bridge 的映射。`NotifyEvent.priority` 有声明和调用方，但 `sendPushNotificationRequest` 只发送 `severity`，priority 从未上 wire；阶段 4 删除无效字段及相应调用实参，保留既有默认投递结果，不新增 priority→severity 映射改变优先级。Gateway 按 `name` 过滤、按 `severity` 映射优先级的现有行为作为基线。
- [ ] 运行相关仓库现有构建、Gateway 契约测试及应用网关测试，记录基线失败。

产出：类型迁移表、依赖图、消息样例与带鉴权前提的兼容矩阵。退出条件：每个活跃契约均有唯一的目标归属，回退、凭据/管理 API、通知与 dead wire 路径明确列出。

## 阶段 2：建立完整规范入口与候选发布产物

在 `zclaudia-gateway/packages/protocol`：

- [ ] 按阶段 1 的 validation + 路由 + 发送点清单逐项定义控制面；特别补上 `backend_heartbeat`、`request_registry_snapshot`、`backend_server_message`、`push_notification_request`、`ping`、`heartbeat_ack`、`pong`，而不是继续从旧包拼接联合类型。业务 payload 保持 `unknown`，通知扩展按网关确实读取的通用事件字段定义。
- [ ] 增加 auth/admin 公开 DTO；更正 `PeerHelloV4.gatewaySecret` 注释为“仅签发凭据，字段名为 wire 兼容保留”，涵盖 device/backend/backend-access，明确 admin token 不用于 peer 握手。
- [ ] 统一 v4 版本常量，移除规范入口中的 v3 类型许可；不顺便缩窄客户端对未来未知错误码的容错能力。
- [ ] 用明确方向的控制消息联合类型约束发送端，接收端在解析边界做必要校验；避免用 `as unknown as` 掩盖协议缺口。
- [ ] 更新 `exports` 和打包设置，每个条件映射将 `types` 放在 `import` / `default` 前；确认新增子入口包含 JS、声明文件及其引用。

在 `zclaudia-protocol`：

- [ ] 新增业务同步与应用传输约定入口；保留现有业务模型和 wire 字段。
- [ ] 旧 `/gateway` 的业务类型在包内重导出新规范定义，并标记 deprecated。
- [ ] 对迁往另一包的旧传输类型，保留冻结的兼容声明及迁移说明；它们只用于旧消费者，不继续演进，也不增加两个协议包间的依赖。
- [ ] 暂时保留旧通知导出供旧消费者使用；新代码采用分类后的规范入口。
- [ ] 将 `/zclaudia` 的 `RunStatus` 定义移出 `agent.ts`，保持现有状态集合；旧 `AgentRunStatus` 暂作兼容别名并保留原导出，其他无消费者 Agent 类型仅保留到阶段 5。
- [ ] 修正现有全部 exports 条件顺序，`types` 前置，不依靠同名 `.d.ts` 被间接找到。
- [ ] 检查根 `index.ts` 的导出冲突和旧网关常量泄漏，明确兼容导出的删除版本。

验证：打包后以 tarball 安装到最小 Node ESM 与浏览器 TypeScript 消费项目；验证子入口、声明依赖闭包和运行时常量。类型测试只覆盖公开 API 兼容和消息方向等真实边界，不为机械移动逐个复制测试。

退出条件：两个包的候选产物能独立消费；`protocol` 的旧消费者仍可通过兼容导出构建；`gateway-protocol` 0.2.0 按破坏性候选检查并修正受影响 TS 消费者，不能要求仍写 `3 | 4` 的旧源码无修改编译。新入口不存在跨包循环或重复规范定义。

## 阶段 3：迁移 Gateway Server 与 SDK

- [ ] Gateway 根包声明对 workspace `gateway-protocol` 的依赖。
- [ ] 将 `src/server.ts`、`src/state.ts` 中的握手、目录、心跳、错误和定向回退导入迁往新包。
- [ ] 管理路由、凭据交换和管理 UI 消费规范 auth/admin DTO，保留签发、过期、撤销、namespace 与 backend 注册权限行为。
- [ ] 将 `src/push-notification.ts`、`src/index.ts` 的配置与通知类型按阶段 1 清单拆分；保持通知路由、鉴权、过滤规则和现有 API 行为。
- [ ] 更新 `packages/client`、`packages/backend` 的类型和常量，与 Gateway 实际 v4 行为对齐。
- [ ] 删除 Gateway 运行代码与测试对 `@zclaudia/protocol` 的依赖；测试可使用不含 ZClaudia 模型的通用 payload。
- [ ] 反转现有 `src/__tests__/protocol-boundary.test.ts`：删除“旧包可用”的正向断言，改为检查 Gateway/SDK 源码及依赖清单禁止导入旧包（含根入口和子路径），并保留通用 payload 不透明性的契约验证；与末尾边界检查共用实现。
- [ ] 修正文档中“v3 共存”“尚未发布 npm”和共享密钥鉴权说明，明确必填 `GATEWAY_ADMIN_TOKEN` 与签发凭据登录，并明确根包版本、SDK 版本和 wire 版本分别代表什么。

退出条件：Gateway 与 SDK 构建、lint、现有测试通过；真实 Gateway 契约测试覆盖 Channel、Topic、HTTP、重连和定向回退；Gateway 包依赖与源码均不再引用应用协议包。

## 阶段 4：迁移 ZClaudia 消费者

- [ ] Shared 按实际导入声明 `gateway-protocol` 直接依赖；Desktop 在阶段 0 基础上与 Server 一起升级到 0.2.x 候选并更新锁文件。
- [ ] `GatewayTransport.ts` 统一剩余握手、Registry、错误类型与 v4 常量；Channel/Topic 副本已在阶段 0 删除。
- [ ] `server/src/infra/gateway/gateway-client.ts`、心跳、HTTP channel、消息 channel 使用规范网关类型，清理迁移过程中不再必要的强制转换。
- [ ] `gateway-backend-data-publisher.ts`、Shared facade 与 Desktop 内容同步改用 `protocol/sync` 和现有业务模型。
- [ ] 清理不可达 stream demand / 顶层 stream event 发送路径，核实实际运行事件的 Channel 消费链路；不把 dead wire 机械搬入 `/sync`。Embedded/Standalone facade 保留 `backend_subscribed` 等进程内事件名，测试其订阅状态变化不受旧类型删除影响。
- [ ] 集中应用 Topic 名、Channel kind 和 namespace，发送端与接收端消费同一套约定。
- [ ] 通知设置、通知 API、ntfy bridge 使用正确的应用契约或 Gateway 管理 DTO，并保留适配映射。
- [ ] 删除 `notification-sender.ts` 中无效 `priority` 字段及通知调用方对应实参（包括 `server-setup.ts` 的 process leak 通知）；验证输出 wire 的 name/severity 和实际默认优先级不变。若要修复产品期望的优先级，另立行为变更。
- [ ] 明确应用配置值为签发凭据；保留 `GATEWAY_SECRET`、`gatewaySecret`、`gateway_secret` 作为旧配置/API/存储名称，修正注释与文档。应用根 `CLAUDE.md` 环境变量表将 Gateway 的必填 admin token 与应用旧变量名承载的 peer credential 分开列出，移除“server、gateway 共用共享密钥”描述。名称全面迁移可另行进行。
- [ ] 仅在 payload 被应用解释的边界补齐必要运行时校验；不让 Gateway 解析应用 payload，也不通过全面 schema 重写扩大范围。

退出条件：应用活跃源码不再从旧 `/gateway` 获取契约，不再手写已有的网关帧；Standalone、Embedded 与 Gateway 模式均通过相关验证。

## 阶段 5：发布、升级与删除兼容层

发布前：先在本地以真实 tarball 联调三个仓库；记录每个候选包版本、消费者提交及测试结果。以下以当前已核实的 0.1.0 / 0.2.0 为版本基线，实施前复查 npm；若计划版本已占用则顺延，仍按下述变更分类处理。

建议顺序：

1. `gateway-protocol` 从 **0.1.0 → 0.2.0，整版按破坏性发布**：包括新增控制面/子入口，以及 `protocolVersion: 3 | 4` 收窄为 `4`。另行发布仅新增业务入口、保留旧导出的 `protocol` 兼容版；两者独立。
2. 按 Gateway 已有 SDK 版本策略发布相应 `gateway-client`、`gateway-backend`，并交付通过验证的 Gateway 服务端版本。
3. 更新 ZClaudia 依赖与锁文件，完成应用回归并交付。
4. 确认已知消费者迁移完成；在 `protocol` 的下一破坏性 minor（以当前 0.2.x 为基线，目标 0.3.0）删除 `/gateway`、`/agent`、旧通知配置出口、dead wire 声明及根入口对应兼容导出。`RunStatus` 已有独立业务定义，不随 `/agent` 一起删除。

发布分类按每个产物的全部变更判断：`gateway-protocol` 0.2.0 是破坏性版本，新增子入口不抵消类型收窄；只有 `protocol` 的中间过渡版在保持全部旧公开 API 的条件下属于兼容发布。SDK 按现有 lockstep 策略同步升级并更新依赖范围，消费者显式升级，不依赖 `^0.1.0` 自动跨到 0.2.x。TypeScript 破坏性变更与运行时 wire 兼容分开验证；本轮 wire 仍为 v4，hello 接收校验保留对非法版本返回协议错误的能力。

回滚：保留上一组已验证的包版本、锁文件、Gateway 产物和应用产物，以及其凭据数据库/配置兼容条件。基线选取已采用签发凭据的 v4 Gateway；回滚不能恢复共享密钥作为登录方式。由于首轮保持 wire 与存储兼容，可以恢复消费者及服务端产物；不撤销或覆盖已经发布的 npm 版本。若联调发现必须改变 wire 行为，拆成独立变更并重新建立新旧端兼容矩阵。

退出条件：已知仓库没有旧入口依赖，兼容删除版有迁移说明；未确认的外部消费者不能被宣称已全部迁移。

## 验证矩阵与最终验收

兼容矩阵前提：先为各被测 Gateway 配置必填 `GATEWAY_ADMIN_TOKEN`，通过管理 API 签发与 peer 角色、namespace 匹配且未过期/撤销的凭据；旧应用通过原 `gatewaySecret` 配置字段传入该凭据。旧应用必须已支持 v4 和该凭据承载方式；“旧”指迁移前消费者，不包括共享密钥专用客户端或 v3。跨独立 Gateway 使用各自签发的凭据，不能默认一个 token 在两套凭据库都有效。先单独通过鉴权，再执行消息兼容测试；缺失 admin 配置、凭据错误/过期、角色或 namespace 不符单列为配置/鉴权失败。

| 场景 | 核心检查 |
| --- | --- |
| 凭据与管理面 | 缺失 admin token 启动失败；凭据签发/列表/撤销；backend enrollment 交换 access token；admin session 登录/探测/登出；角色与 namespace 隔离、过期/撤销拒绝；共享密钥与 admin token 不能作为 peer 凭据 |
| 握手与目录 | v4 注册、Registry 更新、心跳、Backend 离线与 epoch 变化 |
| 控制面覆盖 | 阶段 1 每种消息对应发送/接收路径；heartbeat_ack、ping/pong 可选字段；未知消息被路由拒绝；有效凭据下非 v4 hello 返回协议版本错误 |
| Channel | 双向消息、建连排队、关闭与重连恢复、定向回退行为 |
| Topic | 发布订阅、retain 冷启动、资源快照与增量、离线清理 |
| HTTP | 多块上传与下载、背压、取消、错误返回 |
| 应用同步 | 会话与项目更新、运行事件、断线内容补齐、消息顺序及去重 |
| 通知 | 配置读取、ntfy 鉴权模式、name 过滤、severity→优先级映射、无效 priority 清理后输出不变、测试推送与 Desktop bridge |
| 运行时兼容 | 在上述签发凭据前提下：迁移前 v4 应用 ↔ 新 Gateway、新应用 ↔ 上一已验证的凭据制 v4 Gateway，以及两个 SDK ↔ 新 Gateway |
| TypeScript API 兼容 | gateway-protocol 0.2.0 的类型收窄按破坏性迁移；protocol 过渡版保留旧入口；删除版验证剩余声明不再引用 agent/gateway 旧文件 |
| 非网关模式 | Standalone、Embedded 的类型构建与相关行为回归 |
| 发布产物 | npm tarball 的子入口、types 优先的 exports 条件、声明闭包、浏览器与 Node ESM 消费 |

优先复用 `zclaudia-gateway/src/__tests__/phase3-sdk-contract.test.ts` 和已有 Channel、Topic、HTTP、通知测试；应用侧复用 `server/src/infra/gateway/__tests__/`、GatewayTransport 与 facade 测试，补齐有实际缺口的场景。协议重构需做跨仓联调，不能仅以 TypeScript 编译成功验收。

边界检查复用阶段 3 反转后的 `protocol-boundary.test.ts`，不保留断言“旧包可用”的旧方向，不另造重复检查：Gateway/SDK 禁止导入应用协议；应用禁止导入已移除入口；两个协议包保持独立。检查针对源码和依赖清单，允许历史文档保留迁移说明。

最终完成标准：

- 每个活跃传输契约只有一个规范来源，每个业务契约也只有一个规范来源。
- Gateway 不依赖 ZClaudia 业务模型；应用适配层负责组合与解释 payload。
- 两个协议包互不依赖，消费者直接声明实际所需依赖。
- 所有已知消费者完成迁移，临时冻结声明已在计划的破坏性版本中移除。
- `/agent` 无消费者入口已删除，业务 `RunStatus` 保留；dead wire 与进程内 facade 事件分开处理；鉴权文档、公开 DTO 和实际凭据模型一致。
- 既有通信、通知与三种应用连接模式通过相关回归，发布与回滚记录可追溯。

## 建议提交拆分

| 变更 | 仓库 | 前置条件 |
| --- | --- | --- |
| 0. Desktop 导入已发布 v4 帧、删除五个本地副本 | `zclaudia` | 无，使用 gateway-protocol 0.1.0 |
| 1. 完整控制面、auth/admin/通知扩展、打包验证 | `zclaudia-gateway` | 阶段 1 类型清单；按 0.2.0 破坏性候选准备 |
| 2. 新业务入口与兼容出口 | `zclaudia-protocol` | 阶段 1 类型清单 |
| 3. Gateway 与 SDK 移除旧包依赖、反转边界测试 | `zclaudia-gateway` | 变更 1 |
| 4. 应用与 facade 迁移、凭据语义文档与通知字段清理 | `zclaudia` | 变更 0；变更 1、2 的可安装产物 |
| 5. 删除 gateway/agent 兼容入口及 dead wire、收尾文档 | 三个仓库分别提交 | 变更 3、4 已交付且已知消费者清点完成 |

每项提交均需能独立解释改动和验证；发布与跨仓联调按阶段 5 的顺序推进。实施时允许阶段 2 的两个仓库独立准备，但消费者升级必须等待相应产物就绪。
