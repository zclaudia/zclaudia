import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Hoist mocks so factories can safely reference vi.fn()
const { fetchContextGraph, requestMessageJump, selectSession, getSessionBackendId, add } = vi.hoisted(() => ({
  fetchContextGraph: vi.fn(),
  requestMessageJump: vi.fn(),
  selectSession: vi.fn(),
  getSessionBackendId: vi.fn(() => 'b1'),
  add: vi.fn(),
}));

vi.mock('../../../services/api/context-graph', () => ({ fetchContextGraph }));

vi.mock('../../../stores/uiStore', () => ({
  useUIStore: (sel: any) => sel({ requestMessageJump }),
}));

vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSession }),
}));

let selectedSessionId = 'S0';
vi.mock('../../../stores/selectionStore', () => ({
  useSelectionStore: (sel: any) => sel({ selectedSessionId }),
}));

const sessions: unknown[] = [];
vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: (sel: any) => sel({ sessions }),
}));

vi.mock('../../../stores/ownershipStore', () => ({
  useOwnershipStore: { getState: () => ({ getSessionBackendId }) },
}));

vi.mock('../../../stores/toastStore', () => ({
  useToastStore: { getState: () => ({ add }) },
}));

import { LineageActions, LineagePanel } from '../LineagePanel';
import { useLineageStore } from '../lineageStore';

const linearGraph = {
  rootSessionId: 'S0', focusSessionId: 'S0', truncated: false, forkEdges: [],
  sessions: [{ id: 'S0', name: 'main', forkedFromSessionId: null, forkEntryId: null, createdAt: 1, archived: false, laneOrder: 0 }],
  nodes: [
    { nodeId: 'S0:r', sessionId: 'S0', entryId: 'r', entryType: 'message', isRoot: true, isBranchPoint: false,
      isForkPoint: false, isForkBase: false, isActiveLeaf: false, isBranchTip: false, onActivePath: true,
      parentNodeId: null, incomingMessageCount: 0, timestamp: 't', jump: { messageId: 'm-root', compactionId: null } },
  ],
};

describe('LineagePanel', () => {
  beforeEach(() => {
    fetchContextGraph.mockReset();
    requestMessageJump.mockReset();
    selectSession.mockReset();
    add.mockReset();
    selectedSessionId = 'S0';
    useLineageStore.getState().reset();
  });

  it('fetches and renders the graph for the selected session', async () => {
    fetchContextGraph.mockResolvedValue(linearGraph);
    const { getByTestId } = render(<LineagePanel />);
    await waitFor(() => expect(fetchContextGraph).toHaveBeenCalledWith('S0'));
    await waitFor(() => expect(getByTestId('lineage-node-S0:r')).toBeTruthy());
  });

  it('does not render an internal toolbar inside the graph panel', async () => {
    fetchContextGraph.mockResolvedValue(linearGraph);
    const { queryByLabelText, queryByText, getByTestId } = render(<LineagePanel />);
    await waitFor(() => expect(getByTestId('lineage-node-S0:r')).toBeTruthy());

    expect(queryByText('Lineage')).toBeNull();
    expect(queryByLabelText('Refresh lineage')).toBeNull();
  });

  it('jumps via requestMessageJump + selectSession on node click', async () => {
    fetchContextGraph.mockResolvedValue(linearGraph);
    const { getByTestId } = render(<LineagePanel />);
    await waitFor(() => getByTestId('lineage-node-S0:r'));
    fireEvent.click(getByTestId('lineage-node-S0:r'));
    expect(requestMessageJump).toHaveBeenCalledWith('S0', 'm-root');
    expect(selectSession).toHaveBeenCalledWith('S0', { backendId: 'b1' });
  });

  it('manual refresh re-fetches', async () => {
    fetchContextGraph.mockResolvedValue(linearGraph);
    const { getByLabelText } = render(
      <>
        <LineagePanel />
        <LineageActions />
      </>,
    );
    await waitFor(() => expect(fetchContextGraph).toHaveBeenCalledTimes(1));
    fireEvent.click(getByLabelText('Refresh lineage'));
    await waitFor(() => expect(fetchContextGraph).toHaveBeenCalledTimes(2));
  });

  it('renders the session count in the top actions', async () => {
    fetchContextGraph.mockResolvedValue(linearGraph);
    const { getByText, getByTestId } = render(
      <>
        <LineagePanel />
        <LineageActions />
      </>,
    );
    await waitFor(() => expect(getByTestId('lineage-node-S0:r')).toBeTruthy());
    expect(getByText('1 session')).toBeTruthy();
  });

  it('toasts when a fetch fails', async () => {
    fetchContextGraph.mockRejectedValueOnce(new Error('gone')).mockResolvedValue(linearGraph);
    render(<LineagePanel />);
    await waitFor(() => expect(add).toHaveBeenCalled());
  });

  it('ignores a stale response when the session changed mid-flight', async () => {
    let resolveS0!: (v: unknown) => void;
    let resolveS1!: (v: unknown) => void;
    const p0 = new Promise((r) => { resolveS0 = r; });
    const p1 = new Promise((r) => { resolveS1 = r; });
    fetchContextGraph.mockReturnValueOnce(p0).mockReturnValueOnce(p1);

    const graphS1 = {
      ...linearGraph, rootSessionId: 'S1', focusSessionId: 'S1',
      sessions: [{ id: 'S1', name: 'one', forkedFromSessionId: null, forkEntryId: null, createdAt: 2, archived: false, laneOrder: 0 }],
      nodes: [{ ...linearGraph.nodes[0], nodeId: 'S1:r', sessionId: 'S1' }],
    };

    selectedSessionId = 'S0';
    const { rerender, queryByTestId } = render(<LineagePanel />);
    selectedSessionId = 'S1';
    rerender(<LineagePanel />);

    resolveS1(graphS1);
    await waitFor(() => expect(queryByTestId('lineage-node-S1:r')).toBeTruthy());

    resolveS0(linearGraph); // stale — must be ignored
    await new Promise((r) => setTimeout(r, 0));
    expect(queryByTestId('lineage-node-S0:r')).toBeNull();
    expect(queryByTestId('lineage-node-S1:r')).toBeTruthy();
  });
});
