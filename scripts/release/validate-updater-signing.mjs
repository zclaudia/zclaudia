import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliPath = path.join(repoRoot, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js');

function decodeBox(value, label) {
  const encoded = value?.trim();
  if (!encoded) throw new Error(`${label} is missing or empty.`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(
      `${label} must contain the complete Tauri-generated key file, without decoding it.`
    );
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (
    decoded.toString('base64') !== encoded ||
    !decoded.toString('utf8').startsWith('untrusted comment:')
  ) {
    throw new Error(
      `${label} has invalid Tauri key encoding. Use the original key file contents; do not base64-encode them again.`
    );
  }
  return decoded.toString('utf8').trim().split(/\r?\n/);
}

// Sign a disposable probe with the real Tauri CLI, then verify it against the
// public key shipped to existing clients. Never print key contents or the
// signer's stdout/stderr: even malformed secrets must stay out of CI logs.
export function validateUpdaterSigning({
  privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY,
  password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  publicKey = JSON.parse(
    readFileSync(path.join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')
  ).plugins.updater.pubkey,
} = {}) {
  decodeBox(privateKey, 'TAURI_SIGNING_PRIVATE_KEY');
  const publicLines = decodeBox(publicKey, 'Configured updater public key');
  const publicPacket = Buffer.from(publicLines[1] ?? '', 'base64');
  if (publicPacket.length !== 42 || publicPacket.subarray(0, 2).toString() !== 'Ed') {
    throw new Error('Configured updater public key is not a minisign Ed25519 public key.');
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'zclaudia-updater-check-'));
  try {
    const keyPath = path.join(directory, 'private.key');
    const probePath = path.join(directory, 'probe');
    const probe = Buffer.from('ZClaudia updater signing preflight\n');
    writeFileSync(keyPath, privateKey.trim(), { mode: 0o600 });
    writeFileSync(probePath, probe);
    const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
    for (const name of [
      'TAURI_SIGNING_PRIVATE_KEY',
      'TAURI_SIGNING_PRIVATE_KEY_PATH',
      'TAURI_PRIVATE_KEY',
      'TAURI_PRIVATE_KEY_PATH',
      'TAURI_KEY_PASSWORD',
    ])
      delete env[name];
    const signed = spawnSync(
      process.execPath,
      [cliPath, 'signer', 'sign', '--private-key-path', keyPath, probePath],
      {
        env,
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    if (signed.error || signed.status !== 0) {
      throw new Error(
        'Tauri could not sign the probe. Check TAURI_SIGNING_PRIVATE_KEY and its matching TAURI_SIGNING_PRIVATE_KEY_PASSWORD (empty for an empty-password key).'
      );
    }
    const signatureLines = decodeBox(readFileSync(`${probePath}.sig`, 'utf8'), 'Probe signature');
    const packet = Buffer.from(signatureLines[1] ?? '', 'base64');
    const algorithm = packet.subarray(0, 2).toString();
    if (packet.length !== 74 || !['Ed', 'ED'].includes(algorithm))
      throw new Error('Unexpected minisign probe signature format.');
    // SPKI header for a raw 32-byte Ed25519 public key (RFC 8410).
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        publicPacket.subarray(10),
      ]),
      format: 'der',
      type: 'spki',
    });
    const message = algorithm === 'ED' ? createHash('blake2b512').update(probe).digest() : probe;
    if (
      !packet.subarray(2, 10).equals(publicPacket.subarray(2, 10)) ||
      !verify(null, message, key, packet.subarray(10))
    ) {
      throw new Error(
        'Signing key does not match the updater public key in tauri.conf.json. Restore the existing keypair before publishing updates.'
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateUpdaterSigning();
    console.log(
      'Updater signing key/password validated; signature matches the configured public key.'
    );
  } catch (error) {
    console.error(`Updater signing preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
