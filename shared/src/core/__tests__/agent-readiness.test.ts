import { describe, it, expect } from 'vitest';
import type { AgentReadiness, AgentReadinessReason } from '../agent-readiness.js';

describe('AgentReadiness type', () => {
  it('accepts a usable result', () => {
    const r: AgentReadiness = { usable: true };
    expect(r.usable).toBe(true);
  });
  it('accepts an unusable result with a reason', () => {
    const reason: AgentReadinessReason = 'no_credential';
    const r: AgentReadiness = { usable: false, reason };
    expect(r.reason).toBe('no_credential');
  });
});
