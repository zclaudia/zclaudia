import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const installScript = path.join(repoRoot, 'scripts/hooks/install-git-hooks.mjs');

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

test('install-git-hooks writes a pre-commit hook that runs the ignored-file guard', () => {
  const tempRepo = mkdtempSync(path.join(tmpdir(), 'zclaudia-hook-install-'));
  assert.equal(git(tempRepo, ['init']).status, 0);

  const result = spawnSync(process.execPath, [installScript], {
    cwd: tempRepo,
    env: {
      ...process.env,
      ZCLAUDIA_REPO_ROOT: repoRoot,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const hook = readFileSync(path.join(tempRepo, '.git/hooks/pre-commit'), 'utf8');
  assert.match(hook, /pre-commit-guard\.mjs/);
  assert.match(hook, /node/);
});
