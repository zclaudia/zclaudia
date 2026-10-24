# 设计工作台端到端真实验收计划（workflow + sub-agent + browser/computer use）

日期：2026-10-24。状态：设计定稿（用户已确认三项决策，待启动执行）。上游：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 M1–M3 里程碑与各阶段文档「待补验证」小节（P1 §8.7 后、P2 §10、P3 §10 后、P4 §9 后、P5 §10 后、P7 §12）及 [P3.5 实现设计 §10](2026-10-24-design-workbench-p3.5-implementation.md)。

目标：以真实运行的应用、真实 Codex/Claude 会话与真实浏览器，自动化完成 M1–M3 与 P3.5 的手工冒烟清单，产出逐条目对照证据的验收报告，替代人工逐项点检。判据只验证**机制与链路**（生成→编辑→保存→恢复→导出→分享→交接），不评价真实模型的设计质量（既有 e2e 口径）。

## 0. 已定决策（用户 2026-10-24 确认）

1. **驱动载体：浏览器为主 + Tauri 探查。** 主链路（S1–S6）用 browser-use 技能驱动与 e2e 同款的浏览器构建（真实插件 adapter、真实 composer/文件接口、真实 Codex CLI 子进程）；Tauri 专属项（WKWebView 捕获/全屏/Downloads 落盘）在 Phase 0 探测 computer use 可用性，可用则追加 S7，不可用则明确留白。依据：browser-use 技能现成可靠；computer use 依赖辅助功能权限与 SDK 技能加载，探测失败不应阻塞主链路。
2. **P6 付费图片跳过**：保持「待用户配置 key 补做」口径（本机视频冒烟已过，不在本计划内重跑）。
3. **包含真实 Claude CLI 尝试，限时熔断**（§3 S6）：总限时 10 分钟或「连续 ≥5 次工具查找类调用且无文件产出」即中止，如实记录；不阻塞其他场景结果。

明确留白（本计划不覆盖，收官口径如实标注）：P6 付费图片（待 key）；P7 LAN 第二设备（需另一台设备，用户配合）；远端 backend、其他操作系统。

## 1. 架构：三层分工

| 层   | 承担者                                                                    | 职责                                                                                                                                  |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 编排 | dynamic workflow（CreateWorkflow 脚本）                                   | 阶段顺序、类型化中间结果、门控与熔断、条件分支（S7）、超时与预算、证据汇总与报告落盘                                                  |
| 执行 | general-purpose sub-agent（会话模型，每场景一张卡）                       | 按 §3 场景卡驱动应用（browser-use / computer use）、轮询真实 Agent 运行状态、执行磁盘核验（Bash）、采集证据、按 schema 回报结构化结果 |
| 驱动 | browser-use（control-browser 技能）；computer use（node_repl SDK，仅 S7） | 与真实 UI 交互（点击/输入/截图）；S7 驱动真实 Tauri 窗口                                                                              |

不使用 luna：其工具集（Read/Write/Edit/Bash/Grep/Glob）不含浏览器与 computer use。场景执行 subagent 必须用会话模型（浏览器/屏幕驱动需要强模型），workflow 整体 `max_concurrency = 1`——全部场景共享同一应用实例与会话状态，只能串行；唯一可并行的是末尾报告聚合等纯计算步骤。

## 2. 环境与预检（Phase 0，workflow 第一步）

1. **隔离环境**：`ZCLAUDIA_DATA_DIR=/tmp/zclaudia-e2e-<ts>/data`（与服务/快照/凭据完全隔离）；demo 工作区 `~/SourceCode/zclaudia-e2e-demo-<ts>`（全新目录，含空 `design/`；品牌与模板在场景内安装/生成）。
2. **启动应用**：复用 e2e 基建机制（`pnpm browser:build` + 服务启动方式自 `e2e/playwright.agent-runtimes.config.ts` 提取），但**不注入 Claude/Codex 测试桩**——使用本机真实 Codex CLI（`codex --version` 预检）。Phase 0 记录服务 base URL 与 backend id。
3. **健康检查**：`/health` 200；文件接口可列工作区；composer 可聚焦；截图一张基线。
4. **computer use 探测**（不阻塞）：尝试加载 SDK 截屏与窗口枚举；成功 → S7 启用，失败 → S7 标 skipped（原因记录）。
5. **凭据**：真实 Codex 需要本机已登录；预检失败 → 整个计划 blocked（回报用户），不空跑。
6. **证据目录**：`/tmp/zclaudia-e2e-<ts>/evidence/`，命名 `ev-<场景>-<序号>-<动作>.png`；磁盘证据（diff/unzip 清单/mdls/sips 输出）存同名 `.txt`。

## 3. 场景清单（S1–S5 串行共享会话状态；S6/S7 独立）

每场景产出统一 schema：

```ts
interface ScenarioResult {
  scenario: string; // 'S1-M1-core' | ...
  status: 'pass' | 'fail' | 'blocked' | 'skipped';
  checklist: Array<{
    id: string; // 对应各阶段文档验收条目的短码
    expected: string; // 预期（来自文档原文）
    observed: string; // 实际观察
    status: 'pass' | 'fail' | 'n/a';
    evidence: string[]; // 证据文件名
  }>;
  notes: string; // 偏差、重试、环境异常
}
```

### S1 · M1 主链路（真实 Codex 生成 + 工作台基础）

新建会话（demo 工作区）→ 打开设计面板 → 生成页面：prompt 固定模板（三页静态站：index/products/about，统一导航，品牌色蓝、含 `design/DESIGN.md` 与 `design/tokens.css`、入口引用本地 `design/css/main.css` 与至少两张本地 SVG）→ 轮询消息直至 run 结束（单次生成限时 5 分钟，超时熔断）。

条目（来源主计划 M1 行）：三页被发现并可切换标签；视口切换（手机 390 宽度下布局变化，截图对比）；选中标题改文字与颜色 → 应用 → **撤销/重做**往返 → 保存成功 → 磁盘核对（脚本 diff：仅目标元素字节变化，无关行不动）；外部冲突：shell 直接改磁盘 HTML → 面板保存被拒（REVISION_CONFLICT 提示）→ 重新载入后一致；版本历史：保存点存在 → 手动版本 → 恢复到前版（恢复前自动快照）→ 磁盘内容回到旧版；ZIP 导出（disk 模式）→ 解包核验（`unzip -l` 清单含三页+CSS+SVG，`zclaudia-export.json` 存在，离线可打开性以资源齐全性判定）。

### S2 · M2 品牌与续改（接 S1 会话）

模板对话框安装一个内置模板 → 打开入口页确认可独立编辑；品牌面板查看两文件（S1 生成）→ 选中一张卡片做排版修改（字号/间距，P3.1 面板）→ 保存；「交给 Agent 修改」经上下文检视（确认品牌全文在上下文中可见）→ 真实 Codex 续改一处文案与一处颜色（prompt 明示保持品牌）→ run 反馈横幅出现「Agent 已写入 N 个文件」→ 版本历史出现 `Agent 时间` 恢复点 → 检查品牌色未被破坏（grep tokens.css 主色 + 截图）；素材库导入一张本地图片 → 替换页面 `<img>` → 保存 → 重开面板引用仍在。

### S3 · P3.5 样式来源（接 S1/S2 状态）

选中卡片打开「样式来源」区：条目——规则按来源分组展示（页面内样式块 + `design/css/main.css`）、Active/Overridden 徽标至少各一、外链与内联来源徽标正确；`<style>` 块内声明改值 → 预览即时变化 → 撤销一条 → 保存 → 磁盘 `.css`/HTML 字节核对（无关声明不动）；外部 `.css` 声明改值 → 未保存即预览内联生效（cssDraftEpoch）→ 「Save styles」→ 磁盘核对；外部冲突：shell 改磁盘 `.css` → 面板再保存 → 409 横幅「样式文件已被外部修改」→ Reload from disk → 草稿被磁盘版替换；导出对话框出现「未保存样式修改不包含在导出中」提示（先制造脏草稿再打开导出框）。

### S4 · P5 交互与 deck（浏览器捕获路径）

切运行模式：本地链接跳转（index→products→about）成功、外部链接被拦并有提示与计数；回编辑模式，给 deck 页加 `data-zclaudia-slide` 标记（可直接用 Agent 生成一个三页 deck 页，或手工经面板改源码）→ 幻灯片按钮可用 → 缩略图/排序/备注编辑 → 演示模式键盘翻页（→/←/Esc）→ PDF 导出：`mdls -name kMDItemNumberOfPages` 页数 = 3、文件非零；PNG 导出：`sips -g pixelWidth -g pixelHeight` 尺寸符合视口、截图目检内容非空白（foreignObject 光栅化在浏览器路径的验证；WKWebView 路径归 S7）。

### S5 · P7 分享与审阅（真实第二浏览器）

对当前版本建分享（scope=link，7 天，标题）→ 复制 URL → **browser-use 开独立浏览器上下文**（隐身/独立 profile，无宿主凭据）打开 `/s/<token>`：页面渲染、脚本不执行、点击元素可定位；发两条评论（一条定位元素、一条整页）→ 桌面侧刷新评论列表 → 标记解决 → 「交给 Agent 修改」：真实 Codex 按反馈修改 → run 结束后新恢复点出现；**旧分享不可变验证**：第二浏览器刷新分享页，内容仍是分享时版本（与本地已保存的新版明确不同）；撤销分享 → 第二浏览器刷新得 404；未知 token → 404。

### S6 · 真实 Claude 尝试（独立会话，限时熔断）

新会话（同工作区）选 Claude backend → prompt 生成一页简单作品 → 熔断条件（任一触发即中止并记录）：总时长 > 10 分钟；或连续 ≥5 次工具查找类调用且期间零文件写入（轮询消息流判定）。产出无论成败均为如实记录（条目 status 只有 pass/fail，notes 记录中止原因与消息特征）；**不影响其他场景结论**。

### S7 · Tauri 补充（条件：Phase 0 computer use 探测通过）

computer use 驱动真实 Tauri 开发版（同数据目录策略）：打开 S1 工作区任一页 → PNG 视口导出（WKWebView foreignObject 光栅化产物截图目检：内容完整、无画布污染）→ deck 全屏播放进出 → ZIP 导出确认落盘 `~/Downloads`（Tauri 通路）。探测失败 → `skipped` + 留白口径。

## 4. Workflow 编排设计

```ts
// 骨架（示意；实际脚本按 dynamic-workflows 技能规范撰写）
phase0 = agent(预检卡)            // 环境/启动/健康/computer-use 探测/凭据 → {baseUrl, backendId, tauriCapable, evidenceDir}
s1 = agent(S1卡, deps: phase0)    // 失败重试一次；再失败 → status=fail，S2 依赖 S1 的作品 → blocked，S3 同；S4/S5 若 S1 失败则用备选自举（模板安装生成 deck 与分享页）后继续
s2..s5 = agent(各卡, 串行)
s6 = agent(Claude卡, 独立)
s7 = tauriCapable ? agent(Tauri卡) : skipped
report = agent(报告聚合卡, deps: [s1..s7])   // 汇总 ScenarioResult[] → 落盘验收报告 md
```

- **门控**：任一场景内部「应用不可达/服务崩溃」→ 该场景 blocked，尝试一次应用重启自愈后续场景；连续两场景 blocked → 终止并出部分报告。
- **超时预算**：S1 15 min（含真实生成）、S2 12 min、S3 10 min、S4 10 min、S5 12 min、S6 12 min（硬熔断）、S7 10 min；总预算 ≤ 80 min。
- **真实 Agent 轮询**：subagent 以 10–15s 间隔观察聊天消息区（run 状态、文件写入提示），不做固定 sleep 到超时。
- **失败重试**：每场景至多一次整卡重试（仅机制性失败：选择器失配/等待超时；真实 Agent 产出不符合预期不重试，按 observed 如实记录）。

## 5. 证据与报告

- 报告：`docs/plans/2026-10-24-design-workbench-e2e-acceptance-report.md`——场景 × 条目表（expected/observed/status/evidence）、环境信息（commit、构建方式、Codex/Claude 版本）、留白清单（P6/LAN/远端/其他 OS + S7 若 skipped）、总结论。
- 收官判据：S1–S5 全 pass、S6 如实记录、S7 pass 或明确留白 → 主代理复核报告后更新：主计划状态行（去掉「冒烟待补」，按 S7 结果决定 Tauri 表述）、各阶段文档「待补验证」小节、[设计工作台](../design-workbench.md) 验证段；任一 fail → 报告定位问题，修复后仅重跑受影响场景。
- 证据不入 git（/tmp），报告中记录路径；报告与文档更新入 git。

## 6. 风险与对策

| 风险                               | 对策                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| 真实 Codex 生成不稳定/超时         | 单次生成限时 5 min 熔断；整卡重试一次；仍失败如实记录（机制 vs 模型问题分开归因） |
| browser-use 选择器在真实 UI 上漂移 | 场景卡给出语义定位策略（角色/标签/文案），失败截图留证；一次重试                  |
| computer use 权限/技能不可用       | S7 条件跳过，不阻塞主链路（已定决策 1）                                           |
| 浏览器构建与 Tauri 行为差异        | 差异清单化只归 S7 验证；报告明确「浏览器路径已验证，Tauri 实机 S7 结果/留白」     |
| 隔离不彻底污染真实数据             | 全新 ZCLAUDIA_DATA_DIR + 全新工作区；结束后目录保留供查验，由用户决定清理         |
| 真实会话费用                       | 跳过 P6 后仅 Agent token 费用；S6 Claude 熔断限时；全部 prompt 用固定短模板       |
| deck 标记源码改动引入手工步骤      | 优先由 Agent 生成 deck 页（S4 卡内自带次级生成指令），避免人工改源码              |

## 7. 执行方式

启动时：加载 dynamic-workflows 技能 → 按本文撰写 CreateWorkflow 脚本（场景卡文本内嵌）→ 用户确认 → 后台运行，完成通知。全程无人值守；结束后主代理审报告、跑门禁无关（纯验收不改码，除非 fail 触发修复流程）、更新文档并提交。
