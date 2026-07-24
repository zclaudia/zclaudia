import { describe, it, expect } from 'vitest';
import { buildLibraryItems } from './useAgentsLibrary';

const backends = [
  { backendId: 'b1', name: 'This Device', online: true },
  { backendId: 'b2', name: 'Studio Mac', online: false },
];

const draft = { completeness: 'draft', availability: { usable: true } } as const;

const sources = {
  profiles: new Map([
    ['b1', [{ id: 'p1', name: 'Coding', isDefault: true, model: 'deepseek-v4-flash' }]],
  ]),
  skills: new Map([
    [
      'b1',
      [{ id: 's1', name: 'web-search', description: 'Fan-out research', recordStatus: draft }],
    ],
  ]),
  servers: new Map([['b2', [{ id: 'm1', name: 'filesystem' }]]]),
  llmProfiles: new Map([['b1', [{ id: 'l1', name: 'Local' }]]]),
};

describe('buildLibraryItems', () => {
  it('builds profile items with backendId carried through', () => {
    const items = buildLibraryItems(sources, backends, { tab: 'profiles', backendFilter: 'all' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'profile',
      backendId: 'b1',
      id: 'p1',
      title: 'Coding',
      status: 'Default',
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

  it('threads recordStatus onto the library item', () => {
    const items = buildLibraryItems(sources, backends, { tab: 'skills', backendFilter: 'all' });
    const item = items.find(i => i.kind === 'skill' && i.id === 's1');
    expect(item?.recordStatus).toEqual(draft);
  });

  it('marks skills deletable only when they come from the workspace', () => {
    const withSources = {
      ...sources,
      skills: new Map([
        [
          'b1',
          [
            { id: 's1', name: 'ws-skill', source: 'workspace' },
            { id: 's2', name: 'ext-skill', source: 'external' },
            { id: 's3', name: 'plug-skill', source: 'plugin' },
          ],
        ],
      ]),
    };
    const items = buildLibraryItems(withSources, backends, { tab: 'skills', backendFilter: 'all' });
    expect(items.find(i => i.id === 's1')?.deletable).toBe(true);
    expect(items.find(i => i.id === 's2')?.deletable).toBe(false);
    expect(items.find(i => i.id === 's3')?.deletable).toBe(false);
  });
});
