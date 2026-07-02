#!/usr/bin/env bash
# Build Linux desktop app (deb + rpm)
# Requires: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev
set -euo pipefail
cd "$(dirname "$0")/../.."

# shellcheck source=scripts/build/common.sh
source "$(dirname "$0")/common.sh"

# --- Preflight checks ---
# Prefer rustup-managed toolchain, then ensure Node matches .node-version.
zclaudia_prefer_rustup
zclaudia_setup_node

for cmd in rustup pnpm; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

MISSING_DEPS=()
for pkg in libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev; do
  dpkg -s "$pkg" &>/dev/null || MISSING_DEPS+=("$pkg")
done
if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo "ERROR: Missing system dependencies: ${MISSING_DEPS[*]}"
  echo "Install with: sudo apt-get install -y ${MISSING_DEPS[*]}"
  exit 1
fi

# Release remote config
RELEASE_REMOTE="${RELEASE_REMOTE:-origin}"

# --- Version selection ---
zclaudia_resolve_version linux
if [ -n "${RELEASE_VERSION:-}" ] && [ -n "${RELEASE_BUILD:-}" ]; then
  VERSION_CODE="${RELEASE_VERSION_CODE:-0}"
  MAJOR=$(echo "$VERSION" | cut -d. -f1)
  MINOR=$(echo "$VERSION" | cut -d. -f2)
fi
zclaudia_set_updates_enabled
echo ""

# --- Install / update dependencies ---
echo "=== Installing dependencies ==="
pnpm install
echo ""

# --- Pre-build (shared + server) ---
echo "=== Building shared packages ==="
export APP_VERSION="$VERSION"
pnpm -r run build
pnpm --filter @zclaudia/server run bundle
echo ""

# --- Build ---
echo "Building Linux desktop app..."
# Use --bundles to skip AppImage (often fails in WSL2 without xdg-open)
# Override beforeBuildCommand to empty since we already built above.
TAURI_CONFIG_FILE="apps/desktop/src-tauri/tauri.linux.release.generated.json"

# Tauri requires strict semver (MAJOR.MINOR.PATCH) — strip v prefix and prerelease suffixes
TAURI_VERSION="$(zclaudia_tauri_semver "$VERSION")"

cat > "$TAURI_CONFIG_FILE" <<EOF
{
  "version": "$TAURI_VERSION",
  "build": {
    "beforeBuildCommand": ""
  },
  "bundle": {
    "createUpdaterArtifacts": false,
    "resources": {
      "../../../server/bundle/": "server/"
    }
  }
}
EOF

pnpm --filter @zclaudia/desktop exec tauri build --bundles deb,rpm --config src-tauri/tauri.linux.release.generated.json || {
  rm -f "$TAURI_CONFIG_FILE"
  echo "ERROR: Tauri build failed"
  exit 1
}
rm -f "$TAURI_CONFIG_FILE"

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"
echo ""
echo "=== Linux builds ==="
echo "  DEB: $(ls "$BUNDLE_DIR"/deb/*.deb)"
echo "  RPM: $(ls "$BUNDLE_DIR"/rpm/*.rpm)"
ls -lh "$BUNDLE_DIR"/deb/*.deb "$BUNDLE_DIR"/rpm/*.rpm
