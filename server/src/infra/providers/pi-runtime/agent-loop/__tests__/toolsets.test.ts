import { describe, expect, it, vi } from 'vitest';
import type { ToolName } from '@zclaudia/shared/core/tools';
import { SANDBOX_NETWORK_ACCESS_COMPAT_TOOL } from '../../sandbox-execution/index.js';
import { buildAgentLoopTools, getAgentLoopToolsetDescriptor } from '../toolsets.js';

const EXPECTED_PERMISSION_TOOLS = [
  'CriticalBashCommand',
  'SandboxNetworkAccess',
  'SandboxCapabilityAccess',
  'SandboxUnsandboxedAccess',
];

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
      permissionTools: EXPECTED_PERMISSION_TOOLS,
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: true,
    });

    expect(getAgentLoopToolsetDescriptor('workflow-prompt-readonly')).toMatchObject({
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash'],
      permissionTools: EXPECTED_PERMISSION_TOOLS,
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: true,
    });

    expect(getAgentLoopToolsetDescriptor('workflow-prompt')).toMatchObject({
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Bash', 'Edit', 'MultiEdit', 'Write'],
      permissionTools: EXPECTED_PERMISSION_TOOLS,
      permissionMode: 'allow-declared-tools',
      sandboxReadOnly: false,
    });
  });

  it('declares the sandbox network compat tool through the shared constant (P2 single-source)', () => {
    // The literal 'SandboxNetworkAccess' used to be repeated here, in
    // sandbox-denial.ts (now deleted), and in sandbox-execution/permissions.ts.
    // The toolset must reference the one exported constant.
    expect(EXPECTED_PERMISSION_TOOLS).toContain(SANDBOX_NETWORK_ACCESS_COMPAT_TOOL);
    expect(getAgentLoopToolsetDescriptor('workflow-prompt')?.permissionTools).toContain(
      SANDBOX_NETWORK_ACCESS_COMPAT_TOOL
    );
  });

  it('rejects unknown toolsets', () => {
    expect(() => buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'unknown' })).toThrow(
      'Unknown agent-loop toolset: unknown'
    );
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
    const mutablePermissionTools = descriptor!.permissionTools as string[] | undefined;
    expect(mutablePermissionTools).toBeUndefined();

    expect(getAgentLoopToolsetDescriptor('permission-review')?.tools).toEqual([
      'Read',
      'Glob',
      'Grep',
      'LS',
    ]);
    expect(buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'permission-review' })).toHaveLength(4);
  });

  it('isolates returned internal permission tool descriptors from mutation', () => {
    const descriptor = getAgentLoopToolsetDescriptor('workflow-prompt');
    expect(descriptor?.permissionTools).toEqual(EXPECTED_PERMISSION_TOOLS);

    const mutablePermissionTools = descriptor!.permissionTools as string[];
    expect(() => mutablePermissionTools.push('AskUserQuestion')).toThrow();

    expect(getAgentLoopToolsetDescriptor('workflow-prompt')?.permissionTools).toEqual(
      EXPECTED_PERMISSION_TOOLS
    );
  });

  it('builds writable tools for workflow prompts', () => {
    expect(
      buildAgentLoopTools({ cwd: '/tmp', toolsetId: 'workflow-prompt' }).map(tool => tool.name)
    ).toEqual(['Read', 'Glob', 'Grep', 'LS', 'Bash', 'Edit', 'MultiEdit', 'Write']);
  });

  it('passes permission callbacks into tool construction', async () => {
    const permissionCallback = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'blocked',
    }));
    const bash = buildAgentLoopTools({
      cwd: '/tmp',
      toolsetId: 'workflow-prompt',
      permissionCallback,
    }).find(tool => tool.name === 'Bash') as
      | { execute: (id: string, args: unknown) => Promise<unknown> }
      | undefined;

    expect(bash).toBeDefined();
    const result = (await bash!.execute('bash-1', { command: 'rm -rf /' })) as {
      details?: Record<string, unknown>;
    };

    expect(permissionCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'CriticalBashCommand',
      })
    );
    expect(result.details).toMatchObject({
      ok: false,
      error: 'critical_command_blocked',
    });
  });
});
