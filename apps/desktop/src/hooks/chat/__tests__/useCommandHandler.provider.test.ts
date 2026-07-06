import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SlashCommand } from '@zclaudia/shared';
import { useCommandHandler } from '../useCommandHandler';

vi.mock('../../../services/api', async importOriginal => ({
  ...(await importOriginal<object>()),
  executeCommand: vi.fn(),
}));

vi.mock('../../../services/goalActions', () => ({
  activateGoal: vi.fn(),
}));

vi.mock('../../../services/api/goals', () => ({
  pauseGoal: vi.fn(),
  resumeGoal: vi.fn(),
  clearGoal: vi.fn(),
}));

import * as api from '../../../services/api';

function setup(commands: SlashCommand[]) {
  const addMessage = vi.fn();
  const startRun = vi.fn(async () => undefined);
  const { result } = renderHook(() =>
    useCommandHandler({
      sessionId: 'session-1',
      commands,
      currentSession: { id: 'session-1', workingDirectory: '/repo' } as any,
      currentProject: { id: 'project-1', name: 'Project', rootPath: '/repo' } as any,
      isForcedPlanSession: false,
      mode: 'default',
      addMessage,
      clearMessages: vi.fn(),
      scrollToBottom: vi.fn(),
      startRun,
      llmProfileId: 'claude-profile',
      commandsCacheKey: 'local:claude-profile',
      setDrawerOpen: vi.fn(),
    })
  );
  return { handleCommand: result.current.handleCommand, addMessage, startRun };
}

describe('useCommandHandler provider slash commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards provider slash commands to the active runtime', async () => {
    const { handleCommand, addMessage, startRun } = setup([
      { command: '/config', description: 'Open Claude config', source: 'provider' },
    ]);

    await handleCommand('/config', 'show');

    expect(addMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        role: 'user',
        content: '/config show',
      })
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        input: '/config show',
        mode: 'default',
        workingDirectory: '/repo',
      })
    );
    expect(api.executeCommand).not.toHaveBeenCalled();
  });

  it('forwards unknown slash commands to the active runtime', async () => {
    const { handleCommand, startRun } = setup([]);

    await handleCommand('/some/file/path', '');

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        input: '/some/file/path',
      })
    );
    expect(api.executeCommand).not.toHaveBeenCalled();
  });

  it('executes plugin commands through the command API instead of runtime pass-through', async () => {
    vi.mocked(api.executeCommand).mockResolvedValueOnce({
      type: 'builtin',
      action: 'help',
      command: '/plugin-panel',
      data: { content: 'plugin help' },
    } as any);
    const { handleCommand, startRun } = setup([
      { command: '/plugin-panel', description: 'Plugin panel', source: 'plugin' },
    ]);

    await handleCommand('/plugin-panel', 'open');

    expect(api.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: '/plugin-panel',
        args: ['open'],
        context: expect.objectContaining({
          projectPath: '/repo',
          provider: 'claude-profile',
        }),
      })
    );
    expect(startRun).not.toHaveBeenCalled();
  });
});
