import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineageEmptyState } from '../LineageEmptyState';

describe('LineageEmptyState', () => {
  it('explains how to create branches', () => {
    const { getByText } = render(<LineageEmptyState />);
    expect(getByText(/Fork/)).toBeTruthy();
    expect(getByText(/Branch/)).toBeTruthy();
  });
});
