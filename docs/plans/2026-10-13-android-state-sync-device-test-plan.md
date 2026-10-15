# Android 状态同步设备测试计划

计划初版：2026-10-13。修复基线：`dddd1b12`。状态更新（2026-10-14）：新 APK 已安装并完成审批、force-stop 重开及两次 Doze 短用例；全计划仍为部分覆盖，逐项结果见文末和私有验收索引。

验证实际 Android APK 在弱网、后台冻结和连接恢复后，能否自行恢复到服务端的正确状态。除进程死亡用例外，恢复过程不得依赖退出重进、手动刷新、切换会话或发送新消息。既有 415 项自动化测试作为回归基线，不能代替本计划的设备验收。

## 测试环境

| 项目 | 已核实结果 |
| --- | --- |
| 设备 | `emulator-5554` 在线，AVD `hermes_api34`，ARM64 |
| 系统 | Android 14，API 34 |
| 宿主机模拟器工具 | Android Emulator 37.1.11.0；实际运行实例版本执行前另记 |
| 应用 | `com.zclaudia.mobile.dev`，版本 `0.1.1220-dev.sync.dddd1b12.ns-dev`，versionCode `2220`；本轮安装 APK SHA-256 `eace3b6fb95dad1739cc0df944a0d41e9d99750f4af4bf93fe950ad253404100` |
| Activity | `com.zclaudia.mobile.dev/com.zclaudia.mobile.MainActivity` |
| WebView | `com.google.android.webview`，113.0.5672.136 |
| 冻结入口 | 当前系统 `am help` 提供 `freeze` 和 `unfreeze`；是否能冻结目标进程须执行验证 |

这是实际 APK 和 Android 系统上的设备级测试。模拟器可验证系统生命周期与真实网络链路，但不能据此宣布实体手机厂商省电策略、基带切换也通过。当前 WebView 版本需单独记录；保留此环境跑首轮，再用独立快照测试目标支持的更新 WebView，避免混淆版本因素。

## 准备与执行顺序

1. **固定版本和测试数据。** APK 与 Backend 均包含 `dddd1b12`；记录完整 commit、APK SHA-256、包名、签名、版本和 Gateway 版本。安装包的版本号本身不能证明包含修复。使用独立测试 namespace、Backend A/B 和专用项目，A/B 使用不同数据目录及唯一标记。
2. **建立正常链路。** 实际 APK → HTTPS/WSS Gateway → 实际 Backend → 真实 Agent。优先复用既有远程 Gateway 测试路径；不对共享 Gateway 做重启或全局断网。第二个桌面客户端负责在移动端离线时制造真实状态变化。
3. **完成设备与采证预检。** 验证触控操作、截图、日志、冻结/解冻和网络注入能力。ADB 控制设备；业务动作通过 APK 或第二个真实客户端完成。可使用真实 APK 的可调试 WebView 做 DOM 操作和只读断言，但禁止改 store 或注入业务事件。`--dev` 不代表 APK 一定允许 WebView 调试。
4. **先执行 S01 到 S08。** 确定冻结、断网、消息补齐和审批恢复的用户路径成立。
5. **准备可选择通道的故障代理，再执行 S09 到 S13。** 需要的代理规则属于待实现测试设施，不能把单元测试 mock 的结果算作设备通过。
6. **完成重复测试与稳定性测试。** 全部 P0 用例通过后，输出报告；任何只能通过重启恢复的 P0 失败都阻止本次修复验收。

构建使用 [Android 构建脚本](../../scripts/build/android.sh)。脚本在 `--no-bump` 下仍需要显式 `VERSION`，并会加载仓库 `.env`；使用不会触发 `RELEASE=1` 的隔离构建配置。使用 `--dev --no-bump` 构建后，以指定 serial 的 `adb install -r` 安装，保留原有数据。不用卸载重装来绕过升级失败。

## 数据与通过标准

每轮使用唯一 `testRunId`。准备一个含长正文、工具调用、结构化 contentBlocks 的会话，一个空闲已完成会话，一个真实等待审批的会话；Backend A/B 各有名称和内容明显不同的项目。真实 Agent 任务使用有界、可独立核验的操作，例如在专用仓库中生成带标记的文件。需要运行中故障时，先确认实际 run 已开始再注入。

每例至少具备两类证据：APK 实际画面/只读 UI 内容，以及独立服务端 API、持久化记录或运行日志。第二个客户端的画面只用来辅助，不单独充当服务端真值。

| 验收对象 | 必须满足 |
| --- | --- |
| 连接 | 数据通道尚未打开时，不得把 Backend 显示为已可用；控制连接健康不能掩盖消息通道失效 |
| 消息 | 消息 ID、数量、顺序、最终正文及 contentBlocks 与服务端一致；相同 offset 的正文增长也必须补齐 |
| Run | running、等待审批、成功、失败、取消状态与后端一致，无永久运行中或永久转圈 |
| 资源 | 离线期间项目/会话的新增、修改、归档和删除恢复后可见，旧快照不覆盖新数据 |
| 隔离 | Backend A/B、会话 A/B 的消息、审批和实际副作用不串线；旧请求结果不覆盖当前选择 |
| 提交 | 同一发送或审批意图最多产生一次实际执行；未确认操作不能虚报成功 |
| 交互 | 选择和草稿按产品预期保留，输入可用，恢复过程不要求额外用户动作 |

恢复时长从“设备可运行且故障已解除”的时刻开始计时，冻结和持续离线时间不计入。以下为本轮拟定验收门槛，不是已有测量结果：正常链路前台恢复/显式断连恢复 ≤15 秒；恢复正常网络后 ≤30 秒；持续半开通道应在最后有效数据帧后约 90 秒触发检测，连同重连和补齐总计 ≤120 秒。一次尾部请求超时的场景在 Backend ready 且健康 HTTP 已可达后 ≤25 秒完成补齐。

依据当前代码：控制连接超时 15 秒、握手及开通道超时各 10 秒、数据静默超时 90 秒、尾部请求超时 8 秒、重试间隔 1.5 秒。门槛超时即记录失败并保留实测值，不以“最终恢复”改判通过。尾部对比样本限制在 100 条消息、正文总量 256 KiB 内；大历史单列压力结果。

## 核心用例

下表每个时长、状态和恢复顺序均单独记录结果。P0 的常规场景至少 3 次；S10、S11 的时序竞争至少 10 次。

| ID | 优先级 | 故障与步骤 | 必须验证 |
| --- | --- | --- | --- |
| S01 | P0 | 冷启动正常连接；停在已有空闲会话 2 分钟，不发送业务消息；第二客户端更新此会话 | 无需主动发送也能收到状态/心跳和变化，首次订阅立即可用 |
| S02 | P0 | 真实 run 期间 Home 后分别停留 30 秒、2 分钟、5 分钟；后台期间分别完成任务或进入审批；返回原会话 | 自动补齐正文、终态/审批；不重新触发任务、不产生重复消息 |
| S03 | P0 | Home 后冻结目标进程，保持 120 秒、5 分钟；服务端继续变化；解冻后返回 | 冻结真实生效且 PID 未变；无重启即可恢复。记录 WebView renderer 是否也被冻结，未覆盖则另补变体 |
| S04 | P0 | 冻结期间断网，后端完成任务；分别按“先联网后解冻”和“先解冻、离线 30 秒再联网”恢复 | 两种次序均收敛；不会永久卡在 opening、旧 ready 或残缺回复 |
| S05 | P0 | 前台运行中断开全部有效出网 30 秒、120 秒；增加“点击发送后但确认前断开”变体 | 离线状态合理、输入可恢复；联网后自动补齐；后台运行记录证明不重复提交 |
| S06 | P0 | 经验证的 800 毫秒延迟、128 kbit/s 带宽下接收长回复；再每 5 秒断/通一次，共 10 轮，最后恢复正常网络 | 恢复后正文和工具块完整；无乱序、重复、永久 pending；记录实际延迟和吞吐 |
| S07 | P0 | 手机离线时第二客户端分别新建、重命名、归档、删除测试项目/会话；先做一项，再做连续变更 | 重连所见资源与服务端一致，特别检查删除对象不因 retained 旧快照复活 |
| S08 | P0 | 收到一条 assistant 消息的部分正文后冻结/断网；后端在同一消息 offset 内完成正文及工具块；恢复且不再触发新 run | 捕获故障前后同 offset 证据；最终全文/contentBlocks 一致；没有新事件也能补齐 |
| S09 | P0 | 保持 `/ws` 控制连接可用，单独关闭当前会话的 message data channel；再做只丢该通道双向数据、不发 close 的黑洞变体 | 控制 ping/pong 持续正常的证据；数据通道独立故障仍触发自愈；静默变体满足 120 秒界限 |
| S10 | P0 | 代理分别延迟 peer_ready、channel_ready、数据 socket 握手超过代码超时；恢复期间切换 Backend A/B；放行旧连接的晚到帧 | 旧 channel_ready 不能配给另一个 Backend；旧回调不恢复旧订阅；向 A/B 发不同标记并核对副作用归属 |
| S11 | P0 | 挂起一次真实尾部 HTTP 响应超过 8 秒；随后恢复服务；另一变体在旧响应挂起时再次断连/重连，最后才放行旧响应 | 重试能完成；旧请求不占住恢复锁；新一代结果不被旧结果覆盖；无手动刷新 |
| S12 | P0 | 仅重启专用 Backend A，Gateway 和 B 保持可用；恢复 A。随后在独占测试 Gateway 上做重启变体 | 区分 Gateway 与 Backend 在线状态；B 不串线；恢复 A 后资源和消息一致 |
| S13 | P0 | 后台应用进入 Doze；任务完成/等待审批后退出 Doze。另做后台进程被杀、用户 force-stop 后显式重开两个变体 | Doze 返回自动补齐；进程死亡后重开恢复持久状态；进程被杀不等于用户取消任务 |
| S14 | P1 | 连续 30 分钟循环前后台与断网/联网至少 20 轮，中间穿插 A/B 切换和一个审批操作 | 全程无重复执行、串会话或必须重启；结束稳定 2 分钟后连接数回到初始稳定基线，内存无持续单调增长 |
| S15 | P1 | 新 APK 对候选 Backend 完整回归；对明确支持的旧 Backend 执行只读空闲订阅和恢复用例 | bootstrap ping 兼容路径成立；旧 Backend 固有缺陷分开记录，不能冒充完整服务端修复通过 |

如果真实 Agent 没有产生“同 offset 正文增长”或“等待审批”，对应用例标记 BLOCKED，调整任务后重跑，不能用普通完成消息替代。精确控制旧帧只能在某些协议层做到时，注明设备覆盖范围并保留已有自动化测试作为补充。

## 2026-10-14 新 APK 实测状态

新安装包为 `0.1.1220-dev.sync.dddd1b12.ns-dev`（versionCode 2220，SHA-256 `eace3b6fb95dad1739cc0df944a0d41e9d99750f4af4bf93fe950ad253404100`）；构建的 source-set manifest SHA-256 为 `dbfe8ff5035acd33c49ee2d26a9cfbd0f0a16590b64359412d326ab29c162305`。该修复包含 17 个源文件；交接记录称 156 项 targeted tests、TypeScript 检查、构建和独立源码评审均通过。补丁未提交。设备仍是 Android 14 / WebView 113.0.5672.136 模拟器。

- S13 审批卡片与路由：真实 B 后端 request_approval 在 APK 内显示 Approve/Reject。APKCASE1 使用 APK Approve 按钮后，精确 B interaction resolved、B run 写出唯一 marker 并完成，A 未变化；通过。
- S13 force-stop 分支：force-stop 后旧 PID 消失，显式重开并返回原 B 会话后，heartbeat 重建真实待处理卡片；APK 按钮批准后 run 完结并写出唯一 marker。通过的范围是“用户显式重开后恢复”，不代表自动重开。
- S13 Doze 分支首次运行：应用不在正常或临时 allowlist；深度状态 IDLE、PID 不变。屏外本地 WS 客户端批准真实 interaction，后端在 idle 时完成并写出 marker。前台 +9 秒 DOM 仍显示旧 pending/running，+81 秒 DOM 已同步。30 秒门槛的转换点只能界定在 (9 秒, 81 秒]，该轮时限未证实，不能判产品失败。
- S13 Doze 分支复测：第二个唯一任务同样在深度 IDLE、同 PID、无 allowlist 时获批并完成。恢复后约 14.5 秒首次观察到完整的实际 REST 最终回复及 marker，且无审批/停止按钮或运行中提示；后续到 46 秒保持一致。独立评审接受为 **单次模拟器 ≤30 秒 PASS**。首轮不确定结果仍单列保留。
- 本轮采样器最初的派生布尔值有标题前缀和下划线规范化缺陷；完整原始 DOM/控件树/截图未损坏，独立评审按 REST 最终回复重算并接受。其余 S07-S12、S14-S15 不因这些短用例而视为通过；S05 点击发送后、确认前断网变体仍未测。

## 2026-10-15 S14 连续 Soak（Android 14 模拟器）

- 正式证据目录：`/Users/zhvala/.zclaudia-test/mobile-sync-20261013/run-20261015-soak-r2/`；可读报告为 `report.md`，逐样本原始日志为 `events.jsonl`，采样汇总为 `summary.json`。observer 使用单一 monotonic run，从 2026-10-15 07:37:06.642 到 08:20:46.676（Asia/Shanghai），共 2620.004 秒，其中预热 120 秒、连续 active 2200 秒（36 分 40 秒，20×110 秒）和冷却 300 秒。没有重启observer、App或WebView renderer；cycle1–20各自有真实任务业务 marker，至少20次前后台与已验证离线/重连流程全部完成。
- 版本基线：设备上仍是历史APK SHA-256 `eace3b6fb95dad1739cc0df944a0d41e9d99750f4af4bf93fe950ad253404100`、包 `com.zclaudia.mobile.dev` versionCode 2220；没有重装，不能称为当前HEAD构建。测试时仓库HEAD为 `8e435762cc3c8f1e3370f77ec7b24217e258e5b2`。审批恢复修复在当前HEAD的 `0e9d550b7f28c424231c864a8b51d581be638fcd` 与指定提交 `f62051ed14628673f47ab2a8667623919b521026` 的稳定 patch-id 相同（`5f88ec9784ec883e716aea17596ea52b85018246`）；源码仍可见按backend/session/run归属及权威pending-approval snapshot重建逻辑。
- observer采样完整：active设备进程147/147、cooldown 20/20；renderer同代际分别147/147和20/20；REST active 440/440、cooldown 60/60，invalid均为0。主进程PID22488/starttime 20271398，renderer PID22540/starttime 20273679 全程未变化。预热至冷却中位数：主进程PSS 93,445→93,913 KiB、Private_Dirty 46,688→52,748 KiB；renderer PSS 101,025→108,038 KiB、Private_Dirty 52,576→59,456 KiB。冷却前后半段中位数基本持平：main PSS 93,849→94,015 KiB、Private_Dirty 52,694→52,814 KiB；renderer PSS 108,192→107,945 KiB、Private_Dirty 59,614→59,360 KiB。内存有active后保留增长信号，但冷却平台及短窗口不能证明泄漏，也不能证明无泄漏；采样未测ART/JS heap分配与native分配，避免运行中触发GC。
- 连接/FD没有随轮次累积：主进程预热/冷却中位FD 246→246、socket inode 30→30、Gateway端口28443已建立连接4→4；renderer FD 107→107、socket inode 10→10、Gateway连接0→0。Gateway归属通过正式run前进程socket检查确认。Android全局TCP行仅作为辅助，不作为App连接数。两端后端健康在结束后仍为HTTP 200。
- 每轮包括A/B真实任务、前后台切换和故障网络恢复；cycle10完成一次真实B审批：APK显示待处理卡片，helper对精确interaction ID做正常协议审批，观察到resolved和终态；对应B项目的唯一marker已核验。cycle2/3的动态会话行坐标误选使真实任务分别落在非预期后端；这两轮仍作为实际业务和网络轮次保留，但不计A/B路由断言。cycle2另以正常、已认证WebSocket `run_start` 向B补做了正确路由任务。业务间隔最大约149.446秒，cycle4注入也因切换控制器比计划点晚约122秒；整个observer单段时长没有受影响。controller为UI到WebSocket注入切换和审批helper证据目录修正而安全重启续接，不能描述为controller本身全程未中断。
- 收尾时Airplane Mode=0、应用在前台、PID未变、A/B与Gateway可达、没有observer/controller/helper残留。检查时发现一条指向已不存在WebView PID20537的target-device `tcp:9222` forward，归属无法确定；收尾过程中曾精确移除此映射，随后在本机端口空闲且无其他mapping的条件下按原remote endpoint恢复。最终保留该forward并标记来源/所有权未知；本轮未依赖它，也不声称run启动前无forward。模拟器结果不覆盖实体手机/OEM策略。

逐例时间线和证据路径见私有索引 `/Users/zhvala/.zclaudia-test/mobile-sync-20261013/run-20261014/acceptance-audit-index.md`；最终环境恢复记录见同目录 `acceptance-final-environment.json`。

## 故障注入与清理

以下是执行手册，制定计划时未执行这些改变设备状态的命令。执行器要在异常退出时清理故障，清理只恢复本轮改动，不能清除现有 ADB 映射或其他任务配置。

```bash
export SYNC_TEST_SERIAL=emulator-5554
export SYNC_TEST_PACKAGE=com.zclaudia.mobile.dev
export SYNC_TEST_ACTIVITY=com.zclaudia.mobile.dev/com.zclaudia.mobile.MainActivity

# 普通后台与返回
adb -s "$SYNC_TEST_SERIAL" shell input keyevent KEYCODE_HOME
adb -s "$SYNC_TEST_SERIAL" shell am start -n "$SYNC_TEST_ACTIVITY"

# 冻结：先 Home，记录 pidof 和进程状态，再执行。验证 frozen 状态而非只看命令成功。
adb -s "$SYNC_TEST_SERIAL" shell am freeze --sticky "$SYNC_TEST_PACKAGE"
adb -s "$SYNC_TEST_SERIAL" shell am unfreeze "$SYNC_TEST_PACKAGE"

# 两种进程死亡语义分别测试；am kill 后必须确认目标 PID 确实消失。
adb -s "$SYNC_TEST_SERIAL" shell am kill "$SYNC_TEST_PACKAGE"
adb -s "$SYNC_TEST_SERIAL" shell am force-stop "$SYNC_TEST_PACKAGE"

# Doze：先记录电源状态、Home 并熄屏；确认 dumpsys 输出实际进入 idle。
adb -s "$SYNC_TEST_SERIAL" shell dumpsys battery unplug
adb -s "$SYNC_TEST_SERIAL" shell dumpsys deviceidle force-idle
# 结束本轮 Doze 后清理，再唤醒并返回 APK。
adb -s "$SYNC_TEST_SERIAL" shell dumpsys deviceidle unforce
adb -s "$SYNC_TEST_SERIAL" shell dumpsys battery reset

# 仅作为 Ethernet/Cellular 路径上的弱网候选配置，必须先验证实际请求受影响。
adb -s "$SYNC_TEST_SERIAL" emu network delay 800
adb -s "$SYNC_TEST_SERIAL" emu network speed 128
# 本轮开始前若已有非默认配置，则还原原值，而非下面默认值。
adb -s "$SYNC_TEST_SERIAL" emu network delay none
adb -s "$SYNC_TEST_SERIAL" emu network speed full
```

冻结后读取 `dumpsys activity processes` 并关联 APK 与 WebView renderer 进程。命令被拒绝、目标仍运行或被系统杀死，分别标记注入失败/进程死亡，不能计为冻结通过。只有整个虚拟设备暂停的备用方案也需单独标注，因为它影响系统时钟和全机网络，并不等同于单 App 冻结。

模拟器官方文档把上述网络配置列为 Ethernet/Cellular 控制，较新版本 Wi-Fi 使用 netsim 路径；应确认实际流量路径、请求延迟和吞吐。关闭 Wi-Fi/移动数据后也必须证明 Gateway 请求确实不可达，不能仅凭状态栏判断断网。[Android 模拟器网络控制](https://developer.android.com/studio/run/emulator-console)

选择性故障用专用的 WebSocket/HTTP 反向代理，按连接、后端和规则 ID 操作；只处理测试客户端流量。它需要在 TLS 终止后区分 `/ws`、message channel 与 HTTP 代理请求，支持 close、双向 blackhole、延迟应用帧、挂起一个 HTTP 响应及精确释放。普通端口级断网不能证明 S09；控制通道帧延迟不能破坏 TCP 帧顺序。当前协议路径执行前与实际 Gateway 版本复核。

专用代理使用设备信任的 HTTPS/WSS；若使用已有 loopback 明文例外和 ADB reverse，则只作为确定性注入通道另行标记，仍需在真实远程 TLS 链路完成 S01 到 S08。不得通过关闭产品 TLS 校验来完成验收。故障代理、自动化执行器和采证目录均需在执行阶段实现，本计划不宣称它们已存在。

Doze 依照 Android 官方步骤进入并验证，退出后清理电池模拟；不将“后台停留”视为已经进入 Doze。[Doze 测试说明](https://developer.android.com/training/monitoring-device-state/doze-standby)

## 报告与验收

每个子场景记录：版本组合、testRunId、backend/session/run/message ID、网络路径、故障实际生效证据、故障/解冻/联网/ready/同步完成时间、耗时、截图或录屏、脱敏日志、服务端真值对比及 PASS/FAIL/BLOCKED。长冻结可只录故障前和恢复窗口，保留连续时间日志。不记录凭证、ticket 或完整带认证参数的 URL。

恢复后先采集自动恢复结果，再做任何手动操作。失败时保留原现场，记录“退出重进是否恢复”仅作诊断；重启后的成功不能覆盖原失败。自动化依赖不足或注入未生效均为 BLOCKED，不能计入 PASS。

由执行者提供逐例证据，验收者复核 P0 的状态一致性、恢复时长和实际副作用。最终结论分别写成“模拟器设备级通过”“实体手机待验证”，并列明未覆盖的版本或环境。后续实体手机优先复跑 S02、S03、S04、S05、S13，包含真实 Wi-Fi/蜂窝切换和厂商后台限制。

执行工作拆为三个交付：候选 APK 与隔离后端、故障注入与采证工具、逐例测试报告。首轮先完成普通网络上的恢复闭环，再展开可选择通道的时序故障。若继续使用子代理，可由 GPT-6 Luna 分别承担构建预检、注入工具和报告整理，设备控制由单一执行者串行完成，主代理负责验收，避免多个代理同时操作同一模拟器。
