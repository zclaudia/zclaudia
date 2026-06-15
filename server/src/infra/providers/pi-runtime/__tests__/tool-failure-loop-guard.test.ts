import { describe, it, expect } from 'vitest';
import { ToolFailureLoopGuard, TOOL_FAILURE_HARD_LIMIT } from '../tool-failure-loop-guard.js';

describe('ToolFailureLoopGuard', () => {
  it('counts identical failures by normalized signature', () => {
    const g = new ToolFailureLoopGuard();
    expect(g.recordFailure('Bash', { command: 'npm test' })).toBe(1);
    expect(g.recordFailure('Bash', { command: 'npm test' })).toBe(2);
    expect(g.recordFailure('Bash', { command: 'npm test' })).toBe(3);
  });

  it('treats different commands as different signatures', () => {
    const g = new ToolFailureLoopGuard();
    expect(g.recordFailure('Bash', { command: 'npm test' })).toBe(1);
    expect(g.recordFailure('Bash', { command: 'git status' })).toBe(1);
  });

  it('clears a signature on success', () => {
    const g = new ToolFailureLoopGuard();
    g.recordFailure('Bash', { command: 'npm test' });
    g.recordFailure('Bash', { command: 'npm test' });
    g.recordSuccess('Bash', { command: 'npm test' });
    expect(g.recordFailure('Bash', { command: 'npm test' })).toBe(1);
  });

  it('counts Bash failures by command and diagnostics fingerprint', () => {
    const g = new ToolFailureLoopGuard();
    const args = { command: 'pnpm test' };
    const firstFailure = {
      exitCode: 1,
      diagnostics: [{ path: 'src/a.ts', line: 1, column: 2, severity: 'error', source: 'TS2322', message: 'Type mismatch' }],
    };
    const changedFailure = {
      exitCode: 1,
      diagnostics: [{ path: 'src/b.ts', line: 3, column: 4, severity: 'error', source: 'TS2304', message: 'Missing name' }],
    };

    expect(g.recordFailure('Bash', args, firstFailure)).toBe(1);
    expect(g.recordFailure('Bash', args, changedFailure)).toBe(1);
    expect(g.recordFailure('Bash', args, firstFailure)).toBe(2);
  });

  it('clears all Bash failure fingerprints for a command on success', () => {
    const g = new ToolFailureLoopGuard();
    const args = { command: 'pnpm test' };
    g.recordFailure('Bash', args, {
      exitCode: 1,
      diagnostics: [{ path: 'src/a.ts', line: 1, column: 2, severity: 'error', message: 'Type mismatch' }],
    });
    g.recordFailure('Bash', args, {
      exitCode: 1,
      diagnostics: [{ path: 'src/b.ts', line: 3, column: 4, severity: 'error', message: 'Missing name' }],
    });

    g.recordSuccess('Bash', args);

    expect(g.recordFailure('Bash', args, { exitCode: 1 })).toBe(1);
  });

  it('exposes a hard limit of 3', () => {
    expect(TOOL_FAILURE_HARD_LIMIT).toBe(3);
  });
});
