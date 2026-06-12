import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildTools } from '../tool-bridge.js';
import { __shutdownAllEvalKernelsForTests } from '../eval-kernel.js';

let counter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEval(options: Record<string, unknown> = {}): { tool: any; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'zc-eval-'));
  const sessionId = `eval-test-${process.pid}-${counter++}`;
  const tools = buildTools(dir, { enabled: ['Eval'], sessionId, ...options });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
});
