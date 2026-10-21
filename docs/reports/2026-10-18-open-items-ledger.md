# 未完成项台账(2026-10-18)

汇总各设计/计划/验收文档中**经核实仍未实现**的项,作为唯一清单;来源文档部分已归档至 `docs/archive/`,翻找历史时以本台账为准。完成一项划掉一项并注明提交。

口径:只收录有明确出处、且经代码/验收报告交叉核实仍未落地的项;"步骤未回填但工作已完成"的假阳性(老计划未勾选项、chat-card 把手误拆分已修等)不列。

## 1. 整篇未实现的设计

| 项                       | 来源                                                                                                                         | 说明                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 插件前端独立 origin 隔离 | [plugin-frontend-origin-isolation-plan](../plans/2026-10-12-plugin-frontend-origin-isolation-plan.md)(状态自述"方案,未实现") | 采用独立 origin 提供插件前端,替代单纯去掉 `allow-same-origin`;同源卫生问题 §1.2 也未处理([feature-reassessment](2026-10-12-zcode-feature-reassessment.md) §1) |
| Auto 权限模式            | feature-reassessment §5(`server service.ts:157` 返回 `mode.auto.unimplemented`)                                              | 对标 ZCode 的 auto 模式,至今是声明式未实现                                                                                                                    |

## 2. 竞品借鉴 backlog(ZCode 差距分析)

来源:[00-summary](../reviews/2026-10-16-zcode-gap-analysis/00-summary.md)。第一梯队 6 项已由 first-tier 实现完成(验收 5/5),剩余:

**P1 第二梯队(各约 3 天–2 周)**:

1. @zcode/rpc 分层 RPC 框架 + PersistentProtocol(二进制分帧/ACK/断线重放/背压,T2 §2.1/2.2)
2. Hooks 生命周期扩展(2→7 事件)+ workspace hook 信任准入(T1 §2.1、T5 §2.10)
3. Microcompact 工具结果定点清理(最近 5 条保留 + 9 类白名单,T1 §2.3)
4. Coding Plan 用量配额查询(四接口 + 额度卡 MVP,T6 §2.3;若 GLM coding plan 转主力应提级)
5. Streamdown 流式 Markdown 渲染(streaming/static 双模式 + 未闭合语法补全,T3 §2.1)
6. 架构治理升级(policy-as-code + 违规指纹基线 + `--changed` 增量检查,T7 §2.1–2.3)

**P2(规划内,摘要)**:服务端 CLI 化分发(原子更新/回滚)、子代理运行时一等化、Turn 状态机 + Runtime Command Queue、会话 fork/rewind 契约模型、权限长尾(跨 resume 恢复/审批竞态)、V4 wire 双节奏投递 + 帧分片、~~连接级能力协商 + host capability 票据(<100 行可直接移植)~~、桌面强更门/release notes 投递/快捷键纯函数内核、SSH/WSL/Docker 远程工作区(SSH MVP 1–2 周)、插件资产扩展顺序(mcpServers→agents→hooks)+ Marketplace 闭环 + ~~外部技能一键导入~~ + ~~skills-lock~~、~~官方技能内容直接分发(superpowers 方法论/zcode-guide)~~、受限 CEL 模型选项映射 DSL(867 行)、~~重试预算档位~~、发布工程(ADR 模板/release-it/pre-push 质量闸门)。

以上划线的 5 项(连接级能力协商 + host capability 票据 / skills-lock / 外部技能一键导入 / 官方技能内容直接分发 / 重试预算档位)2026-10-18 已实现,见 [acceptance](../reviews/2026-10-18-easy-tier-implementation/acceptance.md);Marketplace 闭环仍未做。遗留:host capability 签发路由无集成测试、宿主专属能力消费待后续条目;重试预算档位尚无上游配置源传入(仅 API 形式);插件分发运行时链路未闭环(仓库内 plugins/skills 需 plugin_extra_dirs 配置才被发现,发布包 staging 未做),且 plugins/skills 当前被 .gitignore `/plugins/*` 忽略、提交前需加 `!/plugins/skills/` 否定规则。

**远期思路**:TUI 终端形态、Dynamic Workflow 最小切片、node_repl 共享宿主、Bots 多渠道(Telegram MVP)、UI Plugin、移动任务首页、桌面 E2E 容器化、形式化状态空间枚举。

## 3. 计划中明确暂缓/推后的工程项

| 项                                         | 来源                                                                                  | 说明                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 大文件/耦合重构暂缓批(14 项)               | [large-files-coupling-fix-plan](../plans/2026-10-14-large-files-coupling-fix-plan.md) | ClaudiaChat 拆分二阶段、plugins/loader、run-permissions、run-provider-launch、GatewayTransport/BackendChannelManager、codex app-server-client、宿主契约下沉 agent-common、shared/tools.ts 与 usage-accumulators 拆分、shared/facade 升格、app→infra ratchet 禁令、InteractionItem/ChatInputArea/MessageInput 拆分、PermissionSettings、setup-components、e2e 源码 import;各 2–5 人日,独立 PR |
| codex cacheWrite 双计修复(prompt-cache 0a) | [prompt-cache-stats-plan](../plans/2026-10-07-prompt-cache-stats-plan.md)             | 推后"已知不修";修复前 Runtimes 视图 codex 命中率在 write>0 时偏低                                                                                                                                                                                                                                                                                                                            |
| 外部 runtime 逐调用 cache 采集(2e)         | 同上                                                                                  | claude/codex 本轮不考虑;cursor 源头只有逐 turn                                                                                                                                                                                                                                                                                                                                               |
| trim 阶梯化(prompt-cache Phase 3)          | 同上                                                                                  | 暂缓,等分类器积累 `history_trimmed` 数据;已知局限:steer 消息位置与发送顺序不一致                                                                                                                                                                                                                                                                                                             |
| 项目级 `.zclaudia/lsp.json`                | [lsp-p3-plan](../plans/2026-10-04-lsp-p3-plan.md)                                     | 暂缓;将来只做"仅可配置已可信服务器"的受限版本                                                                                                                                                                                                                                                                                                                                                |
| codex/cursor 高级能力                      | [claude-runtime-completion](../archive/plans/claude-runtime-completion.md)(已归档)    | deferred 能力保持不支持,直到各 runtime 直接实现                                                                                                                                                                                                                                                                                                                                              |
| 并排 worktree 独立编辑器                   | [multi-chat-decisions](../plans/2026-10-11-multi-chat-decisions.md)                   | 需扩展工具自身实例模型,不用 pane shell 复制充当状态隔离(远期注记)                                                                                                                                                                                                                                                                                                                            |

## 4. specs 声明的未覆盖范围(设计稿已归档)

| 项                     | 来源                                                                                            | 说明                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token usage 后续范围   | [runtime-token-usage-design](../archive/specs/2026-09-16-runtime-token-usage-design.md) §310    | 外部 CLI 历史导入、费用估算、订阅额度、逐请求账本、workflow/辅助调用入账(purpose 维度);第一版不统计独立运行的 Cursor IDE/Claude Code/Codex 与标题生成等辅助请求 |
| record status 保留原因 | [unified-record-status-design](../archive/specs/2026-07-15-unified-record-status-design.md) §57 | `unreachable`/`no_model` 在词汇表中保留但无 resolver 发出(等持久化 LLM probe)                                                                                   |

## 5. 质量与验收遗留

**first-tier 验收**([acceptance](../reviews/2026-10-16-first-tier-implementation/acceptance.md) §4):

- E 后续:server 侧消费 `ZCLAUDIA_SERVER_AUTH_TOKEN` 的鉴权中间件(token 语义闭环);`latest.json` 多平台索引(发布前必做)
- knip 存量 461 项待人工分批清理,含 1 个失效 import 高危项:`server/src/infra/providers/pi-runtime/__tests__/invocations.test.ts:8` 引用不存在的 `types.js`(台账:[knip-findings](../reviews/2026-10-16-first-tier-implementation/knip-findings.md))
- 合规:claude-agent-sdk 专有许可的分发复核;413 条 desktop 存量 eslint warning
- 完整 `build:distribution` 真实全链路未跑过(首次发布前建议执行);可选:行内 code 失去 prose 药丸底色的样式补齐

**quality-audit**([deferred-refactor-plans](../quality-audit/deferred-refactor-plans.md) + [PROGRESS](../quality-audit/PROGRESS.md)):

- QA-0037:`selectionStore` 单一写者;QA-0039:`sessionSync` 类型化协调器;QA-0043:拆分 5 个超大 UI 文件
- 部分完成:QA-0022(LAN 模式仍绑 0.0.0.0)、QA-0049(gateway 仍构建 sibling repo)

**工具集缺口**([tool-set-reassessment](2026-10-12-zcode-tool-set-reassessment.md)):

- ~~P1:危险命令规则补强(先核对 `permission-evaluator.ts` 的 destructiveOps 再补缺口)~~ —— 2026-10-18 已实现,见 [acceptance](../reviews/2026-10-18-easy-tier-implementation/acceptance.md);残余长尾已在测试中 pin 为已知缺口(base32/openssl 解码执行、无抓取标记的进程替换),Windows CMD 方言超出本仓 POSIX Bash 工具范围未做
- ~~仍缺:Bash `cd` 持久 + 图片输出、Grep `multiline`/`type`/`offset`、Read 视频 + 缺文件 "Did you mean"、Agent 同步返回附 `<usage>`~~ —— 2026-10-18 已实现(四类全部落地;视频按上游不支持路径返回 video_not_supported + ffmpeg 抽帧指引),见 [acceptance](../reviews/2026-10-18-easy-tier-implementation/acceptance.md);sixel 无解码器仅文字说明

**easy-tier 验收遗留**([acceptance](../reviews/2026-10-18-easy-tier-implementation/acceptance.md) §5,2026-10-19 验收发现):

- **server tsc 当前 exit 1**:`server/src/interfaces/http/workspace.ts:183` TS2322(条目 37 路由把 selections 断言为 `{ agent: string }[]`,与 skill-import.ts 的受限联合 `ExternalSkillAgentKey` 不匹配);一行修复后需复跑 server tsc 与 workspace 路由测试
- **plugins/skills 被 .gitignore:134 `/plugins/*` 忽略**(仅否定 `!/plugins/agents/`):提交官方技能分发的 17 个文件前需加 `!/plugins/skills/`,否则静默不入库
- 插件分发运行时链路未闭环:仓库内 plugins/skills 需 plugin_extra_dirs 配置才会被发现;发布包 staging(stage-builtin-agents.mjs/macos.sh)未做

**验证类未完成门禁**:

- builtin runtime([implementation-status](../archive/plans/2026-09-10-builtin-agent-runtime-implementation-status.md),已归档):真实账户实测、各平台安装包、旧版升级/回退仍是未完成门禁;L05/L06 证据另列
- Android 状态同步([android-state-sync-device-test-plan](../plans/2026-10-13-android-state-sync-device-test-plan.md)):S05 点击发送后断网变体未测;S07–S12、S14–S15 不视为通过;实体手机待验证(优先复跑 S02–S05、S13)

## 6. 建议优先级

1. first-tier E 后续 + 完整 `build:distribution`(发布路径阻塞项)
2. 差距分析 P1 第二梯队按痛点选型(弱网→rpc;token 超限→microcompact;hook 生态→hooks 扩展)
3. large-files 14 项暂缓重构(已有执行单元设计,可逐个独立 PR)
4. ~~工具集 P1 危险命令规则补强(安全收益直接)~~ —— 2026-10-18 已实现,见 [acceptance](../reviews/2026-10-18-easy-tier-implementation/acceptance.md)
5. easy-tier 验收遗留:server tsc 红修复(workspace.ts:183 TS2322)+ .gitignore 放行 plugins/skills(见 §5)
