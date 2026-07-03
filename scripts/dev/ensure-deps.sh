#!/usr/bin/env bash
# Auto-install workspace deps before `pnpm dev` (wired via the root `predev`
# hook) so a newly added dependency is present without a manual `pnpm install`.
#
# Frozen-lockfile first: when package.json and the lockfile are in sync this is
# fast and never mutates the lockfile. If they've drifted (e.g. a dep was just
# added) the frozen install fails and we fall back to a normal install, which
# resolves the new dependency. Runs under the project Node via
# with-project-node.sh so the preinstall version guard passes.
set -euo pipefail
cd "$(dirname "$0")/../.."

bash scripts/with-project-node.sh pnpm install --frozen-lockfile 2>/dev/null \
  || bash scripts/with-project-node.sh pnpm install
