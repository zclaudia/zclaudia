// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useSelectionStore } from '../../../../stores/selectionStore';
import { useProjectStore } from '../../../../stores/projectStore';
import { useProjectWorkspaceStore } from '../../../../stores/projectWorkspaceStore';
import { usePluginStore } from '../../../../stores/pluginStore';
import { useServerStore } from '../../../../stores/serverStore';
import { useOwnershipStore } from '../../../../stores/ownershipStore';
import { useRightWorkspaceStore, flattenPanes } from '../../../../stores/rightWorkspaceStore';
import {
  useWorkspaceRoutingStore,
  sessionWorkspaceId,
} from '../../../../stores/workspaceRoutingStore';
import { useTerminalStore } from '../../../../stores/terminalStore';
import { useFileViewerStore } from '../../../../stores/fileViewerStore';

const context = {
  projectId: 'project',
  projectRoot: '/focused-worktree',
  sessionId: 'focused-chat',
  backendId: 'owner-backend',
};
const scopedId = sessionWorkspaceId('focused-chat');

function shortcut(
  key: string,
  modifiers: Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey'> = { ctrlKey: true }
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => window.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  useSelectionStore.setState({ selectedSessionId: 'unrelated-chat' });
  useProjectStore.setState({
    sessions: [
      { id: 'focused-chat', projectId: 'project', workingDirectory: '/focused-worktree' },
      { id: 'unrelated-chat', projectId: 'another-project' },
    ] as any,
  });
  useProjectWorkspaceStore.setState({
    byProject: {
      project: { workspaceId: 'main-anchor', focusedChatSessionId: 'other-chat', toolBindings: {} },
    },
  });
  useWorkspaceRoutingStore.setState({
    registrations: [],
    active: {
      workspaceId: scopedId,
      sessionId: 'focused-chat',
      projectId: 'project',
      projectScoped: false,
    },
  });
  useOwnershipStore.setState({
    sessionBackendIds: { 'focused-chat': 'owner-backend' },
    projectBackendIds: {},
    taskOwners: {},
  });
  useServerStore.setState({
    activeServerId: 'unrelated-backend',
    connections: {
      'owner-backend': { features: ['remoteTerminal'] },
      'unrelated-backend': { features: [] },
    },
  } as any);
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useTerminalStore.setState({ terminals: {}, drawerOpen: {} });
  useFileViewerStore.setState({
    isOpen: false,
    projectRoot: null,
    backendId: null,
    filePath: null,
    content: null,
    searchOpen: false,
  });
  usePluginStore.setState({
    panels: [
      {
        id: 'terminal',
        label: 'Terminal',
        visible: false,
        defaultPlacement: 'right',
        requiresFeature: 'remoteTerminal',
      },
      { id: 'file-viewer', label: 'Files', visible: false, defaultPlacement: 'right' },
    ] as any,
    disabledBuiltinPanels: [],
    panelPlacements: {},
  });
});

describe('workspace keyboard shortcut routing', () => {
  it('opens and toggles only the focused chat owner terminal in its isolated workspace', () => {
    renderHook(() => useKeyboardShortcuts(context));
    expect(shortcut('`').defaultPrevented).toBe(true);
    const terminalId = useTerminalStore.getState().getTerminalId('project', 'owner-backend');
    expect(terminalId).toBeTruthy();
    expect(
      useTerminalStore.getState().getTerminalId('project', 'unrelated-backend')
    ).toBeUndefined();
    expect(useTerminalStore.getState().isDrawerOpen('project', 'owner-backend')).toBe(true);
    expect(
      flattenPanes(useRightWorkspaceStore.getState().bySession[scopedId].root)[0].tools
    ).toEqual([{ toolId: 'terminal', instanceKey: 'owner-backend::project' }]);
    expect(useRightWorkspaceStore.getState().bySession['main-anchor']).toBeUndefined();
    expect(useRightWorkspaceStore.getState().bySession['unrelated-chat']).toBeUndefined();
    shortcut('`');
    expect(useTerminalStore.getState().isDrawerOpen('project', 'owner-backend')).toBe(false);
    shortcut('`');
    expect(useTerminalStore.getState().isDrawerOpen('project', 'owner-backend')).toBe(true);
    expect(useTerminalStore.getState().getTerminalId('project', 'owner-backend')).toBe(terminalId);
  });

  it('activates the focused owner terminal when only a different backend terminal is shown', () => {
    useRightWorkspaceStore.getState().openTool(scopedId, 'terminal', {
      multiInstance: true,
      instanceKey: 'other-backend::project',
    });
    usePluginStore.getState().updatePanelVisibility('terminal', true);
    useTerminalStore.getState().setDrawerOpen('project', true, 'owner-backend');
    renderHook(() => useKeyboardShortcuts(context));
    shortcut('`');
    expect(useTerminalStore.getState().isDrawerOpen('project', 'owner-backend')).toBe(true);
    expect(
      flattenPanes(useRightWorkspaceStore.getState().bySession[scopedId].root).flatMap(
        pane => pane.tools
      )
    ).toContainEqual({ toolId: 'terminal', instanceKey: 'owner-backend::project' });
  });

  it('opens file search on the focused worktree/backend and clears a stale file from another scope', () => {
    useFileViewerStore.setState({
      isOpen: true,
      projectRoot: '/other-root',
      backendId: 'unrelated-backend',
      filePath: 'secret.txt',
      content: 'stale',
    });
    renderHook(() => useKeyboardShortcuts(context));
    expect(shortcut('p', { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
    expect(useFileViewerStore.getState()).toMatchObject({
      isOpen: true,
      searchOpen: true,
      projectRoot: '/focused-worktree',
      backendId: 'owner-backend',
      filePath: null,
      content: null,
    });
    expect(
      flattenPanes(useRightWorkspaceStore.getState().bySession[scopedId].root)[0].tools[0].toolId
    ).toBe('file-viewer');
    expect(useSelectionStore.getState().selectedSessionId).toBe('unrelated-chat');
  });

  it('does not handle shortcuts while disabled or after another handler has claimed them', () => {
    const { rerender } = renderHook(
      ({ enabled }) => useKeyboardShortcuts({ ...context, enabled }),
      { initialProps: { enabled: false } }
    );
    expect(shortcut('`').defaultPrevented).toBe(false);
    expect(useTerminalStore.getState().terminals).toEqual({});
    rerender({ enabled: true });
    const event = new KeyboardEvent('keydown', { key: '`', ctrlKey: true, cancelable: true });
    event.preventDefault();
    act(() => window.dispatchEvent(event));
    expect(useTerminalStore.getState().terminals).toEqual({});
  });
});
