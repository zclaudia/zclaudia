import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from '../../utils/data-dir.js';

/**
 * Independent HMAC key for session runtime-binding integrity (design:
 * docs/plans/2026-09-11-claude-dual-mode-runtime-design.md §7.1).
 *
 * This deliberately does NOT reuse `mcp-oauth-credential-protector.ts`: not its
 * key material, not its env variable, and critically not its read-failure
 * fallback to a `hostname:homedir`-derived string — a binding key that
 * silently degrades would let connection-identity checks pass across machines.
 * Failures here are loud: `RUNTIME_BINDING_KEY_UNAVAILABLE`, and SDK runs that
 * need the key refuse to start.
 *
 * The key protects connection-identity hashes only. It does not encrypt the
 * plaintext `llm_profiles.api_key` column (that migration is explicitly out of
 * scope for this phase).
 */

export class RuntimeBindingKeyUnavailableError extends Error {
  readonly code = 'RUNTIME_BINDING_KEY_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeBindingKeyUnavailableError';
  }
}

const KEY_FILE_NAME = 'runtime-binding-key';
const KEY_BYTES = 32;
const HMAC_PURPOSE = 'zclaudia:runtime-binding-identity:v1';

interface RuntimeBindingKeyOptions {
  dataDir?: string;
  /**
   * Creation is only allowed while no HMAC-backed binding exists yet. Once
   * bindings reference connection hashes, a lost/corrupt key file must fail
   * closed — regenerating would silently re-bind old sessions to unverified
   * connections.
   */
  allowCreate: boolean;
}

function keyPathFor(dataDir: string): string {
  return path.join(dataDir, KEY_FILE_NAME);
}

function decodeKeyMaterial(raw: string, dataDir: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), 'base64url');
  } catch {
    throw new RuntimeBindingKeyUnavailableError(
      `Runtime binding key at ${keyPathFor(dataDir)} is corrupt (not base64url). Restore the key from backup; it will not be regenerated.`
    );
  }
  if (key.length !== KEY_BYTES) {
    throw new RuntimeBindingKeyUnavailableError(
      `Runtime binding key at ${keyPathFor(dataDir)} is corrupt (expected ${KEY_BYTES} bytes, got ${key.length}). Restore the key from backup; it will not be regenerated.`
    );
  }
  return key;
}

function readKeyFile(dataDir: string): Buffer {
  const file = keyPathFor(dataDir);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new RuntimeBindingKeyUnavailableError(
      `Runtime binding key at ${file} could not be read (${error instanceof Error ? error.message : String(error)}). Restore the key from backup; it will not be regenerated.`
    );
  }
  return decodeKeyMaterial(raw, dataDir);
}

/** Whether a binding key file exists (creation decisions use this, not reads). */
export function runtimeBindingKeyExists(dataDir: string = resolveDataDir()): boolean {
  return existsSync(keyPathFor(dataDir));
}

/**
 * Read the runtime binding key, creating it exclusively when allowed.
 * - Existing key: returned as-is; any read/decode failure throws (fail closed).
 * - Missing key + `allowCreate`: created with exclusive semantics (concurrent
 *   creators converge on the first successful write), 0700 dir / 0600 file.
 * - Missing key + `!allowCreate`: throws — an existing binding population must
 *   never trigger silent key generation.
 */
export function getOrCreateRuntimeBindingKey(options: RuntimeBindingKeyOptions): Buffer {
  const dataDir = options.dataDir ?? resolveDataDir();
  const file = keyPathFor(dataDir);
  if (existsSync(file)) return readKeyFile(dataDir);
  if (!options.allowCreate) {
    throw new RuntimeBindingKeyUnavailableError(
      `Runtime binding key at ${file} is missing while runtime bindings already exist. Restore the key from backup or explicitly rebuild affected session bindings.`
    );
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  try {
    // 'wx' fails if another creator won the race — then read theirs.
    const fd = openSync(file, 'wx', 0o600);
    try {
      writeFileSync(fd, key.toString('base64url'), 'utf8');
    } finally {
      closeSync(fd);
    }
    return key;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'EEXIST') return readKeyFile(dataDir);
    throw new RuntimeBindingKeyUnavailableError(
      `Runtime binding key could not be created at ${file} (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

export interface ConnectionIdentity {
  protocol: string;
  /** Normalized endpoint exactly as it will be used. */
  baseUrl: string;
  authMethod: string;
  /** Routing headers by name AND value (values may steer routing; the main API key must not be included). */
  headers?: Record<string, string>;
}

/**
 * Purpose-labelled, canonically serialized HMAC-SHA-256 over the connection
 * identity. Deterministic for identical connections; infeasible to forge a
 * hash for a modified endpoint/headers without the key file.
 */
export function computeConnectionIdentityHash(
  key: Buffer,
  identity: ConnectionIdentity
): string {
  const headers = Object.entries(identity.headers ?? {})
    .map(([name, value]) => [name.trim().toLowerCase(), value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = JSON.stringify({
    protocol: identity.protocol,
    baseUrl: identity.baseUrl,
    authMethod: identity.authMethod,
    headers,
  });
  return createHmac('sha256', key).update(`${HMAC_PURPOSE}:${canonical}`).digest('hex');
}

/** Constant-time comparison for stored vs computed binding hashes. */
export function connectionIdentityHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
