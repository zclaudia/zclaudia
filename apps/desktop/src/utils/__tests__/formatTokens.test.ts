import { describe, it, expect } from 'vitest';
import { formatTokens } from '../formatTokens';

describe('formatTokens', () => {
  it('card style (default: 1 decimal, lowercase k)', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(25_900)).toBe('25.9k');
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });

  it('indicator style (0 decimals, uppercase K, millions stay 1 decimal)', () => {
    expect(formatTokens(1_500, { decimals: 0, upper: true })).toBe('2K');
    expect(formatTokens(14_000, { decimals: 0, upper: true })).toBe('14K');
    expect(formatTokens(1_500_000, { decimals: 0, upper: true })).toBe('1.5M');
  });
});
