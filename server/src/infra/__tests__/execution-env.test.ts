import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExecutionEnv, unwrapResult } from '../execution-env.js';

describe('createExecutionEnv', () => {
  let tmpRoot: string;
  beforeEach(() => { tmpRoot = mkdtempSync(path.join(tmpdir(), 'zc-env-')); });
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

  it('readTextFile returns ok on success', async () => {
    const file = path.join(tmpRoot, 'hello.txt');
    writeFileSync(file, 'hi');
    const env = createExecutionEnv(tmpRoot);
    const r = await env.readTextFile(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hi');
  });

  it('readTextFile returns not_found error for missing file', async () => {
    const env = createExecutionEnv(tmpRoot);
    const r = await env.readTextFile(path.join(tmpRoot, 'nope.txt'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });

  it('listDir enumerates direct children', async () => {
    mkdirSync(path.join(tmpRoot, 'a'));
    writeFileSync(path.join(tmpRoot, 'b.txt'), 'x');
    const env = createExecutionEnv(tmpRoot);
    const r = await env.listDir(tmpRoot);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.value.map(i => i.name).sort();
      expect(names).toEqual(['a', 'b.txt']);
    }
  });

  it('exists returns ok(true) for existing, ok(false) for missing', async () => {
    const env = createExecutionEnv(tmpRoot);
    const ok1 = await env.exists(tmpRoot);
    const ok2 = await env.exists(path.join(tmpRoot, 'no'));
    expect(ok1).toEqual({ ok: true, value: true });
    expect(ok2).toEqual({ ok: true, value: false });
  });

  it('cwd is set from constructor', () => {
    const env = createExecutionEnv(tmpRoot);
    expect(env.cwd).toBe(tmpRoot);
  });

  it('cleanup is callable and idempotent', async () => {
    const env = createExecutionEnv(tmpRoot);
    await env.cleanup();
    await env.cleanup();
  });
});

describe('unwrapResult', () => {
  it('returns value on ok', () => {
    expect(unwrapResult({ ok: true, value: 42 })).toBe(42);
  });

  it('throws error on err', () => {
    const err = new Error('boom');
    expect(() => unwrapResult({ ok: false, error: err })).toThrow('boom');
  });
});
