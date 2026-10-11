import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPanel } from '../BrowserPanel';
import { WorkspaceToolContext } from '../../../components/workspace/WorkspaceToolContext';
import { WorkspaceVisibilityContext } from '../../../components/workspace/WorkspaceContext';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useBrowserStore } from '../browserStore';

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
    useBrowserStore.setState({ engine: { status: 'ready' }, sessions: {} });
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
});
