// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunsTab } from '../RunsTab';
import { makeBackend, makeScope } from './scopeTestUtils';

const apis = vi.hoisted(() => new Map<string, { get: ReturnType<typeof vi.fn> }>());
vi.mock('../useAutomationApi', () => ({
  createAutomationApi: (id: string) => apis.get(id) ?? { get: async () => [] },
}));

function installApi(backendId: string, runs: unknown[] = []) {
  const api = {
    get: vi
      .fn()
      .mockImplementation(async (path: string) =>
        path.startsWith('/api/workflow-runs') ? runs : []
      ),
  };
  apis.set(backendId, api);
  return api;
}

beforeEach(() => apis.clear());

describe('RunsTab scope', () => {
  it('queries runs scoped to the project filter', async () => {
    const api = installApi('b1');
    render(<RunsTab scope={makeScope([makeBackend('b1')], { projectId: 'p1' })} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/workflow-runs?projectId=p1');
    });
  });

  it('queries runs globally when no project is selected', async () => {
    const api = installApi('b1');
    render(<RunsTab scope={makeScope([makeBackend('b1')])} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/workflow-runs');
    });
  });

  it('fetches every online backend and labels each group', async () => {
    const a = installApi('b1', [
      { id: 'r1', status: 'completed', triggerSource: 'manual', startedAt: 1, completedAt: 2 },
    ]);
    const b = installApi('b2', [
      { id: 'r2', status: 'failed', triggerSource: 'event', startedAt: 3, completedAt: 4 },
    ]);
    render(
      <RunsTab scope={makeScope([makeBackend('b1', 'Local'), makeBackend('b2', 'Remote')])} />
    );
    await waitFor(() => {
      expect(a.get).toHaveBeenCalledWith('/api/workflow-runs');
      expect(b.get).toHaveBeenCalledWith('/api/workflow-runs');
    });
    expect(await screen.findByRole('heading', { name: 'Local' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Remote' })).toBeDefined();
    expect(screen.getByText('2 runs')).toBeDefined();
  });
});
