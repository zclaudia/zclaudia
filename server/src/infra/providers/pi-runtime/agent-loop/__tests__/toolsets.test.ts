import { describe, expect, it } from 'vitest';
import type { ToolName } from '@zclaudia/shared/core/tools';
import { buildAgentLoopTools, getAgentLoopToolsetDescriptor } from '../toolsets.js';

describe('agent-loop builtin toolsets', () => {
  it('declares the first-pass builtin toolsets', () => {
    expect(getAgentLoopToolsetDescriptor('none')).toMatchObject({
      id: 'none',
      tools: [],
      permissionMode: 'deny-external',
      sandboxReadOnly: true,
    });

    expect(getAgentLoopToolsetDescriptor('permission-review')).toMatchObject({
      tools: ['Read', 'Glob', 'Grep', 'LS'],
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: true,
    });

    expect(getAgentLoopToolsetDescriptor('code-review-readonly')).toMatchObject({
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash'],
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: true,
    });

    expect(getAgentLoopToolsetDescriptor('workflow-prompt-readonly')).toMatchObject({
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash'],
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: true,
    });

    expect(getAgentLoopToolsetDescriptor('workflow-prompt')).toMatchObject({
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash', 'Edit', 'MultiEdit', 'Write'],
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: false,
    });
  });

  it('rejects unknown toolsets', () => {
    expect(() => buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'unknown' })).toThrow('Unknown agent-loop toolset: unknown');
  });

  it('builds no tools for none', () => {
    expect(buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'none' })).toEqual([]);
  });

  it('isolates returned permission-review descriptors from mutation', () => {
    const descriptor = getAgentLoopToolsetDescriptor('permission-review');
    expect(descriptor).toBeDefined();
    expect(descriptor?.tools).toEqual(['Read', 'Glob', 'Grep', 'LS']);

    const mutableTools = descriptor!.tools as ToolName[];
    expect(() => mutableTools.push('Memory' as ToolName)).toThrow();

    expect(getAgentLoopToolsetDescriptor('permission-review')?.tools).toEqual(['Read', 'Glob', 'Grep', 'LS']);
    expect(buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'permission-review' })).toHaveLength(4);
  });

  it('builds writable tools for workflow prompts', () => {
    expect(buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'workflow-prompt' }).map((tool) => tool.name)).toEqual([
      'Read',
      'Glob',
      'Grep',
      'LS',
      'Bash',
      'Edit',
      'MultiEdit',
      'Write',
    ]);
  });
});
