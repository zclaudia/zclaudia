import { describe, expect, it, vi } from 'vitest';
import { buildClaudeCanUseTool } from '../permissions.js';

describe('buildClaudeCanUseTool plan mode', () => {
  it('exposes the exact shell command and SDK explanation for the approval view', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const command = "printf 'approved' > 'a file.txt'";
    await buildClaudeCanUseTool(onPermission)!(
      'Bash',
      { command },
      {
        signal: new AbortController().signal,
        toolUseID: 'shell',
        title: 'Run command',
        description: 'Write the requested marker',
      }
    );
    expect(JSON.parse(onPermission.mock.calls[0][0].detail)).toEqual({
      command,
      description: 'Write the requested marker',
    });
  });

  it('preserves edit inputs so the approval view can render the proposed diff', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const input = { file_path: 'src/add.ts', old_string: 'a - b', new_string: 'a + b' };
    await buildClaudeCanUseTool(onPermission)!('Edit', input, {
      signal: new AbortController().signal,
      toolUseID: 'edit',
    });
    expect(JSON.parse(onPermission.mock.calls[0][0].detail)).toEqual(input);
  });

  it('auto-allows EnterPlanMode without a permission prompt', async () => {
    const onPermission = vi.fn();
    const canUseTool = buildClaudeCanUseTool(onPermission)!;

    await expect(
      canUseTool(
        'EnterPlanMode',
        {},
        {
          signal: new AbortController().signal,
          toolUseID: 'enter-plan',
        }
      )
    ).resolves.toEqual({ behavior: 'allow' });
    expect(onPermission).not.toHaveBeenCalled();
  });

  it('recognizes the MCP-prefixed enter_plan_mode tool name', async () => {
    const onPermission = vi.fn();
    const canUseTool = buildClaudeCanUseTool(onPermission)!;

    await expect(
      canUseTool(
        'mcp__plan-mode__enter_plan_mode',
        {},
        {
          signal: new AbortController().signal,
          toolUseID: 'enter-plan-mcp',
        }
      )
    ).resolves.toEqual({ behavior: 'allow' });
    expect(onPermission).not.toHaveBeenCalled();
  });

  it('keeps ExitPlanMode on the regular permission flow', async () => {
    const onPermission = vi.fn().mockResolvedValue({
      behavior: 'deny',
      message: 'Add a rollback step.',
    });
    const canUseTool = buildClaudeCanUseTool(onPermission)!;

    await expect(
      canUseTool(
        'ExitPlanMode',
        { plan: '# Plan\n\n1. Change it' },
        {
          signal: new AbortController().signal,
          toolUseID: 'exit-plan',
        }
      )
    ).resolves.toEqual({ behavior: 'deny', message: 'Add a rollback step.' });
    expect(onPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'exit-plan',
        toolName: 'ExitPlanMode',
      })
    );
  });
});
