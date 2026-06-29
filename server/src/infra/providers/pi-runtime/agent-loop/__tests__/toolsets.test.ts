import { describe, expect, it } from 'vitest';
import { buildAgentLoopTools, getAgentLoopToolsetDescriptor } from '../toolsets.js';

describe('agent-loop builtin toolsets', () => {
  it('declares the first-pass builtin toolsets', () => {
    expect(getAgentLoopToolsetDescriptor('none')).toMatchObject({
      id: 'none',
      tools: [],
      permissionMode: 'deny-external',
    });
    expect(getAgentLoopToolsetDescriptor('permission-review')?.tools).toEqual(['Read', 'Glob', 'Grep', 'LS']);
    expect(getAgentLoopToolsetDescriptor('code-review-readonly')?.tools).toEqual(['Read', 'Glob', 'Grep', 'LS', 'Bash']);
    expect(getAgentLoopToolsetDescriptor('workflow-prompt-readonly')?.tools).toEqual(['Read', 'Glob', 'Grep', 'LS', 'Bash']);
  });

  it('rejects unknown toolsets', () => {
    expect(() => buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'unknown' })).toThrow('Unknown agent-loop toolset: unknown');
  });

  it('builds no tools for none', () => {
    expect(buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'none' })).toEqual([]);
  });
});
