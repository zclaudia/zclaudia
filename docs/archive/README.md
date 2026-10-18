# 归档文档(docs/archive/)

2026-10-18 整理时从 `docs/plans/`、`docs/specs/`、`docs/` 根部移入的**已完成或失效**的设计/计划文档,镜像原目录结构(plans/、specs/、mockups/),保留 git 历史。只读参考,不再维护。

- `plans/`(26 篇):claude-runtime 系列(hardening、phase A~E、smoke-check、completion 等 11 篇)、外部 runtime 插件与双模式/协议迁移(codex/cursor 插件、builtin runtime、dual-mode、cursor ACP、protocol-boundary 等 13 篇)、tool-set-alignment(遗留项已由 lsp-manager 落地)、右栏 workspace 初版计划
- `specs/`(6 篇):已上线特性的设计稿(右栏重设计、record status、统一调用协议、token usage、claudia 统一入口、plugin auth)
- `mockups/`:已上线特性(chat-card、任务中心)的 HTML 原型与预览图
- `cache-audit-protocol.md`:描述的 `zclaudia-adapter.ts` 与 `ZCLAUDIA_CACHE_AUDIT` 开关已不存在

判定依据与逐篇证据见当时的整理结论;**这些文档中曾经记录、至今仍未实现的项,已统一提取到 [未完成项台账](../reports/2026-10-18-open-items-ledger.md)**,后续以台账为准,不必在此翻找。
