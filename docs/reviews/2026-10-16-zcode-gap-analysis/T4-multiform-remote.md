# T4 多形态与远程能力 对比报告

> 竞品：ZCode（`/Users/zhvala/SourceCode/zcoder`，Apache-2.0）· 本仓库：zclaudia（`/Users/zhvala/SourceCode/zclaudia`）
> 维度：多形态分发（TUI / Web / 桌面 / 移动）与远程能力（SSH/WSL 远程工作区、手机远控、容器化 E2E）
> 日期：2026-10-16 · 探索方式：只读（目录结构 → README/package.json → 关键入口 → 定向 grep）

---

## 1. 两侧结构对照（简表）

| 能力 | ZCode | zclaudia |
| --- | --- | --- |
| 桌面形态 | Electron（`packages/desktop`） | Tauri v2（`apps/desktop/src-tauri`） |
| Web 形态 | 独立 Web 客户端 `packages/web`（Vite SPA），由同一后端托管；`zcode --web` 一键启动 | 复用桌面 React 应用构建产物，由 server 托管（`server/src/interfaces/http/browser-shell.ts`），`pnpm browser:build` + `browser:start` |
| TUI / CLI 形态 | `apps/zcode-cli/packages/tui` + `bin/zcode.mjs` runner：无参数进 TUI，`--web` 进 Web | **缺失**（无 TUI；`packages/` 下仅 `agent-common`） |
| 单命令分发 | `pnpm build:zcode` 产出 tar.gz + `install.sh` + `latest.json`（`scripts/build-zcode.mjs`） | **缺失**（开发式脚本启动，无打包成单命令发行物） |
| 移动端 | 手机 Web 远控页（`packages/web` 的 `/remote` 路由）+ Android 原生壳 `packages/android`（WebView + 扫码 + 前台保活） | Tauri v2 Android 应用（`apps/desktop/src-tauri/gen/android` 完整 Gradle 工程）+ 同一 React 应用的移动布局（`apps/desktop/src/app/useMobileDrawer.ts` 等）+ ntfy 推送（`apps/desktop/src/services/ntfyBridge.ts`） |
| 远程工作区 | SSH / WSL / Docker 三后端，统一 `IRemoteBackend`（`packages/server/src/remote/`，约 9900 行）；含资源 SFTP 上传与 CDN 部署 | **缺失**（执行环境仅本地：`server/src/infra/execution-env.ts` 为本地 `NodeExecutionEnv`；grep 无 ssh2/sftp/wsl） |
| 远程接入通道 | 外部 relay `wss://zcode.z.ai/ws`（闭源托管，仓库内无 relay 源码） | 自有 Gateway 中继（`server/src/infra/gateway/gateway-client.ts` + 外部仓库 `../zclaudia-gateway`，含 Docker 部署），NAT 穿透、HTTP-over-WS 代理、可吊销凭据 |
| 桌面 E2E 容器化 | `Dockerfile.desktop-e2e`：Electron + xvfb + dbus 容器内跑 WDIO E2E | `e2e/` Playwright 浏览器 E2E（无桌面壳 E2E、无容器化） |
| 会话分享 | `packages/web-share` 落地页 + 分享导入协议（`docs/conversation-share-v1.md`） | **缺失** |

---

## 2. ZCode 领先点（核心章节）

### 2.1 单命令多形态分发：一个 `zcode` 命令 = TUI + Web + Agent

- **解决的问题**：把「终端交互、浏览器访问、Agent 无头调用」收敛为一个发行包和一个入口命令。用户 `brew`/脚本装完即得三形态；`zcode` 进 TUI，`zcode --web` 在本机起 HTTP+WS 服务并托管 Web 静态资源，其余参数透传给 Agent CLI。非本机监听地址自动生成访问令牌，避免裸奔。
- **证据路径**：
  - `packages/zcode-cli`（独立 Server 启动与进程管理，见根 `README.md:219` 仓库结构表）
  - 分发 runner（核心 272 行）：`scripts/zcode-distribution/runner.mjs` — `--web` 分流在 `runner.mjs:256`，非本机 host 自动加 token 在 `runner.mjs:101-111` 与 `runner.mjs:173-174`，自动选空闲端口 `runner.mjs:113-129`，通过环境变量把 Agent 作为 stdio 子进程拉起 `runner.mjs:178-192`
  - 打包脚本：`scripts/build-zcode.mjs`（组装 web dist + server dist + agent bundle + TUI 运行时，产出 `releases/<v>/zcode-<v>.tar.gz`、`sha256.txt`、`latest.json`、`install.sh`，见 `build-zcode.mjs:120-186` 的 `stageZCodePackage`）
  - 安装器：`scripts/zcode-distribution/installer.mjs`
  - 用户面文档：根 `README.md:85-108`「ZCode 命令行版」
  - **zclaudia 现状**：无 TUI、无单命令发行物（缺失）。最接近的是 `pnpm browser:start`（根 `package.json:20`）+ server 托管桌面构建产物 `server/src/interfaces/http/browser-shell.ts:33-65`，但那是开发/自托管脚本，无版本索引、无安装脚本、无 token 自动签发。
- **可搬运性**：**直接移植**。`runner.mjs` 自包含、零依赖（仅 node 内置模块），把 serverEntry/webRoot/agentEntry 指向 zclaudia 的 server bundle 与 desktop dist 即可；token、端口、SIGINT 处理逻辑可原样保留。移植时按 Apache-2.0 保留原许可声明与 NOTICE 归属（ZCode 仓库含 `NOTICE.md`、`THIRD-PARTY-NOTICES.md`）。TUI 形态本身另需自建（runner 的「无参数进 TUI」分支对 zclaudia 暂时退化为「打印用法」）。
- **体量估计**：runner 改造 ~1 天；配套 `build:zcode` 打包脚本（含 server bundle 已有 `server/scripts/bundle.mjs`）~2-3 天。

### 2.2 统一远程工作区后端：SSH / WSL / Docker 三实现 + 工厂

- **解决的问题**：在桌面端把 Agent 执行环境放到远程 Linux（SSH 主机）、Windows WSL 发行版或 Docker 容器，用户在本地 UI 里透明操作远程项目。
- **证据路径**：
  - 接口：`packages/server/src/remote/backend.ts:32-49`（`IRemoteBackend`：detect/upload/exec/exists/readFile，含上传进度与断连事件）
  - 工厂：`packages/server/src/remote/create-backend.ts:6-37`（ssh/wsl/docker 三分支）
  - SSH 实现：`packages/server/src/remote/ssh-backend.ts`（SFTP 上传失败自动降级 exec pipe，`ssh-backend.ts:253-273`）
  - WSL 实现：`packages/server/src/remote/wsl-backend.ts`（`wsl.exe` 子进程，`wsl-backend.ts:43`；连接生命周期/禁止 `wsl --shutdown` 的释放纪律见 `docs/wsl-remote-workspace-design.md`）
  - Docker 实现：`packages/server/src/remote/docker-backend.ts`
  - 目录总量约 9900 行（`wc -l packages/server/src/remote/*.ts` 实测）
  - 配套本地测试容器：`harness/remote/Dockerfile`（ubuntu + openssh-server，root/dev 双账号）+ `harness/remote/README.md`
  - **zclaudia 现状**：缺失。执行环境本地绑定（`server/src/infra/execution-env.ts:17-20`）；`grep -ril ssh|sftp|wsl` 在 server 侧只命中 bash 防护/沙箱代码，无远程工作区能力。
- **可搬运性**：**重写借鉴**。接口形状（detect/upload/exec/exists/readFile + onDidDisconnect）与工厂模式值得照抄；实现层 ssh2/wsl.exe 部分可直接参考，但需对接 zclaudia 的 pi-agent 执行环境与 server 进程模型，工作量是「周」级。若逐文件复制需保留 Apache-2.0 声明与 NOTICE。
- **体量估计**：接口 + SSH 后端 MVP ~1-2 周；WSL/Docker 后端与 UI 连接向导另计 ~2-3 周。

### 2.3 远程资源部署：CDN manifest + 「本地下载后 SFTP 上传」/「远端直连下载」双模式

- **解决的问题**：远程机器上要跑 zcode-server + Node 运行时 + agent + 原生二进制（node-pty 预编译等）。弱网/无外网远端可选择「本地下载后上传」（带进度、可取消、SFTP 失败降级），有外网远端走「远端直连 CDN」；配合部署锁、`.ready` 标记与版本 identity 校验做到幂等。
- **证据路径**：
  - 编排入口：`packages/server/src/remote/deploy.ts:1-63`（集中编排 server/node/agent/tool 资源）
  - 双安装器：`packages/server/src/remote/remoteAssetInstaller.ts:212`（`LocalUploadAssetInstaller`）与 `:616`（`RemoteDownloadAssetInstaller`，多 CDN 候选容错见 `:975-993` 注释）
  - 资源缓存/manifest：`packages/server/src/remote/remoteAssetCache.ts`（1928 行，`.ready` 标记、release 锁、manifest 刷新锁）
  - 上传进度：`packages/server/src/remote/sshUploadProgress.ts`
  - 部署锁：`packages/server/src/remote/remoteDeployLock.ts`
  - README 用户流：根 `README.md:66-68`（「连接远程项目时资源选择『本地下载后上传』…经 SFTP 上传到远程」）
  - **zclaudia 现状**：缺失（依赖 2.2 的远程工作区存在）。zclaudia 的等价物是「把整个 server 部署到远程主机」：`scripts/deploy/server.sh`（systemd）+ `setup-server.sh`，属另一种哲学（见 §3）。
- **可搬运性**：**仅思路**（当前）。remote workspace 落地后，其「双模式安装器 + 部署锁 + ready 标记」的幂等设计直接作为需求规格；逐行移植不现实（强耦合 ZCode 的 CDN 与组件清单）。
- **体量估计**：作为远程工作区二期，~1-2 周。

### 2.4 Android 原生远控壳：扫码配对 + URL 白名单 + 前台保活

- **解决的问题**：手机接管桌面已打开的会话。Android 壳不做独立 Agent，只承载 `/remote` 手机 Web 页：扫码/分享链接/deep link 三入口进入 WebView；前台服务降低后台回收导致的 WebSocket 断连；生产包 URL 白名单防止壳变成任意浏览器。
- **证据路径**：
  - 入口与状态恢复：`packages/android/app/src/main/java/com/example/zcode_mobile/MainActivity.kt:26-98`（intent/deep link/EXTRA_TEXT 分享文本三来源）
  - URL 白名单（生产仅 `https://zcode.z.ai/remote`，debug 放开局域网）：`packages/android/app/src/main/java/com/example/zcode_mobile/remote/RemoteControlUrlPolicy.kt:48-83`
  - 前台保活服务：`packages/android/app/src/main/java/com/example/zcode_mobile/remote/RemoteControlKeepAliveService.kt:20-48`（注释明确「真正恢复交给 web 端 replayable snapshot 协议」）
  - 最近链接存储：`packages/android/app/src/main/java/com/example/zcode_mobile/remote/RemoteControlRecentLinksStore.kt`
  - 产品说明（含 CameraX + ML Kit 扫码）：`docs/mobile-remote-control-android.md`
  - 桌面侧二维码生成：`packages/ui/src/WebRemoteControlDialog.tsx:2`（`import QRCode from "qrcode"`）、`:455`
  - **zclaudia 现状**：已有一等公民 Android 应用——Tauri v2（`apps/desktop/src-tauri/gen/android` 完整 Gradle 工程、`tauri.android.conf.json`）+ 移动布局（`apps/desktop/src/app/useMobileDrawer.ts`、`MobileModeHeader.tsx`、`MobileOverlays.tsx`）+ ntfy 推送桥（`apps/desktop/src/services/ntfyBridge.ts`）。**zclaudia 的 Android 是完整客户端，比 ZCode 的 WebView 壳更重**；ZCode 领先的是「远控壳」的三件套细节：扫码配对入口、URL 白名单策略、前台保活服务。
- **可搬运性**：**重写借鉴**。三个思路都适用于 zclaudia：① 在 Android 端加「扫桌面二维码直连后端/gateway」的配对入口（替代手填地址）；② WebView/Tauri WebView 加载远程地址时的域名白名单策略；③ Tauri Android 前台服务（`foreground-service` 插件）保活长连接。代码层面 Tauri ≠ 原生 Compose，只能重写。
- **体量估计**：扫码配对 ~2-3 天；前台保活 ~1-2 天（含 Tauri 插件配置）。

### 2.5 手机 Web 远控协议：replayable snapshot 断线恢复 + 独立选中态 + 手机专属任务首页

- **解决的问题**：手机浏览器刷新/断网/回前台后，按 replayable 协议重新同步任务状态，不干扰桌面端的选中态与会话主链路（桌面 `desktop-continuous`，手机 `web-remote-replayable` 两权分离）；窄屏进入独立「任务首页 → 聊天」两页 shell，而非压缩版桌面 UI。
- **证据路径**：
  - 架构文档：`docs/web-remote-control/web-remote-control-architecture.md:1-60`（产品概览、两权分离、能力边界）
  - 手机侧实现：`packages/web/src/webRemoteControlLifecycle.ts`、`webRemoteControlTransport.ts`、`webRemoteControlWorkspaceBridgeSession.ts` 等（`packages/web/src/` 下 13 个 `webRemoteControl*` 文件）
  - 同步协议：`docs/web-remote-control/task-realtime-sync.md`、`snapshot-byte-budget.md`
  - 移动稳定性分析：`docs/web-remote-control/mobile-stability-analysis.md`（376 行）
  - **zclaudia 现状**：移动 web 复用桌面 SPA + gateway 通道（`server/src/infra/gateway/gateway-client.ts` 含 content catch-up 消息 `CatchUpContentMessage`，`gateway-client.ts:25-31`），有基础的重连追平；但无任务首页/聊天两页 shell 的移动信息架构，无显式 replayable snapshot 预算管理。移动 UI 基建在`apps/desktop/src/app/`（drawer/header/overlays）持续加固中（近期多个 mobile fix commit）。
- **可搬运性**：**重写借鉴**。zclaudia 已有自有 relay 与 catch-up，协议层差距不大；值得借鉴的是产品层「窄屏任务首页 + 跨工作区时间线」与「断线恢复的 snapshot 字节预算」思路。
- **体量估计**：移动任务首页 shell ~1 周；snapshot 预算机制 ~3-5 天。

### 2.6 桌面 E2E 容器化：Docker 内无头跑 Electron 全链路

- **解决的问题**：Electron 桌面 E2E 在无显示器 CI/本机可重复运行：容器内装全量 X11/GTK/NSS 依赖 + xvfb + dbus，`dbus-run-session -- pnpm --filter @zcode/desktop test:e2e` 一条命令起完整桌面并跑 WDIO 用例；用例集通过 preset 门禁管理（新用例须单 spec 容器内准入后才能进 preset）。
- **证据路径**：
  - `Dockerfile.desktop-e2e`（依赖清单 `:28-78`，E2E spec 环境变量 `:19`，入口 `:96`）
  - 驱动脚本：`scripts/test-desktop-e2e-container.sh`（preset 门禁 `:14-31`：「只有通过人工 review、formal promotion 和单 spec Docker admission 的插件用例才能写入」）
  - **zclaudia 现状**：`e2e/` 为 Playwright 浏览器 E2E（`e2e/playwright.agent-runtimes.config.ts` 等 5 个 config，跑的是 server+web 组合），**无桌面壳（Tauri WebView）E2E，无容器化**（缺失）。
- **可搬运性**：**重写借鉴**。zclaudia 是 Tauri，Electron+WDIO 栈不可直接搬；可搬的是「容器内虚拟显示跑完整壳 + spec 准入门禁」的模式。Tauri 容器化 E2E 可走 tauri-driver/WebDriver 或退一步先把现有 Playwright E2E 容器化（成本低、收益直接）。
- **体量估计**：现有 Playwright E2E 容器化 ~2-3 天；Tauri 壳级 E2E 原型 ~1 周。

### 2.7 会话分享落地页与跨端导入（多形态联动）

- **解决的问题**：桌面（含远程工作区）把已完成会话片段生成分享码 → 公开 Web 落地页 `/cn/share/:code` 预览 → `zcode://share/import` deep link 唤起桌面导入继续工作。Web 形态成为桌面的获客/协作入口。
- **证据路径**：
  - `packages/web-share/src/main.tsx`、`ShareAuthPages.tsx`（独立 Vite 构建，`packages/web-share/package.json`）
  - 协议与边界：`docs/conversation-share-v1.md`（`prepare -> upload -> confirm -> share URL` 流程、`public_importable` 权限）
  - **zclaudia 现状**：缺失（无分享/导入概念）。
- **可搬运性**：**仅思路**。需要先有分享后端与凭据体系；zclaudia 若做，可基于自有 gateway/server 实现更轻的自托管分享。
- **体量估计**：V1（选择+上传+落地页只读）~2 周。

### 2.8 `zcode` 安装脚本与版本索引（自更新通道）

- **解决的问题**：`install.sh` 从下载根地址拉 `latest.json` → 校验 sha256 → 安装到 `~/.zcode/runtime` 并在 bin 目录建命令；支持 `ZCODE_DIST_HOME`/`ZCODE_DIST_BIN_DIR` 定制。让 2.1 的发行物具备可分发性。
- **证据路径**：
  - `scripts/zcode-distribution/installer.mjs`（install.sh 模板与产物说明）
  - 产物组装：`scripts/build-zcode.mjs:120-186` + `README.md:186-192`
  - **zclaudia 现状**：缺失（仅 `version.json`；`scripts/release/version-bump.sh` 管版本号，无发行通道）。
- **可搬运性**：**直接移植**（伴随 2.1）。shell 安装脚本模式通用，改下载地址与目录名即可；保留 Apache-2.0 归属。
- **体量估计**：~1 天。

---

## 3. zclaudia 已有而 ZCode 没有的优势（简列）

1. **自有、可自托管的中继层**：`server/src/infra/gateway/gateway-client.ts`（backend peer：握手/心跳/注册表/消息通道/HTTP-over-WS 代理/SOCKS 代理）+ 外部 `../zclaudia-gateway`（Docker 部署、可吊销的 `zgd_/zgb_/zga_` 凭据、SQLite 设备映射）。ZCode 手机远控依赖闭源外部 relay（`wss://zcode.z.ai/ws`，`docs/web-remote-control/web-remote-control-architecture.md:68`），仓库内无 relay 源码。
2. **一套 React 代码吃下四形态**：桌面（Tauri）、浏览器（`browser-shell.ts` SPA 回退）、Android（Tauri mobile）、移动浏览器，同一 `apps/desktop` 应用 + 平台分支（`apps/desktop/src/utils/platform` 的 `isAndroid()` 等）。ZCode 是桌面 renderer 与 `packages/web` 两套客户端 + `packages/ui` 共享层。
3. **Tauri v2 Android 一等公民**：`apps/desktop/src-tauri/gen/android` 完整 Gradle 工程；ZCode 的 `packages/android` 只是 WebView 远控壳（不创建 Agent runtime，见 `docs/mobile-remote-control-android.md` 末节）。
4. **ntfy 推送桥**：`apps/desktop/src/services/ntfyBridge.ts` 按后端订阅 ntfy 主题，Android 后台也能收到任务通知（近期 commit `e7bbfd86`）；ZCode 移动端无独立推送通道（依赖页面前台保活）。
5. **本地浏览器壳做成系统服务**：`scripts/deploy/browser-service.sh`（systemd/launchd install/start/logs），`pnpm browser:service install` 一键常驻；ZCode 的 Web 模式是前台进程（Ctrl+C 停止）。
6. **远程后端 = 整机部署**：`scripts/deploy/server.sh`/`setup-server.sh` 把 server 以 systemd 服务部署到远程主机再经 gateway 接入——比 ZCode 的「本地壳 + SSH 通道」更简单直接，适合无桌面 Linux 服务器场景。

---

## 4. 不建议搬运的（及原因）

| 项 | 证据 | 原因 |
| --- | --- | --- |
| Electron + WDIO 桌面 E2E 具体栈 | `Dockerfile.desktop-e2e:96`（WDIO 入口） | zclaudia 是 Tauri + Playwright；直接搬栈=重写测试。只搬「容器化 + spec 准入门禁」模式（§2.6） |
| 依赖 `wss://zcode.z.ai` 外部 relay 的远控链路 | `docs/web-remote-control/web-remote-control-architecture.md:64-75` | 闭源托管服务，仓库内无实现；zclaudia 已有自有 gateway，照搬只会引入外部依赖 |
| web-remote-control v2/v3/v4 多版本并行部署链 | `docs/web-remote-control/web-remote-control-architecture.md:91-120` | 为线上灰度服务的历史包袱（三套 Dockerfile/Deployment/CI）；新实现只需单链路 + 版本化静态资源 |
| mock-cdn 开发工作流 | `README.md:66-68` | 与 ZCode 的 CDN 基础设施强耦合；仅在做远程工作区时参考其「本地资源上传」语义 |
| zcode SEA 单可执行构建 / SMB 上传脚本 | `apps/zcode-cli/packages/cli/package.json`（`build:sea`、`upload:sea`） | zclaudia 无 TUI 形态，Node SEA 收益低；且脚本绑定 ZCode 内网 SMB |
| TUI 形态本体 | `apps/zcode-cli/packages/tui` | 体量大（node-pty、原生依赖收集、worker 打包，见 `scripts/build-zcode.mjs` 引用的 `stageTuiRuntime`）；非 T4 关键缺口，zclaudia 已有 Web/桌面/移动三形态覆盖 |
| WSL 的 `wsl --terminate/--shutdown` 类干预 | `docs/wsl-remote-workspace-design.md`（明确禁止） | 不是功能而是负面清单；若做 WSL 支持直接 adopt 该纪律即可，无需搬运代码 |

---

## 附：验证记录

- 目录列举：ZCode `packages/`（含 android/web/web-share/zcode-server-cli）、`harness/remote`；zclaudia `apps/`、`packages/`、`server/src/{interfaces,infra}`。
- 关键读取：ZCode `README.md` 全文、`scripts/zcode-distribution/runner.mjs` 全文、`scripts/build-zcode.mjs`（1-260 行）、`packages/server/src/remote/{backend,create-backend,deploy,remoteAssetCache,remoteAssetInstaller,ssh-backend,wsl-backend}.ts` 摘录、`docs/{mobile-remote-control-android,wsl-remote-workspace-design,web-app-docker-image,conversation-share-v1}.md`、`docs/web-remote-control/web-remote-control-architecture.md`、`packages/android` 全部 Kotlin 入口、`Dockerfile.desktop-e2e` 全文、`harness/remote/{Dockerfile,README.md}`；zclaudia `CLAUDE.md` 全文、`server/src/interfaces/http/browser-shell.ts` 全文、`server/src/infra/gateway/gateway-client.ts`（1-60 行）、`server/src/infra/execution-env.ts`、根 `package.json` scripts、`apps/desktop/src-tauri/{tauri.android.conf.json,gen/}`。
- 定向 grep：zclaudia server 侧 `ssh|sftp|wsl`（仅命中 bash 防护，无远程能力）；`ntfy`（命中 ntfyBridge）；`isAndroid`（命中平台分支）；ZCode 侧 `qrcode`（命中 WebRemoteControlDialog）。
- 未覆盖：ZCode `packages/web` 手机页内部实现细节（仅读路由与文件清单）、`packages/zcode-server-cli` 内部、`../zclaudia-gateway` 源码（在本仓库范围外）。

---

## 5. 独立复核记录

> 复核人：独立复核员（与探索员无共享上下文）· 日期：2026-10-16 · 方式：只读打开全部证据路径逐条核对，所有行号均为本次实测。

- ✅ 单命令多形态分发：一个 zcode 命令 = TUI + Web + Agent（自包含 runner + 打包 + 安装脚本）— `scripts/zcode-distribution/runner.mjs` 仅依赖 node 内置模块（`runner.mjs:2-8`，`wc -l` 实测 272 行），`--web` 分流 `runner.mjs:256`、非本机强制 token `runner.mjs:101-107` + `runner.mjs:173-174`、空闲端口 `runner.mjs:113-129`、Agent 经环境变量以 stdio 子进程拉起 `runner.mjs:178-192`（`ZCODE_AGENT_SERVER_ARGS_JSON` 含 `agent/zcode.cjs "app-server" --stdio`）；`scripts/build-zcode.mjs:265-290` 产出 tar.gz/sha256.txt/latest.json/install.sh（注：`stageZCodePackage` 实际在 `build-zcode.mjs:157-219`，报告写 `:120-186` 系行号漂移）；`scripts/zcode-distribution/installer.mjs:7-49` 安装到 `~/.zcode/runtime` 并建 bin 命令；`README.md:85-108`「ZCode 命令行版」与 `README.md:220`（报告写 `:219`）仓库结构表均命中。
- ✅ 统一远程工作区后端：SSH/WSL/Docker 三实现 + IRemoteBackend 接口与工厂 — `backend.ts:32-49` 精确命中（detect/upload/exec/exists/readFile 在 `:40-48`、上传进度 `:22-30`、`onDidDisconnect` `:38`）；`create-backend.ts:6-37` ssh/wsl/docker 三分支；ssh-backend SFTP 失败降级 exec pipe 实测在 `ssh-backend.ts:255-272`（报告写 `:253-273`，内容吻合）；`wsl-backend.ts:43` `const WSL_COMMAND = "wsl.exe"` 精确命中；`docs/wsl-remote-workspace-design.md:54`「释放过程禁止调用 `wsl --terminate` 或 `wsl --shutdown`」；`wc -l packages/server/src/remote/*.ts` 实测合计 9906 行（报告「约 9900 行」属实），`docker-backend.ts`、`harness/remote/{Dockerfile,README.md}` 均存在。
- ✅ 远程资源部署双模式：CDN manifest + 本地下载后 SFTP 上传 / 远端直连下载，含部署锁与 .ready 幂等标记 — `remoteAssetInstaller.ts:212` `LocalUploadAssetInstaller`、`:616` `RemoteDownloadAssetInstaller` 均精确命中，`:971-993` 多 CDN 候选容错注释（「取消当前请求并尝试下一个 CDN」）在位；`remoteAssetCache.ts` 实测 1928 行，`.ready` 标记 `:41`、release 锁 `:225`、manifest 刷新锁 `:474`；`deploy.ts:1` 注释「远端部署入口集中编排 server/node/agent/tool 资源」且 import `acquireRemoteDeployLock`（`deploy.ts:40`）；`sshUploadProgress.ts`、`remoteDeployLock.ts` 存在且内容相符；`README.md:68`「本地下载后上传…经 SFTP 上传到远程」命中。
- ✅ Android 原生远控壳三件套：扫码配对入口、生产 URL 白名单、前台服务保活 WebSocket — `MainActivity.kt:26-98` 三入口（EXTRA_REMOTE_URL `:87`、deep link `intent.data` `:90`、EXTRA_TEXT `:93`）+ `onSaveInstanceState` 状态恢复 `:57-60`；`RemoteControlUrlPolicy.kt:48-83` 生产仅 `https`+`zcode.z.ai`+`/remote`（`:53`）、debug 放开本机/局域网（`:57-83`）；`RemoteControlKeepAliveService.kt:20-48` `startForeground` 且 `:26` 注释原话「真正的状态恢复仍交给 web 端 replayable snapshot 协议完成」；`docs/mobile-remote-control-android.md:19`「扫码使用 CameraX 预览和 ML Kit Barcode Scanning」；`WebRemoteControlDialog.tsx:2` `import QRCode from "qrcode"`、`:455` `QRCode.toDataURL` 均精确命中。
- ⚠️ 手机 Web 远控协议：replayable snapshot 断线恢复 + 手机/桌面选中态两权分离 + 窄屏任务首页 shell — 领先点本身属实：`web-remote-control-architecture.md:31-32` `desktop-continuous`/`web-remote-replayable` 两权分离、`:21-30` 窄屏「任务首页→聊天」两页 shell 与 replayable 重同步、`mobile-task-home-design.md:80` 小屏断点进入移动端两页 shell、`mobile-stability-analysis.md` 实测 376 行、`webRemoteControlLifecycle.ts:38-56` 可见性/断网恢复钩子、`task-realtime-sync.md` 开篇即 `desktop-continuous`/`web-remote-replayable` 不变量；但报告称 `packages/web/src/` 下有 13 个 `webRemoteControl*` 文件，`ls`+`find` 实测均为 **11** 个。
- ✅ 桌面 E2E 容器化：Dockerfile.desktop-e2e 在容器内 xvfb+dbus 跑完整 Electron E2E，含 spec 准入门禁 — `Dockerfile.desktop-e2e:19` `ZCODE_E2E_SPEC` 环境变量、`:32-33`/`:44` dbus、`:48` libgtk-3-0、`:50` libnss3、`:76` xvfb、`:96` `CMD ["bash","-lc","dbus-run-session -- pnpm --filter @zcode/desktop test:e2e …"]` 均精确命中；`scripts/test-desktop-e2e-container.sh:13` 注释「只有通过人工 review、formal promotion 和单 spec Docker admission 的插件用例才能写入」（报告写 `:14-31`，注释实际在 `:13`，preset 门禁 case 分支 `:20-47`），未获准入的 preset 直接 `exit 2`。

**复核结论**：6 条中 5 条 ✅、1 条 ⚠️、0 条 ❌。⚠️ 条目的领先点成立，仅「13 个文件」计数有误（实为 11）；另有四处 path:line 漂移（`build-zcode.mjs` 的 `stageZCodePackage`、`ssh-backend.ts` 降级段、`test-desktop-e2e-container.sh` 门禁注释、`README.md:219`→`:220`）与一处目录名笔误（`packages/zcode-cli` 应为 `packages/zcode-server-cli`，见 §2.1），均不影响领先点成立。
