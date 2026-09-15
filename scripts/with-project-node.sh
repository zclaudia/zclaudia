#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPECTED_NODE="$(tr -d '[:space:]' < "$PROJECT_ROOT/.node-version")"
CURRENT_NODE="$(node -p "process.version.slice(1)")"

# How to invoke pnpm. Prefer pnpm on PATH: since pnpm 10 it reads
# `packageManager` from package.json and delegates to that exact version
# itself, which is what corepack used to do for us. Corepack is only a
# fallback now — it cannot launch pnpm 11+ (pure ESM, no bin/pnpm.cjs) and
# Node 25 drops it entirely.
if command -v pnpm >/dev/null 2>&1; then
  pnpm_command=(pnpm)
else
  pnpm_command=(corepack pnpm)
fi

resolve_command=("$@")
if [[ "${resolve_command[0]:-}" == "pnpm" ]]; then
  resolve_command=("${pnpm_command[@]}" "${resolve_command[@]:1}")
elif [[ "${resolve_command[0]:-}" == "env" ]]; then
  command_index=1
  while [[ $command_index -lt ${#resolve_command[@]} && "${resolve_command[$command_index]}" == *=* ]]; do
    command_index=$((command_index + 1))
  done
  if [[ $command_index -lt ${#resolve_command[@]} && "${resolve_command[$command_index]}" == "pnpm" ]]; then
    resolve_command=(
      "${resolve_command[@]:0:$command_index}"
      "${pnpm_command[@]}"
      "${resolve_command[@]:$((command_index + 1))}"
    )
  fi
fi

if [[ "$CURRENT_NODE" == "$EXPECTED_NODE" ]]; then
  exec "${resolve_command[@]}"
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd)" >/dev/null 2>&1 || true
  exec fnm exec --using "$EXPECTED_NODE" "${resolve_command[@]}"
fi

echo "Node version mismatch: expected $EXPECTED_NODE, current $CURRENT_NODE." >&2
echo "Install fnm and run: eval \"\$(fnm env)\" && fnm use $EXPECTED_NODE" >&2
exit 1
