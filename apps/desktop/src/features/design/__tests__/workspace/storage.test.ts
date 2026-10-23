import { beforeEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_UI_STORAGE_PREFIX,
  defaultWorkspaceUiState,
  loadWorkspaceUiState,
  normalizeUiState,
  normalizeViewport,
  normalizeZoom,
  saveWorkspaceUiState,
  workspaceUiStorageKey,
} from '../../workspace/storage';

describe('workspace ui storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds the documented key prefix per identity', () => {
    expect(workspaceUiStorageKey('abcd1234')).toBe('zclaudia-design-ws-abcd1234');
    expect(WORKSPACE_UI_STORAGE_PREFIX).toBe('zclaudia-design-ws-');
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadWorkspaceUiState('fresh')).toEqual(defaultWorkspaceUiState());
    expect(loadWorkspaceUiState('fresh')).toEqual({
      version: 1,
      activePath: null,
      recents: [],
      viewport: { preset: 'fill', width: null },
      zoom: { mode: 'fit', value: 1 },
    });
  });

  it('returns defaults for corrupt JSON, wrong versions and non-object payloads', () => {
    localStorage.setItem(workspaceUiStorageKey('k'), '{not json');
    expect(loadWorkspaceUiState('k')).toEqual(defaultWorkspaceUiState());

    localStorage.setItem(workspaceUiStorageKey('k'), JSON.stringify({ version: 2 }));
    expect(loadWorkspaceUiState('k')).toEqual(defaultWorkspaceUiState());

    for (const payload of ['null', '42', '"str"', '[]']) {
      localStorage.setItem(workspaceUiStorageKey('k'), payload);
      expect(loadWorkspaceUiState('k')).toEqual(defaultWorkspaceUiState());
    }
  });

  it('validates fields individually instead of discarding the whole record', () => {
    localStorage.setItem(
      workspaceUiStorageKey('k'),
      JSON.stringify({
        version: 1,
        activePath: 'design/index.html',
        recents: ['a.html', 42, 'b.html', null, 'c.html'],
        viewport: { preset: 'custom', width: 800 },
        zoom: { mode: 'manual', value: 1.5 },
      })
    );
    expect(loadWorkspaceUiState('k')).toEqual({
      version: 1,
      activePath: 'design/index.html',
      recents: ['a.html', 'b.html', 'c.html'],
      viewport: { preset: 'custom', width: 800 },
      zoom: { mode: 'manual', value: 1.5 },
    });
  });

  it('truncates recents to 12 string entries', () => {
    const recents = Array.from({ length: 15 }, (_, index) => `p${index}.html`);
    localStorage.setItem(
      workspaceUiStorageKey('k'),
      JSON.stringify({ version: 1, recents })
    );
    const loaded = loadWorkspaceUiState('k');
    expect(loaded.recents).toEqual(recents.slice(0, 12));
    expect(loaded.recents).toHaveLength(12);
  });

  it('falls back to fill/null when viewport.width is not an integer within 240–3840', () => {
    expect(normalizeViewport({ preset: 'custom', width: 100 })).toEqual({
      preset: 'fill',
      width: null,
    });
    expect(normalizeViewport({ preset: 'custom', width: 800.5 })).toEqual({
      preset: 'fill',
      width: null,
    });
    expect(normalizeViewport({ preset: 'custom', width: 239 })).toEqual({
      preset: 'fill',
      width: null,
    });
    expect(normalizeViewport({ preset: 'custom', width: 3841 })).toEqual({
      preset: 'fill',
      width: null,
    });
    expect(normalizeViewport({ preset: 'custom', width: '800' })).toEqual({
      preset: 'fill',
      width: null,
    });
    expect(normalizeViewport({ preset: 'custom', width: 240 })).toEqual({
      preset: 'custom',
      width: 240,
    });
    expect(normalizeViewport({ preset: 'custom', width: 3840 })).toEqual({
      preset: 'custom',
      width: 3840,
    });
    // fill always carries a null width.
    expect(normalizeViewport({ preset: 'fill', width: 800 })).toEqual({
      preset: 'fill',
      width: null,
    });
    // Unknown presets fall back to fill.
    expect(normalizeViewport({ preset: 'ultrawide', width: 3440 })).toEqual({
      preset: 'fill',
      width: null,
    });
    expect(normalizeViewport(undefined)).toEqual({ preset: 'fill', width: null });
  });

  it('clamps zoom value into 0.25–2 and rejects unknown modes', () => {
    expect(normalizeZoom({ mode: 'manual', value: 5 })).toEqual({ mode: 'manual', value: 2 });
    expect(normalizeZoom({ mode: 'manual', value: 0.1 })).toEqual({ mode: 'manual', value: 0.25 });
    expect(normalizeZoom({ mode: 'manual', value: 'x' })).toEqual({ mode: 'manual', value: 1 });
    expect(normalizeZoom({ mode: 'weird', value: 1.4 })).toEqual({ mode: 'fit', value: 1.4 });
    expect(normalizeZoom(null)).toEqual({ mode: 'fit', value: 1 });
  });

  it('round-trips per identity and keeps identities isolated', () => {
    saveWorkspaceUiState('identity-a', {
      version: 1,
      activePath: 'a.html',
      recents: ['a.html'],
      viewport: { preset: 'mobile', width: 390 },
      zoom: { mode: 'manual', value: 1.25 },
    });
    saveWorkspaceUiState('identity-b', {
      version: 1,
      activePath: 'b.html',
      recents: ['b.html', 'a.html'],
      viewport: { preset: 'fill', width: null },
      zoom: { mode: 'fit', value: 1 },
    });

    expect(loadWorkspaceUiState('identity-a').activePath).toBe('a.html');
    expect(loadWorkspaceUiState('identity-a').viewport).toEqual({ preset: 'mobile', width: 390 });
    expect(loadWorkspaceUiState('identity-b').activePath).toBe('b.html');
    expect(loadWorkspaceUiState('identity-b').recents).toEqual(['b.html', 'a.html']);
    expect(localStorage.getItem('zclaudia-design-ws-identity-a')).not.toBeNull();
    expect(localStorage.getItem('zclaudia-design-ws-identity-b')).not.toBeNull();
    expect(localStorage.getItem(workspaceUiStorageKey('identity-c'))).toBeNull();
  });

  it('treats storage failures as no-ops instead of throwing', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };
    expect(() =>
      saveWorkspaceUiState('k', defaultWorkspaceUiState())
    ).not.toThrow();
    localStorage.setItem = original;

    const originalGet = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => {
      throw new Error('unavailable');
    };
    expect(loadWorkspaceUiState('k')).toEqual(defaultWorkspaceUiState());
    localStorage.getItem = originalGet;
  });
});
