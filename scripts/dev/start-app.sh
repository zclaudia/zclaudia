#!/usr/bin/env bash
#
# ZClaudia App — start dev app (Tauri or Standalone mode)
#
# Usage:
#   ./scripts/dev/start-app.sh [tauri|desktop|standalone|server]
#
# Default: Tauri dev mode
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
warn() { echo -e "\033[0;33m!\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

# --- Source .env files (auto-export). Order: most general first, most specific last (later wins). ---
source_env() {
  local file=$1
  if [[ -f "$file" ]]; then
    info "Loading env from $(basename "$file")"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

source_env "$PROJECT_ROOT/.env"
source_env "$PROJECT_ROOT/.env.local"

# --- Soft warning for missing provider key (server starts fine but pi-agent will error on first message) ---
if [[ -n "${OPENAI_BASE_URL:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  warn "OPENAI_BASE_URL set but OPENAI_API_KEY is empty — pi-agent will reject the first message."
elif [[ "${PI_PROVIDER:-anthropic}" == "anthropic" && -z "${ANTHROPIC_API_KEY:-}" && -z "${OPENAI_BASE_URL:-}" ]]; then
  warn "ANTHROPIC_API_KEY not set — pi-agent will reject the first message. Add it to .env or .env.local."
fi

# --- Banner: show pi-agent config (only the keys that matter) ---
info "pi-agent config:"
ok "  PI_PROVIDER:     ${PI_PROVIDER:-anthropic (default)}"
ok "  PI_MODEL:        ${PI_MODEL:-claude-sonnet-4-6 (default)}"
if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
  ok "  OPENAI_BASE_URL: ${OPENAI_BASE_URL}"
fi

# Ensure fnm is available and uses the project's .node-version
setup_node() {
  eval "$(fnm env --use-on-cd)" 2>/dev/null || die "fnm not found. Install fnm first."
  fnm use --silent-if-unchanged 2>/dev/null || true
}

# Determine mode from argument
MODE="tauri"
ARG="${1:-}"
case "$ARG" in
  standalone|server) MODE="standalone" ;;
  tauri|desktop|"") MODE="tauri" ;;
  *) die "Unknown mode: $ARG. Use: tauri, desktop, standalone, or server" ;;
esac

info "Mode: $MODE"

# --- Kill stale processes ---
kill_stale() {
  info "Stopping stale dev processes..."
  pgrep -f "tauri.dev.conf.json" | xargs -r kill 2>/dev/null || true
  pgrep -f "target/debug/zclaudia" | xargs -r kill 2>/dev/null || true
  pkill -f "server/dist/index.js" 2>/dev/null || true
  pkill -f "binaries/node.*server/dist/index.js" 2>/dev/null || true
  pkill -f "tsx watch src/index.ts" 2>/dev/null || true
  lsof -ti:1420 | xargs -r kill 2>/dev/null || true
  lsof -ti:3100 | xargs -r kill 2>/dev/null || true
}

# --- Wait for port to be free ---
wait_port_free() {
  local port=$1
  for i in $(seq 1 5); do
    if ! lsof -ti:"$port" >/dev/null 2>&1; then
      return 0
    fi
    info "Port $port still in use, waiting... ($i/5)"
    sleep 1
  done
  # Force kill
  local pid
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    warn "Force killing PID $pid on port $port"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  if lsof -ti:"$port" >/dev/null 2>&1; then
    die "Port $port is still occupied after force kill"
  fi
}

# --- Wait for URL to respond ---
wait_for_url() {
  local url=$1
  local timeout=$2
  local label=$3
  for i in $(seq 1 "$timeout"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      ok "$label is ready"
      return 0
    fi
    sleep 1
  done
  die "$label did not become ready at $url within ${timeout}s"
}

# --- Ensure better-sqlite3 matches the project Node that runs the dev server ---
# Both dev modes run the server under the fnm project Node (.node-version), NOT
# the Tauri sidecar: tauri mode pre-launches `node server/dist/index.js` and
# standalone mode uses `tsx watch`. If better-sqlite3 was built under a different
# Node (e.g. a bare shell on a newer Homebrew Node), its native ABI won't load
# and the server dies on startup with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION
# mismatch. Detect that against the project Node and rebuild so this script is
# self-healing — no need to run scripts/with-project-node.sh by hand.
# Precondition: setup_node has already selected the project Node on PATH.
ensure_native_modules() {
  if (cd "$PROJECT_ROOT" && node -e "require('better-sqlite3')") >/dev/null 2>&1; then
    return 0
  fi
  warn "better-sqlite3 native ABI does not match project Node ($(node --version)); rebuilding..."
  (cd "$PROJECT_ROOT" && pnpm rebuild better-sqlite3)
  if (cd "$PROJECT_ROOT" && node -e "require('better-sqlite3')") >/dev/null 2>&1; then
    ok "Native modules rebuilt for project Node ($(node --version))"
  else
    die "better-sqlite3 still fails to load under project Node after rebuild. Try: rm -rf node_modules && bash scripts/with-project-node.sh pnpm install"
  fi
}

# --- Install deps + build shared + server ---
build() {
  setup_node

  info "Installing dependencies..."
  (cd "$PROJECT_ROOT" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
  ok "Dependencies ready"

  ensure_native_modules

  info "Building shared..."
  (cd "$PROJECT_ROOT/shared" && setup_node && pnpm build)
  ok "Shared built"

  info "Building server..."
  (cd "$PROJECT_ROOT/server" && setup_node && pnpm build)
  ok "Server built"
}

# ============================================================
# Shared cleanup — always kill port 3100 on exit
# ============================================================
TAURI_PID=""
SERVER_PID=""
FRONTEND_PID=""

cleanup() {
  info "Cleaning up..."
  # Kill tracked child processes
  [[ -n "$TAURI_PID" ]]    && kill "$TAURI_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]]   && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  # Wait for children to exit gracefully (1s)
  sleep 1
  # Port-level fallback: kill anything still on 3100 and 1420
  lsof -ti:3100 | xargs -r kill 2>/dev/null || true
  lsof -ti:1420 | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
  ok "Dev processes stopped"
}

trap cleanup EXIT INT TERM

# ============================================================
# Tauri dev mode
# ============================================================
start_tauri() {
  kill_stale

  wait_port_free 1420
  wait_port_free 3100

  build

  # Pre-start the server so the Tauri app reuses it via health check,
  # bypassing the sidecar native module check entirely.
  info "Starting server (pre-launch)..."
  (
    cd "$PROJECT_ROOT"
    setup_node
    ZCLAUDIA_DATA_DIR=/tmp/zclaudia-dev/ \
    ZCLAUDIA_CHANNEL=dev \
    PORT=3100 \
    SERVER_HOST=127.0.0.1 \
    node server/dist/index.js
  ) &
  SERVER_PID=$!

  wait_for_url "http://127.0.0.1:3100/health" 15 "Backend"

  info "Starting Tauri dev..."
  cd "$PROJECT_ROOT/apps/desktop"
  setup_node
  # Run in foreground (not exec) so trap cleanup fires on exit
  pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json &
  TAURI_PID=$!
  wait "$TAURI_PID" || true
}

# ============================================================
# Standalone mode (separate server + vite)
# ============================================================
start_standalone() {
  kill_stale

  wait_port_free 3100
  wait_port_free 1420

  build

  info "Starting server (tsx watch)..."
  (cd "$PROJECT_ROOT/server" && setup_node && npx tsx watch src/index.ts) &
  SERVER_PID=$!

  info "Starting frontend (vite)..."
  (cd "$PROJECT_ROOT/apps/desktop" && setup_node && VITE_LOCAL_SERVER_PORT=3100 pnpm dev) &
  FRONTEND_PID=$!

  wait_for_url "http://localhost:3100/api/sessions" 20 "Backend"
  wait_for_url "http://localhost:1420" 20 "Frontend"

  ok "Standalone mode ready — backend :3100, frontend :1420"
  ok "Press Ctrl+C to stop"

  wait
}

# --- Main ---
case "$MODE" in
  tauri)       start_tauri ;;
  standalone)  start_standalone ;;
esac
