import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';

describe('ComposerFooter', () => {
  it('renders left and right slots on one row', () => {
    const { getByTestId } = render(
      <ComposerFooter
        left={<span data-testid="L">left</span>}
        right={<span data-testid="R">right</span>}
      />
    );
    expect(getByTestId('L')).toBeInTheDocument();
    expect(getByTestId('R')).toBeInTheDocument();
  });

  it('exposes a composer-footer testid on the root', () => {
    const { getByTestId } = render(<ComposerFooter left={<span>x</span>} />);
    expect(getByTestId('composer-footer')).toBeInTheDocument();
  });
});
