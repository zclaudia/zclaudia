import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const script = readFileSync(path.join(repoRoot, 'scripts/dev/run-server.sh'), 'utf8');

test('run-server rebuilds agent plugins before the server build', () => {
  // Agent runtimes are loaded from plugins/agents/*/dist/main.js; skipping this
  // leaves the isolated dev server on the previously built plugin bundle.
  const pluginBuild = script.indexOf('--filter "@zclaudia/plugin-*" run build');
  const serverBuild = script.indexOf('--filter @zclaudia/server run build');

  assert.notEqual(pluginBuild, -1);
  assert.ok(pluginBuild < serverBuild);
});
