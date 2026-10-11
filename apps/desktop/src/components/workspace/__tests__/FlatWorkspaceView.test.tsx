import { ChatPane } from '../../../features/chat/ChatPane';
import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRightWorkspaceStore, flattenPanes } from '../../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { FlatWorkspaceView } from '../FlatWorkspaceView';

const counts = vi.hoisted(() => ({ chat: 0, tool: 0, closed: 0 }));
vi.mock('../../../features/chat/ChatPane', () => ({
  ChatPane: () => {
    useEffect(() => { counts.chat++; }, []);
    return <textarea aria-label="Chat draft" defaultValue="draft" />;
  },
}));

function Editor() {
  const [value, setValue] = useState('original');
  useEffect(() => { counts.tool++; return () => { counts.closed++; }; }, []);
  return <input aria-label="Tool edit" value={value} onChange={e => setValue(e.target.value)} />;
}

beforeEach(() => {
  counts.chat = 0; counts.tool = 0; counts.closed = 0;
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useRightSidebarStore.setState({ collapsed: false });
  usePluginStore.setState({ panels: [{ id: 'memory', pluginId: 'test', type: 'panel', label: 'Memory', component: Editor }] });
  useRightWorkspaceStore.getState().ensureChatSession('s');
  useRightWorkspaceStore.getState().openTool('s', 'memory');
});

describe('stable workspace content', () => {
  it('keeps chat and editor DOM/state through moves, collapse and maximize', () => {
    const { rerender } = render(<FlatWorkspaceView chatComponent={ChatPane} sessionId="s" collapsed={false} />);
    const chat = screen.getByLabelText('Chat draft');
    const tool = screen.getByLabelText('Tool edit');
    fireEvent.change(tool, { target: { value: 'unsaved edit' } });
    fireEvent.change(chat, { target: { value: 'unsent chat' } });
    const state = useRightWorkspaceStore.getState();
    act(() => state.moveChatPane('s', 'bottom'));
    rerender(<FlatWorkspaceView chatComponent={ChatPane} sessionId="s" collapsed />);
    expect(screen.getByLabelText('Tool edit')).toBe(tool);
    expect(tool.closest('[data-content-ref]')).not.toBeVisible();
    rerender(<FlatWorkspaceView chatComponent={ChatPane} sessionId="s" collapsed={false} />);
    const pane = flattenPanes(useRightWorkspaceStore.getState().bySession.s.root).find(p => p.tools[0].toolId === 'memory')!;
    act(() => state.setMaximizedPane('s', pane.id));
    expect(chat.closest('[data-content-ref]')).not.toBeVisible();
    act(() => state.setMaximizedPane('s', null));
    expect(screen.getByLabelText('Chat draft')).toBe(chat);
    expect(tool).toHaveValue('unsaved edit');
    expect(chat).toHaveValue('unsent chat');
    expect(counts).toEqual({ chat: 1, tool: 1, closed: 0 });
  });

  it('retains a tool ref host when the tab moves to a different pane', () => {
    useRightWorkspaceStore.getState().openTool('s', 'file-viewer');
    render(<FlatWorkspaceView chatComponent={ChatPane} sessionId="s" collapsed={false} />);
    const tool = screen.getByLabelText('Tool edit');
    fireEvent.change(tool, { target: { value: 'keep' } });
    const panes = flattenPanes(useRightWorkspaceStore.getState().bySession.s.root);
    const source = panes.find(p => p.tools.some(t => t.toolId === 'memory'))!;
    const chat = panes.find(p => p.tools[0].toolId === 'chat')!;
    act(() => useRightWorkspaceStore.getState().moveTabToEdge('s', source.id, chat.id, 'memory', undefined, 'top'));
    expect(screen.getByLabelText('Tool edit')).toBe(tool);
    expect(tool).toHaveValue('keep');
    expect(counts.tool).toBe(1);
    expect(counts.closed).toBe(0);
    const moved = flattenPanes(useRightWorkspaceStore.getState().bySession.s.root).find(p => p.tools.some(t => t.toolId === 'memory'))!;
    act(() => useRightWorkspaceStore.getState().closeTool('s', moved.id, 'memory'));
    expect(screen.queryByLabelText('Tool edit')).toBeNull();
    expect(counts.closed).toBe(1);
  });

  it('provides a virtual empty launcher without persisting its geometry nodes', () => {
    const pane = flattenPanes(useRightWorkspaceStore.getState().bySession.s.root).find(p => p.tools[0].toolId === 'memory')!;
    useRightWorkspaceStore.getState().closePane('s', pane.id);
    render(<FlatWorkspaceView chatComponent={ChatPane} sessionId="s" collapsed={false} emptyState={<div>Open a tool</div>} />);
    expect(screen.getByText('Open a tool')).toBeVisible();
    expect(flattenPanes(useRightWorkspaceStore.getState().bySession.s.root)).toHaveLength(1);
  });
});
