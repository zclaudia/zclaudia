# ZClaudia

Cross-platform shell for a zclaudia-owned coding agent (desktop + mobile).

## Project Structure

```
zclaudia/
├── shared/          # Shared app/domain types
├── server/          # Backend server (Express + WebSocket + zclaudia agent runtime)
├── apps/desktop/    # Tauri v2 desktop + mobile app (React + Vite)
├── scripts/         # Deploy & build scripts
└── e2e/             # End-to-end tests (Vitest)

../zclaudia-gateway/  # Gateway relay service (Express + WebSocket + SQLite)
```

- pnpm workspace for the main app packages
- `@zclaudia/protocol` is consumed from npm
- Build order: **shared** first, then server/desktop. Gateway builds independently from `../zclaudia-gateway/`.

## Key Ports & Environment Variables

| Service  | Default Port | Port Env                         | Notes                                                                                            |
| -------- | ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Server   | 3100         | `PORT` (supports `0` for random) | `SERVER_HOST` defaults to `127.0.0.1`; use `ZCLAUDIA_ALLOW_LAN=1` only for explicit LAN exposure |
| Gateway  | 3200         | `GATEWAY_PORT`                   |                                                                                                  |
| Vite dev | 1420         | -                                | hardcoded, `strictPort: true`                                                                    |

| Env Var             | Used By         | Purpose                                           |
| ------------------- | --------------- | ------------------------------------------------- |
| `ZCLAUDIA_DATA_DIR` | server, gateway | Override data directory (default: `~/.zclaudia/`) |
| `GATEWAY_URL`       | server          | WebSocket URL to connect to gateway               |
| `GATEWAY_SECRET`    | server, gateway | Shared secret for gateway auth                    |
| `GATEWAY_NAME`      | server          | Backend display name on gateway                   |

## Server (`server/`)

- Entry: `server/src/index.ts`
- Express HTTP + WebSocket on same port
- Runs through the internal zclaudia agent runtime boundary; the initial runtime is a stub until pi-agent is integrated
- SQLite database: `~/.zclaudia/data.db` (or `$ZCLAUDIA_DATA_DIR/data.db`)
  - Upgrading across schema migration 003 (LLM profile models): `rm ~/.zclaudia/data.db` once before next start — the `agent_profiles.context_window` column is dropped and the override moves to `llm_profile.models[*].contextWindow`.
  - Upgrading across migration 030 (orchestration model): `rm ~/.zclaudia/data.db` once before next start — the run tables are rebuilt and triggers move from workflows into the new `automations` table.
- File storage: `~/.zclaudia/files/`
- Gateway client (`server/src/gateway-client.ts`): connects to gateway, registers as backend, infinite reconnect with exponential backoff (5s base, 60s cap)
- `PORT=0` support: outputs `SERVER_READY:<port>` to stdout for parent process discovery

## Gateway (`../zclaudia-gateway/`)

- Entry: `../zclaudia-gateway/src/index.ts` → `../zclaudia-gateway/src/server.ts`
- Relay/proxy between backends and clients over WebSocket
- Backends register with gateway secret + device ID
- Clients authenticate, discover backends, send/receive messages through gateway
- HTTP proxy: REST requests proxied over WebSocket (for NAT traversal)
- SQLite storage: `~/.zclaudia/gateway/gateway.db` (or `$ZCLAUDIA_DATA_DIR/gateway/gateway.db`) — device-to-backend ID mappings (persistent 8-char hex IDs)
- Health endpoint: `GET /health`
- Protocol package: npm `@zclaudia/protocol`

### Docker Deployment

- Dockerfile: `../zclaudia-gateway/Dockerfile` (multi-stage, node:22.14.0-slim, no build tools needed — better-sqlite3 uses prebuilt binaries)
- docker-compose: `../zclaudia-gateway/docker-compose.yml`
- `GATEWAY_PORT` variable used in port mapping, container env, and healthcheck
- No hardcoded `container_name` — multiple instances possible via `-p PROJECT_NAME`
- Deploy script: `scripts/deploy/gateway.sh [-p PROJECT] [-e ENV_FILE]`

## Desktop App (`apps/desktop/`)

- Tauri v2 + React + Vite, identifier: `com.zclaudia.desktop`
- State management: Zustand stores in `src/stores/`
- Embedded server (`src/hooks/useEmbeddedServer.ts`):
  - Desktop only (not Android) — spawns Node.js server via Tauri shell plugin
  - Random port via `PORT=0`, parses `SERVER_READY:<port>` from stdout
  - Data dir: `appDataDir()`, dev mode appends `-dev/` for isolation
- Connection: `src/hooks/useMultiServerSocket.ts` manages WebSocket connections
- Server store: `src/stores/serverStore.ts` — local server ID is `'local'`

## Scripts

| Script                                   | Purpose                                                   |
| ---------------------------------------- | --------------------------------------------------------- |
| `scripts/deploy/gateway.sh`              | Deploy gateway Docker container (supports multi-instance) |
| `scripts/deploy/server.sh`               | Deploy server on remote host (systemd)                    |
| `scripts/deploy/setup-server.sh`         | Initial server setup + systemd service install            |
| `pnpm browser:build`                     | Build shared, server, and browser shell assets            |
| `pnpm browser:start`                     | Start local browser shell backend on `127.0.0.1:3100`     |
| `pnpm browser:service install`           | Install local browser shell service via systemd/launchd   |
| `scripts/build/{android,linux,macos}.sh` | Platform-specific builds                                  |
| `scripts/release/version-bump.sh`        | Version management                                        |

## Dev Commands

```bash
pnpm dev                    # Run all packages in dev mode
pnpm server:dev             # Server only (port 3100)
pnpm server:dev:isolated    # Server with random port + isolated data dir
pnpm gateway:dev            # Gateway only (port 3200)
pnpm desktop:dev            # Desktop app only (Vite port 1420)
pnpm browser:build          # Build browser shell assets
pnpm browser:start          # Serve browser shell at http://127.0.0.1:3100
pnpm browser:service install # Install systemd/launchd local browser service
pnpm test                   # Run all tests
pnpm test:e2e               # End-to-end tests
```

## UI Conventions

Chrome styling rules (color/font/icon/row/accent disciplines): see `docs/ui-conventions.md`. New panels and sidebar/composer/header changes must follow it.
