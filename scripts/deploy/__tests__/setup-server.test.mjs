import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const script = readFileSync(path.join(repoRoot, 'scripts/deploy/setup-server.sh'), 'utf8');

test('setup-server pins pnpm to the repository packageManager version', () => {
  assert.match(script, /PACKAGE_MANAGER=/);
  assert.match(script, /corepack prepare "\$PACKAGE_MANAGER" --activate/);
  assert.doesNotMatch(script, /pnpm@latest/);
});

test('setup-server does not fall back from frozen install to mutable install', () => {
  assert.match(script, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(script, /pnpm install --frozen-lockfile[^\n]+(?:\|\||;)[^\n]+pnpm install/);
});
