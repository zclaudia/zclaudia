import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const script = readFileSync(path.join(repoRoot, 'scripts/dev/start-app-clean.sh'), 'utf8');

test('start-app-clean rebuilds agent plugins before launching Tauri', () => {
  // Agent runtimes are loaded from plugins/agents/*/dist/main.js, so the clean
  // launcher must refresh them or it runs the previously built bundle.
  const pluginBuild = script.indexOf('--filter "@zclaudia/plugin-*" run build');
  const tauriLaunch = script.indexOf('tauri dev');

  assert.notEqual(pluginBuild, -1);
  assert.ok(pluginBuild < tauriLaunch);
});
