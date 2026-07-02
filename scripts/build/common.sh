#!/usr/bin/env bash

zclaudia_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

zclaudia_cd_repo_root() {
  cd "$(zclaudia_repo_root)"
}

zclaudia_load_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
}

zclaudia_prefer_rustup() {
  export PATH="$HOME/.cargo/bin:$PATH"
}

zclaudia_setup_node() {
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd)"
    fnm use --silent-if-unchanged 2>/dev/null || true
  fi
  if command -v nvm >/dev/null 2>&1; then
    nvm use 2>/dev/null || true
  fi
}

zclaudia_require_commands() {
  local cmd
  for cmd in "$@"; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "  [OK] $cmd"
    else
      echo "  [FAIL] $cmd not found" >&2
      return 1
    fi
  done
}
