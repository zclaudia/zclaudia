import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const script = readFileSync(path.join(repoRoot, 'scripts/dev/start-app.sh'), 'utf8');

test('start-app documents browser and web modes', () => {
  assert.match(script, /tauri\|desktop\|standalone\|server\|browser\|web/);
  assert.match(script, /--no-build/);
  assert.match(script, /--port PORT/);
});

test('start-app parses browser mode aliases and options', () => {
  assert.match(script, /browser\|web\)/);
  assert.match(script, /--no-build\)/);
  assert.match(script, /--port\)/);
});

test('start-app browser mode serves localhost backend without vite or tauri', () => {
  assert.match(script, /start_browser\(\)/);
  assert.match(script, /SERVER_HOST=127\.0\.0\.1/);
  assert.match(script, /PORT="\$BROWSER_PORT"/);
  assert.match(script, /Browser mode ready.*http:\/\/127\.0\.0\.1:\$BROWSER_PORT/);

  const browserMode = script.match(/start_browser\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.notEqual(browserMode, '');
  assert.doesNotMatch(browserMode, /tauri dev/);
  assert.doesNotMatch(browserMode, /pnpm dev/);
});

test('start-app uses the shared native module checker before server startup', () => {
  assert.match(script, /scripts\/hooks\/check-native-modules\.mjs/);
  assert.doesNotMatch(script, /require\('better-sqlite3'\)/);
});

test('start-app rebuilds agent plugins before starting the server', () => {
  // Agent runtimes are loaded from plugins/agents/*/dist/main.js, so a dev run
  // that skips this silently serves the previously built plugin bundle.
  assert.match(script, /--filter "@zclaudia\/plugin-\*" run build/);

  const buildFn = script.match(/^build\(\) \{[\s\S]*?\n\}/m)?.[0] ?? '';
  assert.notEqual(buildFn, '', 'build() must exist');
  assert.match(buildFn, /--filter "@zclaudia\/plugin-\*" run build/);
});

test('start-app routes every pnpm call through the run_pnpm helper', () => {
  assert.match(script, /run_pnpm\(\)/);
  assert.doesNotMatch(script, /[^a-zA-Z_"]pnpm (install|build|dev|exec)/);
});
