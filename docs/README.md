# 文档索引

`docs/` 全部文档的总目录,按用途分类。整理日期:2026-10-18。

## 目录约定

| 目录 | 放什么 | 命名约定 |
| --- | --- | --- |
| `(根部)` | 长期有效的参考文档 | 主题命名,如 `managed-runtimes.md` |
| `development/` | 开发/集成指南 | 主题命名 |
| `plans/` | 实现计划(进行中/仍有未完成项) | `YYYY-MM-DD-*-plan.md`,系列文档用系列前缀 |
| `reviews/` | 审查、审计、spike 记录(一次性的) | `YYYY-MM-DD-*`,专题可建子目录 |
| `reports/` | 对比分析、测试执行报告、[未完成项台账](reports/2026-10-18-open-items-ledger.md) | `YYYY-MM-DD-*` |
| `quality-audit/` | 2026-09 全仓质量审计(自成一个体系) | 见其内部 [README](quality-audit/README.md) |
| `archive/` | 已完成/失效的历史文档,只读 | 镜像原结构,见 [archive/README](archive/README.md) |
| `superpowers/` | 2026-06~07 SDD 工作流历史归档(仅本地,未入库) | `YYYY-MM-DD-*` |

新文档请对号入座:一次性的审查/走查/审计放 `reviews/` 并带日期前缀;要长期查阅的参考文档放根部或 `development/`;完成或失效的计划/设计移入 `archive/`(git mv 保留历史),其中未实现的项先提取进[台账](reports/2026-10-18-open-items-ledger.md)。

## 长期参考文档

- [managed-runtimes.md](managed-runtimes.md) — 托管 Agent CLI 运行时(codex/claude/cursor/pi)的安装、引用与版本管理
- [ui-conventions.md](ui-conventions.md) — 桌面端 chrome 视觉规范(颜色/字体/图标/行高/accent 纪律);配套素材 `radius-tiers.html`、`tailwind-real.css`
- [runtime-events.md](runtime-events.md) — Runtime 事件模型
- [native-agent-context.md](native-agent-context.md) — 原生 agent 上下文说明
- [plugin-packages.md](plugin-packages.md) — 插件包安装机制
- [agent-playground.md](agent-playground.md) — Agent playground(事件、热重载、安全模型)

### development/

- [external-assistant-chat.md](development/external-assistant-chat.md) — 外部助手聊天集成
- [external-notification-sink.md](development/external-notification-sink.md) — 外部通知展示集成
- [third-party-licenses.md](development/third-party-licenses.md) — 三方许可盘点、声明与门禁(产出根目录 `THIRD-PARTY-NOTICES.md`)

## 实现计划(plans/)

仅列进行中或仍有未完成项的计划;已完结的 26 篇(claude-runtime 系列、runtime/协议迁移、tool-set-alignment、右栏 workspace 初版)与全部 6 篇设计稿见 [archive/](archive/README.md),其中的未完成项已并入[台账](reports/2026-10-18-open-items-ledger.md)。

### 运行时相关(仍在跟进)

- [2026-09-13 会话模型控制](plans/2026-09-13-session-model-controls.md)

### 移动端测试计划

- [2026-09-16 Android 网关 E2E](plans/2026-09-16-android-gateway-e2e-test-plan.md) · [Automations UI 真机 E2E](plans/2026-09-16-automations-ui-real-device-e2e-plan.md)
- [2026-10-13 Android 状态同步真机测试](plans/2026-10-13-android-state-sync-device-test-plan.md)

### 2026-10 近期计划

- [2026-10-04 LSP Manager](plans/2026-10-04-lsp-manager-plan.md) · [LSP P3](plans/2026-10-04-lsp-p3-plan.md)
- [2026-10-05 任务中心 P1](plans/2026-10-05-task-center-p1-plan.md)(已完成)· [Subagent steps P5](plans/2026-10-05-subagent-steps-p5-plan.md)
- [2026-10-07 Prompt cache 统计](plans/2026-10-07-prompt-cache-stats-plan.md)
- [2026-10-11 聊天卡片 Workspace](plans/2026-10-11-chat-card-workspace-plan.md)(基本落地)· [多聊决策记录](plans/2026-10-11-multi-chat-decisions.md)
- [2026-10-12 插件前端 origin 隔离](plans/2026-10-12-plugin-frontend-origin-isolation-plan.md)
- [2026-10-14 大文件与耦合修复](plans/2026-10-14-large-files-coupling-fix-plan.md)(P1/缺陷已修,P2 批量项暂缓为独立 PR)
- [2026-10-16 ZCode 差距分析](plans/2026-10-16-zcode-gap-analysis-plan.md)(已完成 → [报告](reviews/2026-10-16-zcode-gap-analysis/00-summary.md))
- [2026-10-16 第一梯队实现](plans/2026-10-16-first-tier-implementation-plan.md)(验收 5/5 → [验收报告](reviews/2026-10-16-first-tier-implementation/acceptance.md))
- [2026-10-16 多目录项目](plans/2026-10-16-multi-directory-projects-plan.md)(已落地)

## 审查与审计(reviews/)

单篇:

- [impeccable-ui-audit-2026-07-14](reviews/impeccable-ui-audit-2026-07-14.md) / [2026-07-15 复审](reviews/impeccable-ui-audit-2026-07-15.md)— 桌面端 UI 审计
- [tool-call-audit-2026-07-03](reviews/tool-call-audit-2026-07-03.md) — session tool call 审计发现的工具实现问题清单
- [2026-08-06 移动 UI 走查记录](reviews/2026-08-06-mobile-ui-findings.md) · [2026-08-07 Agents Profile 编辑器走查](reviews/2026-08-07-mobile-profile-editor-findings.md)
- [2026-09-18 Claudia 统一入口实现审查](reviews/2026-09-18-claudia-p0-implementation-review.md)
- [2026-10-14 大文件与耦合分析](reviews/2026-10-14-large-files-coupling-review.md)
- [2026-10-16 Codex additional directories spike](reviews/2026-10-16-codex-additional-directories-spike.md) · [Cursor 同题 spike](reviews/2026-10-16-cursor-additional-directories-spike.md)

专题子目录:

- [2026-10-16-zcode-gap-analysis/](reviews/2026-10-16-zcode-gap-analysis/00-summary.md) — ZCode 竞品差距分析:[00-summary](reviews/2026-10-16-zcode-gap-analysis/00-summary.md) + T1 agent runtime ~ T7 工程实践共 7 个维度报告
- [2026-10-16-first-tier-implementation/](reviews/2026-10-16-first-tier-implementation/acceptance.md) — 第一梯队借鉴项实现:[验收报告](reviews/2026-10-16-first-tier-implementation/acceptance.md) + [knip 发现台账](reviews/2026-10-16-first-tier-implementation/knip-findings.md)

## 对比与执行报告(reports/)

- **[2026-10-18 未完成项台账](reports/2026-10-18-open-items-ledger.md)** — 全仓各文档中经核实的未实现项的唯一清单

ZCode 对比共两轮,第二轮是对第一轮的重评估:

- 第一轮(2026-09-23):[功能对比与借鉴清单](reports/2026-09-23-zcode-feature-comparison.md) · [工具集对比](reports/2026-09-23-zcode-tool-set-gap.md)
- 第二轮(2026-10-12):[功能重评估](reports/2026-10-12-zcode-feature-reassessment.md) · [工具集重评估](reports/2026-10-12-zcode-tool-set-reassessment.md)
- [2026-09-17 Automations UI E2E 执行报告](reports/2026-09-17-automations-ui-e2e-run-report.md)

## 质量审计(quality-audit/)

2026-09 全仓分批审计与整改跟踪:[README](quality-audit/README.md)( methodology)、[PROGRESS](quality-audit/PROGRESS.md)(整改进度)、00-baseline ~ 07-agent-tools 共 8 个批次报告、[延后重构计划](quality-audit/deferred-refactor-plans.md)、[2026-09-17 runtime token usage review](quality-audit/2026-09-17-runtime-token-usage-review.md),内含各自的 plans/specs。

## 历史归档

- [archive/](archive/README.md) — 2026-10-18 归档的已完成/失效文档:plans 26 篇(claude-runtime 系列、runtime/协议迁移等)、specs 6 篇、mockups 3 件、cache-audit-protocol
- `superpowers/` — 2026-06-07 ~ 2026-08-23 SDD 工作流产物(plans 78 + specs 70,共 148 篇)。**仅本地保留、未入库**(见 `.gitignore`);claude-runtime 系列归档文档中仍有指向此处的文字引用
