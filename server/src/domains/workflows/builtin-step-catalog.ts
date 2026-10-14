import type { WorkflowStepTypeMeta } from '@zclaudia/shared/features/workflows';

/**
 * Built-in step types advertised by `GET /api/workflow-step-types`. The route
 * merges plugin step meta and activity meta on top of this list, deduping by
 * `type` (later sources win: activity > plugin > builtin).
 */
export const BUILTIN_STEP_TYPES: WorkflowStepTypeMeta[] = [
  {
    type: 'git_merge',
    name: 'Git Merge',
    description: 'Merge branches',
    category: 'Git',
    source: 'builtin',
    supportsLoop: true,
  },
  {
    type: 'create_worktree',
    name: 'Create Worktree',
    description: 'Create a git worktree',
    category: 'Git',
    source: 'builtin',
  },
  {
    type: 'create_pr',
    name: 'Create PR',
    description: 'Create a pull request',
    category: 'Git',
    source: 'builtin',
    supportsLoop: true,
  },
  {
    type: 'ai_review',
    name: 'AI Review',
    description: 'AI code review',
    category: 'AI',
    source: 'builtin',
    supportsLoop: true,
  },
  {
    type: 'ai_prompt',
    name: 'AI Prompt',
    description: 'Send prompt to AI',
    category: 'AI',
    source: 'builtin',
    supportsLoop: true,
    configSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          format: 'multiline',
          description: 'Prompt (supports {{event.key}} templates)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    type: 'shell',
    name: 'Shell Command',
    description: 'Execute shell command',
    category: 'Automation',
    source: 'builtin',
    supportsLoop: true,
    configSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Command to run' } },
      required: ['command'],
    },
  },
  {
    type: 'webhook',
    name: 'Webhook',
    description: 'HTTP webhook call',
    category: 'Automation',
    source: 'builtin',
    supportsLoop: true,
    configSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Webhook URL' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
      },
      required: ['url'],
    },
  },
  {
    type: 'notify',
    name: 'Notify',
    description: 'Send notification',
    category: 'Automation',
    source: 'builtin',
    configSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', format: 'multiline', description: 'Notification message' },
      },
      required: ['message'],
    },
  },
  {
    type: 'condition',
    name: 'Condition',
    description: 'Conditional branching',
    category: 'Flow Control',
    source: 'builtin',
  },
  {
    type: 'wait',
    name: 'Wait / Approval',
    description: 'Wait or require approval',
    category: 'Flow Control',
    source: 'builtin',
  },
  {
    type: 'permission_classify',
    name: 'Permission Classify',
    description: 'Classify permission request',
    category: 'Permission',
    source: 'builtin',
  },
  {
    type: 'ai_risk_analysis',
    name: 'AI Risk Analysis',
    description: 'Analyze permission risk',
    category: 'Permission',
    source: 'builtin',
  },
  {
    type: 'permission_decide',
    name: 'Permission Decide',
    description: 'Decide on permission request',
    category: 'Permission',
    source: 'builtin',
  },
];
