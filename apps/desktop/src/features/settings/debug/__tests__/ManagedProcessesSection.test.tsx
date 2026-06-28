import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const getManagedProcesses = vi.fn().mockResolvedValue([]);
vi.mock('../../../../services/api', () => ({ getManagedProcesses: () => getManagedProcesses() }));

import { ManagedProcessesSection } from '../ManagedProcessesSection';

describe('ManagedProcessesSection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('polls on mount and renders the empty state', async () => {
    render(<ManagedProcessesSection embeddedServerStatus="running" />);
    await vi.waitFor(() => expect(getManagedProcesses).toHaveBeenCalled());
    expect(await screen.findByText('No managed processes recorded yet.')).toBeTruthy();
  });

  it('does not poll when disabled', () => {
    render(<ManagedProcessesSection embeddedServerStatus="disabled" />);
    expect(getManagedProcesses).not.toHaveBeenCalled();
  });
});
