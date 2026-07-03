import { describe, expect, it, vi } from 'vitest';
import {
  runSandboxedWithEscalation,
  type SandboxOperationResult,
} from '../sandbox-execution/index.js';

function failedCurl(): SandboxOperationResult {
  return {
    ok: false,
    sandboxed: true,
    outputText: 'curl: (7) Failed to connect to api.internal.corp port 8000',
    exitCode: 7,
  };
}

describe('runSandboxedWithEscalation', () => {
  it('asks capability permission and reruns with grants on confirmed denial', async () => {
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const persistGrant = vi.fn();
    const operation = vi
      .fn<[], Promise<SandboxOperationResult>>()
      .mockResolvedValueOnce(failedCurl())
      .mockResolvedValueOnce({
        ok: true,
        sandboxed: true,
        outputText: '{"ok":true}',
        exitCode: 0,
      });

    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-1',
      toolName: 'Bash',
      sourceText: 'curl -sS http://api.internal.corp:8000/health',
      allowedDomains: new Set(),
      sandboxMode: 'auto',
      operation,
      permissionCallback,
      persistGrant,
    });

    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxCapabilityAccess' })
    );
    expect(persistGrant).toHaveBeenCalledWith({
      type: 'network',
      protocol: 'http',
      host: 'api.internal.corp',
      port: 8000,
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.details.privilegeMode).toBe('capability-granted');
    expect(result.details.grantsUsed).toEqual([
      { type: 'network', protocol: 'http', host: 'api.internal.corp', port: 8000 },
    ]);
  });

  it('does not prompt for ambiguous failure', async () => {
    const permissionCallback = vi.fn();
    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-2',
      toolName: 'Bash',
      sourceText: 'pnpm test',
      allowedDomains: new Set(),
      sandboxMode: 'auto',
      operation: async () => ({
        ok: false,
        sandboxed: true,
        outputText: 'Tests failed',
        exitCode: 1,
      }),
      permissionCallback,
    });

    expect(permissionCallback).not.toHaveBeenCalled();
    expect(result.details.failureClassification).toBe('ambiguous_failure');
  });

  it('promotes sandbox internal proxy evidence into execution details', async () => {
    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-proxy',
      toolName: 'Bash',
      sourceText: 'curl -sS http://127.0.0.1:8000/health',
      allowedDomains: new Set(),
      sandboxMode: 'sandbox',
      operation: async () => ({
        ok: false,
        sandboxed: true,
        outputText:
          'http_proxy=http://localhost:64700\ncurl: (7) Failed to connect to 127.0.0.1 port 8000',
        exitCode: 7,
      }),
    });

    expect(result.details.sandboxInternalProxyDetected).toBe(true);
    expect(result.details.sandboxInternalProxyUrls).toEqual(['http://localhost:64700']);
  });

  it('requests unsandboxed execution after confirmed localhost bind denial', async () => {
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const unsandboxedOperation = vi.fn(async () => ({
      ok: true,
      sandboxed: false,
      outputText: 'server started',
      exitCode: 0,
    }));

    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-bind',
      toolName: 'Bash',
      sourceText: 'uvicorn proxy:app --host 127.0.0.1 --port 8006',
      allowedDomains: new Set(),
      sandboxMode: 'auto',
      operation: async () => ({
        ok: false,
        sandboxed: true,
        outputText:
          "ERROR: [Errno 1] error while attempting to bind on address ('127.0.0.1', 8006): operation not permitted",
        exitCode: 1,
      }),
      unsandboxedOperation,
      permissionCallback,
    });

    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxUnsandboxedAccess' })
    );
    expect(unsandboxedOperation).toHaveBeenCalledOnce();
    expect(result.result.outputText).toBe('server started');
    expect(result.details.privilegeMode).toBe('unsandboxed');
    expect(result.details.unsandboxedApproved).toBe(true);
  });

  it('preflights obvious localhost server bind commands as unsandboxed', async () => {
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const operation = vi.fn(async () => ({
      ok: false,
      sandboxed: true,
      outputText: 'should not run sandbox first',
    }));
    const unsandboxedOperation = vi.fn(async () => ({
      ok: true,
      sandboxed: false,
      outputText: 'server started',
      exitCode: 0,
    }));

    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-preflight-bind',
      toolName: 'Bash',
      sourceText: 'uvicorn proxy:app --host 127.0.0.1 --port 8007',
      allowedDomains: new Set(),
      sandboxMode: 'auto',
      operation,
      unsandboxedOperation,
      permissionCallback,
    });

    expect(operation).not.toHaveBeenCalled();
    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxUnsandboxedAccess' })
    );
    expect(unsandboxedOperation).toHaveBeenCalledOnce();
    expect(result.details.privilegeMode).toBe('unsandboxed');
  });

  it('preflights AWS SSO credential commands as unsandboxed', async () => {
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const operation = vi.fn(async () => ({
      ok: false,
      sandboxed: true,
      outputText: 'Failed to connect to proxy URL: "http://localhost:53119"',
      exitCode: 255,
    }));
    const unsandboxedOperation = vi.fn(async () => ({
      ok: true,
      sandboxed: false,
      outputText: 'credentials ok',
      exitCode: 0,
    }));

    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-preflight-aws',
      toolName: 'Bash',
      sourceText: 'aws sso get-role-credentials --account-id 123 --role-name dev',
      allowedDomains: new Set(),
      sandboxMode: 'auto',
      operation,
      unsandboxedOperation,
      permissionCallback,
    });

    expect(operation).not.toHaveBeenCalled();
    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxUnsandboxedAccess' })
    );
    expect(result.result.outputText).toBe('credentials ok');
  });

  it('requires privilege reason for explicit unsandboxed mode', async () => {
    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-3',
      toolName: 'Eval',
      sourceText: "await fetch('http://127.0.0.1:8000')",
      allowedDomains: new Set(),
      sandboxMode: 'unsandboxed',
      operation: async () => ({ ok: true, sandboxed: true, outputText: 'unreachable' }),
      permissionCallback: vi.fn(),
    });

    expect(result.result.ok).toBe(false);
    expect(result.result.outputText).toContain('privilege_reason is required');
    expect(result.details.privilegeMode).toBe('sandbox');
  });

  it('runs unsandboxed only after explicit approval', async () => {
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const unsandboxedOperation = vi.fn(async () => ({
      ok: true,
      sandboxed: false,
      outputText: 'host-ok',
    }));

    const result = await runSandboxedWithEscalation({
      toolCallId: 'call-4',
      toolName: 'Bash',
      sourceText: 'aws sts get-caller-identity',
      allowedDomains: new Set(),
      sandboxMode: 'unsandboxed',
      privilegeReason: 'Need host AWS SSO credential cache.',
      operation: async () => ({ ok: false, sandboxed: true, outputText: 'unreachable' }),
      unsandboxedOperation,
      permissionCallback,
    });

    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'SandboxUnsandboxedAccess' })
    );
    expect(unsandboxedOperation).toHaveBeenCalledOnce();
    expect(result.details.privilegeMode).toBe('unsandboxed');
    expect(result.details.unsandboxedApproved).toBe(true);
  });
});
