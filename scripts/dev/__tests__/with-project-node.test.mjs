import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

test('resolves pnpm from PATH when project node already matches', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'zclaudia-node-wrapper-'));
  const binDir = path.join(tempDir, 'bin');
  const argsFile = path.join(tempDir, 'pnpm-args.txt');

  spawnSync('mkdir', ['-p', binDir]);
  writeExecutable(
    path.join(binDir, 'node'),
    '#!/usr/bin/env bash\nif [[ "$1" == "-p" ]]; then echo "22.20.0"; else exit 99; fi\n'
  );
  // pnpm >= 10 pins itself to `packageManager`, so the wrapper invokes it
  // directly rather than through corepack.
  writeExecutable(
    path.join(binDir, 'pnpm'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$PNPM_ARGS_FILE"\n'
  );

  const result = spawnSync('bash', ['scripts/with-project-node.sh', 'pnpm', '--version'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:/usr/bin:/bin`,
      PNPM_ARGS_FILE: argsFile,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(argsFile, 'utf8'), '--version\n');
});
