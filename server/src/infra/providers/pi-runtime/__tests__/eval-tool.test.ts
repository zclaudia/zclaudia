import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildTools } from '../tool-bridge.js';
import { __shutdownAllEvalKernelsForTests } from '../eval-kernel.js';
import { __resetSandboxCacheForTests } from '../sandbox.js';

let counter = 0;

function makeEval(options: Record<string, unknown> = {}): { tool: any; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'zc-eval-'));
  const sessionId = `eval-test-${process.pid}-${counter++}`;
  const tools = buildTools(dir, { enabled: ['Eval'], sessionId, ...options });

  return { tool: tools.find((t: any) => t.name === 'Eval'), dir };
}

describe('Eval tool', () => {
  afterEach(async () => {
    await __shutdownAllEvalKernelsForTests();
  });

  it('evaluates an expression and returns its value', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e1', { code: '1 + 1' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.content[0].text).toContain('2');
  });

  it('persists state across cells within a session', async () => {
    const { tool, dir } = makeEval();
    await tool.execute('e1', { code: 'var counter = 41' });
    const res = await tool.execute('e2', { code: 'counter + 1' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.content[0].text).toContain('42');
  });

  it('captures console output', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e1', { code: 'console.log("hello from eval"); 7' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.content[0].text).toContain('hello from eval');
    expect(res.content[0].text).toContain('7');
  });

  it('supports await with an explicit return', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e1', { code: 'return await Promise.resolve(40) + 2' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.content[0].text).toContain('42');
  });

  it('reports thrown errors without killing the kernel', async () => {
    const { tool, dir } = makeEval();
    const bad = await tool.execute('e1', { code: 'throw new Error("boom")' });
    expect(bad.details.ok).toBe(false);
    expect(bad.content[0].text).toContain('boom');
    const good = await tool.execute('e2', { code: '"still " + "alive"' });
    rmSync(dir, { recursive: true, force: true });
    expect(good.details.ok).toBe(true);
    expect(good.content[0].text).toContain('still alive');
  });

  it('kills a runaway cell at the timeout and restarts the kernel', async () => {
    const { tool, dir } = makeEval();
    await tool.execute('e0', { code: 'var precious = "state"' });
    const hung = await tool.execute('e1', { code: 'while (true) {}', timeout: 1 });
    expect(hung.details.ok).toBe(false);
    expect(hung.content[0].text).toMatch(/timed out/i);

    const after = await tool.execute('e2', { code: 'typeof precious' });
    rmSync(dir, { recursive: true, force: true });
    expect(after.details.ok).toBe(true);
    expect(after.content[0].text).toContain('undefined'); // state lost on restart
  }, 20000);

  it('reset wipes kernel state', async () => {
    const { tool, dir } = makeEval();
    await tool.execute('e1', { code: 'var keep = 123' });
    const res = await tool.execute('e2', { code: 'typeof keep', reset: true });
    rmSync(dir, { recursive: true, force: true });
    expect(res.content[0].text).toContain('undefined');
  });

  it('requires code', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e1', {});
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.error).toBe('missing_code');
  });

  it('requires database context for background execution', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e-bg-no-db', { code: '1 + 1', run_in_background: true });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'missing_db_context',
    });
  });

  it('exposes sandbox_mode and privilege_reason parameters', () => {
    const { tool, dir } = makeEval();
    rmSync(dir, { recursive: true, force: true });

    expect(tool.parameters.properties.sandbox_mode.enum).toEqual([
      'auto',
      'sandbox',
      'unsandboxed',
    ]);
    expect(tool.parameters.properties.privilege_reason.type).toBe('string');
  });

  it('requires privilege_reason for unsandboxed Eval', async () => {
    const permissionCallback = vi.fn();
    const { tool, dir } = makeEval({ permissionCallback });

    const res = await tool.execute('eval-unsandboxed-no-reason', {
      code: '1 + 1',
      sandbox_mode: 'unsandboxed',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(permissionCallback).not.toHaveBeenCalled();
    expect(res.details.ok).toBe(false);
    expect(res.content[0].text).toContain('privilege_reason');
  });

  it('requests unsandboxed permission before host Eval execution', async () => {
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' }));
    const { tool, dir } = makeEval({ permissionCallback });

    const res = await tool.execute('eval-unsandboxed-yes', {
      code: '"HOST_EVAL_OK"',
      sandbox_mode: 'unsandboxed',
      privilege_reason: 'Need to verify host Eval execution path.',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxUnsandboxedAccess' })
    );
    expect(res.content[0].text).toContain('HOST_EVAL_OK');
    expect(res.details.privilegeMode).toBe('unsandboxed');
    expect(res.details.unsandboxedApproved).toBe(true);
  });

  it('rejects non-integer timeout values', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e-invalid-timeout', { code: '1 + 1', timeout: 0.5 });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'invalid_timeout',
    });
  });

  it('blocks sensitive home file reads even when the sandbox is unavailable', async () => {
    const { tool, dir } = makeEval();
    const home = mkdtempSync(path.join(tmpdir(), 'zc-eval-home-'));
    const previousHome = process.env.HOME;
    const previousSandbox = process.env.ZCLAUDIA_SANDBOX;
    process.env.HOME = home;
    process.env.ZCLAUDIA_SANDBOX = 'off';
    __resetSandboxCacheForTests();
    mkdirSync(path.join(home, '.ssh'));
    writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'FAKE_EVAL_PRIVATE_KEY\n');

    const res = await tool.execute('e-sensitive-home', {
      code: 'require("fs").readFileSync("~/.ssh/id_rsa", "utf8")',
    });

    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSandbox === undefined) delete process.env.ZCLAUDIA_SANDBOX;
    else process.env.ZCLAUDIA_SANDBOX = previousSandbox;
    __resetSandboxCacheForTests();
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'eval_sensitive_path_blocked',
      path: '~/.ssh/id_rsa',
    });
    expect(res.content[0].text).not.toContain('FAKE_EVAL_PRIVATE_KEY');
  });

  it('caps large eval output and writes the full output to a secure log', async () => {
    const { tool, dir } = makeEval();
    const res = await tool.execute('e-large-output', {
      code: 'console.log("x".repeat(200000)); "done"',
    });
    const fullOutputPath = res.details.fullOutputPath as string;
    const fullOutput = readFileSync(fullOutputPath, 'utf8');
    const fullOutputStat = statSync(fullOutputPath);

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      outputTruncated: true,
    });
    expect(res.content[0].text.length).toBeLessThan(90_000);
    expect(fullOutputPath).toContain('zclaudia-eval-logs');
    expect(fullOutputStat.mode & 0o777).toBe(0o600);
    expect(fullOutput).toContain('x'.repeat(1000));
    expect(fullOutput).toContain('done');
  });
});
