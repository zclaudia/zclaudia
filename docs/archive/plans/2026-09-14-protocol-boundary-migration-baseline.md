# 协议边界迁移 — 基线与类型迁移表（阶段 1 产出）

日期：2026-09-14。配套计划:`2026-09-14-protocol-boundary-migration.md`。
本文记录实施前核实的行为基线与逐项迁移决定,作为阶段 2–5 的对照依据;
wire 消息名、Topic 名、Channel kind 与行为在首轮迁移中保持不变。

## 1. 依赖图(迁移后)

```text
Desktop / ZClaudia Server / Shared
  ├── @zclaudia/protocol (^0.2.1:/sync /transport /zclaudia /notifications /core;旧 /gateway 冻结兼容)
  └── @zclaudia/gateway-protocol (^0.2.0:根入口 + /auth /admin /notifications)

Gateway Server(@zclaudia/gateway)与 gateway-client / gateway-backend / admin-ui
  └── @zclaudia/gateway-protocol(不再依赖 @zclaudia/protocol)

两个协议包互不依赖;均不依赖应用、SDK 或 Node 专属运行时。
```

## 2. 控制面行为基线(以 validation.ts + server.ts 路由/发送点为准)

validation 对未知类型返回 null → 路由拒绝(`INVALID_MESSAGE`);字段校验通过 ≠ 支持该消息。hello 单独校验(`validatePeerHelloMessage`)。

| 方向             | 消息                                                                                                                                                                                                                                                                                                                                    | 字段宽容性(实际)                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Peer → GW 握手   | `peer_hello`                                                                                                                                                                                                                                                                                                                            | 必须 v4;namespace/权限由服务端凭据记录决定;`gatewaySecret` 为 wire 兼容名,值是签发凭据            |
| Backend → GW     | `backend_heartbeat`                                                                                                                                                                                                                                                                                                                     | `observedAt` 可选,GW 忽略其值                                                                     |
| Backend → GW     | `backend_server_message`                                                                                                                                                                                                                                                                                                                | `targetPeerSessionId` 可校验通过但 handler 缺它直接 return(可解析 ≠ 会投递)                       |
| Backend → GW     | `push_notification_request`                                                                                                                                                                                                                                                                                                             | `event` 仅需存在;GW 读取 name/severity/title/body/tags/clickUrl,按 name 过滤、severity 映射优先级 |
| 已认证 Peer → GW | `request_registry_snapshot` / `ping`(ts 可选)/ `channel_open` / `channel_reject` / `channel_close` / `topic_subscribe` / `topic_unsubscribe` / `topic_publish`                                                                                                                                                                          | 权限按 handler(v4 校验、namespace 一致、租约持有等)                                               |
| GW → Peer        | `peer_ready` / `registry_snapshot` / `gateway_error` / `heartbeat_ack`(恒 `streamDemand:false`)/ `pong`(原样回传 ts)/ `channel_ready` / `channel_offer` / `channel_closed`(reason ∈ closed/rejected/timeout/epoch_changed/backend_offline)/ `topic_subscribed` / `topic_unsubscribed` / `topic_message` / 定向 `backend_server_message` | —                                                                                                 |

gateway_error 现发码集合:`INVALID_MESSAGE` / `PROTOCOL_VERSION_MISMATCH` / `UNAUTHORIZED` / `BACKEND_OFFLINE` / `RATE_LIMITED`;`recovery` 当前从不发送,接收端按未知值=无动作处理。

## 3. 旧 `/gateway` 导出的逐项归属(类型迁移表)

| 旧导出                                                                                                                                                                                                                                                                  | 状态                                                                                                           | 目标                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PeerHelloMessage` / `PeerReadyMessage` / `RegistrySyncPayload` / `BackendPresence` / `RegistrySnapshotMessage` / `GatewayErrorMessage`                                                                                                                                 | 活跃                                                                                                           | `gateway-protocol` 根入口(`PeerHelloV4` 等 V4 名;`registrySync` 内联于 `PeerReadyV4`)                                                                                                                        |
| `BackendHeartbeatMessage` / `HeartbeatAckMessage` / `RequestRegistrySnapshotMessage`                                                                                                                                                                                    | 活跃                                                                                                           | `gateway-protocol` 根入口                                                                                                                                                                                    |
| `BackendServerMessage`                                                                                                                                                                                                                                                  | 活跃(定向回退)                                                                                                 | `gateway-protocol` 根入口,`message: unknown`                                                                                                                                                                 |
| `PushNotificationRequestMessage`                                                                                                                                                                                                                                        | 活跃                                                                                                           | `gateway-protocol/notifications`(`GatewayPushNotificationEvent` 只含 GW 读取的通用字段)                                                                                                                      |
| Channel/Topic/HTTP v4 帧、`GATEWAY_PROTOCOL_V4`                                                                                                                                                                                                                         | 活跃                                                                                                           | `gateway-protocol` 根入口(0.1.0 已有)                                                                                                                                                                        |
| `GatewayResourceEnvelope` / `BackendResourceSnapshotMessage` / `BackendResourceEventMessage` / `CatchUpContentMessage` / `ContentPatchMessage` / `ContentPatchErrorMessage`                                                                                             | 活跃                                                                                                           | `protocol/sync`(wire 名含历史 `backend_` 前缀,原样保留);旧入口 re-export 同一符号并标 deprecated                                                                                                             |
| `GatewayStreamEvent` / `BackendStreamEvent`                                                                                                                                                                                                                             | 半死:server 发送被 `streamDemandActive=false` 永久拦截(desktop `onRunStreamEvent` 回调从未被调用,已随迁移删除) | 不迁入 `/sync`;冻结于旧入口,0.3.0 删除;实际运行事件走消息 Channel                                                                                                                                            |
| `SubscribeBackendMessage` / `UnsubscribeBackendMessage` / `StreamDemandMessage` / `RequestBackendResourceSnapshotMessage` / `SubscriberDisconnectedMessage` / `BackendClientMessage` / `GatewayHttpProxy*` / `minBackendProtocolVersion` / `GATEWAY_PROTOCOL_VERSION=3` | dead wire(活跃源码 0 命中,仅陈旧构建产物)                                                                      | 冻结 + `@deprecated`,0.3.0 删除                                                                                                                                                                              |
| `backend_subscribed` / `backend_unsubscribed`                                                                                                                                                                                                                           | 进程内事件(shared `FacadeAdapterEvent` + adapter emit)                                                         | 保留事件名,与同名旧 wire 类型脱钩,不迁入协议包                                                                                                                                                               |
| `AgentRunStatus` → `RunStatus`                                                                                                                                                                                                                                          | `RunStatus` 定义移入 `protocol/zclaudia`(状态集合不变);`AgentRunStatus` 成为别名,随 `/agent` 于 0.3.0 删除     |
| 通知配置(`NotificationConfig` / `DEFAULT_NOTIFICATION_CONFIG`)                                                                                                                                                                                                          | 应用语义                                                                                                       | `protocol/notifications` 保留(Desktop 设置/ntfy bridge 继续消费);`gateway-protocol/notifications` 另有 `GatewayNotificationConfig` 管理 DTO;ntfy 连接/鉴权/默认值归 Gateway 内部(`src/push-notification.ts`) |

## 4. 凭据与配置映射(鉴权基线)

- 2026-09-04 提交 `77e877b` 起仅接受签发凭据;`GATEWAY_ADMIN_TOKEN` 启动必填,仅用于管理面,不可作 peer 登录。
- 凭据种类:`zgd_`(device)/ `zgb_`(backend enrollment)/ `zga_`(backend-access,由 `/api/backend/token` 以 Bearer zgb\_ 换出,继承 namespace,短 TTL)。
- 公开序列化字段(= `gateway-protocol/auth` 的 `GatewayCredentialInfo`):`id,type,namespace,name,parentId,createdAt,expiresAt,revokedAt,lastUsedAt`;token 仅签发响应一次性返回(`IssuedGatewayCredential.token`),hash 永不导出。
- 应用侧映射(首轮全部保留旧名):env `GATEWAY_SECRET` → `server/src/index.ts` → DB 列 `gateway_secret` → API `gatewaySecret`(`interfaces/http/gateway.ts`),值即 peer 凭据;不做共享密钥→凭据的自动转换。
- 管理面 DTO(`gateway-protocol/admin`):`/api/admin/session`(POST 换 cookie/GET 探测/DELETE 登出,响应 `expiresAt`)、`/api/admin/overview`、`/api/admin/credentials`(POST `IssueCredentialRequest` → `IssuedGatewayCredential`;GET 列表;DELETE → `revoked: string[]`)。

## 5. 通知基线

- GW 行为:`name` 匹配 allow/denylist(点前缀),`severity`(默认 info)→ Priority(default/default/high/urgent);`minSeverity` 下限过滤。
- `NotifyEvent.priority` 声明与调用方实参(process_leak='high'、run_completed='default'、run_failed='high'、permission/interaction='urgent'/'high')从未上 wire —— 已删除字段与实参,输出 wire(name/severity)与默认优先级不变。
- Desktop 通知设置/API/ntfy bridge 继续消费 `protocol/notifications` 的配置形状(与 GW 管理 DTO 字段一致);GW 返回的配置含 ntfy 凭据是首轮兼容决定,非规范背书。

## 6. 实施时的已知基线失败

- desktop `GatewayTransport.test.ts > queues frames and reopens when the channel drops`:`CloseEvent is not defined`(vitest 环境存量问题,迁移前后一致)。
- gateway `phase3-sdk-contract`:loopback 不可绑定时整体 skip(环境相关)。

## 7. 版本与发布(阶段 5 对照)

- `gateway-protocol` 0.1.0 → **0.2.0(破坏性)**:`protocolVersion: 3|4` 收窄为 4、新增控制面/auth/admin/notifications 子入口、错误码收窄;客户端对未来未知错误码的运行时容错不变。
- `protocol` 0.2.0 → **0.2.1(兼容,additive)**:新增 `/sync`、`/transport`;旧 `/gateway`、`/agent` 全部导出保留并标 deprecated;exports 条件 types 前置。
- `protocol` **0.3.0(破坏性,待实施)**:删除 `/gateway`、`/agent`、旧通知配置出口、dead wire 声明与根入口兼容导出;`RunStatus` 不受影响。
- SDK(client/backend)按 lockstep 升级;消费者显式升级,不依赖 `^0.1.0` 自动跨 0.2.x。
- 发布顺序与回滚约束见计划文档阶段 5;回滚不恢复共享密钥登录。
