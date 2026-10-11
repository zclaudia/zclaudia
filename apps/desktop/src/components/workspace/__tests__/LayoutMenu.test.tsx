import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutMenu } from '../LayoutMenu';
import { WorkspacePaneContext } from '../WorkspaceContext';
import { BUILTIN_LAYOUT_PRESETS, useLayoutPresetStore } from '../../../stores/layoutPresetStore';
import { flattenPanes, isChatRef, useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore, workspaceRefKey } from '../../../stores/projectWorkspaceStore';
import { selectProjectChat, resolveProjectWorkspace } from '../../../actions/projectWorkspaceActions';
import { usePluginStore } from '../../../stores/pluginStore';

const { promptText, onOpen, onClose } = vi.hoisted(() => ({ promptText: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() }));
vi.mock('../../../stores/confirmDialogStore', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), promptText,
}));

const projectId = 'project';
const current = () => useRightWorkspaceStore.getState().bySession.A;
const refKeys = () => flattenPanes(current().root).flatMap(p => p.tools).map(workspaceRefKey).sort();
function selectMenuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  promptText.mockResolvedValue(null);
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useLayoutPresetStore.setState({ presets: [...BUILTIN_LAYOUT_PRESETS], selectedByProject: {} });
  usePluginStore.setState({ panels: [{ id: 'memory', pluginId: 'test', type: 'panel', label: 'Memory', onOpen, onClose }] });
  resolveProjectWorkspace(projectId, ['A', 'B'], 'A');
  selectProjectChat(projectId, 'B', { beside: true });
  useRightWorkspaceStore.getState().openTool('A', 'memory');
});

describe('Layout menu integration', () => {
  it('offers all eight layouts and applies the chosen preset without closing or reopening refs', () => {
    const before = refKeys();
    render(<LayoutMenu projectId={projectId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    for (const preset of BUILTIN_LAYOUT_PRESETS) expect(screen.getByRole('menuitem', { name: preset.name })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Compare' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useLayoutPresetStore.getState().selectedByProject.project).toBe('compare');
    expect(refKeys()).toEqual(before);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves, selects, renames and deletes a user layout through the text prompt', async () => {
    render(<LayoutMenu projectId={projectId} />);
    promptText.mockResolvedValueOnce('My review');
    selectMenuItem('Save current layout…');
    await waitFor(() => expect(useLayoutPresetStore.getState().presets.some(p => p.name === 'My review')).toBe(true));
    expect(promptText).toHaveBeenLastCalledWith({ title: 'Save layout', placeholder: 'Layout name', confirmLabel: 'Save' });
    selectMenuItem('My review');
    const selected = useLayoutPresetStore.getState().selectedByProject.project;
    promptText.mockResolvedValueOnce('Renamed review');
    selectMenuItem('Rename layout…');
    await waitFor(() => expect(useLayoutPresetStore.getState().presets.find(p => p.id === selected)?.name).toBe('Renamed review'));
    expect(promptText).toHaveBeenLastCalledWith({ title: 'Rename layout', defaultValue: 'My review', confirmLabel: 'Rename' });
    selectMenuItem('Delete saved layout');
    expect(useLayoutPresetStore.getState().presets).toHaveLength(8);
    expect(useLayoutPresetStore.getState().selectedByProject.project).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports save and rename name conflicts and preserves the existing user preset', async () => {
    render(<LayoutMenu projectId={projectId} />);
    promptText.mockResolvedValueOnce(' Default ');
    selectMenuItem('Save current layout…');
    expect(await screen.findByRole('alert')).toHaveTextContent('A layout with this name already exists.');
    expect(useLayoutPresetStore.getState().presets).toHaveLength(8);
    promptText.mockResolvedValueOnce('Mine');
    selectMenuItem('Save current layout…');
    await waitFor(() => expect(useLayoutPresetStore.getState().presets).toHaveLength(9));
    expect(screen.queryByRole('alert')).toBeNull();
    selectMenuItem('Mine');
    const id = useLayoutPresetStore.getState().selectedByProject.project;
    promptText.mockResolvedValueOnce('review');
    selectMenuItem('Rename layout…');
    expect(await screen.findByRole('alert')).toHaveTextContent('A layout with this name already exists.');
    expect(useLayoutPresetStore.getState().presets.find(p => p.id === id)?.name).toBe('Mine');
  });

  it('ignores a cancelled prompt and exposes no builtin rename/delete actions', async () => {
    render(<LayoutMenu projectId={projectId} />);
    selectMenuItem('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    expect(screen.queryByRole('menuitem', { name: 'Rename layout…' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete saved layout' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Save current layout…' })); });
    expect(useLayoutPresetStore.getState().presets).toHaveLength(8);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens its shortcut only for the focused visible chat pane', () => {
    const chat = flattenPanes(current().root).find(p => p.tools.some(isChatRef))!;
    useRightWorkspaceStore.getState().focusPane('A', chat.id);
    const context = { workspaceId: 'A', paneId: chat.id, projectId };
    const { rerender } = render(<WorkspacePaneContext.Provider value={context}><LayoutMenu projectId={projectId} /></WorkspacePaneContext.Provider>);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true });
    expect(screen.getByRole('menu', { name: 'Layout' })).toBeVisible();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    const tool = flattenPanes(current().root).find(p => !p.tools.some(isChatRef))!;
    act(() => useRightWorkspaceStore.getState().focusPane('A', tool.id));
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
    act(() => useRightWorkspaceStore.getState().focusPane('A', chat.id));
    rerender(<WorkspacePaneContext.Provider value={context}><div hidden><LayoutMenu projectId={projectId} /></div></WorkspacePaneContext.Provider>);
    fireEvent.keyDown(window, { key: 'l', metaKey: true, altKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
