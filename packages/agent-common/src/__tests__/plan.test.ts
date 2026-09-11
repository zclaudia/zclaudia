import { describe, expect, it } from 'vitest';
import { canonicalPlanToolName, modeTransitionForPlanTool, planToolSemantic } from '../plan.js';

describe('plan normalization', () => {
  it('recognizes native and namespaced plan tools', () => {
    expect(canonicalPlanToolName('EnterPlanMode')).toBe('EnterPlanMode');
    expect(canonicalPlanToolName('bridge__exit_plan_mode')).toBe('ExitPlanMode');
    expect(canonicalPlanToolName('Read')).toBeUndefined();
  });

  it('maps canonical tools to shared semantics', () => {
    expect(planToolSemantic('EnterPlanMode')).toBe('plan_enter');
    expect(planToolSemantic('ExitPlanMode')).toBe('plan_proposal');
  });

  it('builds normalized transitions and preserves an exit plan', () => {
    expect(modeTransitionForPlanTool('EnterPlanMode', {}, 'enter-1')).toEqual({
      mode: 'plan',
      reason: 'enter',
      sourceToolUseId: 'enter-1',
    });
    expect(modeTransitionForPlanTool('ExitPlanMode', { plan: '# Plan' }, 'exit-1')).toEqual({
      mode: 'default',
      reason: 'exit',
      sourceToolUseId: 'exit-1',
      plan: '# Plan',
    });
  });
});
