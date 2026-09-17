# Automations UI E2E 测试执行报告（run 2026-09-17-0406）

执行时间：2026-09-17 04:06 – 05:15（定时任务触发）；**D1 补跑：2026-09-17 上午（用户授权后重试，见 §3.5）**
依据计划：[2026-09-16-automations-ui-real-device-e2e-plan.md](../plans/2026-09-16-automations-ui-real-device-e2e-plan.md)
证据目录：`artifacts/automations-ui/2026-09-17-0406/`

> **最新：2026-09-17 授权后实机续跑已执行，见 §9。** D1 控制、新 APK、共同 Backend 和 A15 跨端闭环已打通；新增9项问题及1项草稿契约问题，其中项目筛选陈旧、移动误触和非法 Cron 假失败阻断发布。本轮未修复产品代码。§1–§8 为历史快照，不能把其中“已全部修复”或“UI 权限待授权”当作当前状态。

## 1. 结论（先读）

- **发布门槛 D1+M1 全部 P0 PASS：仍未达成。** D1 在授权后补跑了点击类用例主干（见 §3.5），但文本输入类子用例与部分用例因应用不稳定与键盘注入不可用仍为 BLOCKED；移动端 APK 为旧代码，修复版 APK 复验待做。
- **M1（Android 模拟器内实际 APK，经 ADB 注入真实触摸事件）完成了移动端 P0 主干**：A01–A06、A09–A12、A14、A17、A18 有结论；A15 BLOCKED（两端无共同可达后端，见 §3）。
- **桌面形态（同一前端代码，浏览器承载，独立本地实例）补跑了 A02/A03/A07/A08/A13/B01 与断点检查**，按计划规定**不计入 D1 验收**，仅作为代码级验证与缺陷发现手段。
- **共发现 5 个真实缺陷，全部修复并复验 PASS**（其中 #3 系统项只读、#2 服务端运行可见性同时在实际桌面应用上验证）；组件测试 7/7、自动化特性测试 33/33、服务端 workflows 测试 79/79 通过。
- 修复已进入工作区（未提交，与既有 usage-stats WIP 改动并存）。**移动端 APK 为旧代码，其复验需重新构建安装 APK 后进行**——这是剩余的验收缺口。

## 2. 环境与版本

| 项 | 值 |
| --- | --- |
| 仓库/版本 | `/Users/zhvala/SourceCode/zclaudia` @ `98a05e9a` + 未提交 usage-stats WIP（与本测试无关），版本 0.1.1220 |
| 桌面应用 | Tauri dev 构建 `target/debug/zclaudia`（com.zclaudia.desktop.dev，"Claudia Dev"）— **非打包安装器，记录为偏差** |
| Server A（本机 dev） | `node server/dist/index.js` @127.0.0.1:3100，`ZCLAUDIA_DATA_DIR=/tmp/zclaudia-dev/` |
| Server B（本报告临时） | 同上 @127.0.0.1:3200，独立数据目录 `/tmp/zclaudia-ui3200/`（已清理删除） |
| 移动端 | APK `com.zclaudia.mobile.dev` versionName **0.1.1220-dev**（versionCode 2220，2026-09-16 10:29 安装），与仓库版本一致 |
| 模拟器 | `emulator-5554` / AVD `hermes_api34` / Android 14 (API 34) / sdk_gphone64_arm64 / 1080×2400 @420dpi（CSS 视口 ≈411px）/ 字体缩放 1.0 |
| 移动端后端 | 经网关接入的 **Mac.lan**（测试期间激活）与 lima-devbox（测前原状态，已恢复） |
| 主题 | 亮色（Light Cool）为主，A18 另验暗色（已恢复原主题） |

### 执行方式偏差（重要）

1. **D1 BLOCKED**：ZCode 计算机使用助手的 macOS 辅助功能与屏幕录制授权均为 denied（TCC 需人工授予，定时任务无法自授权）。桌面应用 UI 无法自动化 → 计划 §3 "工具访问不可用时记 BLOCKED"。
2. 桌面侧改用**浏览器承载的同一前端代码**（apps/desktop/dist，构建时间 2026-09-17 01:07，晚于 HEAD 提交，与被测工作区一致）+ 独立本地 server 实例（3200）做功能级验证。按计划 §8 "浏览器不能代表 macOS 安装包已通过"，**不计入 D1 验收**。
3. 移动端按计划允许的 ADB 控制层执行：`input tap/swipe`（真实触摸事件）、`screencap` 采证、ADB Keyboard IME 输入中文（名称字段成功；textarea 的 IME 广播不生效，见 §6 备注）。
4. 计划中的数据集 S1/S6 原计划 API 播种，但移动端可达的 Mac.lan/lima-devbox 后端本机无法直连（mac.lan 192.168.2.187 为另一台机器，端口探测无 zclaudia 服务；网关 API 需鉴权）→ 移动端数据全部经 **UI 创建**（更符合计划"用例操作走 UI"的要求），S6 的 50 条长列表数据集**未在移动端构建**（长列表滚动 B06 及 S6 相关子项标 NOT RUN）。

## 3. 覆盖矩阵与用例结果

结果标注：PASS / FAIL(已修复并复验) / BLOCKED / NOT RUN / PARTIAL。桌面=浏览器形态（不计 D1 验收）。

| 用例 | M1 移动端 APK（Mac.lan） | 桌面形态（3200） | 说明 |
| --- | --- | --- | --- |
| A01 入口与返回 | **PASS** | PASS（Back to app 存在，返回后应用可用） | 移动端证据：`A01-*.png`；无重复标题、无白屏 |
| A02 列表与范围 | PARTIAL（Mac.lan 无项目，仅 Global 1 条核对） | **PASS**（Global 66/Active38；P1 2/1/1；空项目空态；快速切换无残留） | 桌面与 API 基准逐项一致 |
| A03 侧栏树同步 | NOT RUN（Mac.lan 无项目树叶子） | FAIL→**修复后 PASS** | 缺陷 #4 |
| A04 新建基础路径 | **PASS**（中文名称+Manual+Notify，计数 1→2，表单收起） | PASS（同代码） | `A04-after-create3.png` |
| A05 五种 Trigger | **PASS**（manual/interval 60m/cron 0 9 * * */once 将来时/event） | —（同代码） | 摘要与保存参数一致；once 显示 "once"，具体时刻在表单回显核对（09/18/2026 4:35 AM） |
| A06 必填与错误 | **PASS**（空名禁用 Create；缺 message → "Missing required: message"；Once 空 → "Please choose a valid run time"，均不创建） | —（同代码） | `A06-*.png` |
| A07 菜单与键盘 | PARTIAL（触摸路径 PASS：菜单无裁切、可滚动、勾选标记） | **PASS**（ArrowDown 开、焦点漫游、Enter 选择、联动正确；触发器不支持 Enter/Space 打开记入 B12 待办） | |
| A08 取消与重开 | 记录规则（同挂载内 Cancel/Create 均保留 Trigger/Action，Create 重置名称与配置；离开 tab 全部重置） | 同规则（Cancel 连名称也保留——见缺陷 #6 备注） | 两端同代码，规则一致；Cancel 保留名称有误提交隐患，建议后续改为清空 |
| A09 启停闭环 | **PASS**（Disable→分组/计数变化→Enable，仅目标变化） | PASS | `A09-*.png` |
| A10 立即运行 | **FAIL→已修复复验 PASS**（桌面形态） | 同 | 缺陷 #2：两次 Run now 后 Runs 页假空态；修复后运行记录可见（completed·notify·manual） |
| A11 删除闭环 | **PASS**（Disable→Delete→刷新，计数 7→6，其余不变） | PASS | |
| A12 系统项限制 | **FAIL→已修复复验 PASS**（桌面形态） | 同（桌面旧代码同样复现：系统卡片三按钮） | 缺陷 #3：点 Disable 静默失败、无任何标识 |
| A13 卡片与误触 | PARTIAL（逐项操作无串扰；有效热区未做测量） | PASS（长名单行省略不溢出，按钮与文本最小间距 12px，无重叠） | S3/S6 数据集未在移动端构建 |
| A14 IME 与安全区 | **PASS（带备注）**（Gboard 弹出、adjustResize 无遮挡、输入正常；中文名称经 ADB Keyboard 成功；textarea 的 AdbIME 广播失败；拼音组合输入无法自动化） | — | 键盘证据 `A14-*.png` |
| A15 双向跨端一致 | **BLOCKED** | — | 移动端仅能经网关访问 Mac.lan/lima-devbox；桌面/本机无法注册或直连同一后端（mac.lan 为另一台机器且无开放服务，网关需鉴权）。两端无共同可达后端 |
| A16 Backend/Project 隔离 | PARTIAL（后端切换可用；Mac.lan 无项目） | PASS（项目间快速切换 p1→空→p1 无残留、无错范围写入） | S7（Backend B 同名数据播种）BLOCKED（同 A15） |
| A17 失败与恢复 | **FAIL→已修复复验 PASS**（桌面形态注入真故障） | 同 | 缺陷 #1：飞行模式下 Refresh 渲染假空态；修复后显示错误+Retry+保留旧列表，恢复后 Retry 一次成功 |
| A18 主题与布局 | **PASS**（暗色主题全页可读、层级一致、无白斑） | PASS（暗色同验）；767/768/769 断点在浏览器形态标 PARTIAL 不外推 | |
| B01 Interval 边界 | — | **FAIL→已修复复验 PASS** | 缺陷 #5：0 被静默改写为 60；现校验拦截 |
| B02–B06, B08–B13 | NOT RUN | NOT RUN | P1 完整回归超出本次定时窗口；B05 双击重复提交部分证据见 §6 |

移动端截图证据（部分）：`artifacts/automations-ui/2026-09-17-0406/android-apk/`（00-launch、A01 入口/返回/tab、A04 表单创建序列、A05 各 trigger、A06 校验、A09 启停、A10 Runs、A12 系统卡片、A17 飞行模式故障/恢复、A18 暗色、cleanup-*）。

### 3.5 D1 补跑记录（2026-09-17 上午，用户授权后重试；当日晚间二次重试完成剩余点击类用例）

执行方式：macOS 辅助功能（AX）元素驱动实际 Tauri 应用（`target/debug/zclaudia`，"Claudia Dev"，连接本机 3100 修复版服务端）；数据以 API 播种。首次补跑因屏幕录制未生效无截图；二次重试时截图验证被显示器睡眠阻断（截屏为黑屏），证据以 AX 树结构化记录为准。

| 用例（实际桌面应用） | 结果 | 证据（AX 树观测） |
| --- | --- | --- |
| A01 进入 Automations | **PASS** | 侧栏切到 Automations 模式（Back to app + 五 tab + 后端树）；返回后应用可用 |
| A02 Global 计数 | **PASS** | 两次会话分别核对 "4 automations"=Active(3)+Disabled(1)、"2 automations"=Active(2)，均与 API 基准一致 |
| A02 项目范围 | **PASS** | 切到 mobile-e2e：标题 "Automations · mobile-e2e"、"1 automation"、Active(1)；侧栏树叶子渲染 |
| A12 修复 #3（系统项只读） | **PASS（真机验证）** | 系统卡片仅 "System" 文本徽章，无 Run/Disable/Delete 按钮；同屏其余卡片均有三按钮（对照组） |
| A09 启停 | **PASS** | Disable 目标项后 Active(3)→(2)、Disabled(1)→(2)，仅目标项换组；按钮变 Enable |
| A08 取消路径 | PASS | New 表单 Cancel 直接收起、无误提交（两次会话均验证） |
| A10 Run now → Runs 可见 | **PASS（真机完整闭环）** | 点击 Run now → API 查得运行记录（completed · manual · activity · notify）→ Runs 页列表显示该运行 → 运行详情页显示状态徽章/触发源/耗时（6ms）/步骤节点。修复前此处为假空态 |
| A17 故障注入（修复 #1） | **PASS（真机验证）** | 杀掉服务端后 Automations 页显示 "Failed to load automations" + Retry 按钮，**无 "No automations yet" 假空态**；服务端恢复后点 Retry 一次成功，列表完整恢复。附加改进：错误态下计数行不再显示误导性的 "0 automations"（改为占位符，含组件测试断言） |
| A04/A06/B01/A08 打字类子项 | **BLOCKED** | 文本输入不可用：dev 二进制无 bundle_id，CUA 的已验证键盘输入路径拒绝；AX setValue 不触发 React onChange（Create 保持禁用）；osascript System Events AppleEvent 超时(-1712) |
| A18 主题 | NOT RUN | 显示器睡眠导致截屏验证不可用，AX 点击路径未执行 |

**执行中断与环境事件（如实记录，含根因分析）**：

1. 首次补跑开始时应用即处于 "App crashed"（React 错误边界：useConnection）状态——早于本轮任何操作；经 vite HMR 全量重载恢复后正常执行了大部分用例。
2. **二次重试定位到窗口丢失的根因**：**杀掉后端服务器的瞬间，应用 WebView 即崩溃**（窗口 AX 变为不可读、标题退化为 "Claudia Dev"、内容树消失，服务端恢复后也不自愈）。这与首次补跑中 Run now 后的窗口丢失事件关联：当时很可能是连接闪断而非 notify 本身。**这是应用级缺陷（超出 Automations tab 范围）：后端连接中断导致整个应用 UI 崩溃且不可自恢复**，建议单独立项修复（连接层应降级为重连提示而非错误边界崩溃）。
3. 显示器睡眠/锁定时截屏不可用（黑屏）、helper 显示器枚举返回空；AX 读写不受影响。恢复方式：唤醒显示器或重启 ZCode。

D1 测试数据已清理（首轮 3 条 + 次轮 1 条 automations，及对应 2 条运行记录），dev 栈保持运行（server 为修复版 dist）。

## 4. 缺陷清单与修复（全部已实现并复验）

| # | 缺陷（对应用例） | 根因 | 修复（文件:行） | 复验 |
| --- | --- | --- | --- | --- |
| 1 | 请求失败被渲染成正常空态："0 automations / No automations yet"（A17，计划风险 #1 坐实） | 列表 `.catch(() => [])` 后 `setAutomations([])` | `AutomationsTab.tsx:45-61`（listError 状态，失败保留旧列表）+ `:322-340`（错误条+Retry，空态仅在无错误时渲染） | 注入真故障：错误+Retry+67 卡保留；恢复后 Retry 成功 ✓ |
| 2 | Run now 的运行结果在 Runs 页不可见，且失败被吞（A10，风险 #1/#7 坐实） | `GET /api/workflow-runs` 强制要求 projectId（无则 400），Global automation 的运行在任何项目查询下都不可见；RunsTab `.catch(()=>[])` 把 400 渲染成 "No workflow runs yet." | 服务端：`workflow-run-repository.ts:125`（findAll）、`service.ts:312-314`（getAllRuns）、`routes.ts:358-371`（projectId 可选，缺省返回全量）；前端：`RunsTab.tsx:43-70`（错误态）+ `:100-113`（"Failed to load run history"+Retry） | Global/项目范围 Runs 均显示真实运行记录 ✓ |
| 3 | 系统项卡片渲染 Run/Disable/Delete，点击后静默失败、无任何限制标识（A12，风险 #2 坐实） | 卡片未区分 `isSystem`，服务端拒绝但前端吞错 | `automation-types.tsx`（AutomationItem.isSystem 透传）+ `AutomationsTab.tsx:489-505`（System 徽章+Shield+tooltip 替代三个按钮） | 系统卡片只读标识、无操作按钮 ✓ |
| 4 | 卡片变更后侧栏树不同步（A03，风险 #4 坐实） | AutomationsTab 变更只刷本地列表，树订阅的 refreshNonce 无人触发 | `AutomationsTab.tsx:165/176/191/206`（create/toggle/trigger/delete 成功后 `bumpAutomationListRefresh()`） | 卡片 Enable 后树圆点即时变绿 ✓ |
| 5 | Interval 输入 0 被静默改写为 60（B01，计划预告风险坐实；`parseInt(v)||60`）；"-1" 又会原样入库，行为不一致 | 静默归一化 | `AutomationsTab.tsx:128-136`（非空输入必须是正整数，否则 "Interval must be a positive whole number of minutes"；空输入默认 60） | 输入 0 → 校验错误、不创建 ✓ |

另记录（不判 FAIL 的产品契约项，建议评审）：

- **A08 草稿规则**：同挂载期内 Cancel/New 完整保留草稿（含名称），Create 重置名称/配置但保留 Trigger/Action，离开 tab 全部重置。两端一致；Cancel 保留名称存在"放弃后误提交"隐患，建议 Cancel 也清空。
- **B12**：Select 触发器仅响应 ArrowDown/ArrowUp 打开，不支持 Enter/Space（`Select.tsx:326-333`）。
- **运行反馈**：Run now 成功时仍无按钮级 pending 状态（风险 #7 只修了可见性一半）；卡片 `runCount` 固定 0、`lastError` 不映射（代码现状，计划 §2 已知边界，未改动）。

## 5. 测试与复验结果

- 组件测试（AutomationsTab，含 4 个新回归用例：加载失败、禁用失败、系统项只读、interval 校验）：**7/7 PASS**
- automation 特性全部测试：**33/33 PASS**（`vitest.ui.config.ts`）
- 服务端 workflows（http+service，重命名 getAllRuns 后）：**79/79 PASS**
- lint：改动文件 0 error（3 条预存 warning）
- 重建：`@zclaudia/server`、`@zclaudia/desktop` dist 重建成功，3200 实例以新产物复验

## 6. 剩余风险与未覆盖项

1. **D1 部分验收**：点击类用例主干与修复 #1/#2/#3 均已在实际桌面应用验证（§3.5）；文本输入类子用例（A04/A06/B01/A08 打字部分）与 A18 主题的 D1 版本仍缺。
2. **新发现应用级缺陷（待立项）**：后端连接中断导致应用 WebView 整体崩溃（"useConnection" 错误边界）且不可自恢复，需手动重载；这解释了执行期的两次窗口丢失。属于连接层/应用壳问题，超出 Automations tab 范围。
3. **移动端 APK 为旧代码**：5 项修复（+#1 计数行改进）已在工作区源码、桌面形态与实际桌面应用（点击类）复验；APK 需重新构建安装后才能在 M1 复验（本轮未构建 APK）。
3. **A15 双向跨端一致 BLOCKED**：需要移动端与桌面端能接入同一后端（如把本机 dev server 注册进移动端所用网关）。这是产品连接拓扑问题，不是用例可绕过的。
4. **P1 大部分 NOT RUN**（B02–B06、B08–B13）；S6 长列表、S7 Backend B 同名隔离、M2 横屏/字体放大均未执行。
5. **AdbIME 在 WebView textarea 不生效**（name input 正常）：移动端多行配置的中文输入验证受限；拼音组合输入无法自动化，需人工补验。
6. 运行可见性只做到"Runs 页可查"：卡片不显示运行中/结果状态、`runCount/lastError` 仍未映射（计划 §2 记录的现有映射边界）。
7. 双击重复提交（B05）本轮未系统验证；Run now/Create 仍无提交中禁用态。

## 7. 清单核对（计划 §10 收尾）

- [x] 本轮测试数据清理：3200/3100 各删 65 automations + 3 workflows + 3 项目；移动端 Mac.lan 删 5 条（含 once 明日触发项，已避免误触发）；系统内置项未动
- [x] 移动端恢复：后端切回 lima-devbox、主题恢复 Light Cool、IME 恢复 Gboard、飞行模式关闭、分辨率/密度未改动
- [x] 临时实例 3200 停止、`/tmp/zclaudia-ui3200` 删除、浏览器标签关闭；用户常驻 dev 栈（3100/vite/Tauri）保持运行
- [x] 证据归档 `artifacts/automations-ui/2026-09-17-0406/`（截图含原始 1080×2400 尺寸）

**结论**：本轮在 M1 + 桌面形态 + 实际桌面应用上执行了计划的可执行部分：5 个真实缺陷全部修复并复验，其中 #1（故障态，含二次改进）、#2（Runs 可见性闭环）、#3（系统项只读）已在实际桌面应用完整验证；另发现并记录 1 个应用级缺陷（后端连接中断导致 WebView 崩溃不可自恢复）。**仍不构成计划 §10 的发布退出条件达成**：D1 文本输入类用例、D1 版 A18 与 APK 修复版复验待补，A15 依赖连接拓扑解决。

## 8. 续跑：当前候选版准备与阻塞（2026-09-17 晚间）

证据目录：[2026-09-17-followup/env](../../artifacts/automations-ui/2026-09-17-followup/env/)。本节优先于历史环境描述，不覆盖旧截图和旧结果。

### 8.1 已完成并核验

| 工作 | 结果 | 证据 |
| --- | --- | --- |
| 当前代码基线 | `8af523f48344acad099907d2c4c35614afd0832a`；开始时工作区干净；包括新的多 Backend Automations UI | [environment.json](../../artifacts/automations-ui/2026-09-17-followup/env/environment.json) |
| Android 构建 | `VERSION=0.1.1220 ANDROID_VERSION_CODE=2220 ANDROID_VERSION_NAME=0.1.1220 RELEASE=0 bash scripts/build/android.sh --dev --no-bump` 成功；未发布、未增加版本号 | [android-build.log](../../artifacts/automations-ui/2026-09-17-followup/env/android-build.log) |
| APK 安装 | 对 `emulator-5554` 执行保留数据的 `adb install -r` 成功；包 `com.zclaudia.mobile.dev`；versionName `0.1.1220-dev`、versionCode `2220`；lastUpdateTime `2026-09-17 20:54:35` | 安装返回 Success，并以 package metadata 复核；同版本号下用 SHA-256 区分新旧包 |
| APK SHA-256 | `9b539c55cbe36514c312dc0032cbe88519cfec90430913dc738ab5259e753cbc` | [environment.json](../../artifacts/automations-ui/2026-09-17-followup/env/environment.json) |
| Automations 组件回归 | 6 个文件，**32 / 32 PASS** | [components.log](../../artifacts/automations-ui/2026-09-17-followup/env/components.log) |
| Workflows HTTP 回归 | **49 / 49 PASS**，包含无 projectId 的 Runs 查询回归 | [workflows.log](../../artifacts/automations-ui/2026-09-17-followup/env/workflows.log) |
| Workflow service 回归 | **33 / 33 PASS** | [workflow-service.log](../../artifacts/automations-ui/2026-09-17-followup/env/workflow-service.log) |
| 共同后端预检 | 3100 服务使用已有数据目录和 Gateway 配置恢复，`connected=true`；Gateway registry 中 Mac.lan 的 `isThisInstance=true`、`online=true` | 脱敏字段存于 environment.json。上一轮“本机无法注册共同后端”不能再作为当前确定结论，但移动端选择与 A15 双向操作仍未验证 |

构建产物：`apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/zclaudia-0.1.1220.apk`。新 APK 安装完成不等于 M1 修复复验通过；组件与服务端测试也不计入 D1 / M1 的 UI 用例通过数。

### 8.2 当前界面与旧报告差异

- `a6d4c0af` 将 Backend / Project 选择移至内容区筛选项；多 Backend 的 All 模式按 Backend 分组，单 Backend 范围才显示 Active / Disabled 分组。A02 / A03 / A16 要按这套界面重验，不能期待旧 AutomationTree。
- A03 保留“选择范围、计数和操作结果一致”的验收目标；旧侧栏任务叶子同步分支标为界面已移除，不据此把整个 A03 判 PASS。
- 当前 Create 表单是独立子组件，Cancel / 折叠使其卸载。旧报告“Cancel 保留名称”是旧版本行为，当前 A08 需要实测重新记录。
- B01 的旧 `parseInt(value) || 60` 已改为正整数校验；仍需补测负值、小数、非数字、极大值及空值，并完成 APK 验证。
- A17 需检查新多 Backend 错误展示和逐操作反馈，不能机械沿用旧版“保留全部旧列表”的截图基线。

### 8.3 UI 阻塞与尚未完成的工作

| 项目 | 当前状态 | 继续条件 |
| --- | --- | --- |
| D1 桌面输入 / 主题及其他缺失分支 | **BLOCKED** | `cua.getApp` 连续三次返回 Computer Use 的 Accessibility / Screen Recording 权限仍 pending；需在当前 ChatGPT Computer Use 授权流程中完成。历史 ZCode 授权不能证明当前工具已获授权 |
| M1 新 APK 修复复验、A13 / A14 及 P1 | **BLOCKED** | 当前 CUA 不能解析运行中的 `qemu-system-aarch64`；已询问是否允许继续用 ADB 点击、滑动、按键、截图，尚未收到明确回复。构建 / 安装和只读设备查询已完成，未注入触摸操作 |
| A15 双向跨端 | **BLOCKED（UI 驱动）** | 后端预检已有可行共同入口；仍须两端实际 UI 选择同一 Backend，完成 create / disable / enable / delete / Refresh 并比对同一 ID |
| A02 / A03 / A16 当前版本范围检查 | **NOT RUN** | 按新筛选界面播种并执行 S1 / S7；旧侧栏树结果不替代当前结果 |
| B02–B13 与 M2 | **NOT RUN** | UI 驱动恢复后补跑；B07 没有历史结果，明确保留在剩余清单内 |

为解决旧 dev 二进制没有 bundle ID 的问题，准备了 `/tmp/automations-ui-desktop/Claudia Dev.app`，只复制原可执行文件并添加应用元数据，二进制 SHA-256 为 `3a4a4b2555c94d24a13545bc9308f0e9e46afd4930b23da8b6d67326b279a15f`。这仍是 dev 壳，不是发布安装包；目前尚未验证该封装能解决输入问题，不能据此改写 D1 状态。

准备过程中退出旧开发应用使其管理的 Vite / server 一并停止；已恢复原数据目录下的 3100 服务、1420 Vite 和原桌面 dev 可执行文件。未通过停服务执行故障用例，未创建或清理业务测试数据，未改变模拟器 IME、主题、分辨率或导航设置。保留新 APK 供后续复验。

**本次续跑结论：构建 / 安装缺口已完成；原有共同后端判断已更新；UI 剩余用例尚未完成，发布门槛仍未达成。**

## 9. 授权后实际应用续跑（2026-09-17 晚间）

**本节为当前候选版最新结论，优先于 §1–§8。发布门槛未通过：发现新的阻断缺陷；本轮执行测试并归档证据，没有修改产品代码或声称已修复。** §8 的桌面权限、ADB 交互和共同 Backend 阻塞已解除。

### 9.1 环境与证据有效性

- 代码仍为 `8af523f48344acad099907d2c4c35614afd0832a`；Android 为 §8 新构建 APK，同版本号、同 SHA-256，不能与凌晨旧 APK 混用结论。
- D1 通过 Computer Use 控制 `/tmp/automations-ui-desktop/Claudia Dev.app` 中的实际 Tauri WebView，窗口截图为 1152×768；封装原 debug 二进制后输入和截图可用。**仍是 dev 壳，不是发布安装包**。
- M1 通过 ADB 触摸、滑动、系统按键、真实 Gboard 拼音候选和系统日期控件操作实际 APK。模拟器 1080×2400 / 420 dpi / Android 14；没有用浏览器模拟移动端。
- 两端共同连接 **Mac.lan**，本机 API3100 的数据与移动端 Gateway 数据以相同 Automation ID 复核。lima-devbox 只做导航 / 分组对照，没有修改其业务数据。
- 以 API 准备 4 个专用项目、3 个无害工作流、58 条任务，覆盖空项目、混合启停、两条同前缀超长中文名、50 条长列表。业务测试的创建、运行、启停、删除全部从 UI 执行；API 用于播种、读证据和收尾。
- [完整证据目录](../../artifacts/automations-ui/2026-09-17-resume/)：`desktop/*.png + *.txt`、`android/*.png + *.xml`、`android/actions.jsonl`、`env/*.json`。截图为原始分辨率；`A14-pinyin.mp4` 只覆盖组合输入片段，不代表整轮连续录像。

**驱动限制已与产品问题区分**：桌面 `typeText` 偶发丢前导字符，AX `setValue` 在部分字段未触发 React 状态更新；必须以后续实际键入和 API 持久化复核。长 Event 名的 AX 值不能证明已提交，相关分支仍为 BLOCKED。Android UIAutomator 会列出键盘后方或菜单裁剪区外的节点，坐标操作以截图可见区域复核。失败的定位尝试不计作产品 FAIL。

以下中间文件不作为命名所暗示的通过证据：`desktop/B11-draft-scope-changed`（当时范围未切换）、`desktop/A13-long-desktop`（当时仍为 P1）、`desktop/B01-zero-validation`（当时先触发 prompt 必填）、`desktop/B02-event-long-created` / `B02-event-long-real-submit`（未创建）、`android/A06-once-empty`（当时先触发 prompt 必填）。对应有效文件在后文单独列出。

### 9.2 本轮完成的实际操作与结果

这里按**已执行子场景**报告；PARTIAL 表示同一用例尚有分支未跑，不用主干成功覆盖整个用例。

| 用例 | 当前 D1 | 当前 M1 / M2 | 本轮证据与边界 |
| --- | --- | --- | --- |
| A01 导航 | PASS 主干 | PASS 主干 | 实际应用进入、Back to app、其他页返回可用；系统返回另见 B08 |
| A02 / A03 范围、列表、计数 | **FAIL R01** | **FAIL R01** | 选 P1/P2 后筛选高亮变化、列表不变；Refresh 才更新。M1 空项目经 Refresh 正常显示 0。旧侧栏树分支 N/A（已移除） |
| A04 创建 | PASS：中文名 + Manual + Workflow；另保存 Manual Activity | PASS：Once + Workflow；中文名称输入单独验证 | D1 `A04-created-cross`；M1 `A05-once-created`。M1 中文名 + Manual Activity 的完整保存链不沿用旧 APK PASS |
| A05 Trigger | PARTIAL：Manual、Interval 1/默认60、Event 实际保存；非法 Cron 见 R07 | PARTIAL：原生日期控件选次日并保存 Once | Once 保存 `1789740180000`（2026-09-18 22:03 +08:00），立即 UI Disable；当前版两端五种合法 Trigger 全矩阵仍缺 |
| A06 必填 | PASS 已测：空名、prompt 缺失、Workflow 未选 | PASS 已测：空名、prompt 缺失、Once 空，修正 Once 后创建成功 | `A06-once-empty-real` 明确显示 `Please choose a valid run time`；不把早先 prompt 错误当 Once 通过 |
| A07 菜单 | PASS 已测：方向键/Home/End/Return 选择、Escape 关闭 | PASS 已测：Trigger / Action / Workflow 触摸、Action 菜单滚动后选择底部 Workflow | 桌面 Enter / Space 可打开菜单，修正旧报告相反判断；完整 Tab 顺序未走完 |
| A08 草稿 | PASS 已测：Cancel → New 清空；创建成功后 New 回默认值 | PARTIAL：跨页面 / 重启后草稿清空已核对 | 当前表单卸载规则不同于旧版本；两端 New 折叠、Cancel、创建后的全部组合未逐项覆盖 |
| A09 启停 | PASS 主干 | PASS 主干 | A15 同一 ID 双向核对，分组和按钮变化正确；R02 是边缘触摸的独立失败 |
| A10 Run now | 本轮由 M1 发起，D1 创建同一任务 | **PASS 主干（新 APK）** | 单次点击产生 1 次 completed 运行；Runs 页显示 wf-ok、manual、P1、9ms。运行详情 / 失败工作流分支未补跑 |
| A11 删除 | PASS 主干 | PASS 主干 | M1 删除跨端任务后 D1 刷新消失；D1 删除临时 Schema 任务计数 8→7；清理后两端数据核对 |
| A12 系统项只读 | **PASS（当前实际应用）** | **PASS（新 APK）** | 系统项显示 System / Read-only，无 Run、Disable、Delete；没有尝试修改系统数据 |
| A13 长名 / 误触 | **FAIL R03**（长名无法直观区分） | **FAIL R02、R03** | 实际 Run now 边缘触摸变成 Disable，独立 API 比对 ID / enabled；无需继续同类边缘枚举即可判该子场景失败 |
| A14 IME / 日期 | 不适用移动 IME | **PASS 已执行主干，完整提交分支 PARTIAL** | 真实 Gboard `ni hao` 组合态→候选“你好”；名称 `auto-ui-0917r-mobile你好`；textarea 保存可见值 `你好\nsecond－line`（全角连接符来自拼音输入）；键盘展开可滚动到按钮；系统返回先关闭键盘；原生日期控件成功设置。中文多行配置未创建运行 |
| A15 双向跨端 | **PASS** | **PASS** | 创建→移动 Refresh→运行→移动 Disable→桌面 Refresh→桌面 Enable→移动 Refresh→移动 Delete→桌面 Refresh；详见 §9.3 |
| A16 隔离 | **FAIL：项目切换 R01** | **FAIL：项目切换 R01** | Backend All/单选与分组已观察；B 同名数据、弱网迟到响应不因此算通过 |
| A17 失败恢复 | PARTIAL：已删 ID 启停返回错误，见 B13 | **PASS 已测列表/Enable；整项 PARTIAL** | 关闭模拟器 Wi-Fi/移动数据→Enable `Failed to fetch`，Refresh 显示 Backend 错误+Retry，不是假空态；网络恢复 Retry 一次恢复 Disabled 记录，没有误启用。Create/Delete/Run 响应丢失分支未覆盖 |
| A18 主题 | PASS 已测 Light Cool 列表及表单错误、Dark Warm 列表/表单/菜单 | **FAIL R09**（Dark Warm 系统状态栏黑字） | 两端成对长名/混合状态截图见 §9.5；D2 断点不外推 |
| B01 Interval 边界 | **PASS 已测输入与持久化；极大值提示不足** | 未补全 | 0/-1/1.5/abc 拦截；1 保存为1；空值保存为60；超长整数返回 HTTP400 未创建，无字段级解释。依据 `B01-zero-confirmed`、其他 B01 文件及 `pre-cleanup-automations.json` |
| B02 Cron/Event/Once 边界 | **FAIL R07**；Event 空返回400 | Once 空/次日已测；过去时间未测 | 非法 Cron 返回500却落库；长 Event AX 输入受驱动限制，不判产品失败。实际键入短 Event 后创建成功 |
| B03 Action 切换 | Workflow/Activity 切换已执行 | PASS 已测 AI Prompt→Shell→AI Prompt，旧 multiline 清空；Workflow 可选 | `B03-return-ai.xml` 中 textarea为空；其余 Action 组合未全枚举 |
| B04 SchemaForm | **PASS false / enum 持久化** | PASS 已测中文 multiline 与换行显示 | Manual + Git Commit 仅保存、不运行，API input=`{"stageAll":false,"messageMode":"stat"}`。目录没有 number 字段、没有 required boolean，相关 UI 分支 N/A（本目录），不能从组件测试推为 UI PASS |
| B05 重复操作 | 未补全 | **FAIL R05：两次快速 Run 产生两条并行运行，未见 pending** | 专用工作流 sleep3秒；两个 startedAt 相差8ms，抓证时均 running，随后 completed。慢 HTTP/Create 双击仍未覆盖 |
| B06 长列表 | 未补全 | **PASS 列表主干** | 50条，滚到最后 bulk-02→Enable→回顶部；50=Active26+Disabled24；API仅对应 ID enabled变化。长 Workflow 目录未专门播种 |
| B07 旋转/字体 | D2 未补跑 | **FAIL R08 横屏安全区；字体场景 PARTIAL** | 横屏实际2400×1080，跨768出现桌面侧栏，但状态栏压住顶部图标；150%表单可见可操作。设置130%/150%造成 Activity 重建并返回首页，只有150%重新进入后完成布局检查；未完成已填草稿/开菜单旋转矩阵 |
| B08 系统返回 | N/A | **FAIL R04** | 键盘 Back 关闭且保留输入；抽屉 Back 关闭；Select 打开时 Back 直接回首页并丢草稿，未只关菜单 |
| B09 前后台/重开 | 未补全 | PASS 已测；草稿规则有记录 | Home→回前台保留中文名称和 multiline；force-stop/relaunch→重新进入后 New为空，后台数据不重放。重启后范围回 All，需要重新选范围 |
| B10 目录失败 | 未补全 | **FAIL R06** | 离线时打开 New，Action 空白且没有目录错误提示；联网 Retry 恢复列表但 Action 仍空。只覆盖真实整体断网，不等同独立 endpoint 延迟/空目录全部通过 |
| B11 草稿范围切换 | **契约问题 C01** | 未单独补全 | P2 填名字→P1，草稿保留无归属提示，之后创建写到 P1。测试项目均为专用隔离数据；未测跨 Backend 提交 |
| B12 可访问性 | PARTIAL：菜单键盘已测 | PARTIAL：可访问树有 Run now / Enable / Delete | `B12-enter-opens-menu`、`B12-space-opens-menu`；未开启 TalkBack 做实际朗读与遍历，不能据 AX 名称判读屏 PASS |
| B13 两端竞争 | **PASS 已删对象 Disable 分支** | 删除端参与 | M1 删除后 D1 用旧卡片 Disable，显示 HTTP500 错误并移除记录，未复活；触发分支 / 同名Y未测 |

### 9.3 跨端闭环的独立数据证据

X：共同 Backend **Mac.lan** 上的 `auto-ui-0917r-cross-中文1`，Automation ID **`01a0af99-8e11-76d6-9511-bc046a4ce482`**，Project `01a0af97-2547-7624-ac08-e4dd7817af6c`，Manual，Workflow `01a0af97-27b2-74cc-ba49-a5d3f3bebf29`。

独立保存数据见 [cross-created.json](../../artifacts/automations-ui/2026-09-17-resume/env/cross-created.json)。

- [D1 创建](../../artifacts/automations-ui/2026-09-17-resume/desktop/A04-created-cross.png) → [M1 Refresh 后可见](../../artifacts/automations-ui/2026-09-17-resume/android/A15-created-refresh.png)。
- M1 单击 Run now → [真实运行记录](../../artifacts/automations-ui/2026-09-17-resume/env/cross-runs.json) → [APK Runs 页](../../artifacts/automations-ui/2026-09-17-resume/android/A10-runs.png)。运行 `01a0af9a-06c4-7393-9a0d-dc9d563e11f6`，completed，9ms。
- [D1 看到 M1 停用](../../artifacts/automations-ui/2026-09-17-resume/desktop/A15-mobile-disabled-seen.png)；D1 启用后 M1 刷新看到 Active。
- [M1 删除后](../../artifacts/automations-ui/2026-09-17-resume/android/A15-deleted.png) → [D1 最终结果](../../artifacts/automations-ui/2026-09-17-resume/desktop/A15-final.png)。删除后的旧卡片操作证据为 [B13](../../artifacts/automations-ui/2026-09-17-resume/desktop/B13-stale-disable-after-mobile-delete.png)。

### 9.4 新发现的问题（本轮未修复）

严重性用于测试分流；发布决定仍按计划 P0 门槛。下面是实际应用观察，代码定位只是对根因的解释。

| ID / 优先级 | 复现与实际结果 | 影响 / 建议修复位置 | 证据 |
| --- | --- | --- | --- |
| **R01 / P0** | Mac.lan All projects→P1 或 P2，高亮已切换但数量/卡片仍属旧范围；Refresh 才正确。两端复现 | 用户可能操作不属于当前筛选范围的对象。`useAutomationByBackend` effect 只依赖 backend IDs/nonce，没有 projectId；增加范围依赖并验证迟到响应隔离 | D1 `A02-project-stale`、`B11-project-changed-confirmed`；M1 `A02-p1` 与 `A15-created-refresh` |
| **R02 / P0** | M1 P2 第一条长任务 Run bounds `[763,1092][840,1168]`，触摸 `(835,1130)`（位于 Run 内）却使该任务 enabled true→false；间隙 `(844,1130)` 同样触发 Disable | 实际误操作，阻断。`IconButton` 的 `before:-inset-1.5` 在窄布局与相邻按钮热区重叠；须调整布局/热区并重测中心、边缘、间隙 | `android/A13-run-right-edge.png`、`A13-button-gap.png`；`env/A13-edge-result.json`、`A13-gap-changes.json` |
| **R03 / P1** | 两条120+字符任务仅末尾甲/乙不同，D1单行和M1两行都把区分位省略；未找到可见的完整名称入口 | 视觉用户难以选择目标，移动端不能依赖 hover。增加完整名称查看方式；读屏有全文不等于普通触摸用户可区分 | D1 `A13-desktop-long-names`；M1 `A13-p2-refreshed` |
| **R04 / P1** | 已输入名称/多行配置，打开 Trigger Select，Android Back 直接回应用首页 | 应优先关闭菜单；当前丢草稿。统一原生 Back 与弹层状态 | `B08-select-open.png` → `B08-select-back.png`；对照 `B08-keyboard-back`、`B08-drawer-back` |
| **R05 / P1** | 对 sleep3秒 Workflow 快速两次 Run，生成两条同时 running 的记录；按钮没有处理中/已接收提示 | 计划要求明确反馈，避免无意重复。两次 Run 是否允许是产品契约，但缺少反馈已可复现；不能把它描述为“单击重复执行” | `B05-double-run.png`；`env/B05-double-runs.json`（两个 startedAt 相差8ms） |
| **R06 / P1** | 离线 New，Action 空白；恢复联网 Retry 后列表恢复，Action 仍空 | 目录 `.catch(()=>[])` 隐藏错误，列表 Retry 不重试目录。需要独立错误/重试并阻止未知 Action 提交；本轮没有提交空 Action | `B10-offline-catalog.png`、`B10-after-retry.png`；`AutomationsTab.tsx` 目录加载 effect |
| **R07 / P0** | D1 Cron=`not-a-cron `，Create 显示 HTTP500且不收表单；API已保存 enabled=true 的非法任务，Cancel+Refresh后出现 | 失败提示与真实写入相反，重试可重复创建。`AutomationService.createAutomation` 先 repo.create 后 syncSchedule，异常未回滚；应先校验或事务回滚，并展示可理解错误 | `B02-cron-invalid.png` → `B02-invalid-cron-visible-after-refresh.png`；`env/B02-invalid-cron-persisted.json`，ID `01a0afaa-d763-739f-8d79-7bf83ba3863b` |
| **R08 / P1** | M2 横屏跨768后出现桌面侧栏，Android状态栏时间/通知图标与侧栏顶部操作重叠 | 横屏侧栏缺少 Android 顶部安全区；导航仍可见不代表该布局通过 | `B07-landscape.png`（2400×1080） |
| **R09 / P2** | M1 Dark Warm 时状态栏仍为黑色图标/时间，深色背景上难辨认 | 应随应用主题同步 Android system bar 图标颜色；应用内容的层级和菜单本身可读 | `A18-dark-list.png`、`A18-dark-menu.png` |

**C01 / P1 契约待确认**：P2 中输入草稿，切 P1 后不清空，表单没有单独的归属说明；创建成功写到 P1。实际目标与当时选中的 P1 一致，**不把它夸大为跨 Backend 越权写入**；但不满足计划 B11 对草稿明确归属的要求。证据 `desktop/B11-project-changed-confirmed.png`、`B11-scope-created.png`、`env/B11-scope-created.json`。建议明确采用“切范围清草稿”或“表单固定显示提交范围”，然后据此验收。

### 9.5 视觉对照与仍需补验的范围

| 对照状态 | D1 | M1 |
| --- | --- | --- |
| Light Cool / P2 长名称、混合状态 | [桌面](../../artifacts/automations-ui/2026-09-17-resume/desktop/A18-light-list.png) | [移动端](../../artifacts/automations-ui/2026-09-17-resume/android/A13-run-right-edge.png) |
| Dark Warm / P2 长名称、混合状态 | [桌面](../../artifacts/automations-ui/2026-09-17-resume/desktop/A18-dark-list.png) | [移动端](../../artifacts/automations-ui/2026-09-17-resume/android/A18-dark-list.png) |
| Dark Warm / 新建菜单与校验 | [桌面](../../artifacts/automations-ui/2026-09-17-resume/desktop/A18-dark-menu.png) | [移动端](../../artifacts/automations-ui/2026-09-17-resume/android/A18-dark-menu.png) |
| 中文输入 / 软键盘 / 按钮可达 | 桌面输入不替代 IME | [移动端](../../artifacts/automations-ui/2026-09-17-resume/android/A14-multiline.png) |

剩余工作明确区分原因：

- **待修复后复验**：R01/R02/R07 已足以阻断发布；连同 R03–R09 和 C01 对应分支，当前没有 PASS 结论。
- **本轮未完成的执行分支（NOT RUN / PARTIAL，不伪装为环境阻塞）**：两端五种合法 Trigger 完整创建矩阵；过去时间策略；A17 Create/Delete/Run 故障和“已写入但响应丢失”；S7 第二 Backend 同名任务；弱网快速切换迟到响应；Create 慢请求双击；长 Workflow 目录；完整 Tab 创建链、TalkBack实际朗读；B13 已删除任务触发与同名Y；M2 360px/三键导航/已填草稿旋转；D2最小/最大窗口。
- **驱动限制（BLOCKED）**：桌面长 Event / 多行输入有 AX 与 React 值不同步问题，已用真实短键入验证普通 Event，可继续改用可靠输入路径补完边界；不把驱动失败作为产品缺陷。
- **当前目录 N/A**：没有可选 number 配置、没有必填 boolean；合法0/required false 只能另用提供这些 schema 的隔离测试目录再测。桌面实际窗口配置 minWidth=800，不能直接把767/768/769窗口宽度当作可达；仍需按真实内容宽度单独记录 D2。
- **发布形态偏差**：D1当前dev壳；发布安装包复验仍缺。Android模拟器是用户确认的正式移动测试环境，缺实体手机不构成本轮阻塞。

### 9.6 清理与交付核对

- 当前服务端清理 **64 条本轮剩余任务、3 个工作流、4 个项目**；另2条 UI创建任务已在测试链中删除（跨端X、Schema任务）。总计66条本轮测试任务均已移除。
- 清理前存档 [任务快照](../../artifacts/automations-ui/2026-09-17-resume/env/pre-cleanup-automations.json) 和 [3次运行记录](../../artifacts/automations-ui/2026-09-17-resume/env/pre-cleanup-runs.json)。工作流删除通过外键级联清除3条专用运行；没有直接改数据库。
- [cleanup.json](../../artifacts/automations-ui/2026-09-17-resume/env/cleanup.json)：`remainingOwnAutomations=[]`、`remainingOwnRuns=[]`、`systemUnchanged=true`。原系统项与播种前数据完全相同；lima-devbox未写入。移动端最终重新进入 All 并 Refresh，显示两个后端各1条系统项，见 [cleanup-mobile-refreshed.png](../../artifacts/automations-ui/2026-09-17-resume/android/cleanup-mobile-refreshed.png)。
- Android恢复1080×2400 / 420dpi / font_scale1.0 / 自动旋转1 / user_rotation0 / Wi-Fi和移动数据均开启 / 飞行模式关闭 / Gboard原IME；移除本轮添加的中文拼音布局，仅保留原English US QWERTY；主题恢复Light Cool。见 [restored-environment.json](../../artifacts/automations-ui/2026-09-17-resume/env/restored-environment.json) 与 `android/cleanup-chinese-removed.png`。
- 桌面主题恢复Dark Warm；重进Automations后只剩原系统任务与原项目，见 [cleanup-reentered.png](../../artifacts/automations-ui/2026-09-17-resume/desktop/cleanup-reentered.png)。3100/Vite1420和实际桌面应用保持运行。
- 仓库仅修改测试计划和执行报告；§8的32+49+33项测试结果保留，本轮未改产品实现，不重复运行单元测试来代替E2E。

**当前交付状态：原权限、APK和跨端闭环缺口已解决，剩余场景补跑发现9个问题及1项草稿契约问题；发布门槛仍未达成，未完成的细分覆盖已逐项列明。**
