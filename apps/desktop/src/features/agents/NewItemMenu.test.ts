import { describe, it, expect } from 'vitest';
import { resolveNewTarget } from './NewItemMenu';

describe('resolveNewTarget', () => {
  it('maps a specific type tab to its new-selection kind', () => {
    expect(resolveNewTarget('profiles')).toBe('new-profile');
    expect(resolveNewTarget('skills')).toBe('new-skill');
    expect(resolveNewTarget('mcp-servers')).toBe('new-mcp-server');
    expect(resolveNewTarget('providers')).toBe('new-llm-profile');
  });

  it('returns "menu" for the all-items view', () => {
    expect(resolveNewTarget('all')).toBe('menu');
  });
});
