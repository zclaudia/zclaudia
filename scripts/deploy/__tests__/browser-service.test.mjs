import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseServicePort,
  renderBrowserEnv,
  renderLaunchAgentPlist,
  renderSystemdUnit,
  requiredBuildCommands,
} from '../browser-service-lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const launchAgentArgs = [
  'com.zclaudia.browser',
  '/Users/alice/Code/zclaudia',
  '/opt/homebrew/bin/node',
  '/Users/alice/.zclaudia',
  '/Users/alice/Library/Logs/zclaudia',
];

function runBrowserService(args, env = {}) {
  return spawnSync('bash', ['scripts/deploy/browser-service.sh', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function browserServiceShell() {
  return readFileSync(resolve(repoRoot, 'scripts/deploy/browser-service.sh'), 'utf8');
}

test('browser service env binds localhost only', () => {
  const env = renderBrowserEnv({ port: 3100, dataDir: '/home/me/.zclaudia' });

  assert.match(env, /^PORT=3100$/m);
  assert.match(env, /^SERVER_HOST=127\.0\.0\.1$/m);
  assert.match(env, /^NODE_ENV=production$/m);
  assert.match(env, /^ZCLAUDIA_DATA_DIR=\/home\/me\/\.zclaudia$/m);
  assert.doesNotMatch(env, /SERVER_HOST=0\.0\.0\.0/);
});

test('browser service env command preserves existing env file', () => {
  const dataDir = mkdtempSync(resolve(tmpdir(), 'zclaudia-browser-env-'));
  const envFile = resolve(dataDir, 'browser.env');

  try {
    const existing = [
      '# user edits',
      'PORT=4567',
      'SERVER_HOST=127.0.0.1',
      'ZCLAUDIA_DATA_DIR=/custom/zclaudia data',
      '',
    ].join('\n');
    writeFileSync(envFile, existing);

    const result = runBrowserService(['env'], {
      DATA_DIR: dataDir,
      ENV_FILE: envFile,
      PORT: '3100',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`${envFile.replaceAll('/', '\\/')}`));
    assert.equal(readFileSync(envFile, 'utf8'), existing);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('browser service env command creates localhost-only env when missing', () => {
  const dataDir = mkdtempSync(resolve(tmpdir(), 'zclaudia-browser-env-'));
  const envFile = resolve(dataDir, 'browser.env');

  try {
    const result = runBrowserService(['env'], {
      DATA_DIR: dataDir,
      ENV_FILE: envFile,
      PORT: '4217',
    });

    assert.equal(result.status, 0);
    assert.match(readFileSync(envFile, 'utf8'), /^PORT=4217$/m);
    assert.match(readFileSync(envFile, 'utf8'), /^SERVER_HOST=127\.0\.0\.1$/m);
    assert.doesNotMatch(readFileSync(envFile, 'utf8'), /SERVER_HOST=0\.0\.0\.0/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('browser service shell rejects invalid PORT before writing env', () => {
  const dataDir = mkdtempSync(resolve(tmpdir(), 'zclaudia-browser-env-'));
  const envFile = resolve(dataDir, 'browser.env');

  try {
    const result = runBrowserService(['env'], {
      DATA_DIR: dataDir,
      ENV_FILE: envFile,
      PORT: '70000',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid port/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('macOS install loads env before rendering launch agent plist', () => {
  const script = browserServiceShell();
  const macosInstall = script.match(/install_macos\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.notEqual(macosInstall, '');
  assert.ok(
    macosInstall.indexOf('load_env_file') < macosInstall.indexOf('render-launch-agent.mjs')
  );
});

test('linux service control avoids unconditional sudo', () => {
  const script = browserServiceShell();

  assert.match(script, /as_root\(\)/);
  assert.doesNotMatch(script, /Linux\) sudo systemctl (start|stop|restart)/);
});

test('service port parser rejects non-integer and out-of-range ports', () => {
  assert.equal(parseServicePort('3100'), 3100);
  assert.throws(() => parseServicePort('3.14'), /invalid port/i);
  assert.throws(() => parseServicePort('70000'), /invalid port/i);
});

test('browser service build commands include desktop assets', () => {
  assert.deepEqual(requiredBuildCommands(), [
    ['pnpm', '--filter', '@zclaudia/shared', 'run', 'build'],
    ['pnpm', '--filter', '@zclaudia/server', 'run', 'build'],
    ['pnpm', '--filter', '@zclaudia/desktop', 'run', 'build'],
  ]);
});

test('systemd unit runs server dist under the repository root', () => {
  const unit = renderSystemdUnit({
    serviceName: 'zclaudia-browser',
    user: 'alice',
    repoRoot: '/opt/zclaudia',
    nodeBin: '/usr/bin/node',
    nodeDir: '/usr/bin',
    envFile: '/home/alice/.zclaudia/browser.env',
    dataDir: '/home/alice/.zclaudia',
  });

  assert.match(unit, /Description=ZClaudia Local Browser Shell/);
  assert.match(unit, /WorkingDirectory="\/opt\/zclaudia"/);
  assert.match(unit, /EnvironmentFile="\/home\/alice\/\.zclaudia\/browser\.env"/);
  assert.match(
    unit,
    /ExecStart="\/usr\/bin\/env" SERVER_HOST=127\.0\.0\.1 "\/usr\/bin\/node" "\/opt\/zclaudia\/server\/dist\/index\.js"/
  );
});

test('systemd unit pins localhost even when env file is preserved', () => {
  const unit = renderSystemdUnit({
    serviceName: 'zclaudia-browser',
    user: 'alice',
    repoRoot: '/opt/zclaudia',
    nodeBin: '/usr/bin/node',
    nodeDir: '/usr/bin',
    envFile: '/home/alice/.zclaudia/browser.env',
    dataDir: '/home/alice/.zclaudia',
  });

  assert.match(unit, /^EnvironmentFile="\/home\/alice\/\.zclaudia\/browser\.env"$/m);
  assert.match(
    unit,
    /^ExecStart="\/usr\/bin\/env" SERVER_HOST=127\.0\.0\.1 "\/usr\/bin\/node" "\/opt\/zclaudia\/server\/dist\/index\.js"$/m
  );
});

test('systemd unit quotes paths with spaces', () => {
  const unit = renderSystemdUnit({
    serviceName: 'zclaudia-browser',
    user: 'alice',
    repoRoot: '/opt/Z Claudia',
    nodeBin: '/usr/local/bin/node with space',
    nodeDir: '/usr/local/bin',
    envFile: '/home/alice/Z Claudia/browser.env',
    dataDir: '/home/alice/Z Claudia',
  });

  assert.match(unit, /^WorkingDirectory="\/opt\/Z Claudia"$/m);
  assert.match(unit, /^EnvironmentFile="\/home\/alice\/Z Claudia\/browser\.env"$/m);
  assert.match(unit, /^Environment="ZCLAUDIA_DATA_DIR=\/home\/alice\/Z Claudia"$/m);
  assert.match(
    unit,
    /^ExecStart="\/usr\/bin\/env" SERVER_HOST=127\.0\.0\.1 "\/usr\/local\/bin\/node with space" "\/opt\/Z Claudia\/server\/dist\/index\.js"$/m
  );
});

test('launch agent plist binds localhost and writes user logs', () => {
  const plist = renderLaunchAgentPlist({
    label: 'com.zclaudia.browser',
    repoRoot: '/Users/alice/Code/zclaudia',
    nodeBin: '/opt/homebrew/bin/node',
    dataDir: '/Users/alice/.zclaudia',
    logDir: '/Users/alice/Library/Logs/zclaudia',
    port: 3100,
  });

  assert.match(plist, /<string>com\.zclaudia\.browser<\/string>/);
  assert.match(plist, /<key>SERVER_HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(plist, /<string>server\/dist\/index\.js<\/string>/);
  assert.match(
    plist,
    /<key>StandardOutPath<\/key>\s*<string>\/Users\/alice\/Library\/Logs\/zclaudia\/browser\.out\.log<\/string>/
  );
  assert.match(
    plist,
    /<key>StandardErrorPath<\/key>\s*<string>\/Users\/alice\/Library\/Logs\/zclaudia\/browser\.err\.log<\/string>/
  );
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
});

for (const port of ['nope', '3.14', '70000']) {
  test(`render launch agent CLI rejects invalid port ${port}`, () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/deploy/render-launch-agent.mjs', ...launchAgentArgs, port],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid port/i);
  });
}

test('render launch agent CLI writes localhost and provided port', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/deploy/render-launch-agent.mjs', ...launchAgentArgs, '4217'],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /<key>SERVER_HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(result.stdout, /<key>PORT<\/key>\s*<string>4217<\/string>/);
});
