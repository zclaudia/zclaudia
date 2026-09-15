import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeConnectionIdentityHash,
  connectionIdentityHashesMatch,
  getOrCreateRuntimeBindingKey,
  runtimeBindingKeyExists,
  RuntimeBindingKeyUnavailableError,
} from '../runtime-binding-key.js';

function makeDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'runtime-binding-key-'));
}

describe('runtime binding key', () => {
  it('creates a 32-byte key exactly once and converges on concurrent creation', () => {
    const dataDir = makeDataDir();
    try {
      expect(runtimeBindingKeyExists(dataDir)).toBe(false);
      const first = getOrCreateRuntimeBindingKey({ dataDir, allowCreate: true });
      expect(first.length).toBe(32);
      expect(runtimeBindingKeyExists(dataDir)).toBe(true);
      const again = getOrCreateRuntimeBindingKey({ dataDir, allowCreate: true });
      expect(again.equals(first)).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('refuses to create when bindings already exist (fail closed)', () => {
    const dataDir = makeDataDir();
    try {
      expect(() => getOrCreateRuntimeBindingKey({ dataDir, allowCreate: false })).toThrow(
        RuntimeBindingKeyUnavailableError
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('throws on a corrupt key instead of regenerating', () => {
    const dataDir = makeDataDir();
    try {
      writeFileSync(path.join(dataDir, 'runtime-binding-key'), 'not-a-valid-key!!!');
      expect(() => getOrCreateRuntimeBindingKey({ dataDir, allowCreate: true })).toThrow(
        RuntimeBindingKeyUnavailableError
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('throws on a wrong-length key', () => {
    const dataDir = makeDataDir();
    try {
      writeFileSync(
        path.join(dataDir, 'runtime-binding-key'),
        Buffer.from('short').toString('base64url')
      );
      expect(() => getOrCreateRuntimeBindingKey({ dataDir, allowCreate: true })).toThrow(
        /expected 32 bytes/
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('connection identity hash', () => {
  const key = Buffer.alloc(32, 7);

  it('is deterministic for identical connections and sensitive to changes', () => {
    const identity = {
      protocol: 'openai-responses',
      baseUrl: 'https://api.example.com/v1',
      authMethod: 'api-key',
      headers: { 'X-Pool': 'a' },
    };
    const a = computeConnectionIdentityHash(key, identity);
    const b = computeConnectionIdentityHash(key, { ...identity });
    expect(a).toBe(b);
    expect(
      computeConnectionIdentityHash(key, { ...identity, baseUrl: 'https://other/v1' })
    ).not.toBe(a);
    expect(
      computeConnectionIdentityHash(key, { ...identity, headers: { 'X-Pool': 'b' } })
    ).not.toBe(a);
    // Header order must not matter (canonical serialization).
    expect(
      computeConnectionIdentityHash(key, { ...identity, headers: { 'X-Pool': 'a', 'A-B': 'c' } })
    ).toBe(
      computeConnectionIdentityHash(key, { ...identity, headers: { 'A-B': 'c', 'X-Pool': 'a' } })
    );
  });

  it('differs across keys and compares in constant time', () => {
    const identity = {
      protocol: 'anthropic-messages',
      baseUrl: 'https://x',
      authMethod: 'api-key',
    };
    expect(computeConnectionIdentityHash(Buffer.alloc(32, 1), identity)).not.toBe(
      computeConnectionIdentityHash(Buffer.alloc(32, 2), identity)
    );
    const hash = computeConnectionIdentityHash(key, identity);
    expect(connectionIdentityHashesMatch(hash, hash)).toBe(true);
    expect(connectionIdentityHashesMatch(hash, 'different')).toBe(false);
  });
});
