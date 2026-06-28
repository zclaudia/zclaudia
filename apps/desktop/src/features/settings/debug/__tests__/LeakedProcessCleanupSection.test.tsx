import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const clearCleanupResult = vi.fn();
vi.mock('../../../../stores/processMonitorStore', () => ({
  useProcessMonitorStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ lastCleanupResult: null, clearCleanupResult }),
}));

import { LeakedProcessCleanupSection } from '../LeakedProcessCleanupSection';

describe('LeakedProcessCleanupSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends kill_leaked_processes when connected', () => {
    const sendMessage = vi.fn();
    render(<LeakedProcessCleanupSection isConnected sendMessage={sendMessage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clean Leaked Processes' }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'kill_leaked_processes' });
  });

  it('does not send when disconnected', () => {
    const sendMessage = vi.fn();
    render(<LeakedProcessCleanupSection isConnected={false} sendMessage={sendMessage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clean Leaked Processes' }));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
