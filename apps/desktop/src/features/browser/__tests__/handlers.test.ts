import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleBrowserMessage } from '../handlers';
import { useBrowserStore } from '../browserStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useRightWorkspaceStore, newPane } from '../../../stores/rightWorkspaceStore';

const uiMocks = vi.hoisted(() => ({
  openToolInWorkspace: vi.fn(),
  isPanelAvailable: vi.fn(() => true),
}));
vi.mock('../../../utils/workspaceActions', () => ({
  openToolInWorkspace: uiMocks.openToolInWorkspace,
}));
vi.mock('../../../utils/openPanel', () => ({
  isPanelAvailable: uiMocks.isPanelAvailable,
}));

const state = { url: 'http://x/', title: 'X', loading: false, canGoBack: false, canGoForward: false };

describe('handleBrowserMessage', () => {
  beforeEach(() => {
    useBrowserStore.getState().reset();
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useSelectionStore.setState({ selectedSessionId: null });
    uiMocks.openToolInWorkspace.mockClear();
    uiMocks.isPanelAvailable.mockReturnValue(true);
  });

  it('ignores non-browser messages', () => {
    expect(handleBrowserMessage({ type: 'terminal_output', terminalId: 't', data: '' } as never)).toBe(false);
  });

  it('browser_opened and browser_state update session state', () => {
    expect(handleBrowserMessage({ type: 'browser_opened', sessionId: 's1', state } as never)).toBe(true);
    expect(useBrowserStore.getState().sessions['s1'].state?.url).toBe('http://x/');
    handleBrowserMessage({ type: 'browser_state', sessionId: 's1', state: { ...state, title: 'Y' } } as never);
    expect(useBrowserStore.getState().sessions['s1'].state?.title).toBe('Y');
  });

  it('browser_frame stores the latest frame', () => {
    handleBrowserMessage({
      type: 'browser_frame', sessionId: 's1', data: 'AAAA',
      metadata: { deviceWidth: 800, deviceHeight: 600 },
    } as never);
    expect(useBrowserStore.getState().sessions['s1'].frame).toEqual({
      data: 'AAAA', deviceWidth: 800, deviceHeight: 600,
    });
  });

  it('browser_closed records reason and clears frame', () => {
    handleBrowserMessage({ type: 'browser_frame', sessionId: 's1', data: 'AAAA', metadata: { deviceWidth: 1, deviceHeight: 1 } } as never);
    handleBrowserMessage({ type: 'browser_closed', sessionId: 's1', reason: 'crash' } as never);
    const s = useBrowserStore.getState().sessions['s1'];
    expect(s.closedReason).toBe('crash');
    expect(s.frame).toBeNull();
  });

  it('browser_error records the message; browser_engine_status updates engine', () => {
    handleBrowserMessage({ type: 'browser_error', sessionId: 's1', code: 'x', message: 'nav failed' } as never);
    expect(useBrowserStore.getState().sessions['s1'].error).toBe('nav failed');
    handleBrowserMessage({ type: 'browser_engine_status', status: 'downloading', progress: 0.4 } as never);
    expect(useBrowserStore.getState().engine).toMatchObject({ status: 'downloading', progress: 0.4 });
  });

  it('browser_emulation stores the echoed device (and null on disable)', () => {
    const emulation = { presetId: 'iphone-15-pro', width: 393, height: 852, dpr: 3, userAgent: 'ua', mobile: true, hasTouch: true };
    handleBrowserMessage({ type: 'browser_emulation', sessionId: 's1', emulation } as never);
    expect(useBrowserStore.getState().sessions['s1'].emulation).toEqual(emulation);
    handleBrowserMessage({ type: 'browser_emulation', sessionId: 's1', emulation: null } as never);
    expect(useBrowserStore.getState().sessions['s1'].emulation).toBeNull();
  });

  it('browser_console appends entries, replaces on replace:true, and caps at 500', () => {
    const e = (text: string) => ({ level: 'log', text, ts: 1 });
    handleBrowserMessage({ type: 'browser_console', sessionId: 's1', entries: [e('a')] } as never);
    handleBrowserMessage({ type: 'browser_console', sessionId: 's1', entries: [e('b')] } as never);
    expect(useBrowserStore.getState().sessions['s1'].console.map((x) => x.text)).toEqual(['a', 'b']);
    handleBrowserMessage({ type: 'browser_console', sessionId: 's1', entries: [e('fresh')], replace: true } as never);
    expect(useBrowserStore.getState().sessions['s1'].console.map((x) => x.text)).toEqual(['fresh']);
    const many = Array.from({ length: 600 }, (_, i) => e(`m${i}`));
    handleBrowserMessage({ type: 'browser_console', sessionId: 's1', entries: many } as never);
    const buf = useBrowserStore.getState().sessions['s1'].console;
    expect(buf).toHaveLength(500);
    expect(buf[buf.length - 1].text).toBe('m599');
  });

  it('browser_agent_activity toggles agentActive', () => {
    handleBrowserMessage({ type: 'browser_agent_activity', sessionId: 's1', active: true } as never);
    expect(useBrowserStore.getState().sessions['s1'].agentActive).toBe(true);
  });

  it('agent activity active=true auto-opens the browser panel when its session is selected and the workspace is empty', () => {
    useSelectionStore.getState().setSelectedSessionId('s1');
    handleBrowserMessage({ type: 'browser_agent_activity', sessionId: 's1', active: true } as never);
    expect(uiMocks.openToolInWorkspace).toHaveBeenCalledWith('s1', 'browser');
  });

  it('agent activity active=false does not open the panel', () => {
    useSelectionStore.getState().setSelectedSessionId('s1');
    handleBrowserMessage({ type: 'browser_agent_activity', sessionId: 's1', active: false } as never);
    expect(uiMocks.openToolInWorkspace).not.toHaveBeenCalled();
  });

  it('no auto-open when the panel is unavailable on this platform', () => {
    useSelectionStore.getState().setSelectedSessionId('s1');
    uiMocks.isPanelAvailable.mockReturnValueOnce(false);
    handleBrowserMessage({ type: 'browser_agent_activity', sessionId: 's1', active: true } as never);
    expect(uiMocks.openToolInWorkspace).not.toHaveBeenCalled();
  });

  it('no auto-open when the browser tool is already open in the session workspace', () => {
    useSelectionStore.getState().setSelectedSessionId('s1');
    const pane = newPane('browser');
    useRightWorkspaceStore.setState({
      bySession: { s1: { root: pane, primaryPaneId: pane.id, focusedPaneId: pane.id } },
      order: ['s1'],
    });
    handleBrowserMessage({ type: 'browser_agent_activity', sessionId: 's1', active: true } as never);
    expect(uiMocks.openToolInWorkspace).not.toHaveBeenCalled();
  });

  it('no auto-open when the activity is for a non-selected session', () => {
    useSelectionStore.getState().setSelectedSessionId('other-session');
    handleBrowserMessage({ type: 'browser_agent_activity', sessionId: 's1', active: true } as never);
    expect(uiMocks.openToolInWorkspace).not.toHaveBeenCalled();
  });
});
