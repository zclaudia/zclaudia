import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, writeFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseLiveOptions,
  validateLivePaths,
  validateLiveEnvironment,
} from '../agent-runtime-live-options.mjs';

const runner = path.resolve(import.meta.dirname, '../test-builtin-runtime-live.mjs');
const args = [
  '--runtime',
  'codex',
  '--cli-path',
  '/test/cli',
  '--account-root',
  '/test/account',
  '--output-dir',
  '/test/output',
  '--max-turns',
  '3',
  '--turn-timeout-ms',
  '10000',
];

test('live runner rejects alternate E2E executable and resource overrides', () => {
  validateLiveEnvironment({ PATH: '/usr/bin', CI: 'true' });
  for (const key of [
    'ZCLAUDIA_E2E_SERVER_ENTRY',
    'ZCLAUDIA_E2E_NODE_PATH',
    'ZCLAUDIA_E2E_BROWSER_DIST',
    'ZCLAUDIA_E2E_SANDBOX_PROFILE',
  ])
    assert.throws(() => validateLiveEnvironment({ [key]: '/synthetic/override' }), /overrides/);
});

test('live execution requires explicit consent and bounded turns/time', () => {
  assert.throws(() => parseLiveOptions(args), /--allow-live/);
  assert.equal(parseLiveOptions([...args, '--allow-live']).allowLive, true);
  assert.throws(
    () => parseLiveOptions([...args, '--allow-live', '--runtime', 'claude']),
    /Duplicate/
  );
  assert.throws(() => parseLiveOptions([...args.slice(0, -4), '--allow-live']), /must be explicit/);
  assert.throws(
    () =>
      parseLiveOptions(
        args.map(value => (value === '10000' ? 'NaN' : value)).concat('--allow-live')
      ),
    /integer/
  );
  assert.throws(
    () =>
      parseLiveOptions(args.map(value => (value === '3' ? '100' : value)).concat('--allow-live')),
    /between 3 and 3/
  );
});

test('self-test cannot accidentally select a real CLI or account', () => {
  const base = ['--runtime', 'claude', '--output-dir', '/test/output', '--self-test'];
  assert.equal(parseLiveOptions(base).selfTest, true);
  for (const extra of [
    ['--allow-live'],
    ['--cli-path', '/test/cli'],
    ['--account-root', '/test/account'],
    ['--model', 'some-model'],
  ])
    assert.throws(() => parseLiveOptions([...base, ...extra]), /cannot use a real/);
  assert.equal(
    parseLiveOptions([...base, '--self-test-fault', 'turn-timeout']).selfTestFault,
    'turn-timeout'
  );
  assert.throws(
    () => parseLiveOptions([...args, '--allow-live', '--self-test-fault', 'turn-timeout']),
    /self-test mode only/
  );
  assert.throws(() => parseLiveOptions([...base, '--self-test-fault', 'unknown']), /turn-timeout/);
});

test('cancellation scenario has an explicit two-turn budget and separate coverage', () => {
  const base = [
    '--runtime',
    'codex',
    '--output-dir',
    '/test/output',
    '--self-test',
    '--scenario',
    'cancel',
  ];
  const options = parseLiveOptions(base);
  assert.equal(options.maxTurns, 2);
  assert.deepEqual(options.coveredCases, ['L04']);
  assert.throws(() => parseLiveOptions([...base, '--max-turns', '3']), /between 2 and 2/);
  assert.throws(
    () => parseLiveOptions([...base, '--self-test-fault', 'turn-timeout']),
    /coding scenario/
  );
  assert.throws(
    () => parseLiveOptions(base.map(value => (value === 'cancel' ? 'unknown' : value))),
    /coding, cancel, capabilities or concurrency/
  );
});

test('concurrency requires two distinct runtimes and rejects accidental real peer configuration', () => {
  const base = [
    '--runtime',
    'claude',
    '--output-dir',
    '/test/output',
    '--self-test',
    '--scenario',
    'concurrency',
  ];
  assert.throws(() => parseLiveOptions(base), /different supported runtime/);
  assert.throws(
    () => parseLiveOptions([...base, '--peer-runtime', 'claude']),
    /different supported runtime/
  );
  const pair = [...base, '--peer-runtime', 'codex'];
  const parsed = parseLiveOptions(pair);
  assert.deepEqual(parsed.coveredCases, ['L06']);
  assert.equal(parsed.maxTurns, 2);
  assert.equal(parsed.peerRuntime, 'codex');
  assert.throws(
    () => parseLiveOptions([...pair, '--peer-cli-path', '/real/codex']),
    /cannot use a real/
  );
  assert.throws(
    () => parseLiveOptions([...pair, '--peer-model', 'real-model']),
    /cannot use a real/
  );
  assert.throws(
    () =>
      parseLiveOptions(
        base.filter(value => value !== '--self-test').concat('--peer-runtime', 'codex')
      ),
    /peer-cli-path/
  );
  assert.throws(
    () =>
      parseLiveOptions([
        '--runtime',
        'claude',
        '--self-test',
        '--output-dir',
        '/test/output',
        '--peer-runtime',
        'codex',
      ]),
    /require --scenario concurrency/
  );
});

test('validate-only checks canonical paths without executing the vendor or creating reports', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-options-'));
  try {
    const accountRoot = path.join(directory, 'accounts');
    await mkdir(path.join(accountRoot, 'home'), { recursive: true });
    await mkdir(path.join(accountRoot, 'codex'));
    const marker = path.join(directory, 'executed');
    const cli = path.join(directory, 'cli');
    await writeFile(cli, `#!/bin/sh\ntouch '${marker}'\n`);
    await chmod(cli, 0o755);
    const output = path.join(directory, 'report');
    const commandArgs = [
      '--runtime',
      'codex',
      '--cli-path',
      cli,
      '--account-root',
      accountRoot,
      '--output-dir',
      output,
      '--max-turns',
      '3',
      '--turn-timeout-ms',
      '10000',
      '--validate-only',
    ];
    const result = JSON.parse(
      execFileSync(process.execPath, [runner, ...commandArgs], { encoding: 'utf8' })
    );
    assert.equal(result.cliExecuted, false);
    await assert.rejects(stat(marker), { code: 'ENOENT' });
    await assert.rejects(stat(output), { code: 'ENOENT' });
    await mkdir(path.join(accountRoot, 'claude'));
    const peerMarker = path.join(directory, 'peer-executed');
    const peerCli = path.join(directory, 'peer-cli');
    await writeFile(peerCli, `#!/bin/sh\ntouch '${peerMarker}'\n`);
    await chmod(peerCli, 0o755);
    const pairArgs = commandArgs
      .map(value => (value === '3' ? '2' : value))
      .concat('--scenario', 'concurrency', '--peer-runtime', 'claude', '--peer-cli-path', peerCli);
    const pairResult = JSON.parse(
      execFileSync(process.execPath, [runner, ...pairArgs], { encoding: 'utf8' })
    );
    assert.deepEqual(pairResult.coveredCases, ['L06']);
    await assert.rejects(stat(marker), { code: 'ENOENT' });
    await assert.rejects(stat(peerMarker), { code: 'ENOENT' });
    await rm(path.join(accountRoot, 'claude'), { recursive: true });
    await symlink(homedir(), path.join(accountRoot, 'claude'));
    await assert.rejects(validateLivePaths(parseLiveOptions(pairArgs)), /within --account-root/);
    await mkdir(output);
    await assert.rejects(validateLivePaths(parseLiveOptions(commandArgs)), /new directory/);
    await rm(output, { recursive: true });
    await rm(path.join(accountRoot, 'home'), { recursive: true });
    await symlink(homedir(), path.join(accountRoot, 'home'));
    await assert.rejects(validateLivePaths(parseLiveOptions(commandArgs)), /within --account-root/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
