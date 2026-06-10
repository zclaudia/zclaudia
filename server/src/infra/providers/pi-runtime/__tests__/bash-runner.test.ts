import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runBash } from '../bash-runner.js';

const TMP = () => mkdtempSync(join(tmpdir(), 'zc-bash-'));

describe('runBash', () => {
  it('captures merged stdout+stderr and returns exit code 0', async () => {
    const dir = TMP();
    const r = await runBash({ command: 'echo out; echo err 1>&2', cwd: dir, timeoutSec: 10 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('out');
    expect(r.output).toContain('err');
    expect(r.timedOut).toBe(false);
    expect(r.aborted).toBe(false);
  });

  it('returns the real non-zero exit code', async () => {
    const dir = TMP();
    const r = await runBash({ command: 'exit 3', cwd: dir, timeoutSec: 10 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.exitCode).toBe(3);
  });

  it('kills on timeout and flags timedOut', async () => {
    const dir = TMP();
    const start = Date.now();
    const r = await runBash({ command: 'sleep 5', cwd: dir, timeoutSec: 1 });
    const elapsed = Date.now() - start;
    rmSync(dir, { recursive: true, force: true });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(elapsed).toBeLessThan(3000);
  });

  it('returns aborted immediately for an already-aborted signal', async () => {
    const dir = TMP();
    const r = await runBash({ command: 'echo hi', cwd: dir, timeoutSec: 10, signal: AbortSignal.abort() });
    rmSync(dir, { recursive: true, force: true });
    expect(r.aborted).toBe(true);
  });

  it('does not hang when the command leaves a backgrounded child holding stdout', async () => {
    const dir = TMP();
    const start = Date.now();
    const r = await runBash({ command: '( sleep 30 & ) ; echo done', cwd: dir, timeoutSec: 10 });
    const elapsed = Date.now() - start;
    rmSync(dir, { recursive: true, force: true });
    expect(r.output).toContain('done');
    expect(elapsed).toBeLessThan(3000); // resolves on exit + grace, not after 30s
  });

  it('truncates to the tail by line count and keeps full output', async () => {
    const dir = TMP();
    const r = await runBash({ command: "printf 'a\\nb\\nc\\nd\\ne\\n'", cwd: dir, timeoutSec: 10, maxLines: 2 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.truncated).toBe(true);
    expect(r.output).toBe('d\ne\n');
    expect(r.fullOutput).toBe('a\nb\nc\nd\ne\n');
  });
});
