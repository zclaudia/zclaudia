#!/usr/bin/env bash
#
# ZClaudia Local Browser Shell service manager for Linux systemd and macOS launchd.
#
# Usage:
#   ./scripts/deploy/browser-service.sh [command]
#
# Commands:
#   install     Build and install the system service
#   start       Start the installed service
#   stop        Stop the installed service
#   restart     Restart the installed service
#   status      Show service status
#   logs        Tail service logs
#   env         Print the service environment file path
#   rebuild     Rebuild shared, server, and desktop assets
#   uninstall   Remove the installed service
#
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-zclaudia-browser}"
LABEL="${LABEL:-com.zclaudia.browser}"
DATA_DIR="${DATA_DIR:-$HOME/.zclaudia}"
ENV_FILE="${ENV_FILE:-$DATA_DIR/browser.env}"
PORT="${PORT:-3100}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_USER="${SUDO_USER:-$USER}"
COMMAND="${1:-install}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

info() { echo -e "${BLUE}>${NC} $*"; }
ok() { echo -e "${GREEN}+${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die() { echo -e "${RED}x${NC} $*" >&2; exit 1; }

usage() {
  sed -n '3,23p' "$0"
}

os_name() {
  uname -s
}

node_bin() {
  command -v node
}

node_dir() {
  dirname "$(node_bin)"
}

systemd_service_file() {
  printf '/etc/systemd/system/%s.service\n' "$SERVICE_NAME"
}

launch_agent_file() {
  printf '%s/Library/LaunchAgents/%s.plist\n' "$HOME" "$LABEL"
}

write_env_file() {
  mkdir -p "$DATA_DIR"
  {
    echo "# ZClaudia local browser shell"
    echo "PORT=$PORT"
    echo "SERVER_HOST=127.0.0.1"
    echo "NODE_ENV=production"
    echo "ZCLAUDIA_DATA_DIR=$DATA_DIR"
  } > "$ENV_FILE"
  ok "Wrote $ENV_FILE"
}

prepare_corepack() {
  local package_manager
  package_manager="$(node -e 'console.log(require(process.argv[1]).packageManager)' "$PROJECT_ROOT/package.json")"
  corepack enable
  corepack prepare "$package_manager" --activate
}

build_project() {
  info "Building shared, server, and desktop packages..."
  cd "$PROJECT_ROOT"
  prepare_corepack
  corepack pnpm --filter @zclaudia/shared run build
  corepack pnpm --filter @zclaudia/server run build
  corepack pnpm --filter @zclaudia/desktop run build
  ok "Build complete"
}

install_linux() {
  local service_file
  service_file="$(systemd_service_file)"

  write_env_file
  build_project

  info "Installing systemd service: $SERVICE_NAME"
  local unit
  unit="$(node --input-type=module -e "
    import { renderSystemdUnit } from './scripts/deploy/browser-service-lib.mjs';
    process.stdout.write(renderSystemdUnit({
      serviceName: process.argv[1],
      user: process.argv[2],
      repoRoot: process.argv[3],
      nodeBin: process.argv[4],
      nodeDir: process.argv[5],
      envFile: process.argv[6],
      dataDir: process.argv[7],
    }));
  " "$SERVICE_NAME" "$SERVICE_USER" "$PROJECT_ROOT" "$(node_bin)" "$(node_dir)" "$ENV_FILE" "$DATA_DIR")"

  if [[ $EUID -ne 0 ]]; then
    echo "$unit" | sudo tee "$service_file" > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
  else
    echo "$unit" > "$service_file"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
  fi

  ok "Installed $service_file"
}

install_macos() {
  local launch_file
  local log_dir
  launch_file="$(launch_agent_file)"
  log_dir="$HOME/Library/Logs/zclaudia"

  write_env_file
  build_project
  mkdir -p "$(dirname "$launch_file")" "$log_dir"

  info "Installing launch agent: $LABEL"
  node "$PROJECT_ROOT/scripts/deploy/render-launch-agent.mjs" \
    "$LABEL" \
    "$PROJECT_ROOT" \
    "$(node_bin)" \
    "$DATA_DIR" \
    "$log_dir" \
    "$PORT" > "$launch_file"

  launchctl unload "$launch_file" >/dev/null 2>&1 || true
  launchctl load "$launch_file"
  ok "Installed $launch_file"
}

cmd_install() {
  case "$(os_name)" in
    Linux) install_linux ;;
    Darwin) install_macos ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

cmd_start() {
  case "$(os_name)" in
    Linux) sudo systemctl start "$SERVICE_NAME" ;;
    Darwin) launchctl start "$LABEL" ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

cmd_stop() {
  case "$(os_name)" in
    Linux) sudo systemctl stop "$SERVICE_NAME" ;;
    Darwin) launchctl stop "$LABEL" ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

cmd_restart() {
  case "$(os_name)" in
    Linux)
      sudo systemctl restart "$SERVICE_NAME"
      ;;
    Darwin)
      launchctl stop "$LABEL" >/dev/null 2>&1 || true
      launchctl start "$LABEL"
      ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

cmd_status() {
  case "$(os_name)" in
    Linux) systemctl --no-pager status "$SERVICE_NAME" ;;
    Darwin) launchctl list "$LABEL" ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

cmd_logs() {
  case "$(os_name)" in
    Linux)
      journalctl -u "$SERVICE_NAME" -f
      ;;
    Darwin)
      mkdir -p "$HOME/Library/Logs/zclaudia"
      tail -f "$HOME/Library/Logs/zclaudia/browser.out.log" "$HOME/Library/Logs/zclaudia/browser.err.log"
      ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

cmd_env() {
  write_env_file
  echo "$ENV_FILE"
}

cmd_uninstall() {
  case "$(os_name)" in
    Linux)
      sudo systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
      sudo systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
      sudo rm -f "$(systemd_service_file)"
      sudo systemctl daemon-reload
      ok "Uninstalled $SERVICE_NAME"
      ;;
    Darwin)
      local launch_file
      launch_file="$(launch_agent_file)"
      launchctl unload "$launch_file" >/dev/null 2>&1 || true
      rm -f "$launch_file"
      ok "Uninstalled $LABEL"
      ;;
    *) die "Unsupported OS: $(os_name)" ;;
  esac
}

case "$COMMAND" in
  install) cmd_install ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  env) cmd_env ;;
  rebuild) build_project ;;
  uninstall) cmd_uninstall ;;
  -h|--help|help) usage ;;
  *)
    usage
    die "Unknown command: $COMMAND"
    ;;
esac
