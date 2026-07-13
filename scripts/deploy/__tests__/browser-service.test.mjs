import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderBrowserEnv,
  renderLaunchAgentPlist,
  renderSystemdUnit,
  requiredBuildCommands,
} from '../browser-service-lib.mjs';

test('browser service env binds localhost only', () => {
  const env = renderBrowserEnv({ port: 3100, dataDir: '/home/me/.zclaudia' });

  assert.match(env, /^PORT=3100$/m);
  assert.match(env, /^SERVER_HOST=127\.0\.0\.1$/m);
  assert.match(env, /^NODE_ENV=production$/m);
  assert.match(env, /^ZCLAUDIA_DATA_DIR=\/home\/me\/\.zclaudia$/m);
  assert.doesNotMatch(env, /SERVER_HOST=0\.0\.0\.0/);
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
  assert.match(unit, /WorkingDirectory=\/opt\/zclaudia/);
  assert.match(unit, /EnvironmentFile=\/home\/alice\/\.zclaudia\/browser\.env/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/zclaudia\/server\/dist\/index\.js/);
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
