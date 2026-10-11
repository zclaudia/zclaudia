import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPanel } from '../BrowserPanel';
import { WorkspaceToolContext } from '../../../components/workspace/WorkspaceToolContext';
import { WorkspaceVisibilityContext } from '../../../components/workspace/WorkspaceContext';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useBrowserStore } from '../browserStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { handleServerMessage } from '../../../services/messageHandler';

const { sendMessage, sendToServer } = vi.hoisted(() => ({ sendMessage: vi.fn(), sendToServer: vi.fn() }));
vi.mock('../../../contexts/ConnectionContext', () => ({ useConnection: () => ({ sendMessage, sendToServer, isConnected: true }) }));
vi.mock('../BrowserToolbar', () => ({ BrowserToolbar: () => null }));
vi.mock('../BrowserViewportView', () => ({ BrowserViewportView: () => null }));
vi.mock('../ConsoleStrip', () => ({ ConsoleStrip: () => null }));
vi.mock('../NetworkStrip', () => ({ NetworkStrip: () => null }));

describe('BrowserPanel binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectionStore.setState({ selectedSessionId: 'selected-chat' });
    useBrowserStore.setState({ engine: { status: 'ready' }, enginesByBackend: {}, sessions: {} });
  });

  it('attaches the bound chat and defers hidden browser initialization', () => {
    const { rerender, unmount } = render(
      <WorkspaceToolContext.Provider value={{ sessionId: 'fixed-chat' }}>
        <WorkspaceVisibilityContext.Provider value={false}><BrowserPanel /></WorkspaceVisibilityContext.Provider>
      </WorkspaceToolContext.Provider>
    );
    expect(sendMessage).not.toHaveBeenCalled();
    rerender(
      <WorkspaceToolContext.Provider value={{ sessionId: 'fixed-chat' }}>
        <WorkspaceVisibilityContext.Provider value><BrowserPanel /></WorkspaceVisibilityContext.Provider>
      </WorkspaceToolContext.Provider>
    );
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser_open', sessionId: 'fixed-chat' });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'browser_attach', sessionId: 'fixed-chat' }));
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'browser_open', sessionId: 'selected-chat' });
    unmount();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser_detach', sessionId: 'fixed-chat' });
  });

  it('routes browser initialization to the bound backend', () => {
    const { unmount } = render(
      <WorkspaceToolContext.Provider value={{ sessionId: 'fixed-chat', backendId: 'fixed-backend' }}>
        <BrowserPanel />
      </WorkspaceToolContext.Provider>
    );
    expect(sendToServer).toHaveBeenCalledWith('fixed-backend', { type: 'browser_open', sessionId: 'fixed-chat' });
    expect(sendMessage).not.toHaveBeenCalled();
    unmount();
    expect(sendToServer).toHaveBeenCalledWith('fixed-backend', { type: 'browser_detach', sessionId: 'fixed-chat' });
  });

  it('reattaches when the owner recovers while the globally active connection remains online', () => {
    const backend = (runtimeState: 'offline' | 'ready') => ({ backendId: 'fixed-backend', name: 'Owner',
      instanceId: 'owner-instance', deviceId: 'owner-device', channel: 'local', isThisInstance: false, isThisDevice: false,
      online: runtimeState === 'ready', runtimeState, openState: 'subscribed' as const, capabilities: [] });
    useFacadeStore.setState({ connectionState: 'connected', backends: [backend('offline')] });
    const { unmount } = render(<WorkspaceToolContext.Provider value={{ sessionId: 'fixed-chat', backendId: 'fixed-backend' }}><BrowserPanel /></WorkspaceToolContext.Provider>);
    sendToServer.mockClear();
    act(() => useFacadeStore.setState({ backends: [backend('ready')] }));
    expect(sendToServer).toHaveBeenCalledWith('fixed-backend', { type: 'browser_open', sessionId: 'fixed-chat' });
    expect(sendToServer).toHaveBeenCalledWith('fixed-backend', expect.objectContaining({ type: 'browser_attach', sessionId: 'fixed-chat' }));
    expect(sendMessage).not.toHaveBeenCalled();
    unmount();
  });

  it('dispatches real browser messages and isolates the owner engine from other backend status', () => {
    const status = (backendId: string, engineStatus: 'ready' | 'missing') => handleServerMessage({
      type: 'browser_engine_status', status: engineStatus,
    }, { serverId: backendId, backendId, serverRunsRef: new Map(), resolveBackendName: () => undefined, logTag: 'test' });
    status('owner', 'ready');
    status('other', 'missing');
    const { unmount } = render(<WorkspaceToolContext.Provider value={{ sessionId: 'fixed-chat', backendId: 'owner' }}><BrowserPanel /></WorkspaceToolContext.Provider>);
    expect(screen.queryByRole('button', { name: 'Download Chromium' })).not.toBeInTheDocument();
    act(() => status('owner', 'missing'));
    expect(screen.getByRole('button', { name: 'Download Chromium' })).toBeInTheDocument();
    act(() => status('other', 'ready'));
    expect(screen.getByRole('button', { name: 'Download Chromium' })).toBeInTheDocument();
    expect(useBrowserStore.getState().enginesByBackend).toMatchObject({ owner: { status: 'missing' }, other: { status: 'ready' } });
    unmount();
  });
});
