import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatActionsProvider } from '../../ChatActionsContext';
import { useRunInTerminal } from '../useRunInTerminal';
import type { ReactNode } from 'react';

const { mocks } = vi.hoisted(() => ({ mocks: {
  sendMessage: vi.fn(), sendToServer: vi.fn(), openTool: vi.fn(), activatePanel: vi.fn(),
  getTerminalId: vi.fn(), openTerminal: vi.fn(), setDrawerOpen: vi.fn(), waitForReady: vi.fn(),
  route: vi.fn(), features: ['remoteTerminal'] as string[],
} }));
vi.mock('../../../../contexts/ConnectionContext', () => ({ useConnection: () => mocks }));
vi.mock('../../hooks/useSessionRoute', () => ({ useSessionRoute: mocks.route }));
vi.mock('../../../../actions/workspaceActions', () => ({ openToolInWorkspace: mocks.openTool }));
vi.mock('../../../../actions/openPanel', () => ({ activatePanel: mocks.activatePanel }));
vi.mock('../../../../stores/projectStore', () => ({ useProjectStore: { getState: () => ({ sessions: [{ id: 'own-chat', projectId: 'own-project' }] }) } }));
vi.mock('../../../../stores/selectionStore', () => ({ useSelectionStore: (select: (state: unknown) => unknown) => select({ selectedSessionId: 'other-chat' }) }));
vi.mock('../../../../stores/terminalStore', () => ({ useTerminalStore: { getState: () => mocks } }));
vi.mock('../../../../stores/serverStore', () => ({ useServerStore: Object.assign(
  (select: (state: unknown) => unknown) => select({ activeServerId: 'other-backend', connections: { 'own-backend': { features: mocks.features } } }),
  { getState: () => ({ activeServerSupports: () => false }) }
) }));

function wrapper({ children }: { children: ReactNode }) {
  return <ChatActionsProvider value={{ sessionId: 'own-chat', handleSendMessage: vi.fn(), setMode: vi.fn() }}>{children}</ChatActionsProvider>;
}

describe('useRunInTerminal backend scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.features = ['remoteTerminal'];
    mocks.route.mockReturnValue({ backendId: 'own-backend' });
    mocks.getTerminalId.mockReturnValue('own-terminal');
    mocks.waitForReady.mockResolvedValue(undefined);
  });

  it('opens and sends to its own chat backend without relying on selection', async () => {
    const { result } = renderHook(() => useRunInTerminal(), { wrapper });
    expect(mocks.route).toHaveBeenCalledWith('own-chat');
    await act(async () => result.current?.('pwd'));
    expect(mocks.getTerminalId).toHaveBeenCalledWith('own-project', 'own-backend');
    expect(mocks.setDrawerOpen).toHaveBeenCalledWith('own-project', true, 'own-backend');
    expect(mocks.openTool).toHaveBeenCalledWith('own-chat', 'terminal', { projectId: 'own-project', backendId: 'own-backend' });
    expect(mocks.sendToServer).toHaveBeenCalledWith('own-backend', { type: 'terminal_input', terminalId: 'own-terminal', data: 'pwd' });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.activatePanel).not.toHaveBeenCalled();
  });

  it('gates capability using the bound backend rather than the active backend', () => {
    mocks.features = [];
    const { result } = renderHook(() => useRunInTerminal(), { wrapper });
    expect(result.current).toBeUndefined();
  });
});
