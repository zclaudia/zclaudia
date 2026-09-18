import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudiaChat } from '../ClaudiaChat';
import { ClaudiaReturnLink } from '../ClaudiaReturnLink';
import { useComposerStore } from '../../../stores/composerStore';
import { useClaudiaStore } from '../../../stores/claudiaStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import { usePermissionStore } from '../../../stores/permissionStore';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  profiles: vi.fn(),
  send: vi.fn(),
  select: vi.fn(),
  connected: true,
}));
vi.mock('../../../services/api/base', () => ({
  fetchApiForBackend: (...args: unknown[]) => mocks.fetch(...args),
}));
vi.mock('../../../services/api/agent-profiles', () => ({
  listAgentProfilesForBackend: (...args: unknown[]) => mocks.profiles(...args),
}));
vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    sendToServer: mocks.send,
    isConnected: mocks.connected,
    handlePermissionDecision: vi.fn(),
  }),
}));
vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSession: mocks.select }),
}));
vi.mock('../../chat/InlinePermissionRequest', () => ({
  InlinePermissionRequest: ({ request }: any) => <div>{request.detail}</div>,
}));
vi.mock('../../chat/MessageInput', () => ({
  MessageInput: ({ onSend, initialValue, isLoading, onCancel, disabled }: any) => {
    const [value, setValue] = useState(initialValue ?? '');
    return (
      <div>
        <input aria-label="Draft" value={value} onChange={e => setValue(e.target.value)} />
        <button
          disabled={disabled}
          onClick={() => {
            onSend(value);
            setValue('');
          }}
        >
          Send
        </button>
        {isLoading && onCancel && <button onClick={onCancel}>Cancel run</button>}
      </div>
    );
  },
}));
const thread = {
  id: 'thread',
  projectId: 'p',
  title: 'Original',
  createdAt: 1,
  updatedAt: 1,
  lastTaskId: null,
  session: {
    id: 'session',
    name: 'Original',
    agentProfileId: 'agent',
    lastRunStatus: null,
    updatedAt: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useComposerStore.setState({ drafts: {} });
  mocks.connected = true;
  useClaudiaStore.setState({ slices: {}, isExpanded: false, returnTarget: null });
  useServerStore.setState({ activeServerId: 'gw:remote' });
  useFacadeStore.setState({ localBackendId: 'local-real' });
  useSelectionStore.setState({ selectedProjectId: 'p', selectedSessionId: null });
  useProjectStore.setState({
    dataServerId: 'gw:remote',
    projects: [{ id: 'p', name: 'Project', rootPath: '/project' } as any],
  });
  useTopLevelViewStore.getState().openClaudia();
  usePermissionStore.setState({ pendingRequests: [] });
  mocks.profiles.mockResolvedValue([
    { id: 'agent', name: 'Agent', status: 'active', isDefault: true },
  ]);
  mocks.fetch.mockImplementation(async (url: string) => ({
    success: true,
    data: url.includes('/messages')
      ? { messages: [], activeRun: null, lastRunStatus: null }
      : { threads: [] },
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
function send(text: string) {
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: text } });
  fireEvent.click(screen.getByText('Send'));
}

describe('Claudia P0 conversation lifecycle', () => {
  it('uses the canonical remote backend and reuses the first accepted thread', async () => {
    render(<ClaudiaChat />);
    await waitFor(() => expect(mocks.profiles).toHaveBeenCalledWith('remote'));
    send('hello');
    const [backend, message] = mocks.send.mock.calls[0];
    expect(backend).toBe('remote');
    act(() => {
      useClaudiaStore.getState().acceptRun('remote', message.clientRequestId, {
        projectId: 'p',
        branchId: 'new-thread',
        sessionId: 'new-session',
        runId: 'run',
        agentProfileId: 'agent',
      });
      useClaudiaStore.getState().completeRun('remote', message.clientRequestId, 'done');
    });
    expect(screen.getByText('Open work session')).toBeTruthy();
    send('follow up');
    expect(mocks.send.mock.calls.at(-1)?.[1]).toMatchObject({ activeBranchId: 'new-thread' });
    fireEvent.click(screen.getByText('Open work session'));
    expect(mocks.select).toHaveBeenCalledWith('new-session', { backendId: 'remote' });
    expect(useTopLevelViewStore.getState().view.kind).toBe('app');
  });

  it('restores the rejected input and only renders this backend/thread permissions', async () => {
    useClaudiaStore.getState().setThreads('remote', 'p', [thread]);
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages') ? { messages: [], activeRun: null } : { threads: [thread] },
    }));
    usePermissionStore.setState({
      pendingRequests: [
        { requestId: 'a', sessionId: 'session', serverId: 'gw:remote', detail: 'Own permission' },
        {
          requestId: 'b',
          sessionId: 'session',
          serverId: 'gw:other',
          detail: 'Other backend permission',
        },
        {
          requestId: 'c',
          sessionId: 'other-session',
          serverId: 'gw:remote',
          detail: 'Other thread permission',
        },
      ] as any,
    });
    render(<ClaudiaChat />);
    await screen.findByText('Own permission');
    expect(screen.queryByText('Other backend permission')).toBeNull();
    expect(screen.queryByText('Other thread permission')).toBeNull();
    send('keep this draft');
    const request = mocks.send.mock.calls[0][1];
    act(() =>
      useClaudiaStore
        .getState()
        .rejectRun('remote', request.clientRequestId, 'SESSION_BUSY', 'busy')
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('keep this draft')
    );
  });

  it('restores a running session after refresh and offers cancellation of that exact run', async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages')
        ? {
            messages: [],
            activeRun: {
              runId: 'live',
              content: 'Still processing',
              assistantMessageId: 'assistant',
            },
          }
        : { threads: [thread] },
    }));
    render(<ClaudiaChat />);
    await screen.findByText('Still processing');
    fireEvent.click(screen.getByText('Cancel run'));
    expect(mocks.send).toHaveBeenCalledWith('remote', {
      type: 'agent_cancel',
      sessionId: 'session',
      runId: 'live',
    });
  });

  it('does not render the completed response twice after persisted messages arrive', async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages')
        ? {
            messages: [{ id: 'assistant', role: 'assistant', content: 'One answer', createdAt: 3 }],
            activeRun: null,
          }
        : { threads: [thread] },
    }));
    const store = useClaudiaStore.getState();
    store.startRun('remote', {
      clientRequestId: 'req',
      input: 'hi',
      projectId: 'p',
      threadId: 'thread',
      status: 'submitting',
      createdAt: 1,
      updatedAt: 1,
    });
    store.acceptRun('remote', 'req', {
      projectId: 'p',
      branchId: 'thread',
      sessionId: 'session',
      runId: 'run',
      assistantMessageId: 'assistant',
    });
    store.completeRun('remote', 'req', 'One answer');
    render(<ClaudiaChat />);
    await waitFor(() =>
      expect(useClaudiaStore.getState().slices.remote.messagesBySession.session).toHaveLength(1)
    );
    expect(screen.getAllByText('One answer')).toHaveLength(1);
  });
  it('returns from the work session to its originating discussion', async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages') ? { messages: [], activeRun: null } : { threads: [thread] },
    }));
    const chat = render(<ClaudiaChat />);
    fireEvent.click(await screen.findByText('Open work session'));
    chat.unmount();
    useClaudiaStore.getState().setActiveThread('remote', 'p', 'another-thread');
    render(<ClaudiaReturnLink sessionId="session" isMobile={false} />);
    fireEvent.click(screen.getByText('Return to Claudia discussion'));
    expect(useTopLevelViewStore.getState().view.kind).toBe('claudia');
    expect(useClaudiaStore.getState().slices.remote.activeThreadIdByProject.p).toBe('thread');
  });

  it('starts a new topic once and continues its accepted thread', async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages') ? { messages: [], activeRun: null } : { threads: [thread] },
    }));
    render(<ClaudiaChat />);
    await screen.findByText('Open work session');
    fireEvent.click(screen.getByText('New topic'));
    send('new subject');
    const req = mocks.send.mock.calls[0][1];
    expect(req).toMatchObject({ forceNewBranch: true });
    expect(req.activeBranchId).toBeUndefined();
    act(() => {
      useClaudiaStore.getState().acceptRun('remote', req.clientRequestId, {
        projectId: 'p',
        branchId: 'new-thread',
        sessionId: 'new-session',
        runId: 'new-run',
      });
      useClaudiaStore.getState().completeRun('remote', req.clientRequestId, 'done');
    });
    send('continue this');
    expect(mocks.send.mock.calls.at(-1)?.[1]).toMatchObject({ activeBranchId: 'new-thread' });
    expect(mocks.send.mock.calls.at(-1)?.[1].forceNewBranch).toBeUndefined();
  });

  it('resumes the interrupted session even when a new topic was armed', async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages')
        ? { messages: [], activeRun: null, lastRunStatus: 'interrupted' }
        : {
            threads: [{ ...thread, session: { ...thread.session, lastRunStatus: 'interrupted' } }],
          },
    }));
    render(<ClaudiaChat />);
    await screen.findByText('Resume');
    fireEvent.click(screen.getByText('New topic'));
    fireEvent.click(screen.getByText('Resume'));
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(mocks.send.mock.calls[0]).toEqual([
      'remote',
      expect.objectContaining({ activeBranchId: 'thread', input: 'continue' }),
    ]);
    expect(mocks.send.mock.calls[0][1].forceNewBranch).toBeUndefined();
  });
  it('replays the original request after reconnect instead of leaving it submitting forever', async () => {
    const view = render(<ClaudiaChat />);
    await waitFor(() => expect(mocks.profiles).toHaveBeenCalled());
    send('pending request');
    const original = mocks.send.mock.calls[0][1];
    mocks.connected = false;
    view.rerender(<ClaudiaChat />);
    mocks.connected = true;
    view.rerender(<ClaudiaChat />);
    expect(mocks.send).toHaveBeenLastCalledWith('remote', original);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('closes the mobile overlay for the work session and reopens its source discussion', async () => {
    useClaudiaStore.getState().setExpanded(true);
    mocks.fetch.mockImplementation(async (url: string) => ({
      success: true,
      data: url.includes('/messages') ? { messages: [], activeRun: null } : { threads: [thread] },
    }));
    const view = render(<ClaudiaChat isMobile />);
    fireEvent.click(await screen.findByText('Open work session'));
    expect(useClaudiaStore.getState().isExpanded).toBe(false);
    view.unmount();
    render(<ClaudiaReturnLink sessionId="session" isMobile />);
    fireEvent.click(screen.getByText('Return to Claudia discussion'));
    expect(useClaudiaStore.getState().isExpanded).toBe(true);
    expect(useClaudiaStore.getState().slices.remote.activeThreadIdByProject.p).toBe('thread');
  });
  it('restores the persisted draft for this backend and discussion', async () => {
    useComposerStore
      .getState()
      .setDraft('claudia-remote-p-new', { content: 'Saved draft', attachments: [] });
    render(<ClaudiaChat />);
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Saved draft');
  });
  it('keeps a missing explicit target instead of silently starting a fresh thread', async () => {
    useClaudiaStore.getState().setActiveThread('remote', 'p', 'missing-thread');
    render(<ClaudiaChat />);
    await waitFor(() =>
      expect((screen.getByText('Send') as HTMLButtonElement).disabled).toBe(false)
    );
    send('continue original');
    const req = mocks.send.mock.calls[0][1];
    expect(req.activeBranchId).toBe('missing-thread');
    act(() =>
      useClaudiaStore
        .getState()
        .rejectRun('remote', req.clientRequestId, 'THREAD_NOT_FOUND', 'Conversation unavailable')
    );
    expect(screen.getByText('Conversation unavailable')).toBeTruthy();
    expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('continue original');
  });
});
