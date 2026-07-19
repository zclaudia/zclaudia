import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/platform', () => ({
  isAndroid: vi.fn(() => false),
}));

import { getSettingsTabs } from '../settingsTabDefs';
import { isAndroid } from '../../../utils/platform';

describe('getSettingsTabs', () => {
  beforeEach(() => {
    vi.mocked(isAndroid).mockReturnValue(false);
  });

  it('returns the merged desktop order: General → Claudia → Permissions → plugins → Connection → Debug → About', () => {
    const tabs = getSettingsTabs({
      isMobile: false,
      pluginSettingsTabs: [{ id: 'p1', label: 'My Plugin' }],
    });
    expect(tabs.map(t => t.id)).toEqual([
      'general',
      'agent',
      'permissions',
      'plugin:p1',
      'gateway',
      'debug',
      'about',
    ]);
  });

  it('keeps plugin tabs right after Permissions', () => {
    const tabs = getSettingsTabs({
      isMobile: false,
      pluginSettingsTabs: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    const ids = tabs.map(t => t.id);
    expect(ids.indexOf('plugin:a')).toBe(ids.indexOf('permissions') + 1);
    expect(ids.indexOf('gateway')).toBe(ids.indexOf('plugin:b') + 1);
  });

  it('labels the gateway tab "Connection" on desktop but keeps the gateway id for deep links', () => {
    const tabs = getSettingsTabs({ isMobile: false, pluginSettingsTabs: [] });
    const gateway = tabs.find(t => t.id === 'gateway');
    expect(gateway?.label).toBe('Connection');
  });

  it('keeps the "Gateway" label on mobile', () => {
    const tabs = getSettingsTabs({ isMobile: true, pluginSettingsTabs: [] });
    const gateway = tabs.find(t => t.id === 'gateway');
    expect(gateway?.label).toBe('Gateway');
  });

  it('includes the Notifications tab only on Android', () => {
    expect(
      getSettingsTabs({ isMobile: false, pluginSettingsTabs: [] }).map(t => t.id)
    ).not.toContain('notifications');

    vi.mocked(isAndroid).mockReturnValue(true);
    expect(getSettingsTabs({ isMobile: true, pluginSettingsTabs: [] }).map(t => t.id)).toContain(
      'notifications'
    );
  });

  it('does not include plugins or web-search tabs', () => {
    const ids = getSettingsTabs({ isMobile: false, pluginSettingsTabs: [] }).map(t => t.id);
    expect(ids).not.toContain('plugins');
    expect(ids).not.toContain('web-search');
  });
});
