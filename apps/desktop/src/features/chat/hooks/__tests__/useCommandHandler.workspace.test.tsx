import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandHandler } from '../useCommandHandler';
import { dispatchClientActionFromWire } from '../../clientActions';
import type { CommandExecuteResponse } from '@zclaudia/shared/features/commands';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    updateWorkingDirectory: vi.fn(),
    openTool: vi.fn(),
    activatePanel: vi.fn(),
    setDrawerOpen: vi.fn(),
  },
}));
vi.mock('../../../../services/api', async importOriginal => ({
  ...(await importOriginal<object>()),
  updateSessionWorkingDirectory: mocks.updateWorkingDirectory,
}));
vi.mock('../../../../actions/workspaceActions', () => ({ openToolInWorkspace: mocks.openTool }));
vi.mock('../../../../actions/openPanel', () => ({ activatePanel: mocks.activatePanel }));
vi.mock('../useSessionRoute', () => ({ useSessionRoute: () => ({ backendId: 'own-backend' }) }));

function options(sessionId: string, projectId: string) {
  return {
    sessionId,
    currentSession: { id: sessionId, workingDirectory: `/${sessionId}` } as any,
    currentProject: { id: projectId, rootPath: `/${projectId}` } as any,
    commands: [],
    isForcedPlanSession: false,
    mode: 'default',
    addMessage: vi.fn(),
    clearMessages: vi.fn(),
    scrollToBottom: vi.fn(),
    startRun: vi.fn(),
    llmProfileId: undefined,
    commandsCacheKey: sessionId,
    setDrawerOpen: mocks.setDrawerOpen,
  };
}

describe('useCommandHandler workspace scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps independent wire contexts for two chats and unregisters a closed chat', async () => {
    const own = options('chat-A', 'project-A');
    const other = options('chat-B', 'project-B');
    const first = renderHook(() => useCommandHandler(own));
    const second = renderHook(() => useCommandHandler(other));
    await act(async () => {
      await dispatchClientActionFromWire('zc.worktree', 'chat-A');
    });
    expect(own.addMessage).toHaveBeenCalledWith(
      'chat-A',
      expect.objectContaining({ content: expect.stringContaining('/chat-A') })
    );
    expect(other.addMessage).not.toHaveBeenCalled();
    first.unmount();
    expect(await dispatchClientActionFromWire('zc.worktree', 'chat-A')).toBe(false);
    await act(async () => {
      await dispatchClientActionFromWire('zc.worktree', 'chat-B');
    });
    expect(other.addMessage).toHaveBeenCalledWith(
      'chat-B',
      expect.objectContaining({ content: expect.stringContaining('/chat-B') })
    );
    second.unmount();
  });

  it('opens plugin panels in the originating chat rather than global selection', () => {
    const { result } = renderHook(() => useCommandHandler(options('chat-A', 'project-A')));
    act(() =>
      result.current.handleBuiltInCommand({
        type: 'builtin',
        action: 'show_panel',
        data: { panelId: 'changes' },
      } as CommandExecuteResponse)
    );
    expect(mocks.openTool).toHaveBeenCalledWith('chat-A', 'changes', {
      projectId: 'project-A',
      backendId: 'own-backend',
    });
    expect(mocks.activatePanel).not.toHaveBeenCalled();
  });
});
