# Automations UI E2E 测试执行报告（run 2026-09-17-0406）

执行时间：2026-09-17 04:06 – 05:15（定时任务触发，一次性）
依据计划：[2026-09-16-automations-ui-real-device-e2e-plan.md](./2026-09-16-automations-ui-real-device-e2e-plan.md)
证据目录：`artifacts/automations-ui/2026-09-17-0406/`

## 1. 结论（先读）

- **发布门槛 D1+M1 全部 P0 PASS：未达成。** D1（macOS 实际桌面安装包）因执行机器缺失辅助功能/屏幕录制授权无法进行 UI 自动化，整层标 **BLOCKED**；本报告不含任何 D1 的 PASS 结论。
- **M1（Android 模拟器内实际 APK，经 ADB 注入真实触摸事件）完成了移动端 P0 主干**：A01–A06、A09–A12、A14、A17、A18 有结论；A15 BLOCKED（两端无共同可达后端，见 §3）。
- **桌面形态（同一前端代码，浏览器承载，独立本地实例）补跑了 A02/A03/A07/A08/A13/B01 与断点检查**，按计划规定**不计入 D1 验收**，仅作为代码级验证与缺陷发现手段。
- **共发现 5 个真实缺陷，全部修复并在桌面形态复验 PASS**；组件测试 7/7、自动化特性测试 33/33、服务端 workflows 测试 79/79 通过。
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

1. **D1 未验收**：桌面实际安装包未做任何 UI 用例（BLOCKED）。补齐方式：人工授予辅助功能/屏幕录制后重跑，或人工执行 D1 矩阵。
2. **移动端 APK 为旧代码**：5 项修复仅在工作区源码与桌面形态复验；APK 需重新构建安装后才能在 M1 复验（本轮未构建 APK）。
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

**结论**：本轮在 M1 + 桌面形态上执行了计划的可执行部分，发现并修复 5 个真实缺陷（全部复验通过），但**不构成计划 §10 的发布退出条件达成**——D1 实际安装包验收与 APK 修复版复验仍待补做，A15 依赖连接拓扑解决。
