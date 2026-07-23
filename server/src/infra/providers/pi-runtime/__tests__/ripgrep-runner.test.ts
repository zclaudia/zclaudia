import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runRipgrep, runStreamingProcess } from '../ripgrep-runner.js';

describe('runRipgrep', () => {
  it('streams matching file lines and reports not-truncated under the limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-rg-'));
    writeFileSync(join(dir, 'a.ts'), 'const x = 1;\n');
    writeFileSync(join(dir, 'b.ts'), 'const y = 2;\n');
    const { lines, truncated, exitCode } = await runRipgrep(['--files', '--glob', '*.ts', dir], {
      maxLines: 100,
    });
    rmSync(dir, { recursive: true, force: true });
    expect(exitCode).toBe(0);
    expect(truncated).toBe(false);
    expect(lines.length).toBe(2);
  });

  it('stops at maxLines and reports truncated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-rg-'));
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.ts`), 'x\n');
    const { lines, truncated } = await runRipgrep(['--files', dir], { maxLines: 3 });
    rmSync(dir, { recursive: true, force: true });
    expect(lines.length).toBe(3);
    expect(truncated).toBe(true);
  });

  it('returns exitCode 1 with no lines when nothing matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-rg-'));
    writeFileSync(join(dir, 'a.ts'), 'hello\n');
    const { lines, exitCode } = await runRipgrep(['nonexistent_pattern_zzz', dir], {
      maxLines: 100,
    });
    rmSync(dir, { recursive: true, force: true });
    expect(exitCode).toBe(1);
    expect(lines.length).toBe(0);
  });

  it('marks truncated when the timeout fires before all lines are read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-rg-timeout-'));
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.ts`), 'x\n');
    // timeoutMs: 0 fires on the next tick, before spawn I/O delivers lines
    const { truncated } = await runRipgrep(['--files', dir], { maxLines: 100, timeoutMs: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(truncated).toBe(true);
  });

  it('caps accumulated stderr at 8KB and keeps the head', async () => {
    const result = await runStreamingProcess(
      process.execPath,
      ['-e', 'process.stderr.write("x".repeat(64 * 1024))'],
      { maxLines: 10 }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stderr.length).toBeLessThanOrEqual(8 * 1024);
    expect(result.stderr.startsWith('xxxx')).toBe(true);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const start = Date.now();
    const result = await runStreamingProcess(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { maxLines: 10, timeoutMs: 100 }
    );
    const elapsed = Date.now() - start;

    expect(result.truncated).toBe(true);
    // Killed by signal (SIGKILL after the grace period), not by exit code.
    expect(result.exitCode).toBeNull();
    expect(elapsed).toBeLessThan(5_000);
  });
});
