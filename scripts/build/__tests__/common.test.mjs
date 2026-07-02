import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

test('build common helpers resolve repo root and report missing commands', () => {
  const script = `
    set -euo pipefail
    source "${repoRoot}/scripts/build/common.sh"
    zclaudia_cd_repo_root
    test "$PWD" = "${repoRoot}"
    zclaudia_require_commands sh >/dev/null
    if zclaudia_require_commands definitely-missing-zclaudia-command >/dev/null 2>&1; then
      exit 2
    fi
  `;

  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
