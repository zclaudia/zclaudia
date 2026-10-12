# 插件前端独立 origin 隔离方案（2026-10-12）

来源：[2026-10-12-zcode-feature-reassessment.md](../reports/2026-10-12-zcode-feature-reassessment.md) §1.3。
状态：方案，未实现。决策：采用「独立 origin 提供插件前端」，不是单纯去掉 `allow-same-origin`。

## 1. 现状（均已读代码核实）

| 事实                                                                                                                                                               | 位置                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 插件面板有两处 iframe，都带 `sandbox="allow-scripts allow-same-origin allow-forms"`                                                                                | `apps/desktop/src/components/plugins/PluginPanelRenderer.tsx:139`、`PluginWindow.tsx:156` |
| 图标走 `<img src=.../frontend/...>`，不执行脚本，不在范围内                                                                                                        | `apps/desktop/src/app/PluginDock.tsx:47`                                                  |
| 面板 iframe 的 `src` = `getBrowserShellBaseUrl() ?? http://localhost:<localServerPort>` + `/api/plugins/:id/frontend/*`；浏览器壳下前者是 `window.location.origin` | `PluginPanelRenderer.tsx:163-172`、`utils/browserShellRuntime.ts:11-14`                   |
| 因此**浏览器壳下 iframe 与主应用同源**；桌面 Tauri 下 iframe 与**服务端 API 同源**、与应用不同源                                                                   | 同上                                                                                      |
| 浏览器壳只在本机监听时挂载（非本机 host 直接禁用）                                                                                                                 | `server/src/interfaces/http/browser-shell.ts:34-38`                                       |
| 宿主通过 `postMessage` 把 `serverUrl` 发给 iframe；独立窗口模式还发 `authToken`                                                                                    | `PluginPanelRenderer.tsx:100-112`、`PluginWindow.tsx:99-113`                              |
| 前端文件路由 `GET /api/plugins/:id/frontend/*` 没有 `localOnlyMiddleware`；有路径穿越检查                                                                          | `server/src/application/plugins/routes.ts:370`、`frontend-service.ts:34-40`               |
| 服务端 CORS 与 WebSocket upgrade 的 origin 校验**只比对协议和主机名，不比对端口**：`localhost` / `127.0.0.1` / `[::1]` / `tauri.localhost` 上的任意端口都放行      | `server/src/interfaces/http/trust-boundary.ts:25-65`，`server/src/server.ts:162,261`      |
| 直连 WS 的 `auth` 消息不校验凭据（见 §1.2 另一条）                                                                                                                 | `server/src/server.ts:365-370`                                                            |
| 仓库内没有自带的插件前端（`plugins/` 下只有 claude / codex / cursor / agents），第三方前端怎么调用服务端无法从本仓库确认                                           |                                                                                           |

## 2. 威胁

插件前端是第三方 HTML/JS。它在两种模式下分别能做到：

- **浏览器壳**：与主应用同源 + `allow-same-origin` + `allow-scripts`，可直接 `parent.document` 改写宿主、移除自己的 `sandbox` 属性、读主应用的 `localStorage`。沙箱形同虚设。
- **桌面**：不能碰宿主 DOM，但与服务端 API 同源，可以不经过插件权限模型（14 项权限、逐插件授予）直接调任何 `/api/*`。

即使把前端放到另一个端口，因为 CORS 与 WS 校验不比对端口，`http://localhost:<另一个端口>` 仍会被放行去读 API、连 `/ws`。所以**只换端口不够，必须同时让服务端拒绝这个 origin**。

## 3. 方案

### 3.1 独立监听器

- 服务端额外起一个只服务插件前端的 HTTP 监听器（下称 plugin-ui 监听器）：
  - 只绑 `127.0.0.1`。浏览器壳与桌面插件面板目前都只渲染本机服务端的插件前端，不需要对外。
  - 端口默认随机（`0`），可用环境变量固定。
  - 只挂 `GET /p/:pluginId/frontend/*` 与 `GET /styles/plugin-sdk.js`、`/styles/claudia-ui.css`（现有 SDK 与主题资源）。**不挂 `/api`、`/ws`、静态壳。**
  - 复用 `PluginFrontendService.resolveFrontendFile`，路径穿越检查不变。
  - 响应不设 `Access-Control-Allow-Origin`；不设 cookie。
- 端口随 `plugin_panel_registered` 的 `iframeUrl` 以**绝对 URL** 下发（现在是服务端相对路径），宿主不再拼 base。`PluginDock` 的图标 `<img>` 同样改用绝对 URL。
- 嵌入式服务端用 `PORT=0`，现有流程靠 stdout 的 `SERVER_READY:<port>` 发现端口。plugin-ui 端口不需要新的 stdout 约定，因为它通过 `iframeUrl` 下发。

### 3.2 服务端拒绝该 origin

- `isRequestOriginAllowed`（CORS 与 WS upgrade 共用）加一条：origin 等于当前 plugin-ui 监听器 origin 时一律拒绝，优先于主机名白名单。
- 这条同时堵住「任意 localhost 端口页面可连 WS 并发 `auth`」在插件前端上的利用。更一般的「localhost 任意端口都被信任」是现有信任边界设计，不在本方案范围，另记。

### 3.3 iframe 属性

- 保留 `allow-scripts allow-same-origin allow-forms`。`allow-same-origin` 现在只意味着「与 plugin-ui origin 同源」，插件自己的 `localStorage` / IndexedDB 照常可用，且不再与应用、服务端 API 同源。
- 不再需要的 `'*'` targetOrigin：宿主向 iframe 的 `postMessage` 改为精确的 plugin-ui origin；宿主收消息时校验 `event.origin` 与 `event.source`（现在 `onMessage` 只看 `event.data.type`，任何窗口都能触发 `claudia:init`）。

### 3.4 经宿主中转的 API（解决权限绕过）

插件前端不再直连 `/api/*`：

- `plugin-sdk.js` 新增 `ClaudiaSDK.request(method, path, body)`，通过 `postMessage` 交给宿主；宿主**按该插件已授予的权限**判定后再用自己的连接发请求，并回传结果。
- 宿主侧新增一张「插件前端可调用的端点白名单 + 所需权限」表，默认空，按需加。
- 现有前端若直接 `fetch(serverUrl + '/api/...')` 会因 §3.2 被 CORS 拒绝。迁移期见 §5。
- `authToken`（独立窗口模式）不再发给 iframe。

## 4. 不做的事

- 不对 `Origin: null` 放行（沙箱 iframe、`data:` 页面都会发它；放行等于让任意网页打本机 API）。
- 不给每个插件单独的 origin（子域名 `<id>.localhost` 在各 WebView 里的解析行为需要验证，见 §6）。第一版所有插件前端共享一个 plugin-ui origin，插件之间互相可见 storage；风险低于现状，但不是终态。
- 不改远程 backend 的插件前端渲染：目前渲染路径只处理本机服务端（`localServerPort` 或浏览器壳），远程 backend 的插件面板本来就不走 iframe。

## 5. 分阶段

| 阶段 | 内容                                                                                                                                      | 兼容性                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P0   | 本方案；在插件文档里写明现状风险                                                                                                          | 无变化                                                                                                                             |
| P1   | plugin-ui 监听器；`iframeUrl` 改绝对 URL；`isRequestOriginAllowed` 拒绝该 origin；宿主 `postMessage` 校验 `event.origin` / `event.source` | **破坏**直接 `fetch` 服务端 API 的第三方前端。加开关 `ZCLAUDIA_PLUGIN_UI_LEGACY_ORIGIN=1` 回退到旧行为一个版本周期，并在日志里告警 |
| P2   | `ClaudiaSDK.request` 与宿主侧权限中转、端点白名单；`authToken` 不再下发                                                                   | 提供迁移文档；SDK 版本号加 1，协议版本 `PROTOCOL_VERSION` 同步                                                                     |
| P3   | 去掉 legacy 开关；评估每插件独立 origin                                                                                                   |                                                                                                                                    |

## 6. 需要先验证 / 待定

1. **Tauri WebView 对 `*.localhost` 子域名的解析**（WKWebView、WebKitGTK、WebView2 各自行为）。决定 P3 能否做每插件 origin。
2. **`tauri.conf.json` 的 `csp` 当前为 `null`**，所以不会拦 iframe；若以后收紧，要给 `frame-src` 放行 plugin-ui origin。
3. **第三方前端的真实用法**：本仓库没有样例。P1 上线前需要一个调查：已发布的 `.zplugin` 里有没有带 `frontend` 的，它们是 `fetch` 还是只用 `postMessage`。这决定 legacy 开关要留多久。
4. **嵌入式模式下 plugin-ui 端口的生命周期**：服务端重启后端口变化，已开的 iframe 需要重载。`plugin_panel_registered` 在服务端启动时重发，宿主应在收到新 `iframeUrl` 时重建 iframe。

## 7. 测试

- `trust-boundary`：plugin-ui origin 被 CORS 与 WS upgrade 拒绝；同主机其它端口行为不变。
- plugin-ui 监听器：只响应前端路径；`/api/*`、`/ws` 返回 404；路径穿越返回 403；无 CORS 头。
- `PluginPanelRenderer` / `PluginWindow`：`src` 为绝对 plugin-ui URL；`postMessage` 的 targetOrigin 精确；忽略来自其它 `event.source` 的 `claudia:ready`。
- E2E：浏览器壳下，插件前端读 `parent.document` 抛 `SecurityError`；直接 `fetch('/api/...')` 被拒；`ClaudiaSDK.request` 对未授权权限返回拒绝。
