import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiCallForBackend, apiCall, getSessionBackendId } = vi.hoisted(() => ({
  apiCallForBackend: vi.fn(),
  apiCall: vi.fn(),
  getSessionBackendId: vi.fn(),
}));

vi.mock('../unwrap', () => ({ apiCallForBackend, apiCall }));

vi.mock('../../../stores/ownershipStore', () => ({
  useOwnershipStore: { getState: () => ({ getSessionBackendId }) },
}));

import { fetchContextGraph } from '../context-graph';

describe('fetchContextGraph', () => {
  beforeEach(() => {
    apiCallForBackend.mockReset();
    apiCall.mockReset();
    getSessionBackendId.mockReset();
  });

  it('routes to the session owner backend when known', async () => {
    getSessionBackendId.mockReturnValue('backend-7');
    apiCallForBackend.mockResolvedValue({ rootSessionId: 's1' });
    const res = await fetchContextGraph('s1');
    expect(apiCallForBackend).toHaveBeenCalledWith('backend-7', '/api/sessions/s1/context-graph');
    expect(apiCall).not.toHaveBeenCalled();
    expect(res).toEqual({ rootSessionId: 's1' });
  });

  it('falls back to apiCall when no owner backend', async () => {
    getSessionBackendId.mockReturnValue(null);
    apiCall.mockResolvedValue({ rootSessionId: 's1' });
    await fetchContextGraph('s1');
    expect(apiCall).toHaveBeenCalledWith('/api/sessions/s1/context-graph');
    expect(apiCallForBackend).not.toHaveBeenCalled();
  });
});
