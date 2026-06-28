import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const clearLogs = vi.fn();
vi.mock('../../../../services/logger', () => ({
  getLogCount: () => 32,
  clearLogs: () => clearLogs(),
  exportLogs: () => '[]',
}));

import { ClientLogsSection } from '../ClientLogsSection';

describe('ClientLogsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the buffer count and clears on click', () => {
    render(<ClientLogsSection />);
    expect(screen.getByText('32 entries in buffer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clearLogs).toHaveBeenCalledTimes(1);
  });
});
