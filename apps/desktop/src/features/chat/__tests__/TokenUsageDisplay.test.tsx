import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenUsageDisplay } from '../TokenUsageDisplay';

describe('TokenUsageDisplay', () => {
  it('renders nothing when there is no usage yet', () => {
    const { container } = render(<TokenUsageDisplay inputTokens={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the used percentage of the context window', () => {
    render(<TokenUsageDisplay inputTokens={14_000} contextWindow={272_000} />);
    expect(screen.getByText('5%')).toBeInTheDocument(); // round(14000/272000*100) = 5
  });

  it('prefers the latest snapshot input over the cumulative total', () => {
    render(
      <TokenUsageDisplay inputTokens={100_000} latestInputTokens={14_000} contextWindow={272_000} />,
    );
    expect(screen.getByText('5%')).toBeInTheDocument();
  });

  it('shows an em dash when the context window is unknown', () => {
    render(<TokenUsageDisplay inputTokens={14_000} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('colors muted below 60% usage', () => {
    const { container } = render(<TokenUsageDisplay inputTokens={50_000} contextWindow={272_000} />);
    expect(container.firstChild).toHaveClass('text-muted-foreground'); // 18%
  });

  it('colors amber between 60% and 80% usage', () => {
    const { container } = render(<TokenUsageDisplay inputTokens={180_000} contextWindow={272_000} />);
    expect(container.firstChild).toHaveClass('text-yellow-500'); // 66%
  });

  it('colors red above 80% usage', () => {
    const { container } = render(<TokenUsageDisplay inputTokens={240_000} contextWindow={272_000} />);
    expect(container.firstChild).toHaveClass('text-destructive'); // 88%
  });

  it('renders only the ring — no cache glyph or warning icon', () => {
    const { container } = render(<TokenUsageDisplay inputTokens={240_000} contextWindow={272_000} />);
    expect(container.textContent).not.toContain('↺');
    expect(container.querySelectorAll('svg').length).toBe(1); // just the ring
  });
});
