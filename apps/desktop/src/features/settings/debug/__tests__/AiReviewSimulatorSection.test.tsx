import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../../services/api', () => ({
  listLlmProfiles: () => Promise.resolve([]),
  simulateAIReview: vi.fn(),
}));

import { AiReviewSimulatorSection } from '../AiReviewSimulatorSection';

describe('AiReviewSimulatorSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is collapsed by default and expands the form on toggle', async () => {
    render(<AiReviewSimulatorSection />);
    expect(screen.getByText('AI review simulator')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run Review' })).toBeNull();
    fireEvent.click(screen.getByLabelText(/Expand AI review simulator/i));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run Review' })).toBeTruthy()
    );
  });
});
