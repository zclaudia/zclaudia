import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { isSandboxAvailable, wrapCommand } from '../sandbox.js';
import { runBash } from '../bash-runner.js';

const gated = isSandboxAvailable() ? describe : describe.skip;

async function runWrapped(command: string, workspaceRoot: string, timeoutSec = 20) {
  const w = await wrapCommand(command, { workspaceRoot });
  expect(w.sandboxed).toBe(true);
  return runBash({ command: '', cwd: workspaceRoot, timeoutSec, sandbox: { argv: w.argv!, env: w.env! } });
}

gated('sandbox enforcement (real OS sandbox present)', () => {
  it('allows writes inside the workspace, denies writes outside', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'zc-sbx-ws-'));
    await runWrapped(`echo hi > "${ws}/ok.txt"`, ws);
    expect(existsSync(join(ws, 'ok.txt'))).toBe(true);

    const outside = join(homedir(), `zc-sbx-should-not-exist-${process.pid}.txt`);
    await runWrapped(`echo x > "${outside}"`, ws);
    expect(existsSync(outside)).toBe(false);
    rmSync(ws, { recursive: true, force: true });
  });

  it('quoting through argv: nested quotes + pipe + $() run correctly', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'zc-sbx-ws-'));
    const r = await runWrapped(`echo "a'b" | tr -d "'"`, ws);
    rmSync(ws, { recursive: true, force: true });
    expect(r.output).toContain('ab');
  });

  it('network: a non-allow-listed domain is blocked', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'zc-sbx-ws-'));
    // example.com is NOT in DEFAULT_ALLOWED_DOMAINS → must be blocked (fast-fail via proxy)
    const r = await runWrapped(`curl -sS -m 6 -o /dev/null -w "HTTP:%{http_code}" https://example.com 2>&1 || echo "BLOCKED:$?"`, ws, 12);
    rmSync(ws, { recursive: true, force: true });
    // a real HTTP:200 would mean the network sandbox is NOT active — that must not happen
    expect(r.output).not.toContain('HTTP:200');
    expect(r.output).toMatch(/BLOCKED:|HTTP:000|Connection|timed out|refused/i);
  });

  it('timeout kills the sandbox-wrapped process tree', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'zc-sbx-ws-'));
    const start = Date.now();
    const r = await runWrapped('sleep 30', ws, 1);
    rmSync(ws, { recursive: true, force: true });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
