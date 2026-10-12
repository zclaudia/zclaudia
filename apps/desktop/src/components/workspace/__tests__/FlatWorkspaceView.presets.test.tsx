import { ChatPane } from '../../../features/chat/ChatPane';
import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlatWorkspaceView } from '../FlatWorkspaceView';
import { LayoutMenu } from '../LayoutMenu';
import { useWorkspaceTool } from '../WorkspaceToolContext';
import { BUILTIN_LAYOUT_PRESETS, useLayoutPresetStore } from '../../../stores/layoutPresetStore';
import { useProjectWorkspaceStore, workspaceRefKey } from '../../../stores/projectWorkspaceStore';
import { flattenPanes, useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { useServerStore } from '../../../stores/serverStore';
import {
  selectProjectChat,
  resolveProjectWorkspace,
} from '../../../actions/projectWorkspaceActions';
import { closeTabInWorkspace } from '../../../actions/workspaceActions';

const lifecycle = vi.hoisted(() => ({
  mounts: {} as Record<string, number>,
  unmounts: {} as Record<string, number>,
  onOpen: vi.fn(),
  onClose: vi.fn(),
}));
vi.mock('../../../features/chat/ChatPane', () => ({
  ChatPane: ({ sessionId }: { sessionId: string }) => {
    const [draft, setDraft] = useState('');
    useEffect(() => {
      const key = `chat:${sessionId}`;
      lifecycle.mounts[key] = (lifecycle.mounts[key] ?? 0) + 1;
      return () => {
        lifecycle.unmounts[key] = (lifecycle.unmounts[key] ?? 0) + 1;
      };
    }, [sessionId]);
    return (
      <textarea
        aria-label={`Draft ${sessionId}`}
        value={draft}
        onChange={event => setDraft(event.target.value)}
      />
    );
  },
}));

function Editor({ panelId }: { panelId: string }) {
  const context = useWorkspaceTool();
  const identity = `${panelId}:${context?.backendId}:${context?.projectId}`;
  const [mountIdentity] = useState(identity);
  const [value, setValue] = useState('');
  useEffect(() => {
    lifecycle.mounts[mountIdentity] = (lifecycle.mounts[mountIdentity] ?? 0) + 1;
    return () => {
      lifecycle.unmounts[mountIdentity] = (lifecycle.unmounts[mountIdentity] ?? 0) + 1;
    };
  }, [mountIdentity]);
  return (
    <>
      <input
        aria-label={`Edit ${identity}`}
        value={value}
        onChange={event => setValue(event.target.value)}
      />
      {panelId === 'memory' && <iframe title="Plugin-like frame" />}
    </>
  );
}

const projectId = 'project';
const current = () => useRightWorkspaceStore.getState().bySession.A;
const refs = () => flattenPanes(current().root).flatMap(p => p.tools);

beforeEach(() => {
  lifecycle.mounts = {};
  lifecycle.unmounts = {};
  lifecycle.onOpen.mockClear();
  lifecycle.onClose.mockClear();
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  useProjectWorkspaceStore.setState({ byProject: {} });
  useLayoutPresetStore.setState({ presets: [...BUILTIN_LAYOUT_PRESETS], selectedByProject: {} });
  useRightSidebarStore.setState({ collapsed: false });
  useServerStore.setState({ activeServerId: 'be' });
  useTerminalStore.setState({
    terminals: { 'be-1::project': 'term-1', 'be-2::project': 'term-2' },
  });
  useProjectStore.setState({
    projects: [
      {
        id: projectId,
        name: 'Project',
        type: 'code',
        rootPath: '/work/main',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    sessions: ['A', 'B', 'C'].map(id => ({
      id,
      projectId,
      name: id,
      type: 'regular' as const,
      workingDirectory: `/work/${id}`,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
  usePluginStore.setState({
    panels: ['terminal', 'memory'].map(id => ({
      id,
      pluginId: 'test',
      type: 'panel' as const,
      label: id,
      component: Editor,
      onOpen: lifecycle.onOpen,
      onClose: lifecycle.onClose,
    })),
    disabledBuiltinPanels: [],
  });
  resolveProjectWorkspace(projectId, ['A', 'B', 'C'], 'A');
  selectProjectChat(projectId, 'B', { beside: true });
  selectProjectChat(projectId, 'C', { beside: true });
  useRightWorkspaceStore
    .getState()
    .openTool('A', 'terminal', { instanceKey: 'be-1::project', multiInstance: true });
  useRightWorkspaceStore
    .getState()
    .openTool('A', 'terminal', { instanceKey: 'be-2::project', multiInstance: true });
  useRightWorkspaceStore.getState().openTool('A', 'memory');
  const memory = refs().find(ref => ref.toolId === 'memory')!;
  useProjectWorkspaceStore
    .getState()
    .setToolBinding(projectId, memory, { mode: 'fixed', sessionId: 'B' });
});

describe('preset switches retain live content hosts', () => {
  it('preserves all chat drafts, tool edits, selections and nested frame DOM while changing every layout', () => {
    const { rerender } = render(
      <>
        <LayoutMenu projectId={projectId} />
        <FlatWorkspaceView
          chatComponent={ChatPane}
          sessionId="A"
          projectId={projectId}
          collapsed={false}
        />
      </>
    );
    const chatInputs = ['A', 'B', 'C'].map(
      id => screen.getByLabelText(`Draft ${id}`) as HTMLTextAreaElement
    );
    const toolLabels = ['terminal:be-1:project', 'terminal:be-2:project', 'memory:be:project'];
    const toolInputs = toolLabels.map(label => screen.getByLabelText(`Edit ${label}`));
    const frame = screen.getByTitle('Plugin-like frame');
    const beforeRefs = refs();
    const beforeKeys = beforeRefs.map(workspaceRefKey).sort();
    chatInputs.forEach((input, index) => {
      fireEvent.change(input, { target: { value: `Unsent message ${index}` } });
      input.setSelectionRange(2, 6);
      input.scrollTop = 17 + index;
    });
    toolInputs.forEach((input, index) =>
      fireEvent.change(input, { target: { value: `Unsaved edit ${index}` } })
    );

    for (const preset of BUILTIN_LAYOUT_PRESETS) {
      fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
      fireEvent.click(screen.getByRole('menuitem', { name: preset.name }));
      expect(refs().map(workspaceRefKey).sort()).toEqual(beforeKeys);
      for (const ref of beforeRefs)
        expect(refs().find(item => workspaceRefKey(item) === workspaceRefKey(ref))).toBe(ref);
      chatInputs.forEach((input, index) => {
        expect(screen.getByLabelText(`Draft ${['A', 'B', 'C'][index]}`)).toBe(input);
        expect(input).toHaveValue(`Unsent message ${index}`);
        expect([input.selectionStart, input.selectionEnd, input.scrollTop]).toEqual([
          2,
          6,
          17 + index,
        ]);
      });
      toolInputs.forEach((input, index) => {
        expect(screen.getByLabelText(`Edit ${toolLabels[index]}`)).toBe(input);
        expect(input).toHaveValue(`Unsaved edit ${index}`);
      });
      expect(screen.getByTitle('Plugin-like frame')).toBe(frame);
      expect(Object.values(lifecycle.mounts)).toEqual([1, 1, 1, 1, 1, 1]);
      expect(lifecycle.unmounts).toEqual({});
      expect(lifecycle.onOpen).not.toHaveBeenCalled();
      expect(lifecycle.onClose).not.toHaveBeenCalled();
      expect(
        useProjectWorkspaceStore.getState().byProject.project.toolBindings[
          workspaceRefKey(beforeRefs.find(t => t.toolId === 'memory')!)
        ]
      ).toEqual({ mode: 'fixed', sessionId: 'B' });
    }

    // Collapsing tools and restoring geometry also preserves the same content hosts.
    rerender(
      <>
        <LayoutMenu projectId={projectId} />
        <FlatWorkspaceView chatComponent={ChatPane} sessionId="A" projectId={projectId} collapsed />
      </>
    );
    expect(toolInputs[0].closest('[data-content-ref]')).not.toBeVisible();
    rerender(
      <>
        <LayoutMenu projectId={projectId} />
        <FlatWorkspaceView
          chatComponent={ChatPane}
          sessionId="A"
          projectId={projectId}
          collapsed={false}
        />
      </>
    );
    expect(screen.getByTitle('Plugin-like frame')).toBe(frame);
    const memoryPane = flattenPanes(current().root).find(p =>
      p.tools.some(t => t.toolId === 'memory')
    )!;
    act(() => closeTabInWorkspace('A', memoryPane.id, 'memory'));
    expect(screen.queryByLabelText('Edit memory:be:project')).toBeNull();
    expect(lifecycle.unmounts).toEqual({ 'memory:be:project': 1 });
    expect(lifecycle.onClose).toHaveBeenCalledTimes(1);
  });
});
