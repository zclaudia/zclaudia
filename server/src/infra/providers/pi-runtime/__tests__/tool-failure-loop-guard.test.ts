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

  it('exposes a hard limit of 3', () => {
    expect(TOOL_FAILURE_HARD_LIMIT).toBe(3);
  });
});
