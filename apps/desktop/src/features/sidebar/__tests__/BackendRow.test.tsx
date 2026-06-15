import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackendRow } from '../BackendRow';

describe('BackendRow', () => {
  it('renders the backend name and online status', () => {
    render(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}}>
        <div data-testid="child">projects</div>
      </BackendRow>,
    );
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Local Server/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides children when collapsed and shows them when expanded', () => {
    const { rerender } = render(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}}>
        <div data-testid="child">projects</div>
      </BackendRow>,
    );
    expect(screen.queryByTestId('child')).toBeNull();

    rerender(
      <BackendRow name="Local Server" online expanded onToggle={() => {}}>
        <div data-testid="child">projects</div>
      </BackendRow>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <BackendRow name="Local Server" online expanded={false} onToggle={onToggle}>
        <div />
      </BackendRow>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Local Server/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
