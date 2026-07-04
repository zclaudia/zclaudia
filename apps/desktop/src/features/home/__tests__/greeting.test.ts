import { describe, it, expect } from 'vitest';
import { greeting } from '../greeting';

describe('greeting', () => {
  it('says good morning from 5am to before noon', () => {
    expect(greeting(5)).toBe('Good morning');
    expect(greeting(11)).toBe('Good morning');
  });

  it('says good afternoon from noon to before 6pm', () => {
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(17)).toBe('Good afternoon');
  });

  it('says good evening in the evening and overnight', () => {
    expect(greeting(18)).toBe('Good evening');
    expect(greeting(23)).toBe('Good evening');
    expect(greeting(0)).toBe('Good evening');
    expect(greeting(4)).toBe('Good evening');
  });
});
