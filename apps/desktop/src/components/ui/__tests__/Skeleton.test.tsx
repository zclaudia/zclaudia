import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PaneSkeleton } from '../Skeleton';

describe('PaneSkeleton', () => {
  it('renders skeleton blocks', () => {
    const { container } = render(<PaneSkeleton />);
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
  });
});
