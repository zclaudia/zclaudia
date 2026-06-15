#!/usr/bin/env bash
#
# Pin the sourcing script to the project's Node (.node-version) via fnm.
#
# Source this NEAR THE TOP of a dev script — before any node/pnpm/npx use, and
# (for scripts that parse "$@") before the arg-parsing loop, so the re-exec
# preserves the original args:
#
#     source "$SCRIPT_DIR/../lib/use-project-node.sh"
#
# It reads .node-version and, if the current Node differs, re-execs the WHOLE
# calling script once under the project Node. fnm exec puts a stable versioned
# bin dir first on PATH, so the right Node survives even an `env -i` sandbox
# (start-app-clean.sh). The current==expected guard prevents an infinite
# re-exec loop. No-op when already on the right Node or when .node-version is
# absent. This is the same intent as scripts/with-project-node.sh, but applied
# to the whole script instead of wrapping a single command.

__upn_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
__upn_expected="$(tr -d '[:space:]' < "$__upn_root/.node-version" 2>/dev/null || true)"
__upn_current="$(node -p 'process.version.slice(1)' 2>/dev/null || true)"

if [[ -n "$__upn_expected" && "$__upn_current" != "$__upn_expected" ]]; then
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)" >/dev/null 2>&1 || true
    echo -e "\033[0;34m>\033[0m Switching to project Node $__upn_expected (was ${__upn_current:-none}) and re-running…"
    exec fnm exec --using "$__upn_expected" bash "$0" "$@"
  fi
  echo -e "\033[0;31mx\033[0m Current Node (${__upn_current:-none}) != project Node ($__upn_expected) and fnm is not installed." >&2
  echo -e "  Install fnm, or switch Node manually: fnm install $__upn_expected && fnm use $__upn_expected" >&2
  exit 1
fi

unset __upn_root __upn_expected __upn_current
