import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { PaneTabs } from '../PaneTabs';

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  usePluginStore.setState({
    panels: [
      { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory' },
      { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'Files' },
    ] as any,
    disabledBuiltinPanels: [],
  });
});

function seedPane() {
  const s = useRightWorkspaceStore.getState();
  s.openTool('A', 'memory');
  s.openTool('A', 'file-viewer'); // [memory, files], active = files
  return useRightWorkspaceStore.getState().bySession.A.root as any;
}

describe('PaneTabs', () => {
  it('renders a tab per tool with the active one marked', () => {
    const pane = seedPane();
    const { getByText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    expect(getByText('Memory')).toBeTruthy();
    const filesTab = getByText('Files').closest('[data-tab-index]') as HTMLElement;
    expect(filesTab.getAttribute('data-active')).toBe('true');
  });

  it('clicking a tab activates it', () => {
    const pane = seedPane();
    const { getByText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    fireEvent.click(getByText('Memory'));
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).activeToolId).toBe('memory');
  });

  it('clicking a tab close button closes that tab', () => {
    const pane = seedPane();
    const { getByLabelText } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    fireEvent.click(getByLabelText('Close Memory'));
    const root = useRightWorkspaceStore.getState().bySession.A.root as any;
    expect(root.tools.map((t: any) => t.toolId)).toEqual(['file-viewer']);
  });

  it('exposes a trailing window-drag region (strip is the topmost row)', () => {
    const pane = seedPane();
    const { container } = render(<PaneTabs sessionId="A" pane={pane} focused />);
    expect(container.querySelector('[data-tauri-drag-region]')).toBeTruthy();
  });
});
