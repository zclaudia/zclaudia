import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api/readiness');

import { useAgentReadinessStore } from '../agentReadinessStore';
import * as readinessModule from '../../services/api/readiness';

const getAgentReadiness = vi.mocked(readinessModule.getAgentReadiness);

beforeEach(() => {
  getAgentReadiness.mockReset();
  useAgentReadinessStore.setState({ readiness: null, loading: false });
});

describe('agentReadinessStore', () => {
  it('refresh() stores the fetched readiness', async () => {
    getAgentReadiness.mockResolvedValue({ usable: false, reason: 'no_credential' });
    await useAgentReadinessStore.getState().refresh();
    expect(useAgentReadinessStore.getState().readiness).toEqual({ usable: false, reason: 'no_credential' });
  });

  it('refresh() fails open (usable:true) when the API throws', async () => {
    getAgentReadiness.mockRejectedValue(new Error('network'));
    await useAgentReadinessStore.getState().refresh();
    expect(useAgentReadinessStore.getState().readiness).toEqual({ usable: true });
  });

  it('isUsable() returns true while readiness is unknown (null) — never block before first load', () => {
    expect(useAgentReadinessStore.getState().isUsable()).toBe(true);
  });

  it('isUsable() reflects a loaded unusable result', async () => {
    getAgentReadiness.mockResolvedValue({ usable: false, reason: 'no_agent' });
    await useAgentReadinessStore.getState().refresh();
    expect(useAgentReadinessStore.getState().isUsable()).toBe(false);
  });
});
