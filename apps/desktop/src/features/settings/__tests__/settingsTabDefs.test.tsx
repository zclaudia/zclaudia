import { describe, it, expect } from 'vitest';
import { getServerTabs } from '../settingsTabDefs';

describe('getServerTabs', () => {
  it('getServerTabs no longer includes plugins or web-search', () => {
    const tabs = getServerTabs({ isActiveLocalBackend: true, pluginSettingsTabs: [] });
    const ids = tabs.map(t => t.id);
    expect(ids).not.toContain('plugins');
    expect(ids).not.toContain('web-search');
  });
});
