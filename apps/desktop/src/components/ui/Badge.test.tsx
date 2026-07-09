import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge label="Profile" tone="accent" />);
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('renders an online dot when online is true', () => {
    render(<Badge label="This Device" online />);
    expect(screen.getByTestId('badge-dot')).toBeInTheDocument();
  });
});
