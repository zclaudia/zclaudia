import { resolveProjectWorkspace } from '../../../actions/projectWorkspaceActions';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePlaceholder } from '../WorkspacePlaceholder';
import { applyLayoutPreset } from '../../../actions/layoutPresetActions';
import { BUILTIN_LAYOUT_PRESETS, useLayoutPresetStore } from '../../../stores/layoutPresetStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';
import { flattenPanes, isChatRef, useRightWorkspaceStore, type LayoutNode, type PlaceholderNode } from '../../../stores/rightWorkspaceStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { useServerStore } from '../../../stores/serverStore';

const onOpen = vi.fn();
const onClose = vi.fn();
const projectId = 'project';
const current = () => useRightWorkspaceStore.getState().bySession.A;
const placeholders = (root: LayoutNode | null): PlaceholderNode[] => {
  if (!root || root.kind === 'pane') return [];
  return root.kind === 'placeholder' ? [root] : [...placeholders(root.children[0]), ...placeholders(root.children[1])];
};
const chatSlot = () => placeholders(current().root).find(p => p.accepts === 'chat')!;
const toolSlot = () => placeholders(current().root).find(p => p.accepts === 'tool:terminal')!;
const chats = () => flattenPanes(current().root).flatMap(p => p.tools.filter(isChatRef));

beforeEach(() => {
  vi.clearAllMocks();
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useLayoutPresetStore.setState({ presets: [...BUILTIN_LAYOUT_PRESETS], selectedByProject: {} });
  useProjectStore.setState({ sessions: [
    { id: 'A', projectId, name: 'Main' }, { id: 'B', projectId, name: 'Watcher' },
    { id: 'foreign', projectId: 'other-project', name: 'Foreign' },
    { id: 'archived', projectId, name: 'Archived', archivedAt: 2 },
  ].map(session => ({ type: 'regular' as const, createdAt: 1, updatedAt: 1, ...session })) });
  useServerStore.setState({ activeServerId: 'be' });
  useOwnershipStore.setState({ projectBackendIds: {}, sessionBackendIds: {} });
  usePluginStore.setState({ panels: [
    { id: 'terminal', pluginId: 'test', type: 'panel', label: 'Terminal', onOpen, onClose },
    { id: 'memory', pluginId: 'test', type: 'panel', label: 'Memory' },
  ], disabledBuiltinPanels: [] });
  resolveProjectWorkspace(projectId, ['A', 'B'], 'A');
  applyLayoutPreset(projectId, 'compare');
});

describe('Workspace empty slots', () => {
  it('offers only active sessions from this project and fills the chosen new chat', () => {
    const empty = chatSlot();
    const firstRef = chats()[0];
    render(<WorkspacePlaceholder node={empty} projectId={projectId} />);
    expect(screen.getByRole('button', { name: 'Main' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Watcher' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Foreign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archived' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Watcher' }));
    expect(chats().map(t => t.instanceKey)).toEqual(['A', 'B']);
    expect(chats()[0]).toBe(firstRef);
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(false);
    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('B');
    expect(useProjectStore.getState().selectedSessionId).toBe('B');
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses an existing chat and keeps the slot available without creating another ref', () => {
    const empty = chatSlot();
    const existing = flattenPanes(current().root).find(p => p.tools.some(isChatRef))!;
    render(<WorkspacePlaceholder node={empty} projectId={projectId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Main' }));
    expect(chats()).toHaveLength(1);
    expect(current().focusedPaneId).toBe(existing.id);
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(true);
  });

  it('offers only matching tools and initializes the explicitly selected terminal scope once', () => {
    const empty = toolSlot();
    render(<WorkspacePlaceholder node={empty} projectId={projectId} />);
    expect(screen.queryByRole('button', { name: 'Memory' })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    const tool = flattenPanes(current().root).flatMap(p => p.tools).find(t => t.toolId === 'terminal');
    expect(tool).toEqual({ toolId: 'terminal', instanceKey: 'be::project' });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ sessionId: 'A', projectId, backendId: 'be' });
    expect(onClose).not.toHaveBeenCalled();
    expect(placeholders(current().root).some(p => p.id === empty.id)).toBe(false);
  });

  it('opens placeholder tools with the project owner backend instead of the active server', () => {
    useOwnershipStore.getState().setProjectOwner(projectId, 'be-owner');
    const empty = toolSlot();
    render(<WorkspacePlaceholder node={empty} projectId={projectId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    const tool = flattenPanes(current().root).flatMap(p => p.tools).find(t => t.toolId === 'terminal');
    expect(tool).toEqual({ toolId: 'terminal', instanceKey: 'be-owner::project' });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ sessionId: 'A', projectId, backendId: 'be-owner' });
  });

  it('shows the same-project session creation guidance when the catalog has no choices', () => {
    useProjectStore.setState({ sessions: [] });
    render(<WorkspacePlaceholder node={chatSlot()} projectId={projectId} />);
    expect(screen.getByText('Create a session from the sidebar to open it here.')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reports a stale slot failure without altering the active workspace', () => {
    const stale = { ...chatSlot(), id: 'removed-slot' };
    render(<WorkspacePlaceholder node={stale} projectId={projectId} />);
    const before = current();
    fireEvent.click(screen.getByRole('button', { name: 'Watcher' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to fill this slot');
    expect(current()).toBe(before);
  });

  it('responds to project catalog changes without exposing another project session', () => {
    render(<WorkspacePlaceholder node={chatSlot()} projectId={projectId} />);
    act(() => useProjectStore.setState(state => ({ sessions: state.sessions.map(s => s.id === 'B' ? { ...s, projectId: 'other-project' } : s) })));
    expect(screen.queryByRole('button', { name: 'Watcher' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Main' })).toBeVisible();
  });
});
