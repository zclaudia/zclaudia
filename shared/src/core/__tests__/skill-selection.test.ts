import { describe, expect, it } from 'vitest';
import {
  defaultSkillSelection,
  normalizeSkillSelection,
  resolveSkillSelection,
  skillRefKey,
  type SkillCatalogEntry,
} from '../skills.js';

const discovered: SkillCatalogEntry[] = [
  { source: 'workspace', id: 'guidelines' },
  { source: 'external', id: 'security-audit' },
  { source: 'plugin', id: 'plugin-reviewer' },
];

describe('skill selection', () => {
  it('keeps all discovered skills visible when selection is absent', () => {
    const resolved = resolveSkillSelection(discovered);

    expect(resolved.discoverable.map(skillRefKey)).toEqual([
      'workspace:guidelines',
      'external:security-audit',
      'plugin:plugin-reviewer',
    ]);
    expect(resolved.pinned).toEqual([]);
  });

  it('filters providers, adds explicit includes, and lets exclude win', () => {
    const resolved = resolveSkillSelection(discovered, {
      providers: [{ source: 'workspace' }],
      include: [{ source: 'external', id: 'security-audit' }],
      exclude: [{ source: 'workspace', id: 'guidelines' }],
      pinned: [
        { source: 'external', id: 'security-audit' },
        { source: 'workspace', id: 'guidelines' },
      ],
    });

    expect(resolved.discoverable.map(skillRefKey)).toEqual(['external:security-audit']);
    expect(resolved.pinned.map(skillRefKey)).toEqual(['external:security-audit']);
  });

  it('treats an explicit selection without providers as all discovered skills', () => {
    const resolved = resolveSkillSelection(discovered, {
      exclude: [{ source: 'external', id: 'security-audit' }],
      pinned: [{ source: 'workspace', id: 'guidelines' }],
    });

    expect(resolved.discoverable.map(skillRefKey)).toEqual([
      'workspace:guidelines',
      'plugin:plugin-reviewer',
    ]);
    expect(resolved.pinned.map(skillRefKey)).toEqual(['workspace:guidelines']);
  });

  it('normalizes invalid selection values and keeps defaults explicit', () => {
    expect(defaultSkillSelection.providers).toEqual([
      { source: 'workspace' },
      { source: 'external' },
      { source: 'plugin' },
    ]);

    expect(normalizeSkillSelection({
      providers: [{ source: 'workspace' }, { source: 'bad' }],
      include: [{ source: 'external', id: 'audit' }, { source: 'plugin', id: '' }],
      exclude: [{ source: 'plugin', id: 'reviewer' }],
      pinned: [{ source: 'workspace', id: 'guidelines' }],
    })).toEqual({
      providers: [{ source: 'workspace' }],
      include: [{ source: 'external', id: 'audit' }],
      exclude: [{ source: 'plugin', id: 'reviewer' }],
      pinned: [{ source: 'workspace', id: 'guidelines' }],
    });
  });
});
