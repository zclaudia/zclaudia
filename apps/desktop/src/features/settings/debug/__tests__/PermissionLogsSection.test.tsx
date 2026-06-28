import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getPermissionLogs = vi.fn().mockResolvedValue({ entries: [], total: 0 });
vi.mock('../../../../services/api', () => ({ getPermissionLogs: (a: unknown) => getPermissionLogs(a) }));

import { PermissionLogsSection } from '../PermissionLogsSection';

describe('PermissionLogsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads on mount and renders the All/Allow/Deny filter', async () => {
    render(<PermissionLogsSection />);
    await waitFor(() => expect(getPermissionLogs).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });

  it('reloads with a decision filter when Deny is clicked', async () => {
    render(<PermissionLogsSection />);
    await waitFor(() => expect(getPermissionLogs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(getPermissionLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ decision: 'deny', offset: 0 })
      )
    );
  });
});
