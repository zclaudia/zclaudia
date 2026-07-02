import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as sandboxRuntime from '@anthropic-ai/sandbox-runtime';
import {
  isSandboxAvailable,
  SENSITIVE_DENY_READ,
  DEFAULT_ALLOWED_DOMAINS,
  __resetSandboxCacheForTests,
  wrapCommand,
} from '../sandbox.js';

describe('sandbox availability + constants', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.ZCLAUDIA_SANDBOX;
    __resetSandboxCacheForTests();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ZCLAUDIA_SANDBOX;
    else process.env.ZCLAUDIA_SANDBOX = prev;
    __resetSandboxCacheForTests();
  });

  it('ZCLAUDIA_SANDBOX=off → unavailable regardless of host', () => {
    process.env.ZCLAUDIA_SANDBOX = 'off';
    expect(isSandboxAvailable()).toBe(false);
  });

  it('SENSITIVE_DENY_READ entries are absolute (no leading ~) and home-expanded', () => {
    expect(SENSITIVE_DENY_READ.length).toBeGreaterThan(0);
    for (const p of SENSITIVE_DENY_READ) {
      expect(p.startsWith('~')).toBe(false);
    }
    expect(SENSITIVE_DENY_READ.some(p => p.startsWith(os.homedir()) && p.endsWith('.ssh'))).toBe(
      true
    );
  });

  it('DEFAULT_ALLOWED_DOMAINS covers common registries + VCS', () => {
    expect(DEFAULT_ALLOWED_DOMAINS).toContain('registry.npmjs.org');
    expect(DEFAULT_ALLOWED_DOMAINS).toContain('github.com');
    expect(DEFAULT_ALLOWED_DOMAINS).toContain('pypi.org');
  });
});

function mockAvailable() {
  vi.spyOn(sandboxRuntime.SandboxManager, 'isSupportedPlatform').mockReturnValue(true);
  vi.spyOn(sandboxRuntime.SandboxManager, 'checkDependencies').mockReturnValue({
    warnings: [],
    errors: [],
  } as any);
  vi.spyOn(sandboxRuntime.SandboxManager, 'initialize').mockResolvedValue(undefined as any);
}

describe('wrapCommand', () => {
  beforeEach(() => {
    __resetSandboxCacheForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetSandboxCacheForTests();
    delete process.env.ZCLAUDIA_SANDBOX;
  });

  it('degrades to { sandboxed:false } when sandbox is off', async () => {
    process.env.ZCLAUDIA_SANDBOX = 'off';
    const r = await wrapCommand('echo hi', { workspaceRoot: '/ws' });
    expect(r.sandboxed).toBe(false);
    expect(r.argv).toBeUndefined();
  });

  it('read-write: allowWrite = [workspaceRoot, tmp], includes denyWrite + network allow-list, returns argv+env', async () => {
    mockAvailable();
    const wrapSpy = vi
      .spyOn(sandboxRuntime.SandboxManager, 'wrapWithSandboxArgv')
      .mockResolvedValue({
        argv: ['/bin/bash', '-c', 'sandboxed echo'],
        env: { PATH: '/usr/bin' },
      } as any);
    const r = await wrapCommand('echo hi', { workspaceRoot: '/ws' });
    expect(r.sandboxed).toBe(true);
    expect(r.argv?.[0]).toBe('/bin/bash');
    expect(r.env).toEqual({ PATH: '/usr/bin' }); // used as-is, not merged with process.env
    const cfg = wrapSpy.mock.calls[0][2] as any;
    expect(cfg.filesystem.allowWrite).toContain('/ws');
    expect(Array.isArray(cfg.filesystem.denyWrite)).toBe(true); // required field present
    expect(Array.isArray(cfg.filesystem.denyRead)).toBe(true);
    expect(cfg.network.allowedDomains).toEqual(DEFAULT_ALLOWED_DOMAINS);
  });

  it('read-only mode: allowWrite excludes the workspace (tmp only)', async () => {
    mockAvailable();
    const wrapSpy = vi
      .spyOn(sandboxRuntime.SandboxManager, 'wrapWithSandboxArgv')
      .mockResolvedValue({ argv: ['/bin/bash', '-c', 'x'], env: {} } as any);
    await wrapCommand('ls', { workspaceRoot: '/ws', readOnly: true });
    const cfg = wrapSpy.mock.calls[0][2] as any;
    expect(cfg.filesystem.allowWrite).not.toContain('/ws');
  });

  it('returns sandboxed:false when the lib throws (caller decides fail-open/closed)', async () => {
    mockAvailable();
    vi.spyOn(sandboxRuntime.SandboxManager, 'wrapWithSandboxArgv').mockRejectedValue(
      new Error('boom')
    );
    const r = await wrapCommand('echo hi', { workspaceRoot: '/ws' });
    expect(r.sandboxed).toBe(false);
  });
});

describe('wrapCommand extraAllowedDomains', () => {
  it('produces a sandboxed argv when an extra domain is granted (sandbox available)', async () => {
    __resetSandboxCacheForTests();
    if (!isSandboxAvailable()) return; // gated: skip where sandbox is unsupported
    const wrap = await wrapCommand('curl https://example.com', {
      workspaceRoot: process.cwd(),
      extraAllowedDomains: ['example.com'],
    });
    expect(wrap.sandboxed).toBe(true);
    expect(Array.isArray(wrap.argv)).toBe(true);
  });
});
