#!/usr/bin/env bash
#
# ZClaudia Server — one-command deploy for remote backends
#
# Usage:
#   git pull && ./scripts/deploy/server.sh
#   ./scripts/deploy/server.sh --service zclaudia-server-dev --data-dir ~/.zclaudia-dev
#
# What it does:
#   1. pnpm install (if lockfile changed)
#   2. Build shared → server
#   3. Create / update systemd service
#   4. Restart the service
#
set -euo pipefail

# Defaults
SERVICE_NAME="zclaudia-server"
DATA_DIR="$HOME/.zclaudia"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    -s|--service)  SERVICE_NAME="$2"; shift 2 ;;
    -d|--data-dir) DATA_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [-s|--service NAME] [-d|--data-dir DIR]"
      echo "  -s, --service   Systemd service name (default: zclaudia-server)"
      echo "  -d, --data-dir  Data directory (default: ~/.zclaudia)"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$DATA_DIR/.env"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PACKAGE_MANAGER=""

VERSION_FILE="$DATA_DIR/.version"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[0;33m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

info "Service: $SERVICE_NAME | Data: $DATA_DIR"
echo ""

# ── Version check ────────────────────────────────────────────
mkdir -p "$DATA_DIR"
NEW_VERSION="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
NEW_SUBJECT="$(git -C "$PROJECT_ROOT" log -1 --format='%s' 2>/dev/null || echo "")"
OLD_VERSION=""
if [[ -f "$VERSION_FILE" ]]; then
  OLD_VERSION="$(cat "$VERSION_FILE")"
fi

if [[ -n "$OLD_VERSION" && "$OLD_VERSION" != "$NEW_VERSION" ]]; then
  echo -e "${YELLOW}▸ Upgrading: ${OLD_VERSION} → ${NEW_VERSION}${NC} (${NEW_SUBJECT})"
elif [[ -n "$OLD_VERSION" ]]; then
  echo -e "${YELLOW}▸ Redeploying: ${NEW_VERSION}${NC} (no version change)"
else
  echo -e "${YELLOW}▸ First deploy: ${NEW_VERSION}${NC} (${NEW_SUBJECT})"
fi
echo ""

# ── Resolve paths ─────────────────────────────────────────────
NODE_BIN="$(command -v node 2>/dev/null)" || die "node not found"
NODE_DIR="$(dirname "$NODE_BIN")"
PACKAGE_MANAGER="$(node -e 'console.log(require(process.argv[1]).packageManager)' "$PROJECT_ROOT/package.json")"
corepack enable
corepack prepare "$PACKAGE_MANAGER" --activate

# ── 1. Install deps ──────────────────────────────────────────
info "Installing dependencies..."
cd "$PROJECT_ROOT"
if ! corepack pnpm install --frozen-lockfile; then
  if [[ "${ZCLAUDIA_DEPLOY_REPAIR_INSTALL:-0}" == "1" ]]; then
    echo -e "${YELLOW}▸ Frozen install failed; running mutable install because ZCLAUDIA_DEPLOY_REPAIR_INSTALL=1${NC}"
    corepack pnpm install
  else
    die "Frozen install failed. Fix pnpm-lock.yaml or rerun with ZCLAUDIA_DEPLOY_REPAIR_INSTALL=1 to repair dependencies."
  fi
fi
ok "Dependencies installed"

# ── 2. Build ──────────────────────────────────────────────────
info "Building shared..."
corepack pnpm --filter @zclaudia/shared run build
info "Building server..."
corepack pnpm --filter @zclaudia/server run build
ok "Build complete"

# ── 3. Ensure ~/.zclaudia/.env ──────────────────────────────
mkdir -p "$DATA_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating default $ENV_FILE"
  cat > "$ENV_FILE" <<'EOF'
PORT=3100
SERVER_HOST=0.0.0.0
# GATEWAY_URL=wss://your-gateway
# GATEWAY_SECRET=
# GATEWAY_NAME=
EOF
  ok "Created $ENV_FILE — edit if needed"
fi

# ── 4. Create / update systemd unit ─────────────────────────
info "Writing systemd service..."

UNIT="[Unit]
Description=ZClaudia Server ($SERVICE_NAME)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_ROOT
EnvironmentFile=$ENV_FILE
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=ZCLAUDIA_DATA_DIR=$DATA_DIR
ExecStart=$NODE_BIN $PROJECT_ROOT/server/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"

echo "$UNIT" | sudo tee "$SERVICE_FILE" > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" --quiet 2>/dev/null
ok "Systemd unit updated"

# ── 5. Restart ────────────────────────────────────────────────
info "Restarting service..."
sudo systemctl restart "$SERVICE_NAME"
ok "Service restarted"

# ── 6. Save version ──────────────────────────────────────────
echo "$NEW_VERSION" > "$VERSION_FILE"

# ── Status ────────────────────────────────────────────────────
echo ""
systemctl --no-pager status "$SERVICE_NAME" --lines=5 || true
echo ""
ok "Deploy complete (${NEW_VERSION}). Logs: journalctl -u $SERVICE_NAME -f"
