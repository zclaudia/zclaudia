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

import { LineagePanel } from '../LineagePanel';

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
  });

  it('fetches and renders the graph for the selected session', async () => {
    fetchContextGraph.mockResolvedValue(linearGraph);
    const { getByTestId } = render(<LineagePanel />);
    await waitFor(() => expect(fetchContextGraph).toHaveBeenCalledWith('S0'));
    await waitFor(() => expect(getByTestId('lineage-node-S0:r')).toBeTruthy());
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
    const { getByLabelText } = render(<LineagePanel />);
    await waitFor(() => expect(fetchContextGraph).toHaveBeenCalledTimes(1));
    fireEvent.click(getByLabelText('Refresh lineage'));
    await waitFor(() => expect(fetchContextGraph).toHaveBeenCalledTimes(2));
  });

  it('toasts when a fetch fails', async () => {
    fetchContextGraph.mockRejectedValueOnce(new Error('gone')).mockResolvedValue(linearGraph);
    render(<LineagePanel />);
    await waitFor(() => expect(add).toHaveBeenCalled());
  });
});
