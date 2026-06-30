import { describe, it, expect } from 'vitest';
import type { Automation, AutomationAction, AutomationTrigger } from '../automations.js';

describe('Automation types', () => {
  it('models a single-activity automation', () => {
    const action: AutomationAction = { kind: 'activity', ref: 'git_commit', input: { messageMode: 'ai' } };
    const trigger: AutomationTrigger = { type: 'interval', intervalMinutes: 30 };
    const automation: Automation = {
      id: 'a1',
      name: 'Auto commit',
      enabled: true,
      trigger,
      action,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(automation.action.kind).toBe('activity');
    expect(automation.trigger.type).toBe('interval');
  });

  it('models a workflow-action automation', () => {
    const action: AutomationAction = { kind: 'workflow', ref: 'wf-123' };
    expect(action.kind).toBe('workflow');
  });
});
