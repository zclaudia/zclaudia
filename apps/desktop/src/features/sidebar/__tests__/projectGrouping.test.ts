import { describe, it, expect } from 'vitest';
import { selectProjectIdsForBackend } from '../projectGrouping';

const projects = [
  { id: 'p1' },
  { id: 'p2' },
  { id: 'p3' },
] as any[];

function ownerOf(id: string): string | null {
  return ({ p1: 'backend-a', p2: 'backend-b' } as Record<string, string>)[id] ?? null;
}

describe('selectProjectIdsForBackend', () => {
  it('returns projects owned by the given backend', () => {
    const ids = selectProjectIdsForBackend(projects, 'backend-a', ownerOf, 'local');
    expect(ids).toEqual(['p1']);
  });

  it('attributes ownerless projects to the local backend', () => {
    const ids = selectProjectIdsForBackend(projects, 'local', ownerOf, 'local');
    expect(ids).toEqual(['p3']);
  });

  it('returns empty when no project belongs to the backend', () => {
    const ids = selectProjectIdsForBackend(projects, 'backend-z', ownerOf, 'local');
    expect(ids).toEqual([]);
  });
});
