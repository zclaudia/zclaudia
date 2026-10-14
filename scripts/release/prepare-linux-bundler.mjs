// Tauri CLI 2.11.2 pins rpm 0.16.0, whose Sha256Writer hashes bytes before
// the compressor accepts them. Short writes repeatedly hash the remaining
// input and produce an incorrect uncompressed payload digest. Build the same
// CLI with that write contract fixed until its upstream dependency is updated.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const testOnly = process.argv.includes('--test-only');
if (!testOnly && (process.platform !== 'linux' || !process.env.GITHUB_ENV)) {
  throw new Error('The patched Linux bundler must be prepared inside GitHub Actions');
}
const cliVersion = JSON.parse(
  await readFile(path.join(repo, 'apps/desktop/node_modules/@tauri-apps/cli/package.json'), 'utf8')
).version;
if (cliVersion !== '2.11.2') {
  throw new Error('Tauri CLI changed; review or remove the rpm 0.16.0 short-write workaround');
}
const work = await mkdtemp(path.join(tmpdir(), 'zclaudia-linux-bundler-'));
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
async function download(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'zclaudia-ci (https://github.com/zclaudia/zclaudia)' },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} (${url})`);
  return Buffer.from(await response.arrayBuffer());
}
async function unpack(name, version, checksum) {
  const archive = await download(
    `https://static.crates.io/crates/${name}/${name}-${version}.crate`
  );
  if (createHash('sha256').update(archive).digest('hex') !== checksum) {
    throw new Error(`${name} archive checksum does not match its registry/lockfile`);
  }
  const filename = path.join(work, `${name}.crate`);
  await writeFile(filename, archive);
  run('tar', ['-xzf', filename, '-C', work]);
  return path.join(work, `${name}-${version}`);
}
const cliIndex = (await download('https://index.crates.io/ta/ur/tauri-cli'))
  .toString('utf8')
  .trim()
  .split('\n')
  .map(line => JSON.parse(line));
const cliChecksum = cliIndex.find(entry => entry.vers === cliVersion)?.cksum;
if (!cliChecksum) throw new Error('Pinned Tauri CLI is missing from the registry index');
const cli = await unpack('tauri-cli', cliVersion, cliChecksum);
const lockPath = path.join(cli, 'Cargo.lock');
const lock = await readFile(lockPath, 'utf8');
const rpmBlock = lock
  .split('[[package]]')
  .find(block => /^\s*name = "rpm"\nversion = "0\.16\.0"\n/.test(block));
if (!rpmBlock) throw new Error('Tauri no longer pins rpm 0.16.0; review the workaround');
const rpmChecksum = /^checksum = "([a-f0-9]{64})"$/m.exec(rpmBlock)?.[1];
if (!rpmChecksum) throw new Error('rpm checksum is missing from the CLI lockfile');
const rpm = await unpack('rpm', '0.16.0', rpmChecksum);
const writerPath = path.join(rpm, 'src/rpm/headers/types.rs');
const writer = await readFile(writerPath, 'utf8');
const oldWrite = '        self.hasher.update(buf);\n        self.writer.write(buf)';
if (writer.split(oldWrite).length !== 2) {
  throw new Error('Unexpected rpm Sha256Writer source; refusing to patch it');
}
await writeFile(
  writerPath,
  writer.replace(
    oldWrite,
    '        let written = self.writer.write(buf)?;\n        self.hasher.update(&buf[..written]);\n        Ok(written)'
  )
);
const localRpmBlock = rpmBlock.replace(/^source = .*\n/m, '').replace(/^checksum = .*\n/m, '');
await writeFile(lockPath, lock.replace(rpmBlock, localRpmBlock));
await appendFile(
  path.join(cli, 'Cargo.toml'),
  `\n[patch.crates-io]\nrpm = { path = ${JSON.stringify(rpm)} }\n`
);

// Exercise the exact patched dependency with real short writes and a gzip RPM
// round-trip, including its uncompressed payload digest (the old code fails).
const probe = path.join(work, 'probe');
run('mkdir', ['-p', path.join(probe, 'src')]);
await writeFile(
  path.join(probe, 'Cargo.toml'),
  `[package]\nname = "zclaudia-rpm-contract"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nrpm = { path = ${JSON.stringify(rpm)}, default-features = false, features = ["gzip-compression"] }\nflate2 = "1"\nsha2 = "0.10"\n`
);
await writeFile(
  path.join(probe, 'src/lib.rs'),
  await readFile(new URL('./__tests__/rpm-short-write.rs', import.meta.url))
);
run('cargo', ['test', '--release', '--manifest-path', path.join(probe, 'Cargo.toml')], {
  cwd: probe,
  env: { ...process.env, ZCLAUDIA_RPM_SAMPLE_BIN: process.execPath },
});
// Cargo must accept the patched source with every other dependency still pinned.
run(
  'cargo',
  [
    'metadata',
    '--locked',
    '--format-version',
    '1',
    '--manifest-path',
    path.join(cli, 'Cargo.toml'),
  ],
  {
    cwd: cli,
    stdio: ['ignore', 'ignore', 'inherit'],
  }
);
if (!testOnly) {
  const target = path.join(work, 'target');
  run(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      '--manifest-path',
      path.join(cli, 'Cargo.toml'),
      '--target-dir',
      target,
    ],
    { cwd: cli }
  );
  const binary = path.join(target, 'release/cargo-tauri');
  run(binary, ['--version']);
  await appendFile(process.env.GITHUB_ENV, `ZCLAUDIA_TAURI_BIN=${binary}\n`);
}
console.log('RPM short-write contract and payload digest verified');
