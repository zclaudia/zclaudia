import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('debugLog', () => {
  let dataDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'codex-debug-log-test-'));
    vi.stubEnv('ZCLAUDIA_DATA_DIR', dataDir);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('is a no-op unless ZCLAUDIA_CODEX_DEBUG=1', async () => {
    const { debugLog, debugLogPath } = await import('../config.js');

    debugLog('should not appear anywhere');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(existsSync(debugLogPath())).toBe(false);
  });

  it('writes an owner-only log file in the data dir when enabled', async () => {
    vi.stubEnv('ZCLAUDIA_CODEX_DEBUG', '1');
    const { debugLog, debugLogPath } = await import('../config.js');

    debugLog('hello from debug');

    const logPath = debugLogPath();
    expect(logPath.startsWith(dataDir)).toBe(true);
    expect(readFileSync(logPath, 'utf-8')).toContain('hello from debug');
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
    expect(consoleLogSpy).toHaveBeenCalledWith('hello from debug');
  });

  it('scrubs MCP bridge env credentials from debug output', async () => {
    vi.stubEnv('ZCLAUDIA_CODEX_DEBUG', '1');
    const { buildMcpConfigArgs, debugLog, debugLogPath } = await import('../config.js');

    const args = buildMcpConfigArgs({
      name: 'claudia-plugins',
      config: { command: 'node', env: { API_TOKEN: 'sk-live-supersecret' } },
    });
    debugLog(`spawn args: ${args.join(' ')}`);

    const fileContent = readFileSync(debugLogPath(), 'utf-8');
    const consoleContent = consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n');
    for (const content of [fileContent, consoleContent]) {
      expect(content).not.toContain('sk-live-supersecret');
      expect(content).toContain('[redacted]');
    }
  });
});

describe('summarizeConfigArgKeys', () => {
  it('lists -c override keys without their values', async () => {
    const { summarizeConfigArgKeys } = await import('../config.js');

    const summary = summarizeConfigArgKeys([
      '-c',
      'approval_policy="on-request"',
      '-c',
      'mcp_servers.claudia-plugins.env.BRIDGE_TOKEN="sk-live-supersecret"',
    ]);

    expect(summary).toBe('approval_policy, mcp_servers.claudia-plugins.env.BRIDGE_TOKEN');
    expect(summary).not.toContain('sk-live-supersecret');
  });
});
