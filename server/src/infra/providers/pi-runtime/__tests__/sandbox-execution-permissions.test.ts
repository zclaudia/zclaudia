import { describe, expect, it } from 'vitest';
import {
  SANDBOX_CAPABILITY_ACCESS_TOOL,
  SANDBOX_UNSANDBOXED_ACCESS_TOOL,
  buildSandboxCapabilityRequest,
  buildSandboxUnsandboxedRequest,
} from '../sandbox-execution/index.js';

describe('sandbox execution permission requests', () => {
  it('builds a capability request with target evidence', () => {
    const request = buildSandboxCapabilityRequest({
      requestId: 'call-1:capability:0',
      commandPreview: 'curl http://127.0.0.1:8000/health',
      grants: [{ type: 'network', protocol: 'http', host: '127.0.0.1', port: 8000 }],
      classification: 'confirmed_sandbox_denial',
      evidence: {
        matchedSignals: ['curl error output'],
        candidateTargets: ['http://127.0.0.1:8000'],
        missingSignals: [],
      },
    });

    expect(request.toolName).toBe(SANDBOX_CAPABILITY_ACCESS_TOOL);
    expect(request.toolInput).toMatchObject({
      grants: [{ type: 'network', host: '127.0.0.1', port: 8000 }],
      classification: 'confirmed_sandbox_denial',
    });
    expect(request.detail).toContain('http://127.0.0.1:8000');
  });

  it('discloses the true host-level scope of a network grant (P2 grant widening)', () => {
    // The sandbox runtime enforces host-level allow-lists: approving
    // http://api.internal.corp:8000 really opens every port/protocol on that
    // host. The approval text must say so, not imply URL-level scoping.
    const request = buildSandboxCapabilityRequest({
      requestId: 'call-1b:capability:0',
      commandPreview: 'curl http://api.internal.corp:8000/health',
      grants: [{ type: 'network', protocol: 'http', host: 'api.internal.corp', port: 8000 }],
      classification: 'confirmed_sandbox_denial',
      evidence: {
        matchedSignals: ['curl error output'],
        candidateTargets: ['http://api.internal.corp:8000'],
        missingSignals: [],
      },
    });

    expect(request.detail).toContain('http://api.internal.corp:8000');
    expect(request.detail).toContain('all ports and protocols on api.internal.corp');
    expect(request.detail).toContain('host-scoped');
  });

  it('builds an unsandboxed request from model reason', () => {
    const request = buildSandboxUnsandboxedRequest({
      requestId: 'call-2:unsandboxed',
      toolName: 'Eval',
      commandPreview: "await fetch('http://127.0.0.1:8000')",
      privilegeReason: 'Need to contact a local development server bound outside the sandbox.',
    });

    expect(request.toolName).toBe(SANDBOX_UNSANDBOXED_ACCESS_TOOL);
    expect(request.detail).toContain('model is requesting host execution');
    expect(request.toolInput).toMatchObject({
      originalToolName: 'Eval',
      privilegeReason: 'Need to contact a local development server bound outside the sandbox.',
    });
  });

  it('discloses a critical-pattern match in the unsandboxed request (P0-4)', () => {
    const request = buildSandboxUnsandboxedRequest({
      requestId: 'call-3:unsandboxed',
      toolName: 'Bash',
      commandPreview: 'rm -rf /',
      privilegeReason: 'need host execution',
      criticalReason: 'recursive delete of a root-level path',
    });

    expect(request.detail).toContain('critical-risk pattern');
    expect(request.detail).toContain('recursive delete of a root-level path');
    expect(request.toolInput).toMatchObject({
      criticalReason: 'recursive delete of a root-level path',
    });
  });
});
