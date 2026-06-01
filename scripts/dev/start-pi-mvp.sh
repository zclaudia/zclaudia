#!/usr/bin/env bash
#
# ZClaudia App — start dev app preconfigured for the pi-MVP test environment.
#
# Loads .env / .env.local / .env.pi (in that order, later wins), validates the
# required provider API key, prints a config banner + manual verification
# checklist, then delegates to scripts/dev/start-app.sh standalone.
#
# Usage:
#   ./scripts/dev/start-pi-mvp.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

info() { echo -e "\033[0;34m>\033[0m $*"; }
ok()   { echo -e "\033[0;32m+\033[0m $*"; }
warn() { echo -e "\033[0;33m!\033[0m $*"; }
die()  { echo -e "\033[0;31mx\033[0m $*" >&2; exit 1; }

# --- Source .env files (auto-export) ---
source_env() {
  local file=$1
  if [[ -f "$file" ]]; then
    info "Loading env from $file"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

source_env "$PROJECT_ROOT/.env.pi"
source_env "$PROJECT_ROOT/.env.local"
source_env "$PROJECT_ROOT/.env"

# --- Validate provider key availability ---
if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    die "OPENAI_BASE_URL is set but OPENAI_API_KEY is empty. Add it to .env."
  fi
elif [[ "${PI_PROVIDER:-}" == "openai" ]]; then
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    die "PI_PROVIDER=openai but OPENAI_API_KEY is empty. Add it to .env."
  fi
else
  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    die "Default provider is anthropic but ANTHROPIC_API_KEY is empty. Add it to .env."
  fi
fi

# --- Isolation defaults (export so subprocesses see them) ---
export ZCLAUDIA_DATA_DIR="${ZCLAUDIA_DATA_DIR:-/tmp/zclaudia-pi-mvp/}"
export ZCLAUDIA_CHANNEL="${ZCLAUDIA_CHANNEL:-pi-mvp}"

# --- Banner ---
info "pi-MVP test environment ready:"
ok "  PI_PROVIDER:       ${PI_PROVIDER:-anthropic (default)}"
ok "  PI_MODEL:          ${PI_MODEL:-claude-sonnet-4-6 (default)}"
ok "  OPENAI_BASE_URL:   ${OPENAI_BASE_URL:-unset (using built-in providers)}"
ok "  ZCLAUDIA_DATA_DIR: ${ZCLAUDIA_DATA_DIR}"

# --- Manual verification checklist ---
info "Manual verification checklist (do these in the desktop app after it opens):"
ok "  1. New session, send \"Hello, who are you?\" → streaming reply"
ok "  2. Same session, send \"What did I just ask?\" → references prior msg (multi-turn)"
ok "  3. Stop, unset key, restart, retry → clean config error UX"
ok "  4. Set PI_MODEL=invalid-id, restart, retry → clean unknown-model UX"

# --- Delegate (exec for clean signal propagation) ---
exec "$PROJECT_ROOT/scripts/dev/start-app.sh" standalone
