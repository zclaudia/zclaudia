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

# Resolves the release VERSION and BUILD for a platform.
# In CI (RELEASE_VERSION + RELEASE_BUILD set by the workflow) those are used as-is.
# Locally it derives a dev version from the latest release tag via version-bump.sh,
# eval'd into the current shell so it can export VERSION/BUILD/VERSION_CODE. Callers
# remain responsible for any platform-specific derivation (e.g. VERSION_CODE, MAJOR).
zclaudia_resolve_version() {
  local platform="$1"
  echo "=== Version check ==="
  if [ -n "${RELEASE_VERSION:-}" ] && [ -n "${RELEASE_BUILD:-}" ]; then
    VERSION="$RELEASE_VERSION"
    BUILD="$RELEASE_BUILD"
    echo "Using CI-provided version: $VERSION (build $BUILD)"
  else
    echo "Local build → deriving dev version from latest release tag"
    eval "$(./scripts/release/version-bump.sh --platform "$platform" --dev-suffix)"
  fi
}

# Enables updater artifacts only for real CI releases (RELEASE_VERSION + RELEASE_BUILD),
# defaulting to false for local/dev builds unless explicitly overridden.
zclaudia_set_updates_enabled() {
  export UPDATES_ENABLED="${UPDATES_ENABLED:-${RELEASE_VERSION:+true}}"
  if [ -z "${RELEASE_VERSION:-}" ] || [ -z "${RELEASE_BUILD:-}" ]; then
    export UPDATES_ENABLED="${UPDATES_ENABLED:-false}"
  fi
}

# Strip a leading `v` and any prerelease suffix, yielding the strict MAJOR.MINOR.PATCH
# that Tauri's config requires. Usage: TAURI_VERSION="$(zclaudia_tauri_semver "$VERSION")"
zclaudia_tauri_semver() {
  echo "$1" | sed 's/^v//; s/-.*//'
}
