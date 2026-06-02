import { describe, it, expect } from 'vitest';
import { newId } from '../uuid.js';

describe('newId', () => {
  it('returns a uuid-formatted string', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns version 7 (time-ordered) UUIDs', () => {
    const id = newId();
    expect(id[14]).toBe('7');
  });

  it('produces lexicographically increasing ids across time', async () => {
    const first = newId();
    await new Promise((r) => setTimeout(r, 2));
    const second = newId();
    expect(second > first).toBe(true);
  });

  it('returns distinct values within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });
});
