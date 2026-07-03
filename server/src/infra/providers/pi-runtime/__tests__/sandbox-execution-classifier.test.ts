import { describe, expect, it } from 'vitest';
import { classifySandboxFailure } from '../sandbox-execution/index.js';

describe('classifySandboxFailure', () => {
  it('confirms a network denial when stderr has a curl failure and an ungranted URL', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -sS http://127.0.0.1:8000/health',
      outputText: 'curl: (7) Failed to connect to 127.0.0.1 port 8000',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(['github.com']),
    });

    expect(result.classification).toBe('confirmed_sandbox_denial');
    expect(result.evidence.candidateTargets).toEqual(['http://127.0.0.1:8000']);
    expect(result.recommendedNextStep).toMatch(/SandboxCapabilityAccess/);
  });

  it('marks silent curl as probable instead of confirmed', () => {
    const result = classifySandboxFailure({
      toolName: 'Bash',
      sourceText: 'curl -s http://127.0.0.1:8000/health',
      outputText: '',
      exitCode: 7,
      sandboxed: true,
      allowedDomains: new Set(),
    });

    expect(result.classification).toBe('probable_sandbox_denial');
    expect(result.evidence.missingSignals).toContain('network error output');
    expect(result.evidence.missingSignals).toContain('curl stderr may be suppressed by -s');
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
});
