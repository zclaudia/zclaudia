import { describe, expect, it, vi } from 'vitest';
import {
  runSandboxedWithEscalation,
  type SandboxOperationResult,
} from '../sandbox-execution/index.js';

function failedCurl(): SandboxOperationResult {
  return {
    ok: false,
    sandboxed: true,
    outputText: 'curl: (7) Failed to connect to 127.0.0.1 port 8000',
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
      sourceText: 'curl -sS http://127.0.0.1:8000/health',
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
      host: '127.0.0.1',
      port: 8000,
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.details.privilegeMode).toBe('capability-granted');
    expect(result.details.grantsUsed).toEqual([
      { type: 'network', protocol: 'http', host: '127.0.0.1', port: 8000 },
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
