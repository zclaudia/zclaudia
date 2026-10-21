# T3 桌面客户端与 UI 体系 对比报告

> 探索范围：ZCode 侧 `packages/desktop`（Electron）、`packages/client`、`packages/ui`、`packages/share-ui`、`packages/web-share`、`packages/stream-animate`；zclaudia 侧 `apps/desktop`（Tauri 2）。探索方式：目录结构 + package.json + 关键入口文件精读 + 定向 grep，均为只读。以下所有 ZCode 路径均已在本会话中实际打开/读取验证。

## 1. 两侧结构对照（简表）

| 维度 | ZCode | zclaudia |
|---|---|---|
| 桌面运行时 | Electron（tsup 打包 main/preload/renderer/host/scheduler，`packages/desktop/tsup.config.ts`；electron-builder 出三平台安装包） | Tauri 2（Rust 侧仅 ~1.9k 行：`src-tauri/src/{lib,server,window_manager,traffic_lights,wsl,network_probe,permissions,android_bridge}.rs`） |
| 主进程能力层 | `packages/desktop/src/main/` 177 个文件：菜单/托盘/更新/窗口 chrome/webview 安全/Chrome 凭据导入/CUA 等 | `src-tauri/src/lib.rs` 222 行：托盘（Show/Quit 两项）+ macOS 权限 + 关窗隐藏到托盘 |
| 前端工程 | `packages/ui`（约 1800 个 ts/tsx，含 49 个 shadcn 风格基础组件、ai-elements 60+、i18n、快捷键内核、Zustand store、hooks），被 desktop/web/share-ui 三个宿主复用 | `apps/desktop/src` 单体：components 146 个 tsx + features 484 个 tsx，无独立 UI 包，无 i18n 层 |
| 聊天渲染 | `packages/ui/src/components/ai-elements/message.tsx`（1671 行，streamdown + shiki + CJK/数学/mermaid 插件） | `features/chat/message-list/assistantMarkdown.tsx`（141 行，react-markdown + prism-react-renderer） |
| 流式动画 | streamdown 流式解析 + shimmer（motion/react）+ 独立性能基准包 `stream-animate` | `LoadingIndicator.tsx` 轮换思考文案 + 省略号动画；无流式 markdown 解析 |
| 多窗口 | 主窗口 + about + update-status + resource-manager + cua-permission-panel + plugin-sandbox（4 个 renderer HTML 入口）+ 单实例锁/deep link 路由 | 主窗口 + DraftWindow 弹出撰写窗 + SessionChatWindow 会话弹出窗 + 项目仪表盘窗（WebviewWindow） |
| 自动更新 | electron-updater + 自研 manifest provider，2051 行，多通道/多语言 release notes/强制更新门 | `@tauri-apps/plugin-updater` + GitHub latest.json，`hooks/useAutoUpdate.ts` + `UpdateBanner.tsx`，另有 Android APK 下载安装通道 |
| 桌面/Web 复用 | `IPlatformService`（shared/src/platform.ts，1177 行）+ 同一 `@zcode/ui` 渲染于 Electron/Web/公开分享页/手机远控页 | 单一 Tauri 前端；移动端靠同一代码编译 Android（`tauri.android.conf.json`），无 Web 宿主复用 |
| 设计系统 | 根 `DESIGN.md`（text-ui-* 强制字号标度）+ `packages/ui/src/styles.css` 主题 token | `scripts/gen-tokens.mjs` token 生成管线（带 --check 校验）+ radius/lifecycle 两个自研 lint 脚本 |

## 2. ZCode 领先点（核心章节）

### 2.1 Streamdown 流式 Markdown 渲染管线（含 CJK/数学/mermaid 与降级边界）

- **解决的问题**：流式输出中 markdown 处于"半截"状态（未闭合围栏、未闭合粗体），直接用 react-markdown 会出现闪烁/错误渲染；ZCode 用 streamdown 的 `parseIncompleteMarkdown` 只在流式态开启，完成态一律 static，并针对生产事故（React #185）收敛出明确的模式切换与重挂载 key 策略。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/ui/src/components/ai-elements/message.tsx:700-706`（`resolveMessageStreamdownMode`：只有真实流式走 streaming，历史/完成态固定 static）；`message.tsx:857-883`（`buildMessageStreamdownRenderKey`：streaming 状态不参与 key，防子树卸载重放动画）；`message.tsx:1613-1656`（Streamdown 装配：`parseIncompleteMarkdown={streaming}`、`animated={false}`、代码高亮延迟到流结束、`linkSafety` 关闭改由自定义 a 渲染器接管）；`message.tsx:708-748`（`MessageResponseMarkdownBoundary`：单条 markdown 渲染异常降级为纯文本）；`message.tsx:587-698`（单 `$` 数学定界符启发式，防 `$5-$10` 价格区间误判为公式）。
  - zclaudia 现状：`/Users/zhvala/SourceCode/zclaudia/apps/desktop/src/features/chat/message-list/assistantMarkdown.tsx`（react-markdown 静态映射，无流式解析、无数学、无 mermaid——grep `mermaid|katex|mathjax|remark-math` 全仓库无命中）；`AssistantContent.tsx` 仅 39 行。
- **可搬运性**：**重写借鉴**。streamdown 本身是 npm 开源包（MIT），但 ZCode 的价值在集成层：streaming/static 模式切换、render key 纪律、每块错误边界、单 `$` 数学启发式。这些模式可以直接套到 zclaudia 的 react-markdown 栈上（react-markdown 也可换 streamdown）；注释里的事故记录（React #185、remend 误补 `**`）是现成的避坑清单。
- **体量估计**：核心集成约 600–900 行（不含 streamdown 依赖本身）；数学启发式 ~110 行可整段照搬。

### 2.2 Markdown 类型标度与排版体系（text-ui-* 强制 token）

- **解决的问题**：AI 输出的 markdown 缺少独立阅读层级（标题/正文/表格/代码字号混用紧凑 UI 字号），且多宿主（聊天/预览/分享页）字号不一致。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/ui/src/components/ai-elements/message.tsx:438-447`（h1–h6 → `text-ui-xl/lg/base/base/medium/normal` + 统一 mt/mb 的显式标度映射）；`/Users/zhvala/SourceCode/zcoder/DESIGN.md`（"Highest-priority UI constraint"：全仓库强制 `text-ui-*`，禁止 `text-[13px]`、禁止改 html font-size，全局缩放只允许 `--ui-font-size`）；`message.tsx:1367-1370`（正文 `text-ui-base leading-[1.75] tracking-wide`）。
  - zclaudia 现状：`assistantMarkdown.tsx:83-124` h1–h6 映射无任何字号 class（走浏览器默认标题样式），无全局 markdown 字号标度；有 `FontSizeSelector.tsx`（small/medium/large 三档）但仅作用于局部。
- **可搬运性**：**直接移植**（作为设计规则+一小组 class 映射）。zclaudia 已有 token 管线（`scripts/gen-tokens.mjs`），只需在 token 表中加 ui 字号标度并在 markdown 组件映射里引用；DESIGN.md 的规则文本可改写后并入本仓库规范。注意这是 ZCode 自定的设计规则，非第三方代码，无许可负担。
- **体量估计**：token 定义 ~30 行 + 组件映射 ~20 行 + 规范文档半页。

### 2.3 完整桌面自动更新体系（通道/本地化 release notes/强制更新门）

- **解决的问题**：更新不止"下载安装"：多通道（stable/preview）、按 flavor 禁用、后台轮询（不可见 15min/可见 2min 双间隔）、可取消下载、更新完成后的多语言 release notes 投递与"已读确认"、强制升级期拦截 deep link/second-instance、菜单与托盘入口状态同步。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/autoUpdater.ts`（2051 行：状态机 + `AUTO_UPDATE_POLL_INTERVAL_MS`/`AUTO_UPDATE_VISIBLE_POLL_INTERVAL_MS` 双轮询 + `releaseNotesByLocale` + 取消令牌 + fail-closed 的 flavor 禁用语义，见 `autoUpdater.ts:26-64`）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/manifestUpdateProvider.ts`（自研 feed 源）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/forceUpdateGuard.ts`、`forceUpdatePrompt.ts`；UI 侧 `/Users/zhvala/SourceCode/zcoder/packages/ui/src/UpdateStatusDialog.tsx`、`UpdateReleaseNotesTooltip.tsx`、`hooks/useDesktopUpdateMenu.ts`。
  - zclaudia 现状：`/Users/zhvala/SourceCode/zclaudia/apps/desktop/src/hooks/useAutoUpdate.ts`（Tauri updater 插件 + GitHub latest.json，4 小时轮询，无 release notes/通道/强制更新概念）；`/Users/zhvala/SourceCode/zclaudia/apps/desktop/src/components/UpdateBanner.tsx`（横幅展示）；`src-tauri/tauri.conf.json` 已配 pubkey + endpoint。
- **可搬运性**：**重写借鉴**。Tauri updater 已覆盖下载安装与签名校验；值得搬的是产品语义：双间隔轮询、release notes（含按 locale）投递与已读记忆、force-update 期间冻结其他入口。electron-updater 特定代码（CancellationToken、NSIS 相关）不适用。
- **体量估计**：在现有 useAutoUpdate/updateStore 上扩展约 400–600 行 + 更新弹窗组件 ~300 行。

### 2.4 本地化原生应用菜单 + 用户自定义快捷键内核

- **解决的问题**：原生菜单需要跟随系统语言（macOS `getLocale` 在中文系统返回 en-US 的坑），且菜单 accelerator 要与设置页的用户自定义键位、录制态（录制时摘掉全部 accelerator 防误触）、显式"未设置"语义保持一致——main 进程与 renderer 生效表是两套消费方。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/desktopApplicationMenu.ts:34-39`（系统语言解析补丁）、`desktopApplicationMenu.ts:63-82`（accelerator 解析：空数组=未设置、全非法=回退默认、录制态摘键）、`desktopApplicationMenu.ts:106-109`（zoomIn 的 Plus/= 双条目兼容 Windows）；菜单文案 i18n 在 `@zcode/shared` 的 `desktopMenuMessageIds`；快捷键纯函数内核 `/Users/zhvala/SourceCode/zcoder/packages/ui/src/shortcuts/bindings.ts:1-38`（匹配/录制/生效表/冲突检测唯一实现，IME 组合与长按过滤）；冲突检测 `shortcuts/conflicts.ts`。
  - zclaudia 现状：`src-tauri/src/lib.rs:126-142` 托盘菜单仅 Show/Quit 两项；原生应用菜单缺失（未确认 Tauri 侧有 Menu 覆盖——`lib.rs` 仅托盘菜单）；快捷键为组件内硬编码，无可配置内核。
- **可搬运性**：**重写借鉴**。`bindings.ts` 纯函数内核（382 行）几乎可直接移植（无 DOM/Electron 依赖）；菜单部分要换 Tauri 的 `MenuBuilder` API 重写，但"accelerator 解析语义"（空数组/回退/录制态）这套规则可以原样照搬。
- **体量估计**：快捷键内核移植 ~400 行 + 测试；菜单重建 ~250 行（Tauri API）。

### 2.5 托盘驻留与平台差异化关闭行为

- **解决的问题**：托盘不是"加个图标"：Linux 只认 PNG 图标、Windows 用独立 .ico 防高 DPI 模糊；Linux close-to-tray 依赖能力探测（有专门 spec 文档）；macOS 关窗转 leave-full-screen 再隐藏；托盘菜单要跟随产品身份（Preview flavor 不露更新入口）与 locale 重建。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/desktopTray.ts:15-26`（平台图标路径策略）、`desktopTray.ts:37-41`（Linux 平台门 + 能力探测注释）、`desktopTray.ts:86-94`（flavor 决定更新入口）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/desktopDarwinCloseBehavior.ts`（macOS 关窗→leave-full-screen→hide）；`desktopWindowLifecycle.ts:395-425`（最后一窗关闭的三分支：隐藏到托盘/确认退出/直接退出）。
  - zclaudia 现状：`src-tauri/src/lib.rs:108-195` 已有托盘 + 关窗隐藏，但菜单固定两项、无 locale/flavor 语义、无 Linux 能力探测。
- **可搬运性**：**重写借鉴**（Tauri tray API 不同，但图标平台策略、关闭行为三分支、菜单重建语义可照搬）。zclaudia 已完成 60% 基础设施。
- **体量估计**：~150 行增量。

### 2.6 多窗口体系与单实例 deep link 路由

- **解决的问题**：窗口种类按职责拆分（主窗口/about/资源管理器/更新状态/CUA 权限面板/插件沙箱），每个 renderer HTML 独立入口控制 bundle；窗口关闭时其宿主子进程跟随、renderer reload 时重挂既有 host 而非重启；二次启动实例把 argv/deep link 数据转交首实例路由（含 Linux argv 被桌面环境重排的防御）。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/desktop/vite.config.ts:239-244`（4 个 HTML 入口）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/desktopWindowLifecycle.ts:24-70,155-180`（窗口生命周期 + host 重挂）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/desktopSecondInstanceDeepLink.ts:38-63`（second-instance argv 防御）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/index.ts:2043-2047`（`requestSingleInstanceLock`）；`/Users/zhvala/SourceCode/zcoder/packages/desktop/src/main/resourceManagerWindow.ts`（独立资源监控窗，505 行）。
  - zclaudia 现状：已有弹出窗（`/Users/zhvala/SourceCode/zclaudia/apps/desktop/src/features/chat/hooks/useSessionActions.ts:106-107` WebviewWindow 弹会话窗、`src/components/draft/DraftWindow.tsx` 草稿窗 + `emitTo('main')` 关闭同步、`src/features/dashboard/openProjectDashboardWindow.ts`），`src-tauri/src/window_manager.rs` 仅 44 行窗口枚举；无单实例锁/deep link 路由（未确认——grep 未发现 single-instance 相关代码）。
- **可搬运性**：**重写借鉴**。Tauri 2 无 Electron 的 second-instance API，需用 `tauri-plugin-single-instance`；"每窗口独立 HTML 入口"策略（vite 多入口）可直接复用。zclaudia 的多窗口骨架已存在，差的是窗口种类语义（沙箱/资源监控）与单实例路由。
- **体量估计**：单实例插件接入 ~50 行；新窗口种类按需每窗 ~200–500 行。

### 2.7 工作区文件链接与外链的安全分流渲染

- **解决的问题**：聊天里的相对路径/`file://`/Windows 盘符/带行号链接要统一解析为可点击的文件入口（点击前 stat 真实类型、右键菜单选编辑器/复制路径），外链要在"内置浏览器 vs 系统浏览器"间分流（左键默认 + 右键强制），且要赶在 rehype-harden 把路径标记成 `[blocked]` 之前改写 href。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/ui/src/components/ai-elements/message.tsx:750-798`（`formatMarkdownFileLinkTargetHref`：Windows 盘符补 `/C:/`、裸文件名规整）、`message.tsx:801-828`（`rewriteLocalFileMarkdownTargetsRehypePlugin`，先于 harden 执行）、`message.tsx:933-984`（`buildMessageFileLinkTarget`/`openMessageFileLinkInEditor`：动作时 stat 决定 file/directory）、`message.tsx:999-1080`（`MessageExternalLink`：本机/私网白名单 + 右键双目标）；Windows 反斜杠转义 remark 插件 `/Users/zhvala/SourceCode/zcoder/packages/ui/src/lib/windowsFileLinkEscapeRemarkPlugin.ts`。
  - zclaudia 现状：`/Users/zhvala/SourceCode/zclaudia/apps/desktop/src/features/chat/FileReference.tsx` 与 `FileLineReference.tsx` 已有行内文件引用渲染；但 assistantMarkdown 的 `a` 映射统一交给 `ChatLink`（`assistantMarkdown.tsx:57-59`），无路径规整/harden 前改写/stat 分层。
- **可搬运性**：**重写借鉴**。规则（何时规整、何时 stat、右键语义）可整体照搬；实现要接到 zclaudia 的 opener/shell 权限体系上。
- **体量估计**：~300–400 行 + 测试。

### 2.8 桌面 / Web / 公开分享页的同源 UI 复用策略

- **解决的问题**：同一套会话时间线要跑在四个宿主（Electron renderer、完整 Web、匿名公开分享页、手机远控页）而不把 Desktop 专属依赖带进公开页 bundle；平台差异收敛到一个接口，UI 层永不直接碰 `window.zcode`。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/shared/src/platform.ts:654-720`（`IPlatformService`：接口注释明确"只放必须穿越进程边界的操作，业务服务走 RPC"；Desktop/Web 各自实现）；`/Users/zhvala/SourceCode/zcoder/packages/share-ui/src/index.ts:1-4`（share-ui 仅 re-export `ui/src/v4/ConversationShareReadonlyTimeline.tsx`，不暴露整包边界）；`/Users/zhvala/SourceCode/zcoder/packages/ui/src/v4/ConversationShareReadonlyTimeline.tsx:1-6`（文件头安全边界注释：公开页 bundle 体积、无 Desktop 宿主回退、Desktop 能力必须注入）；`/Users/zhvala/SourceCode/zcoder/packages/web-share/src/main.tsx`（独立 Vite 入口，主题前置同步防"浅壳深码块"）；`/Users/zhvala/SourceCode/zcoder/packages/ui/src/replay.ts:1-14`（"只 re-export 不定义"的回放导出桶）。消费方验证：`packages/desktop/package.json`、`packages/web/package.json` 均依赖 `@zcode/ui`（grep 命中）。
  - zclaudia 现状：缺失（无独立 UI 包与第二宿主；`apps/` 下仅 desktop；平台抽象为 `src/utils/platform.ts` + `src/facade/`，但仅服务 Tauri 单宿主）。
- **可搬运性**：**仅思路**（zclaudia 当前没有 Web 宿主需求）。但其中的两条纪律对本仓库立即有用：a) "平台接口只放必须跨进程边界的操作"；b) 共享组件文件头写明宿主约束与注入要求。
- **体量估计**：无直接移植体量；作为架构约束写入规范即可。

### 2.9 stream-animate：流式渲染性能基准工具

- **解决的问题**：流式 UI 优化缺数据：以真实 SSE 流为输入，测 TTFT/字符速率，把输出按时间切帧桶（60/120fps 两档），给出帧趋势与峰值预测，配套 FrameChart 可视化——用于回答"流式动画掉帧是否在渲染层"。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/packages/stream-animate/src/shared/types.ts:19-56`（FrameBucket/FrameScenario/RunMetrics 定义）、`/Users/zhvala/SourceCode/zcoder/packages/stream-animate/src/server/index.ts`（独立 HTTP 服务，端口 5187）、`/Users/zhvala/SourceCode/zcoder/packages/stream-animate/src/server/frameBuckets.ts`、`frameForecast.ts`、`/Users/zhvala/SourceCode/zcoder/packages/stream-animate/src/client/FrameChart.tsx`。
  - zclaudia 现状：缺失（无对应性能基准工具；grep `requestAnimationFrame|typewriter` 在 MessageList 无命中）。
- **可搬运性**：**直接移植**。自包含（React + 本地 server，无 ZCode 内部依赖），Apache-2.0，保留其许可声明与 NOTICE 归属即可。
- **体量估计**：整包约几百行，可整包引入为 dev 工具。

### 2.10 第三方许可与 NOTICE 治理

- **解决的问题**：仓库大量借鉴 vercel/ai-elements 等第三方源码，需要可再生的 NOTICE：从依赖图+复制源码生成统一第三方声明，版本/来源/哈希入库存档——这直接决定了"从 ZCode（Apache-2.0）移植代码"时我方的合规动作。
- **证据路径**：
  - ZCode：`/Users/zhvala/SourceCode/zcoder/THIRD-PARTY-NOTICES.md:1-5`（由 `scripts/licenses.mjs notices` 生成，inventory.json 记录哈希）；`/Users/zhvala/SourceCode/zcoder/scripts/licenses.mjs`；移植溯源范式见 `/Users/zhvala/SourceCode/zcoder/packages/ui/src/components/ai-elements/message.tsx:1-6` 与 `shimmer.tsx:1-5`（"Derived from vercel/ai-elements … Apache-2.0 … See THIRD-PARTY-NOTICES.md"）。
  - zclaudia 现状：缺失（未发现 THIRD-PARTY-NOTICES 或等价生成脚本）。
- **可搬运性**：**直接移植**（licenses.mjs 思路与文件头溯源格式）。若从 ZCode 搬运代码：ZCode 为 Apache-2.0，需保留其版权与许可声明、不得用其商标，并在我方 NOTICE 中归属；ZCode 内部又派生自 vercel/ai-elements（Apache-2.0），逐文件头部已注明，搬运对应文件时两层声明都要保留。
- **体量估计**：文件头规范立即生效；脚本适配本仓库 monorepo ~1–2 天。

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

- **移动端同源**：同一前端代码经 Tauri 编译 Android（`apps/desktop/src-tauri/tauri.android.conf.json`、`src-tauri/src/android_bridge.rs`、`useAutoUpdate.ts` 的 `isAndroid` 分支 + APK 下载安装通道）；ZCode 的移动覆盖是"手机 Web 远控桌面"，无原生 App。
- **token 生成管线带校验**：`apps/desktop/scripts/gen-tokens.mjs --check`（主题 token 集中在 `tokens/config.mjs`，CI 可卡校验），ZCode 的 token 是手维护 CSS。
- **自研 UI 不变量 lint**：`scripts/check-react-lifecycle-invariants.mjs`、`check-radius-conventions.mjs` 已挂进 lint script，ZCode 未见等价物（未确认）。
- **DraftWindow 弹出撰写窗**：独立草稿窗 + `emitTo('main','draft-window-closed')` 跨窗同步与 30s 会话存活检查（`src/components/draft/DraftWindow.tsx:16-39`），ZCode 无对应"弹出撰写"窗口。
- **WSL 支持**：`src-tauri/src/wsl.rs`（300 行）；ZCode 未见 WSL 专门处理（未确认）。
- **运行时选型本身**：Tauri 侧 Rust 后端仅 ~1.9k 行即承载 server 托管/托盘/权限，包体与内存天然小于 Electron 主进程 177 文件的规模（属选型收益，非代码证据）。

## 4. 不建议搬运的（及原因）

- **Chrome 凭据/cookie 导入族**（`chromeCookieManager.ts`、`chromeCredentialManager.ts`、`windowsChromeAppBoundKey.ts` 等）：深度绑定 Chromium App-Bound Encryption 与 Windows DPAPI，Tauri WebView 无对等能力，且属敏感凭据访问，风险收益比差。
- **CUA（Computer Use）助手族**（`desktopCuaHelperInstaller.ts`、`windowsCuaOperationIndicator.ts`、macOS .app helper 打包）：依赖 Electron 产线单独的 helper 二进制与辅助工具签名链，与 zclaudia 产品方向不同。
- **ARMS RUM 遥测族**（`appARMSBootstrap.ts`、`armsEventRedaction.ts`、`@arms/rum-electron`）：供应商专属（阿里云 ARMS），换遥测栈时应按我方基建重选。
- **整包搬 `@zcode/ui`**：约 1800 个文件、含大量产品语义组件（Bots/CodingPlan/Highspeed/Rewards 等），直接引入等于接收整个产品壳；只应按 2.1/2.2/2.7 的粒度摘取模式与小组件。
- **Electron 专属窗口 chrome 实现**（`desktopWindowButtonPosition.ts` 的 Windows TitleBarOverlay、`desktopWindowChrome.ts` 的 webviewTag 硬化）：Tauri 的 `titleBarStyle: Overlay` + 自绘控制已是另一条路线（zclaudia `traffic_lights.rs` 已自实现红绿灯定位），两边机制不可互换。
- **WebRemoteControl 手机远控 UI**（`packages/ui/src/WebRemoteControlMobileShell.tsx` 等）：zclaudia 已用原生 Android 覆盖同一需求，再搬远控壳是重复建设。
- **electron-updater 具体实现细节**（NSIS 补丁、`windowsAumidIcon.ts`、安装器脚本）：打包器不同，全部不适用；只搬 2.3 列的产品语义。

## 附：未覆盖/未确认项

- `packages/desktop/src/host/`、`scheduler/` 与每窗口 host 子进程模型的完整细节（仅读到生命周期接口层）。
- `packages/desktop/test/` 与 wdio E2E 分片策略（`wdio.conf.ts`、`run-windows-e2e-shards.mjs` 存在但未评估覆盖面）。
- ZCode `docs/desktop/linux-close-to-tray.md` spec（desktopTray.ts 注释引用，未读原文）。
- zclaudia 是否完全无单实例锁/deep link 处理（基于 grep 未命中，未穷尽）。
- streamdown 上游许可（npm 包）在本报告未核实，搬运前需确认（ZCode 侧对其用法见 message.tsx）。

## 5. 独立复核记录

> 复核人：独立复核员（与探索员无共享上下文）。复核范围：第 2 章 P1/P2 领先点共 8 条，全部证据文件于本会话只读打开核对，2026-10-16。

- ✅ Streamdown 流式 Markdown 渲染管线：`resolveMessageStreamdownMode` 仅真实流式返回 "streaming"、完成态固定 static（packages/ui/src/components/ai-elements/message.tsx:700-706），`parseIncompleteMarkdown={streaming}` 仅流式开启未闭合语法补全（message.tsx:1635），`MessageResponseMarkdownBoundary` 单条 markdown 异常降级纯文本（message.tsx:708-748），单 `$` 数学启发式含 `$5-$10` 价格区间豁免（message.tsx:587-628）均属实。
- ✅ Markdown 类型标度：h1–h6 显式映射 `messageMarkdownHeadingClassNames`，h1=text-ui-xl、h2=text-ui-lg、h3–h6=text-ui-base（差异落在字重 semibold/semibold/semibold/medium/normal，报告把字重压缩进字号串是措辞小瑕疵但映射本身属实）（message.tsx:440-447），DESIGN.md:12-23 "Highest-priority UI constraint" 强制全仓库 text-ui-*、禁 `text-[13px]`、禁改 html font-size、只许 `--ui-font-size`；正文 `text-ui-base leading-[1.75]`（message.tsx:1367-1370）。
- ✅ 完整桌面自动更新体系：双间隔轮询 15min 不可见/2min 可见（autoUpdater.ts:26-27,240-241），`releaseNotesByLocale` 多语言投递（autoUpdater.ts:82-93,657-665）+ 已读记忆 `acknowledgePostUpdateReleaseNotes`（autoUpdater.ts:57,1485-1504），可取消下载 CancellationToken（autoUpdater.ts:53,1267-1268；UpdateStatusDialog.tsx:30 `onCancelDownload`），强更门阻止创建主窗口并退出（forceUpdateGuard.ts:217-254）且强制升级期拦截 second-instance deep link/workspace 请求（desktopSecondInstanceDeepLink.ts:45-65），文件实测 2051 行（wc -l），flavor 禁用 fail-closed 语义（autoUpdater.ts:61-64）。
- ✅ 本地化原生应用菜单 + 快捷键纯函数内核：`getPreferredSystemLanguages` 修 macOS 中文系统返回 en-US（desktopApplicationMenu.ts:34-39），accelerator 解析空数组=未设置/全非法回退默认/录制态摘键（desktopApplicationMenu.ts:63-82），zoomIn 的 Plus/= 双条目（desktopApplicationMenu.ts:106-109,207-223）；bindings.ts 头注即"匹配、录制、生效表与冲突检测的唯一实现"且 IME（isComposing/Process/Dead/229）与长按 repeat 一律过滤（bindings.ts:1-7,40-52），实测 382 行、conflicts.ts 独立存在（304 行）。
- ✅ 托盘驻留与平台差异化关闭行为：Linux PNG/Windows 独立 .ico 图标策略含高 DPI 注释（desktopTray.ts:15-26），Linux 平台门 + 能力探测 spec 引用（desktopTray.ts:37-41），flavor 决定更新入口（desktopTray.ts:86-94）；macOS 全屏关窗先 leave-full-screen 再隐藏（desktopDarwinCloseBehavior.ts:17-26）；最后一窗三分支隐藏托盘/免确认直接退出/确认退出（desktopWindowLifecycle.ts:395-425）。
- ✅ 多窗口体系与单实例 deep link 路由：vite 4 个独立 HTML 入口 index/resource-manager/cua-permission-panel/plugin-sandbox（vite.config.ts:239-245），renderer reload 时给存活 host 补挂 MessagePort 而非重启（desktopWindowLifecycle.ts:137-180），Linux argv 重排防御优先读 additionalData（desktopSecondInstanceDeepLink.ts:38-41），资源管理器独立窗实测 505 行、main 只做三件事注释（resourceManagerWindow.ts:27-33）。
- ✅ 工作区文件链接与外链安全分流渲染：Windows 盘符补 `/C:/`、裸文件名规整 `./`（message.tsx:750-775），`rewriteLocalFileMarkdownTargetsRehypePlugin` 置于 defaultRehypePlugins（含 harden）之前（message.tsx:801-828），打开动作时 stat 决定 file/directory（message.tsx:959-984），`MessageExternalLink` 右键强制内置/系统双目标（message.tsx:999-1080），Windows 反斜杠转义还原 remark 插件（windowsFileLinkEscapeRemarkPlugin.ts:18-22,78-95）。
- ✅ 桌面/Web/公开分享页同源 UI 复用：`IPlatformService` 接口注释明确"只放必须穿越进程边界的操作，业务服务走 RPC"、Desktop/Web 各自实现（platform.ts:644-654），share-ui 仅最小 re-export 时间线与 Theme（share-ui/src/index.ts:1-6），共享时间线文件头安全边界注释（公开页 bundle/无 Desktop 宿主/能力必须注入）（ConversationShareReadonlyTimeline.tsx:1-4），replay.ts:1-13"只 re-export 不定义"导出桶，desktop/web 两 package.json 均依赖 `@zcode/ui`（desktop/package.json:74、web/package.json:14）。
