import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { CompactionMarker } from '@zclaudia/shared';
import { CompactionMarkerCard } from '../CompactionMarkerCard';

function makeMarker(overrides: Partial<CompactionMarker> = {}): CompactionMarker {
  return {
    compactionId: 'c1',
    summary: 'this is the summary',
    tokensBefore: 12345,
    source: 'auto',
    readFiles: [],
    modifiedFiles: [],
    createdAt: 1000,
    ...overrides,
  };
}

describe('CompactionMarkerCard', () => {
  it('renders collapsed by default with Auto-compacted header + token count', () => {
    const { getByTestId, getByText, queryByText } = render(
      <CompactionMarkerCard marker={makeMarker({ tokensBefore: 7000 })} />
    );
    expect(getByTestId('compaction-marker-card').getAttribute('data-source')).toBe('auto');
    expect(getByText(/auto-compacted/i)).toBeTruthy();
    expect(getByText(/7,000 tokens/)).toBeTruthy();
    // Summary is hidden when collapsed
    expect(queryByText('this is the summary')).toBeNull();
  });

  it('renders Manually compacted label when source is manual', () => {
    const { getByText } = render(
      <CompactionMarkerCard marker={makeMarker({ source: 'manual' })} />
    );
    expect(getByText(/manually compacted/i)).toBeTruthy();
  });

  it('expands on click and reveals the summary', () => {
    const { getByRole, getByText } = render(<CompactionMarkerCard marker={makeMarker()} />);
    const button = getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getByText('this is the summary')).toBeTruthy();
  });

  it('shows customInstructions only when source=manual + instructions present', () => {
    const { getByRole, getByText, queryByText, rerender } = render(
      <CompactionMarkerCard
        marker={makeMarker({ source: 'manual', customInstructions: 'focus on auth' })}
      />
    );
    fireEvent.click(getByRole('button'));
    expect(getByText('Custom instructions')).toBeTruthy();
    expect(getByText('focus on auth')).toBeTruthy();

    // Same instructions but source=auto -> not shown
    rerender(
      <CompactionMarkerCard
        marker={makeMarker({ source: 'auto', customInstructions: 'focus on auth' })}
      />
    );
    fireEvent.click(getByRole('button')); // re-collapsing previous one; new tree starts collapsed
    // After rerender the card is a new tree; click once to expand:
    fireEvent.click(getByRole('button'));
    expect(queryByText('Custom instructions')).toBeNull();
  });

  it('renders file activity details when readFiles or modifiedFiles present', () => {
    const { getByRole, getByText } = render(
      <CompactionMarkerCard
        marker={makeMarker({
          readFiles: ['/a.ts', '/b.ts'],
          modifiedFiles: ['/c.ts'],
        })}
      />
    );
    fireEvent.click(getByRole('button'));
    expect(getByText(/File activity \(2 read, 1 modified\)/)).toBeTruthy();
    expect(getByText('/a.ts')).toBeTruthy();
    expect(getByText('/c.ts')).toBeTruthy();
  });

  it('does not render file activity section when both file lists are empty', () => {
    const { getByRole, queryByText } = render(<CompactionMarkerCard marker={makeMarker()} />);
    fireEvent.click(getByRole('button'));
    expect(queryByText(/File activity/)).toBeNull();
  });
});
