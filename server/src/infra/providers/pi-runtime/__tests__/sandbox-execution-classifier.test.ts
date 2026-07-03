import { describe, expect, it } from 'vitest';
import { classifySandboxFailure } from '../sandbox-execution/index.js';

describe('classifySandboxFailure', () => {
  it('confirms a network denial when stderr has a curl failure and an ungranted URL', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -sS http://api.internal.corp:8000/health',
      outputText: 'curl: (7) Failed to connect to api.internal.corp port 8000',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(['github.com']),
    });

    expect(result.classification).toBe('confirmed_sandbox_denial');
    expect(result.evidence.candidateTargets).toEqual(['http://api.internal.corp:8000']);
    expect(result.recommendedNextStep).toMatch(/SandboxCapabilityAccess/);
  });

  it('marks silent curl as probable instead of confirmed', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -s http://api.internal.corp:8000/health',
      outputText: '',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('probable_sandbox_denial');
    expect(result.evidence.missingSignals).toContain('network error output');
    expect(result.evidence.missingSignals).toContain('curl stderr may be suppressed by -s');
  });

  it('treats localhost proxy env output as sandbox-runtime evidence', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -sS http://api.internal.corp:8000/health',
      outputText:
        'http_proxy=http://localhost:64700\ncurl: (7) Failed to connect to api.internal.corp port 8000',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('confirmed_sandbox_denial');
    expect(result.evidence.matchedSignals).toContain('sandbox-runtime localhost proxy env');
    expect(result.evidence.internalProxyUrls).toEqual(['http://localhost:64700']);
  });

  it('marks ordinary command-not-found as not sandbox denial', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'does-not-exist',
      outputText: 'bash: does-not-exist: command not found',
      exitCode: 127,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('not_sandbox_denial');
  });

  it('classifies Eval fetch errors using code-derived targets', () => {
    const result = classifySandboxFailure({
      toolName: 'Eval',
      sourceText: "await fetch('https://api.example.com/data')",
      outputText: 'TypeError: fetch failed\ncause: Error: connect ECONNREFUSED 10.0.0.1:443',
      sandboxed: true,
      allowedDomains: new Set(['github.com']),
    });

    expect(result.classification).toBe('confirmed_sandbox_denial');
    expect(result.evidence.candidateTargets).toEqual(['https://api.example.com']);
  });

  it('marks failures with no URL and no sandbox signal as ambiguous', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'pnpm test',
      outputText: 'Tests failed',
      exitCode: 1,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('ambiguous_failure');
  });

  it('treats a loopback connect failure as not a sandbox denial (sandbox allows loopback connects)', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -s http://127.0.0.1:8000/health',
      outputText: '',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('not_sandbox_denial');
    expect(result.evidence.candidateTargets).toEqual([]);
    expect(result.evidence.inference).toMatch(/loopback/i);
    expect(result.recommendedNextStep).not.toMatch(/escalation/i);
  });

  it('treats a localhost connection-refused as not a sandbox denial', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -sS http://localhost:8000/health',
      outputText: 'curl: (7) Failed to connect to localhost port 8000: Connection refused',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('not_sandbox_denial');
  });

  it('still confirms denial when an ungranted external target accompanies a loopback one', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -sS http://127.0.0.1:8000/relay https://api.internal.corp/data',
      outputText: 'curl: (6) Could not resolve host: api.internal.corp',
      exitCode: 6,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('confirmed_sandbox_denial');
    expect(result.evidence.candidateTargets).toEqual(['https://api.internal.corp']);
  });

  it('does not suggest escalation for failures with no sandbox signals at all', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'python3 gen_csms_token.py --ttl abc',
      outputText: "Invalid duration format: 'abc'. Use formats like: 3600, 1s, 5m",
      exitCode: 1,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('ambiguous_failure');
    expect(result.recommendedNextStep).not.toMatch(/escalation/i);
  });

  it('classifies localhost bind EPERM as a host-only sandbox denial', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'uvicorn proxy:app --host 127.0.0.1 --port 8006',
      outputText:
        "ERROR: [Errno 1] error while attempting to bind on address ('127.0.0.1', 8006): operation not permitted",
      exitCode: 1,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('confirmed_sandbox_denial');
    expect(result.evidence.matchedSignals).toContain('localhost bind denied by sandbox');
    expect(result.recommendedPrivilegeMode).toBe('unsandboxed');
    expect(result.recommendedNextStep).toContain('sandbox_mode:"unsandboxed"');
  });
});
