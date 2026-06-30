import { describe, it, expect } from 'vitest';
import { normalizeWorkflowDefinition } from '../workflows.js';
import type { WorkflowDefinition, WorkflowRun } from '../workflows.js';

describe('normalizeWorkflowDefinition (trigger-free)', () => {
  it('does not include a triggers field', () => {
    const def = normalizeWorkflowDefinition({ nodes: [], edges: [], entryNodeId: '' });
    expect('triggers' in def).toBe(false);
  });

  it('drops any legacy triggers field on input', () => {
    const def = normalizeWorkflowDefinition({
      nodes: [{ id: 'a', name: 'A', type: 'shell', config: {}, position: { x: 0, y: 0 } }],
      edges: [],
      entryNodeId: 'a',
      triggers: [{ type: 'cron', cron: '* * * * *' }],
    });
    expect('triggers' in def).toBe(false);
  });
});

describe('WorkflowRun generalization', () => {
  it('allows an activity-action run with no workflowId', () => {
    const run: WorkflowRun = {
      id: 'r1',
      status: 'running',
      triggerSource: 'schedule',
      initiator: 'automation:a1',
      actionKind: 'activity',
      actionRef: 'git_commit',
      startedAt: 1,
    };
    expect(run.workflowId).toBeUndefined();
    expect(run.initiator).toBe('automation:a1');
  });
});
