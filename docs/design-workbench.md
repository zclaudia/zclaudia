# 内置设计工作台原型

设计工作台沿用 ZClaudia 当前会话、Agent 和工作目录，以磁盘上的 HTML 文件作为作品来源。
这是参照 Open Design 的“文件 → 预览 → 元素编辑 → 写回源码”边界实现的小型模块；不启动 Open Design daemon，也不引入第二套聊天或项目数据库。

后续能力与验收顺序见 [分阶段实施计划](plans/2026-10-23-design-workbench-implementation-plan.md)。

## 使用

1. 打开一个有工作目录的会话，在右侧工具区或工具添加菜单选择 **设计**。
2. 点击 **生成页面**。设计指令会追加到当前聊天输入框，补充页面需求并发送，使用当前 Agent 生成 `design/index.html` 和本地资源。
3. 工作台自动发现 HTML 文件，也可以从文件选择器打开已有作品。可见时每隔约两秒检查文件变化。
4. 点击预览中的元素，修改文字、文字颜色或背景颜色（支持清除颜色声明），点击 **应用修改** 查看效果；可用 **撤销/重做** 回退，再点击 **保存** 写回原文件。
5. 保存成功后自动创建版本快照；**版本历史** 中可查看版本列表、保存手动版本、对比差异，并把工作区恢复到所选版本（恢复前会自动保存当前状态）。
6. 点击 **交给 Agent 修改**，把文件和所选元素信息追加到同一个聊天，补充要求后发送。
7. **重新载入** 会丢弃当前未保存修改并读取磁盘文件。外部修改与本地草稿冲突时，保存会拒绝覆盖。

## 原型范围

- 桌面及桌面浏览器工作区；静态 HTML/CSS、本地图片和字体。
- 预览不执行作品自己的 JavaScript 或事件处理器，外部网络资源不加载；源码中的脚本不会因预览而删除。
- 文字编辑只处理纯文本元素；包含子元素的容器可以改颜色，复杂布局或结构修改交给 Agent。
- 不提供任意 React/Vue 源码反向编辑、开发服务器代理、多人协作、导出或 Open Design 模板市场。

## P1 编辑与恢复（2026-10-23）

精确编辑与持久历史已落地，设计与验收细节见 [P1 实现设计](plans/2026-10-23-design-workbench-p1-implementation.md)：

- **精确源码修改**：客户端编辑引擎基于 parse5 源码位置做最小字节替换，只改目标文本或内联 style 声明；注释、实体、无关属性与换行逐字节保留。隐式节点、重复属性、文本指纹失配与过期修订一律拒绝，不猜测匹配目标；选区消息绑定草稿修订，迟到的 iframe 消息不会修改新版本。
- **撤销/重做**：每文档有界快照式历史（默认 100 条 / 32 MiB，连续同类编辑合并），保存后仍可撤销为新草稿，外部接管/重载/恢复后重建基线。
- **样式覆盖**：只写选中元素的 inline 声明并支持清除；外部 `!important` 等导致修改未生效时，面板通过预览计算样式回读提示原因，不静默提高优先级。
- **统一写入边界**：保存走 `server/src/infra/fs/safe-file-write.ts`（按文件互斥、修订校验、写前备份至数据目录、原子替换）；设计保存与宿主文件工具可共用该模块（pi-runtime 迁移另立 PR）。
- **持久快照与版本恢复**：内容寻址 blob 存 `~/.zclaudia/design-snapshots/`，清单入 SQLite（migration 050）；捕获入口 HTML 与引用的本地 CSS/图片/字体（2 MiB/10 MiB/50 MiB/200 条上限），未捕获资源明示。恢复采用 pre-restore 快照 + 冲突校验 + 暂存 + 顺序改名 + 操作日志，中断如实三段报告，不声称跨文件原子。快照按 workspace 根目录归属：同一工作区的多个聊天看到同一份历史。
- 现存限制：HTTP 保存为 SHA-256 修订校验下的原子替换，未共用锁的外部进程仍存在极短并发窗口；快照校验一致不等于同一时刻一致；恢复中断的恢复路径是 pre-restore 快照。
- 远端请求沿用当前 backend 的 API 通道，不向 iframe 传入地址或凭据；远端设备仍需单独验证。macOS Tauri WebView 已完成下述本机实测。

## 模块边界

- `apps/desktop/src/features/design/`：面板与组件、静态预览、精确编辑引擎（`html/`）、撤销历史（`history/`）、行差异（`diff.ts`）、backend-aware API 客户端。
- `apps/desktop/src/plugins/builtinPanels.ts`：原生内置面板注册。
- `server/src/application/design/design-service.ts`：从会话解析工作目录、限定文件访问、版本校验和保存。
- `server/src/application/design/snapshot-service.ts`、`restore-service.ts`、`resource-graph.ts`：快照捕获/清单、分阶段恢复、HTML/CSS 资源引用图。
- `server/src/infra/design/blob-store.ts`：内容寻址快照存储；`server/src/infra/fs/safe-file-write.ts`：共享文件写入边界（锁/修订/备份/原子替换）。
- `server/src/interfaces/http/design.ts`：已有认证中间件保护的 `/api/design` 路由（文件、快照、恢复）。

预览使用不含 `allow-same-origin` 的 sandbox iframe。宿主只接收目标 iframe 且 channel 匹配的元素选择消息；预览资源通过受认证的宿主 API 读取后内联，不让作品自行访问宿主文件接口。

## 验证

```sh
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts src/infra/fs src/application/design/__tests__
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
pnpm browser:build
bash scripts/with-project-node.sh env E2E_BROWSER_CHANNEL=chrome pnpm exec playwright test --config e2e/playwright.agent-runtimes.config.ts design.playwright.spec.ts
```

浏览器验收使用独立临时数据目录和确定性的 Claude CLI 测试桩，经过真实插件 adapter、聊天消息和文件接口，验证生成、本地资源预览、可视编辑保存、同一会话续改、外部写入冲突和重新打开。它验证应用集成，不评价真实模型的设计质量。

P1 单元/接口测试覆盖：逐字节源码保留、重复节点与过期选区拒绝、隐式节点与重复属性拒绝、撤销/重做与保存边界、并发写入互斥与过期修订拒绝、快照捕获/去重/隔离、恢复冲突与中断三段报告、路径越界与错误 snapshotId 防护（证据见 [P1 实现设计 §8.7](plans/2026-10-23-design-workbench-p1-implementation.md)）。

2026-10-23 本机实测：在 macOS 的 Claudia Dev（Tauri 开发版）中，通过真实 Codex CLI 会话生成 `design/index.html`、本地 CSS 和 5 个 SVG；设计面板自动发现并显示页面。点击纯文本主标题，修改文字与颜色，应用并保存后，直接检查磁盘 HTML 确认写入，再重新载入并重新选择标题，确认文字及计算颜色仍然一致。体验项目位于 `/Users/zhvala/SourceCode/zclaudia-design-demo`，会话名为 `Codex · 设计闭环体验`。

此前一次真实 Claude CLI 尝试停留在重复的 `ToolSearch` 调用，未写文件，已取消。该次 CLI 为 2.1.304，超过运行时已测试上限 2.1.181；现有证据不能认定版本就是根因。此次原生闭环成功结果来自 Codex，不计为 Claude 实测通过。
