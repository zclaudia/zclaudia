import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const LIVE_HELP = `Usage: pnpm test:e2e:agent-runtimes:live -- --runtime <claude|codex|cursor> --cli-path <executable> --account-root <test-account-root> --output-dir <new-report-directory> --max-turns <3|2> --turn-timeout-ms 180000 --allow-live [--scenario <coding|cancel|capabilities|concurrency>] [--model <model>] [--headless] [--validate-only]

Runs coding (L01-L03, 3 user turns; default), cancel (L04, 2 user turns),
capabilities (L05, 3 user turns: approval/modes and real host MCP), or
concurrency (L06, 2 user turns across two distinct runtimes)
through the complete browser application. Build browser/server first.
Concurrency also requires --peer-runtime and --peer-cli-path (plus optional
--peer-model). The shared dedicated account root must contain both runtime
directories; the CLI for --runtime is cancelled, the peer continues to completion.
The account root must contain home/ and <runtime>/, prepared with a dedicated test
account. Sets HOME/USERPROFILE to home/, CODEX_HOME or CLAUDE_CONFIG_DIR to the
runtime directory, and uses the same root for adapter configuration. Cursor uses
home/.cursor. macOS keychain accounts require a dedicated OS test user.
No credentials are copied to reports; the test account directories are retained.
--allow-live is mandatory for actual CLI execution. --validate-only checks paths
and arguments without starting the app or CLI. --max-turns must match the chosen
scenario and bounds user turns, not model-internal tool turns or dollars.
Each turn has a deadline. Reported usage can be unavailable and is not a billing
cap: provision an account/provider quota separately. POSIX runner only for now.

Credential-free runner check:
  ... --runtime <runtime> --output-dir <new-directory> --self-test
Self-tests use protocol fixtures and are never reported as live acceptance.
--self-test-fault turn-timeout intentionally stalls the first fixture turn to
verify that deadlines fail acceptance and still clean up the owned processes.
Real account and actual installer acceptance remain separate from self-tests.`;

export function parseLiveOptions(args) {
  const values = {};
  const flags = new Set(['--allow-live', '--self-test', '--headless', '--validate-only']);
  const keyed = new Set([
    '--runtime',
    '--cli-path',
    '--account-root',
    '--output-dir',
    '--max-turns',
    '--turn-timeout-ms',
    '--model',
    '--self-test-fault',
    '--scenario',
    '--peer-runtime',
    '--peer-cli-path',
    '--peer-model',
  ]);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--') continue;
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate argument ${key}`);
    if (flags.has(key)) values[key] = true;
    else if (keyed.has(key) && args[index + 1] && !args[index + 1].startsWith('--'))
      values[key] = args[++index];
    else throw new Error(`Invalid or incomplete argument ${key}`);
  }
  if (!['claude', 'codex', 'cursor'].includes(values['--runtime']))
    throw new Error('--runtime must name claude, codex, or cursor');
  if (!values['--output-dir']) throw new Error('--output-dir is required');
  const scenario = values['--scenario'] ?? 'coding';
  const cases = {
    coding: ['L01', 'L02', 'L03'],
    cancel: ['L04'],
    capabilities: ['L05'],
    concurrency: ['L06'],
  };
  if (!Object.hasOwn(cases, scenario))
    throw new Error('--scenario must be coding, cancel, capabilities or concurrency');
  const turns = ['cancel', 'concurrency'].includes(scenario) ? 2 : 3;
  const selfTest = !!values['--self-test'];
  if (scenario === 'concurrency') {
    if (
      !['claude', 'codex', 'cursor'].includes(values['--peer-runtime']) ||
      values['--peer-runtime'] === values['--runtime']
    )
      throw new Error('--peer-runtime must name a different supported runtime');
    if (!selfTest && !values['--peer-cli-path'])
      throw new Error('--peer-cli-path is required for live concurrency');
  } else if (['--peer-runtime', '--peer-cli-path', '--peer-model'].some(key => values[key]))
    throw new Error('Peer options require --scenario concurrency');
  if (values['--self-test-fault'] && (!selfTest || values['--self-test-fault'] !== 'turn-timeout'))
    throw new Error('--self-test-fault supports turn-timeout in --self-test mode only');
  if (values['--self-test-fault'] && scenario !== 'coding')
    throw new Error('--self-test-fault requires the coding scenario');
  if (
    selfTest &&
    [
      '--allow-live',
      '--cli-path',
      '--account-root',
      '--model',
      '--peer-cli-path',
      '--peer-model',
    ].some(key => values[key])
  )
    throw new Error('--self-test cannot use a real CLI, model, or account');
  if (!selfTest && (!values['--cli-path'] || !values['--account-root']))
    throw new Error('--cli-path and --account-root are required');
  if (!selfTest && !values['--allow-live'] && !values['--validate-only'])
    throw new Error('Actual execution requires --allow-live with a dedicated test account');
  const integer = (key, fallback, min, max) => {
    const raw = values[key] ?? fallback;
    if (!/^\d+$/.test(String(raw))) throw new Error(`${key} must be an integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${key} must be between ${min} and ${max}`);
    return value;
  };
  if (!selfTest && (!values['--max-turns'] || !values['--turn-timeout-ms']))
    throw new Error('--max-turns and --turn-timeout-ms must be explicit for live execution');
  return {
    runtime: values['--runtime'],
    peerRuntime: values['--peer-runtime'],
    peerCliPath: values['--peer-cli-path'] ? path.resolve(values['--peer-cli-path']) : undefined,
    peerModel: values['--peer-model'],
    scenario,
    coveredCases: cases[scenario],
    uncoveredCases: ['L01', 'L02', 'L03', 'L04', 'L05', 'L06'].filter(
      id => !cases[scenario].includes(id)
    ),
    cliPath: values['--cli-path'] ? path.resolve(values['--cli-path']) : undefined,
    accountRoot: values['--account-root'] ? path.resolve(values['--account-root']) : undefined,
    outputDirectory: path.resolve(values['--output-dir']),
    maxTurns: integer('--max-turns', turns, turns, turns),
    turnTimeoutMs: integer('--turn-timeout-ms', selfTest ? 15000 : undefined, 1000, 600000),
    model: values['--model'],
    selfTest,
    selfTestFault: values['--self-test-fault'],
    allowLive: !!values['--allow-live'],
    headless: selfTest || !!values['--headless'],
    validateOnly: !!values['--validate-only'],
  };
}

export async function validateLivePaths(options) {
  if (process.platform === 'win32')
    throw new Error(
      'This live runner currently requires a POSIX host; Windows acceptance remains outstanding'
    );
  try {
    await stat(options.outputDirectory);
    throw new Error('--output-dir must be a new directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (options.selfTest) return options;
  const accountRoot = await realpath(options.accountRoot);
  const home = await realpath(homedir());
  if (
    [home, ...['.claude', '.codex', '.cursor'].map(name => path.join(home, name))].includes(
      accountRoot
    )
  )
    throw new Error(
      'Use a dedicated test account root, not a default user configuration directory'
    );
  for (const name of [
    'home',
    options.runtime,
    ...(options.peerRuntime ? [options.peerRuntime] : []),
  ]) {
    const directory = await realpath(path.join(accountRoot, name));
    const relative = path.relative(accountRoot, directory);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative) ||
      !(await stat(directory)).isDirectory()
    )
      throw new Error(`Test account ${name}/ must be a directory within --account-root`);
  }
  const cliPath = await realpath(options.cliPath);
  if (!(await stat(cliPath)).isFile()) throw new Error('--cli-path must be a file');
  await access(cliPath, constants.X_OK);
  let peerCliPath;
  if (options.peerRuntime) {
    peerCliPath = await realpath(options.peerCliPath);
    if (!(await stat(peerCliPath)).isFile()) throw new Error('--peer-cli-path must be a file');
    await access(peerCliPath, constants.X_OK);
  }
  return { ...options, cliPath, peerCliPath, accountRoot };
}

// This runner currently certifies the locally built application only. Artifact
// overrides belong to the separate bundle harness and must not silently change
// the executable being tested while the evidence records a source entry hash.
export function validateLiveEnvironment(environment) {
  if (Object.keys(environment).some(key => key.startsWith('ZCLAUDIA_E2E_')))
    throw new Error('Clear ZCLAUDIA_E2E_ overrides before using the live runner');
}
