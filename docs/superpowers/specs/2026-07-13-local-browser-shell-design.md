# Local Browser Shell for Server-Only Mode

**Date:** 2026-07-13
**Status:** Approved, ready for implementation plan

## Problem

ZClaudia can run its backend without the desktop app, but a user who cannot or does not
want to install the Tauri app still needs a UI. Today the backend exposes HTTP APIs and
WebSocket endpoints, while the React UI normally runs through Tauri or a separate Vite
dev server. Opening `http://127.0.0.1:3100` in a browser does not provide the app shell.

The desired case is intentionally local-only: run the backend on the same machine and
open it from that machine's browser with `127.0.0.1`. This is not a LAN or public remote
access feature.

## Goal

Add a browser-accessible shell for server-only mode:

- User runs the server locally.
- User opens `http://127.0.0.1:<PORT>` in a browser.
- The backend serves the built React app.
- The React app talks back to the same origin for REST and WebSocket traffic.
- No authentication is added for this mode because the server remains bound to localhost.
- Linux and macOS can run the local browser shell as a background service.

## Non-goals

- No LAN access via `192.168.x.x` or `0.0.0.0`.
- No gateway dependency.
- No new auth, pairing code, login screen, or token system.
- No redesign of the desktop UI.
- No requirement that browser mode support Tauri-only native affordances.
- No Windows service support in the first implementation.

## Recommended approach

Use a single-process local web mode: the Node server serves both API/WebSocket traffic and
the built frontend assets.

```
pnpm build
pnpm --filter @zclaudia/server run start

open http://127.0.0.1:3100
```

The server remains the control plane. The browser UI becomes a thin shell loaded from the
same origin, so CORS and origin handling stay simple. Frontend code should resolve its
backend URL from `window.location` when running outside Tauri.

## Server behavior

### Binding

Keep current safe binding semantics and make service deployment honor them:

- Default host: `127.0.0.1`.
- `ZCLAUDIA_ALLOW_LAN=1` remains the separate opt-in path for LAN binding, but this
  feature does not rely on it.
- Local browser shell service templates must write `SERVER_HOST=127.0.0.1`, not
  `0.0.0.0`.

The docs should be corrected where they still say the server defaults to `0.0.0.0`; the
current implementation defaults to `127.0.0.1` unless LAN access is explicitly enabled.
Existing deploy scripts that create `SERVER_HOST=0.0.0.0` should either be split into a
remote-backend path and a local-browser path, or changed so local-browser install commands
generate the localhost-only env.

### Static asset serving

After API and WebSocket setup, Express serves the built desktop assets:

- Static directory: the built output from `apps/desktop`, normally `apps/desktop/dist`.
- `GET /assets/*`, favicon files, and other static files are served directly.
- Browser routes fall back to `index.html`.
- API routes and WebSocket upgrade paths are never swallowed by the fallback.

The fallback should be registered after existing API routes and before the final Express
error handler, or through a dedicated static-web setup step that preserves the same order.

The server should not require static assets during development server-only runs. If the
asset directory is missing, API-only startup should still work and log a concise message
that browser shell assets are unavailable until the frontend is built.

## Service deployment

Service support is part of the local browser shell, but it remains localhost-only. The
service manager starts the same server binary used by manual startup; it does not add a
second web server, reverse proxy, gateway, or authentication layer.

### Common service contract

Both Linux and macOS service installers should:

- install dependencies with the pinned package manager;
- build `shared`, `server`, and `apps/desktop` so the browser shell assets exist;
- create or preserve a local env file;
- set `PORT=3100` by default;
- set `SERVER_HOST=127.0.0.1` by default;
- set `NODE_ENV=production`;
- set `ZCLAUDIA_DATA_DIR` to the user's local data directory;
- start `server/dist/index.js`;
- provide `start`, `stop`, `restart`, `status`, `logs`, `env`, `rebuild`, and
  `uninstall` commands where the platform supports them cleanly.

The user-facing address after install is always:

```text
http://127.0.0.1:3100
```

### Linux: systemd

Keep the existing systemd strategy, but adjust it for local browser shell use:

- install a user-owned service such as `zclaudia-browser.service`;
- keep `WorkingDirectory` at the repository root;
- use an env file under the data directory or project root;
- write `SERVER_HOST=127.0.0.1`;
- include the desktop build in the rebuild/install path;
- keep journal logs available via `journalctl -u <service> -f`.

The existing `scripts/deploy/setup-server.sh` and `scripts/deploy/server.sh` are close,
but currently write `SERVER_HOST=0.0.0.0` and only build `shared` + `server`. The browser
shell implementation should either update those defaults for the local-browser command or
add a separate script to avoid changing remote-backend behavior unexpectedly.

### macOS: launchd

Add a user LaunchAgent installer. It should run as the logged-in user rather than a
system daemon, because ZClaudia data and provider credentials live in the user's home
directory.

Suggested LaunchAgent shape:

- label: `com.zclaudia.browser`;
- plist path: `~/Library/LaunchAgents/com.zclaudia.browser.plist`;
- working directory: repository root;
- program: the absolute `node` binary path;
- arguments: `server/dist/index.js`;
- env: `PORT=3100`, `SERVER_HOST=127.0.0.1`, `NODE_ENV=production`,
  `ZCLAUDIA_DATA_DIR=$HOME/.zclaudia`;
- stdout/stderr logs under `~/Library/Logs/zclaudia/`;
- `RunAtLoad=true`;
- `KeepAlive=true`.

Installer commands should wrap `launchctl bootstrap`, `bootout`, `kickstart`, and
`print` so users do not need to manage plist details manually.

## Frontend runtime behavior

### Environment detection

Add a small browser runtime resolver instead of scattering conditionals:

- Tauri/embedded desktop: keep existing `localServerPort` and embedded facade behavior.
- Browser-served local shell: if not running in Tauri and `window.location.protocol` is
  `http:` or `https:`, use the current page origin.
- Gateway/mobile direct mode remains unchanged.

Suggested helper shape:

```ts
getBrowserShellBaseUrl(): string | null
getBrowserShellFacadeWsUrl(): string | null
```

The exact names can follow existing utility conventions.

### REST base URL

When browser shell mode is active:

```ts
baseUrl = window.location.origin
```

So `fetchApi('/api/...')` calls the same server that served the page.

### WebSocket URL

When browser shell mode is active:

```ts
wsUrl =
  window.location.protocol === 'https:'
    ? `wss://${window.location.host}/ws/backend-facade`
    : `ws://${window.location.host}/ws/backend-facade`
```

This mirrors the embedded desktop facade path, but uses the browser page host instead of
hardcoded `localhost:${localServerPort}`.

### Localhost hardcoding cleanup

Several frontend paths currently assume `http://localhost:${localServerPort || 3100}` or
`ws://localhost:${serverPort}`. Browser shell support should centralize those decisions
so each feature does not invent its own base URL.

Key areas to check:

- `apps/desktop/src/services/api/base.ts`
- `apps/desktop/src/facade/embedded-facade-client.ts`
- `apps/desktop/src/services/gatewayProxy.ts`
- plugin panel iframe URL builders
- hooks/components that read `localServerPort` directly for HTTP URLs

The intended outcome is not a large rewrite. Add a shared resolver and move existing
callers over only where browser mode would otherwise connect to the wrong host.

## Unsupported or degraded browser features

The browser shell should load the main app and support normal backend-backed workflows.
Any feature that depends on Tauri-native APIs should degrade gracefully:

- no Tauri shell plugin spawning from the browser;
- no desktop window controls;
- no native tray/update integration;
- no OS-level app window assumptions.

Existing code already gates many Tauri paths through platform/runtime checks. The
implementation should verify the browser shell does not call Tauri APIs during startup.

## Error handling

- Missing static assets: server logs a clear "browser shell not built" message, continues
  serving API/WebSocket.
- Failed WebSocket connection: the existing connection state UI should show disconnected;
  no special browser-only modal is needed.
- Browser refresh/deep link: fallback to `index.html` should preserve client-side routes.
- Static file miss under `/assets`: return normal 404, not `index.html`, so broken asset
  paths are visible during debugging.

## Testing

### Server tests

- Static assets are served when the desktop build directory exists.
- Browser route fallback returns `index.html`.
- API routes still win over static fallback.
- Missing static directory does not prevent server startup.

### Service script tests

- Linux env template uses `SERVER_HOST=127.0.0.1`.
- Linux install/rebuild path builds the desktop assets as well as shared/server.
- macOS LaunchAgent plist renders with localhost binding and the expected data/log paths.
- Service commands do not mutate unrelated remote gateway configuration.

### Frontend unit tests

- Browser shell resolver returns `window.location.origin` for HTTP base URL.
- Browser shell resolver returns `ws://host/ws/backend-facade` or
  `wss://host/ws/backend-facade` based on page protocol.
- Existing embedded desktop behavior still returns localhost + `localServerPort`.
- `getBaseUrlForBackend` uses current origin in browser shell mode.

### Smoke test

Run the built server locally and use Playwright against `http://127.0.0.1:3100`:

- app shell loads;
- initial facade WebSocket connects;
- a lightweight API-backed view can fetch data;
- no startup console error from missing Tauri APIs.

## Rollout

Ship as a local-only server feature. The first implementation can expose it implicitly:
if `apps/desktop/dist` exists, the server serves it. Documentation should make the entry
point explicit:

```bash
pnpm build
pnpm --filter @zclaudia/server run start
# open http://127.0.0.1:3100
```

Add platform service wrappers after the core browser shell works:

- Linux: systemd installer/start/stop/status/logs.
- macOS: launchd installer/start/stop/status/logs.

If packaging needs a clearer command, add convenience scripts such as
`pnpm browser:start` and `pnpm browser:install-service`, but the core runtime remains the
same server process bound to `127.0.0.1`.
