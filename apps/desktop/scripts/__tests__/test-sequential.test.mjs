import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '../..');

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

test('spawns vitest through corepack pnpm and reports child errors', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'zclaudia-test-sequential-'));
  const binDir = path.join(tempDir, 'bin');
  const argsFile = path.join(tempDir, 'corepack-args.txt');

  spawnSync('mkdir', ['-p', binDir]);
  writeExecutable(
    path.join(binDir, 'corepack'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$COREPACK_ARGS_FILE"\n'
  );

  const result = spawnSync(
    process.execPath,
    ['scripts/test-sequential.mjs', 'src/stores/__tests__/gatewayStore.test.ts'],
    {
      cwd: desktopRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:/usr/bin:/bin`,
        COREPACK_ARGS_FILE: argsFile,
      },
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    readFileSync(argsFile, 'utf8'),
    'pnpm\nexec\nvitest\nrun\n--config\nvitest.unit.config.ts\nsrc/stores/__tests__/gatewayStore.test.ts\n'
  );
});
