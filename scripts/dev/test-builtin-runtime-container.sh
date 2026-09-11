#!/usr/bin/env bash
# Docker daemon selection follows DOCKER_CONTEXT / DOCKER_HOST; never changes it.
set -euo pipefail

if [[ $# -eq 1 && "$1" == '--help' ]]; then
  echo 'Usage: bash test-builtin-runtime-container.sh <linux-server-bundle> <shipped-linux-node> <new-output-directory>'
  echo 'Runs API acceptance with CLI fixtures in a network-disabled, read-only artifact container. Requires Docker and a matching Linux CPU architecture.'
  exit 0
fi
if [[ $# -ne 3 ]]; then
  echo 'Expected Linux bundle, shipped Linux Node, and a new output directory' >&2
  exit 2
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle_dir="$(cd "$1" && pwd)"
node_file="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
output_parent="$(cd "$(dirname "$3")" && pwd)"
output_dir="$output_parent/$(basename "$3")"
test -f "$bundle_dir/server.mjs"
test -f "$bundle_dir/builtin-plugins/catalog.json"
test -x "$node_file"
mkdir "$output_dir" # Never reuse a previous run or its private database.
input_dir=''
container_name="zclaudia-runtime-$(date +%s)-$$"
container_created=false

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$container_created" == true ]]; then
    docker inspect --format '{"State":{{json .State}},"Mounts":{{json .Mounts}},"Image":{{json .Image}},"NetworkMode":{{json .HostConfig.NetworkMode}}}' \
      "$container_name" > "$output_dir/container.json" || status=1
    docker rm -f "$container_name" > "$output_dir/container-cleanup.log" 2>&1 || status=1
  fi
  if [[ -n "$input_dir" ]]; then rm -rf "$input_dir" || status=1; fi
  printf '{"exitCode":%s,"containerCreated":%s}\n' "$status" "$container_created" > "$output_dir/runner-exit.json"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep input outside the writable output mount: otherwise the same artifact
# could be modified through a second, writable path inside the container.
input_dir="$(mktemp -d "$output_parent/zclaudia-runtime-input.XXXXXX")"
mkdir -p "$input_dir/scripts/dev" "$input_dir/scripts/plugins"
cp -R "$bundle_dir" "$input_dir/bundle"
cp "$node_file" "$input_dir/node"
cp -R "$repo_dir/e2e/fixtures/agent-runtimes" "$input_dir/fixtures"
cp "$repo_dir/scripts/dev/test-builtin-runtime-artifact-smoke.mjs" "$input_dir/scripts/dev/"
cp "$repo_dir/scripts/plugins/artifact-integrity.mjs" "$input_dir/scripts/plugins/"

docker create --name "$container_name" --init --network none \
  --mount "type=bind,src=$input_dir,dst=/input,readonly" \
  --mount "type=bind,src=$output_dir,dst=/output" \
  node@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7 \
  /input/node /input/scripts/dev/test-builtin-runtime-artifact-smoke.mjs \
  --artifact-dir /input/bundle --node-path /input/node \
  --fixtures-dir /input/fixtures --output-dir /output/run > "$output_dir/container-id.txt"
container_created=true
docker start -a "$container_name" > "$output_dir/container.log" 2>&1
echo "Artifact API acceptance report: $output_dir/run/summary.json"
