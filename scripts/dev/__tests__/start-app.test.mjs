import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
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

test('dedicated dev credentials override inherited and repository Gateway settings', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-env-'));
  try {
    writeFileSync(path.join(root, '.env'), 'GATEWAY_SECRET=production-base\n');
    writeFileSync(path.join(root, '.env.local'), 'GATEWAY_SECRET=production-local\n');
    const devEnv = path.join(root, 'dev.env');
    writeFileSync(devEnv, 'GATEWAY_SECRET=dedicated-dev\nZCLAUDIA_CHANNEL=dev\n');
    const envSetup = script
      .slice(script.indexOf('source_env() {'), script.indexOf('# --- Soft warning'))
      .replace('$HOME/.zclaudia-dev/.env', '$DEV_TEST_ENV_FILE');
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -euo pipefail
        PROJECT_ROOT="$1"
        DEV_TEST_ENV_FILE="$2"
        info() { :; }
        ${envSetup}
        bash -c 'printf "%s\\n" "$GATEWAY_SECRET" "$ZCLAUDIA_CHANNEL"'`,
        'test',
        root,
        devEnv,
      ],
      { encoding: 'utf8', env: { ...process.env, GATEWAY_SECRET: 'inherited-production' } }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'dedicated-dev\ndev\n');
    assert.equal(readFileSync(path.join(root, '.env'), 'utf8'), 'GATEWAY_SECRET=production-base\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'macOS cleanup stops a dev socket owner outside target/debug and preserves other instances',
  {
    skip: process.platform !== 'darwin',
  },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'start-app-test-'));
    const identifier = `com.zclaudia.test.${process.pid}`;
    const socket = `/tmp/${identifier.replace(/[.-]/g, '_')}_si.sock`;
    const otherSocket = `/tmp/zclaudia_other_test_${process.pid}_si.sock`;
    const children = [];
    try {
      const configDir = path.join(root, 'apps/desktop/src-tauri');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(configDir, 'tauri.dev.conf.json'), JSON.stringify({ identifier }));
      // Both processes have arbitrary command lines, like a dev .app launched
      // outside cargo. Only the one owning this config's socket should be stopped.
      for (const socketPath of [socket, otherSocket]) {
        const child = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            'import net from "node:net"; net.createServer().listen(process.argv[1], () => process.stdout.write("ready\\n"));',
            socketPath,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        children.push(child);
        await once(child.stdout, 'data');
      }
      const stopDevInstance = script.match(/^stop_dev_instance\(\) \{[\s\S]*?\n\}/m)?.[0];
      assert.ok(stopDevInstance);
      const runCleanup = () =>
        spawnSync(
          'bash',
          [
            '-c',
            `
      set -euo pipefail
      PROJECT_ROOT="$1"
      info() { :; }
      die() { echo "$*" >&2; exit 1; }
      ${stopDevInstance}
      stop_dev_instance
    `,
            'test',
            root,
          ],
          { encoding: 'utf8', timeout: 15000 }
        );
      const exited = once(children[0], 'exit');
      const result = runCleanup();
      assert.equal(result.status, 0, result.stderr);
      await exited;
      assert.equal(children[0].signalCode, 'SIGTERM');
      assert.equal(children[1].exitCode, null);
      process.kill(children[1].pid, 0);
      // A leftover socket file with no owner must not block the next launch.
      const repeat = runCleanup();
      assert.equal(repeat.status, 0, repeat.stderr);
    } finally {
      for (const child of children) child.kill();
      for (const socketPath of [socket, otherSocket]) rmSync(socketPath, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('Tauri startup failures propagate to the caller', () => {
  const startTauri = script.match(/^start_tauri\(\) \{[\s\S]*?\n\}/m)?.[0];
  assert.ok(startTauri);
  const result = spawnSync(
    'bash',
    [
      '-c',
      `
    set -euo pipefail
    PROJECT_ROOT="$1"
    kill_stale() { :; }
    wait_port_free() { :; }
    build() { :; }
    setup_node() { :; }
    node() { :; }
    wait_for_url() { :; }
    info() { :; }
    warn() { echo "$*"; }
    run_pnpm() { return 42; }
    ${startTauri}
    start_tauri
  `,
      'test',
      repoRoot,
    ],
    { encoding: 'utf8', timeout: 5000 }
  );
  assert.equal(result.status, 42, result.stderr);
  assert.match(result.stdout, /Tauri dev exited with status 42/);
});
