import { describe, it, expect } from 'vitest';
import { buildLibraryItems } from './useAgentsLibrary';

const backends = [
  { backendId: 'b1', name: 'This Device', online: true },
  { backendId: 'b2', name: 'Studio Mac', online: false },
];

const sources = {
  profiles: new Map([['b1', [{ id: 'p1', name: 'Coding', isDefault: true, model: 'deepseek-v4-flash' }]]]),
  skills: new Map([['b1', [{ id: 's1', name: 'web-search', description: 'Fan-out research' }]]]),
  servers: new Map([['b2', [{ id: 'm1', name: 'filesystem' }]]]),
  llmProfiles: new Map([['b1', [{ id: 'l1', name: 'Local' }]]]),
};

describe('buildLibraryItems', () => {
  it('builds profile items with backendId carried through', () => {
    const items = buildLibraryItems(sources, backends, { tab: 'profiles', backendFilter: 'all' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'profile',
      backendId: 'b1', id: 'p1', title: 'Coding', status: 'Default',
    });
  });

  it('filters by type tab', () => {
    const items = buildLibraryItems(sources, backends, { tab: 'skills', backendFilter: 'all' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'skill', title: 'web-search' });
  });

  it('filters by backend', () => {
    const items = buildLibraryItems(sources, backends, { tab: 'mcp-servers', backendFilter: 'b2' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'mcp-server', backendId: 'b2' });
  });
});
