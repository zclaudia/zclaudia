// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunsTab } from '../RunsTab';

function makeApi() {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RunsTab scope', () => {
  it('queries runs scoped to the projectId prop', async () => {
    const api = makeApi();
    render(<RunsTab api={api as never} projectId="p1" />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/workflow-runs?projectId=p1');
    });
  });

  it('queries runs globally when no projectId is given', async () => {
    const api = makeApi();
    render(<RunsTab api={api as never} projectId={undefined} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/workflow-runs');
    });
  });
});
