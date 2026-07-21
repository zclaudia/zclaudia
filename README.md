# ZClaudia

A cross-platform desktop and gateway shell for a zclaudia-owned coding agent, built with Tauri + React.

## Features

- **ZClaudia Agent Runtime**: Uses an internal agent runtime boundary, ready for future pi-agent integration
- **Cross-Platform**: Desktop (macOS/Windows/Linux) and mobile web
- **Project Management**: Organize conversations by project
- **Supervision**: AI-powered project orchestration and task management
- **Local-First**: All data stored locally with SQLite

## Getting Started

### Prerequisites

- Node.js 22.19+ (project pins 22.20.0 via `.node-version`)
- pnpm 9+
- Rust (latest stable)
- For desktop build: Xcode (macOS) or Visual Studio (Windows)

### Development

```bash
# Install dependencies
pnpm install

# Start Tauri dev mode (default)
pnpm dev

# Or start standalone mode (frontend + backend separately)
pnpm --filter @zclaudia/server run dev  # Backend
pnpm --filter @zclaudia/desktop run dev # Frontend
```

### Local Browser Mode

Use this when you want the backend to serve the built UI directly on the same machine, without installing the desktop app.

```bash
pnpm browser:build
pnpm browser:start
```

Open `http://127.0.0.1:3100` in your browser. The service binds to `127.0.0.1` by default.

On Linux or macOS, install it as a user-facing service:

```bash
pnpm browser:service install
pnpm browser:service start
pnpm browser:service logs
pnpm browser:service uninstall
```

### Build

```bash
# Build macOS app
bash scripts/build/macos.sh

# Build Windows app
bash scripts/build/windows.ps1

# Build Linux app
bash scripts/build/linux.sh
```

## Architecture

```
zclaudia/
├── apps/desktop/     # Tauri desktop app (React + TypeScript)
├── server/           # Backend server (Node.js + TypeScript)
├── shared/           # Shared types
├── e2e/              # End-to-end tests (Vitest + Playwright)
└── scripts/          # Build, deploy, and dev tooling

../zclaudia-gateway/  # WebSocket relay for remote access
../zclaudia-plugins/  # Official Claude, Codex, and Cursor agent plugins
```

`@zclaudia/protocol` is consumed from npm. ZClaudia uses the package's
`/zclaudia` models internally and adapts them to the neutral `/gateway`
resource, stream, and notification envelopes before sending them through
`../zclaudia-gateway/`.

Official agent runtime plugins are maintained in
[zclaudia/zclaudia-plugins](https://github.com/zclaudia/zclaudia-plugins). Install a release
`.zplugin` from **Plugins → Install plugin**. ZClaudia validates the archive before installing it,
keeps previous managed versions for rollback, and leaves a newly selected version inactive until
you enable it. For local development, build that repository and add an `agents/<name>` package
through **Development directories** instead.

Additional architecture notes:

- [Runtime Event Model](docs/runtime-events.md)
- [Plugin Package Installation](docs/plugin-packages.md)

## License

MIT
