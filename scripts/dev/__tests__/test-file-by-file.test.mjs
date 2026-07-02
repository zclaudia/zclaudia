import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const scriptPath = path.join(repoRoot, 'scripts/dev/test-file-by-file.mjs');

test('does not execute shell metacharacters from the test path argument', () => {
  const marker = path.join(tmpdir(), `zclaudia-test-file-helper-${process.pid}`);
  rmSync(marker, { force: true });

  const result = spawnSync(
    process.execPath,
    [scriptPath, `apps/desktop/src/does-not-exist; touch ${marker} #`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(marker), false);
});

test('rejects sibling repository paths unless external mode is explicit', () => {
  const result = spawnSync(process.execPath, [scriptPath, '../zclaudia-gateway/src'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--allow-external/);
});
