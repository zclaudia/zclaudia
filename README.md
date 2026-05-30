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
```

`@zclaudia/protocol` is consumed from npm. ZClaudia uses the package's
`/zclaudia` models internally and adapts them to the neutral `/gateway`
resource, stream, and notification envelopes before sending them through
`../zclaudia-gateway/`.

## License

MIT
