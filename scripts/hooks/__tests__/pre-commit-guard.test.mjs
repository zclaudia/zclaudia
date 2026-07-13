import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const guardScript = path.join(repoRoot, 'scripts/hooks/pre-commit-guard.mjs');

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

test('pre-commit guard rejects ignored files even when force-added', () => {
  const tempRepo = mkdtempSync(path.join(tmpdir(), 'zclaudia-precommit-'));
  assert.equal(git(tempRepo, ['init']).status, 0);
  assert.equal(git(tempRepo, ['config', 'user.email', 'test@example.com']).status, 0);
  assert.equal(git(tempRepo, ['config', 'user.name', 'Test User']).status, 0);

  writeFileSync(path.join(tempRepo, '.gitignore'), 'docs/superpowers/\n');
  mkdirSync(path.join(tempRepo, 'docs/superpowers/specs'), { recursive: true });
  writeFileSync(path.join(tempRepo, 'docs/superpowers/specs/local.md'), '# local only\n');

  assert.equal(git(tempRepo, ['add', '.gitignore']).status, 0);
  assert.equal(git(tempRepo, ['add', '-f', 'docs/superpowers/specs/local.md']).status, 0);

  const result = spawnSync(process.execPath, [guardScript], {
    cwd: tempRepo,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ignored staged file/i);
  assert.match(result.stderr, /docs\/superpowers\/specs\/local\.md/);
});
