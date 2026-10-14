import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateUpdaterSigning } from '../validate-updater-signing.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), 'zclaudia-signing-tests-'));
after(() => rmSync(directory, { recursive: true, force: true }));

function generate(name, password) {
  const keyPath = path.join(directory, name);
  const generated = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'),
      'signer',
      'generate',
      '--ci',
      '--password',
      password,
      '--write-keys',
      keyPath,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }
  );
  assert.equal(generated.status, 0, 'Tauri should generate the isolated test keypair');
  return {
    privateKey: readFileSync(keyPath, 'utf8'),
    publicKey: readFileSync(`${keyPath}.pub`, 'utf8'),
    password,
  };
}

const encrypted = generate('encrypted.key', 'fixture-password');
const emptyPassword = generate('empty-password.key', '');

test('signs a probe and verifies against the shipped public key, with an encrypted key', () => {
  assert.doesNotThrow(() => validateUpdaterSigning(encrypted));
});

test('supports a key generated with an empty password without prompting', () => {
  assert.doesNotThrow(() => validateUpdaterSigning(emptyPassword));
});

test('fails missing or empty repository secrets explicitly', () => {
  assert.throws(() => validateUpdaterSigning({ ...encrypted, privateKey: '' }), /missing or empty/);
});

test('rejects raw decoded minisign text and double-encoded key contents', () => {
  const decoded = Buffer.from(encrypted.privateKey, 'base64').toString();
  assert.throws(
    () => validateUpdaterSigning({ ...encrypted, privateKey: decoded }),
    /without decoding/
  );
  const doubleEncoded = Buffer.from(encrypted.privateKey).toString('base64');
  assert.throws(
    () => validateUpdaterSigning({ ...encrypted, privateKey: doubleEncoded }),
    /do not base64-encode/
  );
});

test('rejects the wrong password without exposing the secret or subprocess output', () => {
  assert.throws(
    () => validateUpdaterSigning({ ...encrypted, password: 'wrong-password' }),
    error => {
      assert.match(error.message, /matching TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
      assert.ok(!error.message.includes(encrypted.privateKey));
      assert.ok(!error.message.includes('wrong-password'));
      return true;
    }
  );
});

test('rejects a valid signing key that does not match existing clients', () => {
  assert.throws(
    () => validateUpdaterSigning({ ...encrypted, publicKey: emptyPassword.publicKey }),
    /does not match/
  );
});

test('verifies the cryptographic signature even when the public key id matches', () => {
  const lines = Buffer.from(encrypted.publicKey, 'base64').toString().trim().split('\n');
  const packet = Buffer.from(lines[1], 'base64');
  packet[packet.length - 1] ^= 1;
  lines[1] = packet.toString('base64');
  const publicKey = Buffer.from(lines.join('\n') + '\n').toString('base64');
  assert.throws(() => validateUpdaterSigning({ ...encrypted, publicKey }), /does not match/);
});
