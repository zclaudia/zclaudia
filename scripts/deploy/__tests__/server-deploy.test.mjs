import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const script = readFileSync(path.join(repoRoot, 'scripts/deploy/server.sh'), 'utf8');

test('server deploy pins pnpm to the repository packageManager version', () => {
  assert.match(script, /PACKAGE_MANAGER=/);
  assert.match(script, /corepack prepare "\$PACKAGE_MANAGER" --activate/);
  assert.doesNotMatch(script, /pnpm@latest/);
});

test('server deploy does not fall back from frozen install to mutable install by default', () => {
  assert.match(script, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(script, /pnpm install --frozen-lockfile[^\n]+(?:\|\||;)[^\n]+pnpm install/);
});

test('server deploy defaults to localhost binding', () => {
  assert.match(script, /SERVER_HOST=127\.0\.0\.1/);
  assert.doesNotMatch(script, /SERVER_HOST=0\.0\.0\.0/);
});
