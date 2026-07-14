import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const script = readFileSync(path.join(repoRoot, 'scripts/hooks/check-native-modules.mjs'), 'utf8');

test('native module checker covers server native dependencies', () => {
  assert.match(script, /createRequire\(path\.join\(repoRoot, 'server\/package\.json'\)\)/);
  assert.match(script, /name: 'better-sqlite3'/);
  assert.match(script, /name: 'node-pty'/);
  assert.match(script, /require\('node-pty'\)/);
  assert.match(script, /corepack/);
  assert.match(script, /--filter', '@zclaudia\/server'/);
});
