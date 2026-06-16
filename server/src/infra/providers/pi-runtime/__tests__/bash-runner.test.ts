import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runBash, persistBashFullOutput } from '../bash-runner.js';

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

  it('spawns the provided sandbox argv directly instead of shell -c', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-bash-sb-'));
    const r = await runBash({
      command: 'THIS_SHOULD_NOT_RUN',
      cwd: dir,
      timeoutSec: 10,
      sandbox: { argv: ['sh', '-c', 'echo SANDBOXED_PATH'], env: process.env },
    });
    rmSync(dir, { recursive: true, force: true });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('SANDBOXED_PATH');
    expect(r.output).not.toContain('THIS_SHOULD_NOT_RUN');
  });

  it('feeds stdin to the child process', async () => {
    const dir = TMP();
    const result = await runBash({ command: 'cat -', cwd: dir, timeoutSec: 10, stdin: 'hello stdin' });
    rmSync(dir, { recursive: true, force: true });
    expect(result.exitCode).toBe(0);
    expect(result.fullOutput).toContain('hello stdin');
  });

  it('merges extraEnv over process.env', async () => {
    const dir = TMP();
    const result = await runBash({ command: 'echo "$ZC_TEST_VAR"', cwd: dir, timeoutSec: 10, extraEnv: { ZC_TEST_VAR: 'zc-42' } });
    rmSync(dir, { recursive: true, force: true });
    expect(result.fullOutput).toContain('zc-42');
  });

  it('captures stderr separately in stderrOutput', async () => {
    const dir = TMP();
    const result = await runBash({ command: 'echo out; echo err >&2; exit 2', cwd: dir, timeoutSec: 10 });
    rmSync(dir, { recursive: true, force: true });
    expect(result.exitCode).toBe(2);
    expect(result.stderrOutput).toContain('err');
    expect(result.stderrOutput).not.toContain('out');
    expect(result.fullOutput).toContain('out');
  });

  it('caps stderr at 64KB and spills the complete output to disk when capped', async () => {
    const dir = TMP();
    const dataDir = mkdtempSync(join(tmpdir(), 'zc-bashdata-'));
    const prev = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
    try {
      const result = await runBash({
        command: "python3 -c \"import sys; sys.stderr.write('e' * 100000)\" ; exit 0",
        cwd: dir,
        timeoutSec: 10
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderrOutput.length).toBeLessThanOrEqual(66 * 1024); // ~64KB capture cap (+ at most one chunk)
      // Output exceeds the in-memory cap: fullOutput is the tail, complete content on disk.
      expect(result.truncated).toBe(true);
      expect(result.fullOutputPath).toBeDefined();
      expect(result.fullOutput.length).toBeLessThanOrEqual(52 * 1024);
      expect(readFileSync(result.fullOutputPath!, 'utf8').length).toBeGreaterThan(99000);
    } finally {
      if (prev === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
      else process.env.ZCLAUDIA_DATA_DIR = prev;
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sweeps spilled bash logs older than the TTL on the next persist', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zc-bashlogs-'));
    const prev = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
    try {
      const fresh = persistBashFullOutput('fresh'); // creates the dir + a recent file
      const stale = join(dataDir, 'bash-logs', 'stale-old.log');
      writeFileSync(stale, 'old');
      const backdated = Date.now() / 1000 - 25 * 60 * 60; // 25h ago, past the 24h TTL
      utimesSync(stale, backdated, backdated);

      const newer = persistBashFullOutput('newer'); // triggers the sweep

      expect(existsSync(stale)).toBe(false); // swept
      expect(existsSync(fresh)).toBe(true);  // recent, kept
      expect(existsSync(newer)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
      else process.env.ZCLAUDIA_DATA_DIR = prev;
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
